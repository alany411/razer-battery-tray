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

export type BatteryReading =
  | { kind: "ok"; percent: number; charging: boolean }
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

export interface ReadOptions {
  attempts?: number;
  retryDelayMs?: number;
  /** Time the mouse (or the dongle relaying to it) needs between a request and its response. */
  responseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readBattery(
  transport: HidTransport,
  {
    attempts = 3,
    retryDelayMs = 500,
    responseDelayMs = 50,
    sleep = defaultSleep,
  }: ReadOptions = {},
): Promise<BatteryReading> {
  let devices: HidDeviceInfo[];
  try {
    devices = await transport.list();
  } catch (error) {
    return { kind: "unavailable", reason: errorMessage(error) };
  }

  // Prefer the cable: when it is plugged in it answers even if the dongle is also present.
  const candidates = [
    ...devices.filter((d) => d.productId === WIRED_PRODUCT_ID),
    ...devices.filter((d) => d.productId === DONGLE_PRODUCT_ID),
  ];
  if (candidates.length === 0) {
    return { kind: "unavailable", reason: "mouse not found" };
  }

  let lastReason = "";
  let mouseDidNotAnswer = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs);
    for (const device of candidates) {
      try {
        return await readFrom(transport, device.path, responseDelayMs, sleep);
      } catch (error) {
        lastReason = errorMessage(error);
        if (error instanceof NoAnswerError) mouseDidNotAnswer = true;
      }
    }
  }

  const wired = candidates.some((d) => d.productId === WIRED_PRODUCT_ID);
  return !wired && mouseDidNotAnswer
    ? { kind: "asleep" }
    : { kind: "unavailable", reason: lastReason };
}

async function readFrom(
  transport: HidTransport,
  path: string,
  responseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<BatteryReading> {
  const handle = await transport.open(path);
  try {
    const level = await query(handle, BATTERY_LEVEL, responseDelayMs, sleep);
    const charging = await query(handle, CHARGING_STATUS, responseDelayMs, sleep);
    return { kind: "ok", percent: Math.round((level / 255) * 100), charging: charging === 1 };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function query(
  handle: HidHandle,
  command: Command,
  responseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<number> {
  const report = new Uint8Array(REPORT_LENGTH + 1);
  report.set(buildRequest(command), 1);
  await handle.sendFeatureReport(report);
  await sleep(responseDelayMs);
  const parsed = parseResponse(command, await handle.getFeatureReport(0, REPORT_LENGTH + 1));
  if (!parsed.ok)
    throw parsed.replied ? new NoAnswerError(parsed.reason) : new Error(parsed.reason);
  return parsed.value;
}

/** The dongle replied, but the mouse did not answer the request. */
class NoAnswerError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
