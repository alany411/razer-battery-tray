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
  /**
   * Calls `listener` each time the HID work ends on its own, not through `restart`, e.g. when an
   * open crashes it. Handles opened before stop working, and calls still running fail.
   */
  onExit?(listener: () => void): void;
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
/** The most rounds in a row an interface in quarantine is left unopened. */
const MAX_QUARANTINE_ROUNDS = 15;
/**
 * Rounds in a row a request may stay hung before the HID work restarts. A hung request holds only
 * its own interface, so it gets longer than a hung open, but it must not hold it for good.
 */
const HUNG_REQUEST_ROUNDS = 3;
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
  const guarded = guard(transport, options.timeoutMs);
  transport.onExit?.(() => guarded.exited());
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
  // Each cable or dongle is its own connection, even two dongles of one model.
  const sameConnection = (a: HidDeviceInfo, b: HidDeviceInfo) => a.productId === b.productId;
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
    // The reason given at the end is the last attempt's, e.g. not found once the device is unplugged.
    skippedHung = false;

    // List again on every retry: the dongle may show up late, e.g. right after resume.
    let interfaces: HidDeviceInfo[];
    try {
      interfaces = attempt === 0 && listed ? listed : await transport.list();
    } catch (error) {
      lastReason = errorMessage(error);
      continue;
    }
    // Any interface that hung before (its open or a request on it) goes last, so if it hangs again
    // the others have had their turn. Then prefer the cable: when it is plugged in it answers even if the dongle is also
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
    // restart every device opens again, so the other interfaces on its connection (the cable or the
    // dongle), which may hang just the same, wait that round too.
    const hung = (c: HidDeviceInfo) =>
      guarded.quarantined(c.path) ||
      (guarded.restarted() &&
        candidates.some((o) => sameConnection(o, c) && guarded.quarantined(o.path)));
    skippedHung = candidates.some(hung);

    for (const candidate of candidates) {
      if (remaining() === 0) {
        lastReason = "poll timed out";
        break attempts;
      }
      if (hung(candidate)) continue;
      // A call that timed out earlier is still running on this connection (the cable or the
      // dongle), so another would only hold another thread.
      if (candidates.some((c) => sameConnection(c, candidate) && guarded.busy(c.path))) {
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
    // Models on disposable batteries have no charging flag. The device just answered the battery
    // request, so no answer to this one does not make it asleep.
    const charging =
      model.rechargeable &&
      (await query(handle, CHARGING_STATUS, transactionId, sleep).catch((error: unknown) => {
        if (error instanceof DeviceAsleepError) return 0;
        throw error;
      })) === 1;
    // A device that is truly empty is off, so a 0% reading through the dongle means it is asleep.
    if (link === "wireless" && batteryByte === 0 && !charging) {
      throw new DeviceAsleepError("device reported 0%");
    }
    return { percent: Math.round((batteryByte / 255) * 100), charging };
  } catch (error) {
    // The handle stays open for the next poll unless a call on it failed. A device that did not
    // answer, or answered something else (e.g. Synapse's request), still has a working handle, and
    // opening again may wait behind a hung open.
    if (!(error instanceof DeviceAsleepError || error instanceof ProtocolError)) {
      await handle.close().catch(() => {});
    }
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
  const read = async () => {
    await sleep(RESPONSE_DELAY_MS);
    return parseResponse(command, await handle.getFeatureReport(0, REPORT_LENGTH + 1));
  };
  let parsed = await read();
  // A busy device may have the answer ready a moment later, without asking again.
  if (!parsed.ok && parsed.busy) parsed = await read();
  if (!parsed.ok)
    throw parsed.deviceDidNotAnswer
      ? new DeviceAsleepError(parsed.reason)
      : new ProtocolError(parsed.reason);
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
   * Calls `restart` if an open or listing from earlier has been running for the HID timeout, since
   * every new one would wait behind it, or if a call on an interface has been running for the HID
   * timeout at the start of 3 rounds in a row, and quarantines the interface whose open or call hung.
   * One that has run for less, e.g. cut short by the deadline of a round just before, is left to
   * finish.
   */
  newRound(restart: () => void): void;
  /**
   * Forgets every call and handle, since the HID work ended on its own. An open running at that
   * moment may have ended it, so its interface is quarantined at once, and the other interfaces on
   * its connection wait for the rest of this round and the next, as after a restart.
   */
  exited(): void;
}

interface Quarantine {
  /** Opens that hung since the interface last opened or left a listing. */
  hangs: number;
  roundsLeft: number;
}

/** A call on an interface; `old` once it has run for the HID timeout. */
interface RunningCall {
  old: boolean;
}

/** HID calls made since the last restart. */
interface Calls {
  running: Map<string, Set<RunningCall>>;
  /** Rounds in a row that began with an old call running on the interface. */
  busyRounds: Map<string, number>;
  handles: Map<string, HidHandle>;
  /** The open or listing that is running. `path` is the interface being opened, if it is an open. */
  head?: { path: string | undefined; old: boolean };
  /** Opens and listings waiting for their turn, first come first served. */
  waiting: Waiting[];
  listing?: Promise<HidDeviceInfo[]>;
  lastListed?: HidDeviceInfo[];
}

interface Waiting {
  start(): void;
  /** Gives up waiting, e.g. because the HID work these calls were for has ended. */
  cancel(error: Error): void;
}

/**
 * Keeps hung HID calls from piling up. node-hid runs each call on one of a few shared threads, and
 * a timeout does not stop it. It also opens and lists one at a time for the whole process, so a
 * hung open or listing holds up every later one until the HID work is restarted. So this keeps
 * handles open between polls, starts one open or listing at a time and lets the others wait their
 * turn, gives the last listing while an open or listing is still running, restarts at the next
 * round, and `busy` tells which interfaces to leave alone.
 */
function guard(transport: HidTransport, timeoutMs = HID_TIMEOUT_MS): GuardedTransport {
  let calls = freshCalls();
  let restarted = false;
  /** Whether the next round counts as a restart, since an open ended the HID work on its own. */
  let exitedOpening = false;
  // Each hang doubles the rounds an interface is left alone: 1, 2, 4 and so on. `extra` covers the
  // rest of the round it hung in.
  const quarantineHang = (path: string, extra = 0) => {
    const hangs = (quarantine.get(path)?.hangs ?? 0) + 1;
    quarantine.set(path, {
      hangs,
      roundsLeft: Math.min(2 ** (hangs - 1), MAX_QUARANTINE_ROUNDS) + extra,
    });
  };
  const dropCalls = (reason: string) => {
    for (const waiting of calls.waiting) waiting.cancel(new Error(reason));
    calls.waiting = [];
    calls = freshCalls();
  };
  // Keyed by path. Kept across restarts.
  const quarantine = new Map<string, Quarantine>();

  return {
    busy: (path) => calls.running.has(path),
    quarantined: (path) => (quarantine.get(path)?.roundsLeft ?? 0) > 0,
    hungBefore: (path) => quarantine.has(path),
    restarted: () => restarted,
    newRound: (restart) => {
      for (const q of quarantine.values()) q.roundsLeft = Math.max(0, q.roundsLeft - 1);
      const busyRounds = new Map<string, number>();
      for (const [path, running] of calls.running) {
        if ([...running].some((call) => call.old)) {
          busyRounds.set(path, (calls.busyRounds.get(path) ?? 0) + 1);
        }
      }
      calls.busyRounds = busyRounds;
      const hung = new Set(
        [...busyRounds].filter(([, rounds]) => rounds >= HUNG_REQUEST_ROUNDS).map(([path]) => path),
      );
      const hungOpen = calls.head?.old ? calls.head : undefined;
      if (hungOpen?.path !== undefined) hung.add(hungOpen.path);
      const restarting = hungOpen !== undefined || hung.size > 0;
      restarted = restarting || exitedOpening;
      exitedOpening = false;
      if (!restarting) return;
      for (const path of hung) quarantineHang(path);
      dropCalls("HID process restarted");
      restart();
    },
    exited: () => {
      const opening = calls.head?.path;
      if (opening !== undefined) {
        quarantineHang(opening, 1);
        restarted = true;
        exitedOpening = true;
      }
      dropCalls("HID process exited");
    },
    list: (limit) => {
      const current = calls;
      if (current.lastListed && (current.head || current.waiting.length > 0)) {
        return Promise.resolve(current.lastListed);
      }
      if (current.listing) return timeout(current.listing, limit());
      const listing = inTurn(current, timeoutMs, undefined, limit, () => {
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
        return await inTurn(current, timeoutMs, path, limit, () => {
          opened = track(current, path, timeoutMs, transport.open(path)).then((raw) => {
            quarantine.delete(path);
            const handle: HidHandle = {
              sendFeatureReport: (data) =>
                track(current, path, timeoutMs, raw.sendFeatureReport(data)),
              getFeatureReport: (reportId, length) =>
                track(current, path, timeoutMs, raw.getFeatureReport(reportId, length)),
              close: () => {
                if (current.handles.get(path) === handle) current.handles.delete(path);
                return track(current, path, timeoutMs, raw.close());
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
  return { running: new Map(), busyRounds: new Map(), handles: new Map(), waiting: [] };
}

/**
 * Starts `start` once the open or listing running and those waiting before it have settled, then
 * gives it `limit` to finish. Gives up waiting after `limit`, and then never starts it.
 */
function inTurn<T>(
  calls: Calls,
  timeoutMs: number,
  path: string | undefined,
  limit: Limit,
  start: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      if (calls.waiting[0] === waiting) calls.waiting.shift();
      const head = { path, old: false };
      calls.head = head;
      // Set before the call's own time limit, so a call given the whole HID timeout is old by the
      // time it times out.
      const aging = setTimeout(() => {
        head.old = true;
      }, timeoutMs);
      const call = start();
      settled(call, () => {
        clearTimeout(aging);
        if (calls.head === head) delete calls.head;
        calls.waiting[0]?.start();
      });
      timeout(call, limit()).then(resolve, reject);
    };
    const waiting: Waiting = {
      start: run,
      cancel: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    if (!calls.head && calls.waiting.length === 0) return run();
    calls.waiting.push(waiting);
    timer = setTimeout(() => {
      calls.waiting.splice(calls.waiting.indexOf(waiting), 1);
      reject(new Error("HID request timed out"));
    }, limit());
  });
}

/** Counts `call` as running on this interface until it settles, and as old after `timeoutMs`. */
function track<T>(
  { running }: Calls,
  path: string,
  timeoutMs: number,
  call: Promise<T>,
): Promise<T> {
  const entry: RunningCall = { old: false };
  const onPath = running.get(path) ?? new Set();
  running.set(path, onPath.add(entry));
  const aging = setTimeout(() => {
    entry.old = true;
  }, timeoutMs);
  settled(call, () => {
    clearTimeout(aging);
    onPath.delete(entry);
    if (onPath.size === 0 && running.get(path) === onPath) running.delete(path);
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

/** A response came back, but not the answer: a busy or other status, or another request's answer. */
class ProtocolError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
