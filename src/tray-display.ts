import type { BatteryReading } from "./battery-reader.js";
import { ALERT_THRESHOLDS } from "./low-battery-alerts.js";

export const MOUSE_NAME = "DeathAdder V3 Pro";

export type Tone = "normal" | "low" | "critical" | "charging" | "inactive";

export interface TrayDisplay {
  tooltip: string;
  iconText: string;
  tone: Tone;
}

const [LOW, CRITICAL] = ALERT_THRESHOLDS;

export function describeReading(reading: BatteryReading): TrayDisplay {
  switch (reading.kind) {
    case "ok":
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
    case "asleep":
      return { tooltip: `${MOUSE_NAME} — Asleep`, iconText: "z", tone: "inactive" };
    case "unavailable":
      return {
        tooltip: `${MOUSE_NAME} — Unavailable (${reading.reason})`,
        iconText: "-",
        tone: "inactive",
      };
  }
}
