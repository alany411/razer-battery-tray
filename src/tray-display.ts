import type { BatteryReading, PollResult } from "./battery-reader.js";
import { ALERT_THRESHOLDS } from "./low-battery-alerts.js";

export const MOUSE_NAME = "DeathAdder V3 Pro";

export type Tone = "normal" | "low" | "charging" | "inactive";

export interface TrayDisplay {
  tooltip: string;
  /** Extra explanation for the menu, e.g. why the battery is unavailable. */
  detail?: string;
  iconText: string;
  tone: Tone;
}

const LOW = Math.max(...ALERT_THRESHOLDS);

export function describePollResult(result: PollResult): TrayDisplay {
  switch (result.kind) {
    case "reading": {
      const { reading } = result;
      return {
        tooltip: `${MOUSE_NAME} — ${reading.percent}%${reading.charging ? " (charging)" : ""}`,
        iconText: `${reading.percent}%`,
        tone: reading.charging ? "charging" : reading.percent <= LOW ? "low" : "normal",
      };
    }
    case "asleep":
      return { tooltip: `${MOUSE_NAME} — Asleep`, iconText: "z", tone: "inactive" };
    case "unavailable":
      // Windows cuts tray tooltips off at 127 characters, so the reason goes in the menu instead.
      return {
        tooltip: `${MOUSE_NAME} — Unavailable`,
        detail: result.reason,
        iconText: "-",
        tone: "inactive",
      };
  }
}

export function describeLowBattery(
  threshold: number,
  reading: BatteryReading,
): { title: string; body: string } {
  return {
    title: `Mouse battery at or below ${threshold}%`,
    body: reading.charging
      ? `${MOUSE_NAME} is at ${reading.percent}% and charging.`
      : `${MOUSE_NAME} is at ${reading.percent}%. Charge it soon.`,
  };
}
