import { findConnection } from "./device-table.js";
import type { DeviceModel } from "./device-table.js";
import {
  BATTERY_LEVEL,
  CHARGING_STATUS,
  REPORT_LENGTH,
  buildRequest,
  parseResponse,
} from "./razer-protocol.js";
import type { Command } from "./razer-protocol.js";

export const RAZER_VENDOR_ID = 0x1532;

export interface BatteryReading {
  percent: number;
  charging: boolean;
}

export type PollResult =
  | { kind: "reading"; reading: BatteryReading }
  | { kind: "asleep" }
  | { kind: "unavailable"; reason: string };

export interface DevicePoll {
  model: DeviceModel;
  result: PollResult;
}

/** A poll of each connected device. `reason` says why listing devices failed, if it did. */
export type PollRound =
  | { kind: "devices"; devices: DevicePoll[] }
  | { kind: "none"; reason?: string };

export interface HidDeviceInfo {
  productId: number;
  path: string;
}

export interface HidHandle {
  /** `data` starts with the report ID byte. */
  sendFeatureReport(data: Uint8Array): Promise<void>;
  getFeatureReport(reportId: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Razer HID devices (vendor ID 0x1532), one entry per interface. */
export interface HidTransport {
  list(): Promise<HidDeviceInfo[]>;
  open(path: string): Promise<HidHandle>;
}

export interface PollOptions {
  sleep?: (ms: number) => Promise<void>;
  /** How long a single HID call may take before it counts as failed. */
  timeoutMs?: number;
  /**
   * How long one device's poll, retries included, may take. Finding the devices before that has
   * a limit of the same length, so a round takes at most twice this.
   */
  deadlineMs?: number;
  now?: () => number;
}

const RETRIES = 3;
const RETRY_DELAY_MS = 500;
/** Time the device (or the dongle relaying to it) needs between a request and its response. */
const RESPONSE_DELAY_MS = 50;
const HID_TIMEOUT_MS = 2_000;
// Keeps Refresh now responsive (at most twice this per round) even when every interface is stuck.
const POLL_DEADLINE_MS = 10_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns a function that polls every connected device in the device table at once. For each
 * device it remembers which HID interface last gave a battery reading and tries it first, so
 * interfaces that stall cannot use up the poll's time limit.
 */
export function createBatteryPoller(
  transport: HidTransport,
  options: PollOptions = {},
): () => Promise<PollRound> {
  const memory: RoundMemory = { devices: new Map(), lastModels: [] };
  const guarded = guard(transport);
  return () => pollRound(guarded, options, memory);
}

/** Polls one model, whether or not it is connected. */
export function pollDevice(
  transport: HidTransport,
  model: DeviceModel,
  options: PollOptions = {},
): Promise<PollResult> {
  return poll(guard(transport), model, timing(options), {});
}

interface PollMemory {
  lastPath?: string;
}

interface RoundMemory {
  /** Keyed by model name. */
  devices: Map<string, PollMemory>;
  /** The models found by the last listing that worked. */
  lastModels: DeviceModel[];
}

interface Timing {
  timeoutMs: number;
  deadline: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function timing({
  sleep = defaultSleep,
  timeoutMs = HID_TIMEOUT_MS,
  deadlineMs = POLL_DEADLINE_MS,
  now = Date.now,
}: PollOptions): Timing {
  return { sleep, timeoutMs, deadline: now() + deadlineMs, now };
}

async function pollRound(
  transport: GuardedTransport,
  options: PollOptions,
  memory: RoundMemory,
): Promise<PollRound> {
  const time = timing(options);
  const remaining = () => Math.max(0, time.deadline - time.now());
  const timed = withTimeouts(transport, () => Math.min(time.timeoutMs, remaining()));

  let models: DeviceModel[] = [];
  let reason: string | undefined;
  let listed = false;
  for (let attempt = 0; attempt <= RETRIES && models.length === 0; attempt++) {
    if (attempt > 0) await time.sleep(Math.min(RETRY_DELAY_MS, remaining()));
    if (remaining() === 0) {
      reason = "poll timed out";
      break;
    }
    try {
      models = connectedModels(await timed.list());
      listed = true;
      reason = undefined;
    } catch (error) {
      reason = errorMessage(error);
    }
  }
  if (listed) memory.lastModels = models;
  if (models.length === 0) {
    if (!reason) return { kind: "none" };
    // A listing that failed is not an unplugged device, so keep the devices found before.
    if (memory.lastModels.length === 0) return { kind: "none", reason };
    const result: PollResult = { kind: "unavailable", reason };
    return { kind: "devices", devices: memory.lastModels.map((model) => ({ model, result })) };
  }

  // Polled side by side, each with its own time limit, so a device that stalls cannot hold up
  // the others.
  const devices = await Promise.all(
    models.map(async (model) => {
      let modelMemory = memory.devices.get(model.name);
      if (!modelMemory) memory.devices.set(model.name, (modelMemory = {}));
      return { model, result: await poll(transport, model, timing(options), modelMemory) };
    }),
  );
  return { kind: "devices", devices };
}

/** The table models with at least one interface present, in the order first seen. */
function connectedModels(interfaces: HidDeviceInfo[]): DeviceModel[] {
  return [...new Set(interfaces.flatMap((i) => findConnection(i.productId)?.model ?? []))];
}

async function poll(
  guarded: GuardedTransport,
  model: DeviceModel,
  { sleep, timeoutMs, deadline, now }: Timing,
  memory: PollMemory,
): Promise<PollResult> {
  const remaining = () => Math.max(0, deadline - now());
  // A stuck device or dongle (or another app holding it) must not stall polling forever.
  const transport = withTimeouts(guarded, () => Math.min(timeoutMs, remaining()));
  // Waits count against the deadline too.
  const wait = (ms: number) => sleep(Math.min(ms, remaining()));
  const linkOf = (i: HidDeviceInfo) => {
    const found = findConnection(i.productId);
    return found?.model === model ? found.link : undefined;
  };
  const isWired = (i: HidDeviceInfo) => linkOf(i) === "wired";
  const isWireless = (i: HidDeviceInfo) => linkOf(i) === "wireless";

  let lastReason = "";
  let deviceAsleep = false;
  let wired = false;
  attempts: for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAY_MS);
    if (remaining() === 0) {
      lastReason = "poll timed out";
      break;
    }

    // List again on every attempt: the dongle may show up late, e.g. right after resume.
    let interfaces: HidDeviceInfo[];
    try {
      interfaces = await transport.list();
    } catch (error) {
      lastReason = errorMessage(error);
      continue;
    }
    // Prefer the cable: when it is plugged in it answers even if the dongle is also present.
    // Then the interface that answered last time.
    const candidates = [...interfaces.filter(isWired), ...interfaces.filter(isWireless)].toSorted(
      (a, b) => Number(b.path === memory.lastPath) - Number(a.path === memory.lastPath),
    );
    if (candidates.length === 0) {
      lastReason = "device not found";
      deviceAsleep = false;
      continue;
    }
    // Like Asleep, the cable counts only if it is still connected on the latest attempt.
    wired = candidates.some(isWired);
    // Asleep needs the dongle to be present now, not just on an earlier attempt.
    if (!candidates.some(isWireless)) deviceAsleep = false;

    for (const candidate of candidates) {
      if (remaining() === 0) {
        lastReason = "poll timed out";
        break attempts;
      }
      // A call that timed out earlier is still running, so another would only hold another thread.
      if (candidates.some((c) => guarded.busy(c.path))) {
        lastReason = "device is not responding";
        break;
      }
      try {
        const reading = await readFrom(transport, model, candidate, wait);
        memory.lastPath = candidate.path;
        return { kind: "reading", reading };
      } catch (error) {
        lastReason = errorMessage(error);
        if (error instanceof DeviceAsleepError) deviceAsleep = true;
      }
    }
  }

  return !wired && deviceAsleep ? { kind: "asleep" } : { kind: "unavailable", reason: lastReason };
}

async function readFrom(
  transport: HidTransport,
  model: DeviceModel,
  candidate: HidDeviceInfo,
  sleep: (ms: number) => Promise<void>,
): Promise<BatteryReading> {
  const connection = findConnection(candidate.productId);
  if (!connection) throw new Error("device not found");
  const { link, transactionId } = connection;
  const handle = await transport.open(candidate.path);
  try {
    const batteryByte = await query(handle, BATTERY_LEVEL, transactionId, sleep);
    // Models on disposable batteries have no charging flag.
    const charging =
      model.rechargeable && (await query(handle, CHARGING_STATUS, transactionId, sleep)) === 1;
    // A device that is truly empty is off, so a 0% reading through the dongle means it is asleep.
    if (link === "wireless" && batteryByte === 0 && !charging) {
      throw new DeviceAsleepError("device reported 0%");
    }
    return { percent: Math.round((batteryByte / 255) * 100), charging };
  } catch (error) {
    // The handle stays open for the next poll unless something went wrong with it.
    await handle.close().catch(() => {});
    throw error;
  }
}

async function query(
  handle: HidHandle,
  command: Command,
  transactionId: number,
  sleep: (ms: number) => Promise<void>,
): Promise<number> {
  const report = new Uint8Array(REPORT_LENGTH + 1);
  report.set(buildRequest(command, transactionId), 1);
  await handle.sendFeatureReport(report);
  await sleep(RESPONSE_DELAY_MS);
  const parsed = parseResponse(command, await handle.getFeatureReport(0, REPORT_LENGTH + 1));
  if (!parsed.ok)
    throw parsed.deviceDidNotAnswer
      ? new DeviceAsleepError(parsed.reason)
      : new Error(parsed.reason);
  return parsed.value;
}

interface GuardedTransport extends HidTransport {
  /** Whether a call on this interface is still running, e.g. one that timed out but never returned. */
  busy(path: string): boolean;
}

/**
 * Keeps hung HID calls from piling up. node-hid runs each call on one of a few shared threads, and
 * a timeout does not stop it. It also opens and lists one at a time for the whole app, so a hung
 * open or listing holds up every later one. So this keeps handles open between polls, gives the
 * last listing while an open or listing is still running, and `busy` tells which interfaces to
 * leave alone.
 */
function guard(transport: HidTransport): GuardedTransport {
  const running = new Map<string, number>();
  const handles = new Map<string, HidHandle>();
  // Opens and listings still running, which hold up any new one.
  let queued = 0;
  let listing: Promise<HidDeviceInfo[]> | undefined;
  let lastListed: HidDeviceInfo[] | undefined;

  const track = <T>(path: string, call: Promise<T>): Promise<T> => {
    running.set(path, (running.get(path) ?? 0) + 1);
    settled(call, () => {
      const left = (running.get(path) ?? 1) - 1;
      if (left === 0) running.delete(path);
      else running.set(path, left);
    });
    return call;
  };
  const inQueue = <T>(call: Promise<T>): Promise<T> => {
    queued++;
    settled(call, () => queued--);
    return call;
  };

  return {
    busy: (path) => running.has(path),
    list: () => {
      if (lastListed && queued > 0) return Promise.resolve(lastListed);
      if (listing) return listing;
      const started = inQueue(transport.list());
      listing = started;
      started.then(
        (listed) => {
          listing = undefined;
          lastListed = listed;
          // Let go of interfaces that are gone, e.g. an unplugged dongle.
          for (const [path, handle] of handles) {
            if (!listed.some((i) => i.path === path)) void handle.close().catch(() => {});
          }
        },
        () => {
          listing = undefined;
        },
      );
      return started;
    },
    open: async (path) => {
      const open = handles.get(path);
      if (open) return open;
      const raw = await track(path, inQueue(transport.open(path)));
      const handle: HidHandle = {
        sendFeatureReport: (data) => track(path, raw.sendFeatureReport(data)),
        getFeatureReport: (reportId, length) => track(path, raw.getFeatureReport(reportId, length)),
        close: () => {
          if (handles.get(path) === handle) handles.delete(path);
          return track(path, raw.close());
        },
      };
      handles.set(path, handle);
      return handle;
    },
  };
}

/** Runs `done` once `call` settles, either way. */
function settled(call: Promise<unknown>, done: () => void): void {
  void call.then(done, done);
}

function withTimeouts(transport: HidTransport, ms: () => number): HidTransport {
  return {
    list: () => timeout(transport.list(), ms()),
    open: async (path) => {
      const opening = transport.open(path);
      const handle = await timeout(opening, ms()).catch((error: unknown) => {
        // If it opens after all, close it so the interface is not left held.
        void opening.then((late) => late.close()).catch(() => {});
        throw error;
      });
      return {
        sendFeatureReport: (data) => timeout(handle.sendFeatureReport(data), ms()),
        getFeatureReport: (reportId, length) =>
          timeout(handle.getFeatureReport(reportId, length), ms()),
        close: () => timeout(handle.close(), ms()),
      };
    },
  };
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("HID request timed out")), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** The device did not answer the request, or answered 0% through the dongle while not charging. */
class DeviceAsleepError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
