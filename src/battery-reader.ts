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

export interface RestartableHidTransport extends HidTransport {
  /**
   * Starts the HID work over, ending every call still running, e.g. an open that never returns.
   * Handles opened before stop working.
   */
  restart(): void;
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
/** The most rounds in a row an interface whose open hung is left unopened. */
const MAX_QUARANTINE_ROUNDS = 15;
const QUARANTINED = "device stopped responding";

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns a function that polls every connected device in the device table at once. For each
 * device it remembers which HID interface last gave a battery reading and tries it first, so
 * interfaces that stall cannot use up the poll's time limit.
 */
export function createBatteryPoller(
  transport: RestartableHidTransport,
  options: PollOptions = {},
): () => Promise<PollRound> {
  const memory: RoundMemory = { devices: new Map(), lastModels: [] };
  const guarded = guard(transport);
  return () => pollRound(guarded, () => transport.restart(), options, memory);
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
  restart: () => void,
  options: PollOptions,
  memory: RoundMemory,
): Promise<PollRound> {
  const time = timing(options);
  const remaining = () => Math.max(0, time.deadline - time.now());
  const timed = withTimeouts(transport, () => Math.min(time.timeoutMs, remaining()));
  transport.newRound(restart);

  let interfaces: HidDeviceInfo[] = [];
  let models: DeviceModel[] = [];
  let reason: string | undefined;
  let listed = false;
  for (let attempt = 0; attempt <= RETRIES && models.length === 0; attempt++) {
    if (attempt > 0) await time.sleep(Math.min(RETRY_DELAY_MS, remaining()));
    if (remaining() === 0) {
      reason = "listing devices timed out";
      break;
    }
    try {
      interfaces = await timed.list();
      models = connectedModels(interfaces);
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
      const result = await poll(transport, model, timing(options), modelMemory, interfaces);
      return { model, result };
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
  /** What the round's listing found, used instead of listing again on the first attempt. */
  listed?: HidDeviceInfo[],
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
  let skippedHung = false;
  attempts: for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAY_MS);
    if (remaining() === 0) {
      lastReason = "poll timed out";
      break;
    }

    // List again on every retry: the dongle may show up late, e.g. right after resume.
    let interfaces: HidDeviceInfo[];
    try {
      interfaces = attempt === 0 && listed ? listed : await transport.list();
    } catch (error) {
      lastReason = errorMessage(error);
      continue;
    }
    // Any interface whose open hung before goes last, so if it hangs again the others have had
    // their turn. Then prefer the cable: when it is plugged in it answers even if the dongle is also
    // present. Then the interface that answered last time.
    const candidates = interfaces
      .filter((i) => linkOf(i) !== undefined)
      .toSorted(
        (a, b) =>
          Number(guarded.hungBefore(a.path)) - Number(guarded.hungBefore(b.path)) ||
          Number(isWired(b)) - Number(isWired(a)) ||
          Number(b.path === memory.lastPath) - Number(a.path === memory.lastPath),
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
    // Opening it could hang the HID work again before the other devices are opened. Right after a
    // restart every device opens again, so the other interfaces on its link (the cable or the
    // dongle), which may hang just the same, wait that round too.
    const hung = (c: HidDeviceInfo) =>
      guarded.quarantined(c.path) ||
      (guarded.restarted() &&
        candidates.some((o) => linkOf(o) === linkOf(c) && guarded.quarantined(o.path)));
    skippedHung = candidates.some(hung);

    for (const candidate of candidates) {
      if (remaining() === 0) {
        lastReason = "poll timed out";
        break attempts;
      }
      if (hung(candidate)) continue;
      // A call that timed out earlier is still running on this link (the cable or the dongle), so
      // another would only hold another thread.
      if (candidates.some((c) => linkOf(c) === linkOf(candidate) && guarded.busy(c.path))) {
        lastReason = "device is not responding";
        continue;
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

  // Other interfaces failing or not answering says less than the one that hung, which was not tried.
  if (skippedHung) return { kind: "unavailable", reason: QUARANTINED };
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
    // The handle stays open for the next poll unless something went wrong with it. A device that
    // did not answer still has a working handle, and opening again may wait behind a hung open.
    if (!(error instanceof DeviceAsleepError)) await handle.close().catch(() => {});
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

/** How long a call may take, read when it starts: the HID timeout, clipped to the poll deadline. */
type Limit = () => number;

interface GuardedTransport {
  /** Waits its turn behind a running open or listing for up to `limit`, then lists within `limit`. */
  list(limit: Limit): Promise<HidDeviceInfo[]>;
  /** Waits its turn behind a running open or listing for up to `limit`, then opens within `limit`. */
  open(path: string, limit: Limit): Promise<HidHandle>;
  /** Whether a call on this interface is still running, e.g. one that timed out but never returned. */
  busy(path: string): boolean;
  /** Whether this interface is left unopened this round because an open of it hung. */
  quarantined(path: string): boolean;
  /** Whether an open of this interface hung since it last opened or left a listing. */
  hungBefore(path: string): boolean;
  /** Whether this round began with a restart. */
  restarted(): boolean;
  /**
   * Calls `restart` if an open or listing from earlier is still running, since every new one would
   * wait behind it, and quarantines the interface whose open hung.
   */
  newRound(restart: () => void): void;
}

interface Quarantine {
  /** Opens that hung since the interface last opened or left a listing. */
  hangs: number;
  roundsLeft: number;
}

/** HID calls made since the last restart. */
interface Calls {
  running: Map<string, number>;
  handles: Map<string, HidHandle>;
  /** The open or listing that is running. `path` is the interface being opened, if it is an open. */
  head?: { path: string | undefined };
  /** Opens and listings waiting for their turn, first come first served. */
  waiting: (() => void)[];
  listing?: Promise<HidDeviceInfo[]>;
  lastListed?: HidDeviceInfo[];
}

/**
 * Keeps hung HID calls from piling up. node-hid runs each call on one of a few shared threads, and
 * a timeout does not stop it. It also opens and lists one at a time for the whole process, so a
 * hung open or listing holds up every later one until the HID work is restarted. So this keeps
 * handles open between polls, starts one open or listing at a time and lets the others wait their
 * turn, gives the last listing while an open or listing is still running, restarts at the next
 * round, and `busy` tells which interfaces to leave alone.
 */
function guard(transport: HidTransport): GuardedTransport {
  let calls = freshCalls();
  let restarted = false;
  // Keyed by path. Kept across restarts.
  const quarantine = new Map<string, Quarantine>();

  return {
    busy: (path) => calls.running.has(path),
    quarantined: (path) => (quarantine.get(path)?.roundsLeft ?? 0) > 0,
    hungBefore: (path) => quarantine.has(path),
    restarted: () => restarted,
    newRound: (restart) => {
      for (const q of quarantine.values()) q.roundsLeft = Math.max(0, q.roundsLeft - 1);
      const hung = calls.head;
      restarted = hung !== undefined;
      if (!hung) return;
      if (hung.path !== undefined) {
        // Each hang doubles the rounds it is left alone: 1, 2, 4 and so on.
        const hangs = (quarantine.get(hung.path)?.hangs ?? 0) + 1;
        quarantine.set(hung.path, {
          hangs,
          roundsLeft: Math.min(2 ** (hangs - 1), MAX_QUARANTINE_ROUNDS),
        });
      }
      calls = freshCalls();
      restart();
    },
    list: (limit) => {
      const current = calls;
      if (current.lastListed && (current.head || current.waiting.length > 0)) {
        return Promise.resolve(current.lastListed);
      }
      if (current.listing) return timeout(current.listing, limit());
      const listing = inTurn(current, undefined, limit, () => {
        const call = transport.list();
        call.then(
          (listed) => {
            current.lastListed = listed;
            // Let go of interfaces that are gone, e.g. an unplugged dongle. Plugged in again, it
            // gets a fresh start.
            for (const [path, handle] of current.handles) {
              if (!listed.some((i) => i.path === path)) void handle.close().catch(() => {});
            }
            for (const path of quarantine.keys()) {
              if (!listed.some((i) => i.path === path)) quarantine.delete(path);
            }
          },
          () => {},
        );
        return call;
      });
      current.listing = listing;
      settled(listing, () => {
        if (current.listing === listing) delete current.listing;
      });
      return listing;
    },
    open: async (path, limit) => {
      const current = calls;
      const open = current.handles.get(path);
      if (open) return open;
      let opened: Promise<HidHandle> | undefined;
      try {
        return await inTurn(current, path, limit, () => {
          opened = track(current, path, transport.open(path)).then((raw) => {
            quarantine.delete(path);
            const handle: HidHandle = {
              sendFeatureReport: (data) => track(current, path, raw.sendFeatureReport(data)),
              getFeatureReport: (reportId, length) =>
                track(current, path, raw.getFeatureReport(reportId, length)),
              close: () => {
                if (current.handles.get(path) === handle) current.handles.delete(path);
                return track(current, path, raw.close());
              },
            };
            current.handles.set(path, handle);
            return handle;
          });
          return opened;
        });
      } catch (error) {
        // If it opens after all, close it so the interface is not left held.
        void opened?.then((late) => late.close()).catch(() => {});
        throw error;
      }
    },
  };
}

function freshCalls(): Calls {
  return { running: new Map(), handles: new Map(), waiting: [] };
}

/**
 * Starts `start` once the open or listing running and those waiting before it have settled, then
 * gives it `limit` to finish. Gives up waiting after `limit`, and then never starts it.
 */
function inTurn<T>(
  calls: Calls,
  path: string | undefined,
  limit: Limit,
  start: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      const head = { path };
      calls.head = head;
      const call = start();
      settled(call, () => {
        if (calls.head === head) delete calls.head;
        calls.waiting.shift()?.();
      });
      timeout(call, limit()).then(resolve, reject);
    };
    if (!calls.head && calls.waiting.length === 0) return run();
    calls.waiting.push(run);
    timer = setTimeout(() => {
      calls.waiting.splice(calls.waiting.indexOf(run), 1);
      reject(new Error("HID request timed out"));
    }, limit());
  });
}

/** Counts `call` as running on this interface until it settles. */
function track<T>({ running }: Calls, path: string, call: Promise<T>): Promise<T> {
  running.set(path, (running.get(path) ?? 0) + 1);
  settled(call, () => {
    const left = (running.get(path) ?? 1) - 1;
    if (left === 0) running.delete(path);
    else running.set(path, left);
  });
  return call;
}

/** Runs `done` once `call` settles, either way. */
function settled(call: Promise<unknown>, done: () => void): void {
  void call.then(done, done);
}

/** Gives each call on `guarded` the time limit `limit` reads when the call starts. */
function withTimeouts(guarded: GuardedTransport, limit: Limit): HidTransport {
  return {
    list: () => guarded.list(limit),
    open: async (path) => {
      const handle = await guarded.open(path, limit);
      return {
        sendFeatureReport: (data) => timeout(handle.sendFeatureReport(data), limit()),
        getFeatureReport: (reportId, length) =>
          timeout(handle.getFeatureReport(reportId, length), limit()),
        close: () => timeout(handle.close(), limit()),
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
