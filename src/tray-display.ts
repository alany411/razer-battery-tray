import type { BatteryReading, PollResult, PollRound } from "./battery-reader.js";
import { ALERT_THRESHOLDS } from "./low-battery-alerts.js";

export type Tone = "normal" | "low" | "charging" | "inactive";

export interface TrayDisplay {
  tooltip: string;
  /** Extra explanation for the menu, e.g. why the battery is unavailable. */
  detail?: string;
  iconText: string;
  tone: Tone;
}

/** Key of the single icon shown while no device is listed. */
export const NO_DEVICE = "";

/** The icon shown before the first poll finishes. */
export const READING_DISPLAYS: ReadonlyMap<string, TrayDisplay> = new Map([
  [NO_DEVICE, { tooltip: "Reading battery…", iconText: "-", tone: "inactive" }],
]);

const LOW = Math.max(...ALERT_THRESHOLDS);

/** One tray icon per device, keyed by model name, or a single icon when none was found. */
export function describeRound(round: PollRound): Map<string, TrayDisplay> {
  if (round.kind === "none") {
    return new Map([
      [
        NO_DEVICE,
        {
          tooltip: "No Razer device found",
          ...(round.reason ? { detail: round.reason } : {}),
          iconText: "-",
          tone: "inactive",
        },
      ],
    ]);
  }
  return new Map(
    round.devices.map(({ model, result }) => {
      const display = describePollResult(model.name, result);
      if (round.stale) {
        display.detail = [display.detail, STALE_DETAIL].filter(Boolean).join(" · ");
      }
      return [model.name, display];
    }),
  );
}

const STALE_DETAIL = "A stuck HID request keeps the device list from updating";

export function describePollResult(name: string, result: PollResult): TrayDisplay {
  switch (result.kind) {
    case "reading": {
      const { reading } = result;
      return {
        tooltip: `${name} — ${reading.percent}%${reading.charging ? " (charging)" : ""}`,
        iconText: String(reading.percent),
        tone: reading.charging ? "charging" : reading.percent <= LOW ? "low" : "normal",
      };
    }
    case "asleep":
      return { tooltip: `${name} — Asleep`, iconText: "z", tone: "inactive" };
    case "unavailable":
      // Windows cuts tray tooltips off at 127 characters, so the reason goes in the menu instead.
      return {
        tooltip: `${name} — Unavailable`,
        detail: result.reason,
        iconText: "-",
        tone: "inactive",
      };
  }
}

export function describeLowBattery(
  name: string,
  threshold: number,
  reading: BatteryReading,
): { title: string; body: string } {
  return {
    title: `${name} battery at or below ${threshold}%`,
    body: reading.charging
      ? `${name} is at ${reading.percent}% and charging.`
      : `${name} is at ${reading.percent}%. Charge it soon.`,
  };
}
