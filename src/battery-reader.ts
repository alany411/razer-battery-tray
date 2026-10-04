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
}

const RETRIES = 3;
const RETRY_DELAY_MS = 500;
/** Time the mouse (or the dongle relaying to it) needs between a request and its response. */
const RESPONSE_DELAY_MS = 50;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollBattery(
  transport: HidTransport,
  { sleep = defaultSleep }: PollOptions = {},
): Promise<PollResult> {
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
  let mouseAsleep = false;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    for (const device of candidates) {
      try {
        return { kind: "reading", reading: await readFrom(transport, device, sleep) };
      } catch (error) {
        lastReason = errorMessage(error);
        if (error instanceof MouseAsleepError) mouseAsleep = true;
      }
    }
  }

  const wired = candidates.some((d) => d.productId === WIRED_PRODUCT_ID);
  return !wired && mouseAsleep ? { kind: "asleep" } : { kind: "unavailable", reason: lastReason };
}

async function readFrom(
  transport: HidTransport,
  device: HidDeviceInfo,
  sleep: (ms: number) => Promise<void>,
): Promise<BatteryReading> {
  const handle = await transport.open(device.path);
  try {
    const level = await query(handle, BATTERY_LEVEL, sleep);
    const charging = await query(handle, CHARGING_STATUS, sleep);
    // A mouse that is truly empty is off, so a 0% reading through the dongle means it is asleep.
    if (device.productId === DONGLE_PRODUCT_ID && level === 0 && charging !== 1) {
      throw new MouseAsleepError("mouse reported 0%");
    }
    return { percent: Math.round((level / 255) * 100), charging: charging === 1 };
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

/** The mouse did not answer the request, or answered 0% through the dongle. */
class MouseAsleepError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
