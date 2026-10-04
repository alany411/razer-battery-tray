import {
  BATTERY_LEVEL,
  CHARGING_STATUS,
  REPORT_LENGTH,
  buildRequest,
  parseResponse,
} from "./razer-protocol.js";
import type { Command } from "./razer-protocol.js";

export const RAZER_VENDOR_ID = 0x1532;
export const WIRED_PRODUCT_ID = 0x00b6;
export const DONGLE_PRODUCT_ID = 0x00b7;

export interface BatteryReading {
  percent: number;
  charging: boolean;
}

export type PollResult =
  | { kind: "reading"; reading: BatteryReading }
  | { kind: "asleep" }
  | { kind: "unavailable"; reason: string };

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
}

const RETRIES = 3;
const RETRY_DELAY_MS = 500;
/** Time the mouse (or the dongle relaying to it) needs between a request and its response. */
const RESPONSE_DELAY_MS = 50;
const HID_TIMEOUT_MS = 2_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollBattery(
  transport: HidTransport,
  { sleep = defaultSleep, timeoutMs = HID_TIMEOUT_MS }: PollOptions = {},
): Promise<PollResult> {
  // A stuck mouse or dongle (or another app holding it) must not stall polling forever.
  transport = withTimeouts(transport, timeoutMs);
  let interfaces: HidDeviceInfo[];
  try {
    interfaces = await transport.list();
  } catch (error) {
    return { kind: "unavailable", reason: errorMessage(error) };
  }

  // Prefer the cable: when it is plugged in it answers even if the dongle is also present.
  const candidates = [
    ...interfaces.filter((i) => i.productId === WIRED_PRODUCT_ID),
    ...interfaces.filter((i) => i.productId === DONGLE_PRODUCT_ID),
  ];
  if (candidates.length === 0) {
    return { kind: "unavailable", reason: "mouse not found" };
  }

  let lastReason = "";
  let mouseAsleep = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    for (const candidate of candidates) {
      try {
        return { kind: "reading", reading: await readFrom(transport, candidate, sleep) };
      } catch (error) {
        lastReason = errorMessage(error);
        if (error instanceof MouseAsleepError) mouseAsleep = true;
      }
    }
  }

  const wired = candidates.some((c) => c.productId === WIRED_PRODUCT_ID);
  return !wired && mouseAsleep ? { kind: "asleep" } : { kind: "unavailable", reason: lastReason };
}

async function readFrom(
  transport: HidTransport,
  candidate: HidDeviceInfo,
  sleep: (ms: number) => Promise<void>,
): Promise<BatteryReading> {
  const handle = await transport.open(candidate.path);
  try {
    const batteryByte = await query(handle, BATTERY_LEVEL, sleep);
    const charging = (await query(handle, CHARGING_STATUS, sleep)) === 1;
    // A mouse that is truly empty is off, so a 0% reading through the dongle means it is asleep.
    if (candidate.productId === DONGLE_PRODUCT_ID && batteryByte === 0 && !charging) {
      throw new MouseAsleepError("mouse reported 0%");
    }
    return { percent: Math.round((batteryByte / 255) * 100), charging };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function query(
  handle: HidHandle,
  command: Command,
  sleep: (ms: number) => Promise<void>,
): Promise<number> {
  const report = new Uint8Array(REPORT_LENGTH + 1);
  report.set(buildRequest(command), 1);
  await handle.sendFeatureReport(report);
  await sleep(RESPONSE_DELAY_MS);
  const parsed = parseResponse(command, await handle.getFeatureReport(0, REPORT_LENGTH + 1));
  if (!parsed.ok)
    throw parsed.mouseDidNotAnswer ? new MouseAsleepError(parsed.reason) : new Error(parsed.reason);
  return parsed.value;
}

function withTimeouts(transport: HidTransport, ms: number): HidTransport {
  return {
    list: () => timeout(transport.list(), ms),
    open: async (path) => {
      const opening = transport.open(path);
      const handle = await timeout(opening, ms).catch((error: unknown) => {
        // If it opens after all, close it so the interface is not left held.
        void opening.then((late) => late.close()).catch(() => {});
        throw error;
      });
      return {
        sendFeatureReport: (data) => timeout(handle.sendFeatureReport(data), ms),
        getFeatureReport: (reportId, length) =>
          timeout(handle.getFeatureReport(reportId, length), ms),
        close: () => timeout(handle.close(), ms),
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

/** The mouse did not answer the request, or answered 0% through the dongle while not charging. */
class MouseAsleepError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
