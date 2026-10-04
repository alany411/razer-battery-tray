import type { BatteryReading, Poll } from "./battery-reader.js";
import { ALERT_THRESHOLDS } from "./low-battery-alerts.js";

export const MOUSE_NAME = "DeathAdder V3 Pro";

export type Tone = "normal" | "low" | "critical" | "charging" | "inactive";

export interface TrayDisplay {
  tooltip: string;
  iconText: string;
  tone: Tone;
}

const [LOW, CRITICAL] = ALERT_THRESHOLDS;

export function describePoll(poll: Poll): TrayDisplay {
  switch (poll.kind) {
    case "reading": {
      const { reading } = poll;
      return {
        tooltip: `${MOUSE_NAME} — ${reading.percent}%${reading.charging ? " (charging)" : ""}`,
        iconText: String(reading.percent),
        tone: reading.charging
          ? "charging"
          : reading.percent <= CRITICAL
            ? "critical"
            : reading.percent <= LOW
              ? "low"
              : "normal",
      };
    }
    case "asleep":
      return { tooltip: `${MOUSE_NAME} — Asleep`, iconText: "z", tone: "inactive" };
    case "unavailable":
      // Windows cuts tray tooltips off at 127 characters, so the reason is only logged.
      return { tooltip: `${MOUSE_NAME} — Unavailable`, iconText: "-", tone: "inactive" };
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
