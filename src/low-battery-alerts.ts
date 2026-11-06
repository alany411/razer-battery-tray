import type { BatteryReading } from "./battery-reader.js";

export const ALERT_THRESHOLDS = [20, 10] as const;
/** How far above a threshold the battery must rise before it can alert again. */
const REARM_MARGIN = 3;

/** Decides when to warn about a low battery: once per threshold until it recharges past it by REARM_MARGIN. */
export class LowBatteryAlerts {
  private readonly armed: Map<number, boolean>;

  constructor(thresholds: readonly number[] = ALERT_THRESHOLDS) {
    this.armed = new Map(thresholds.map((t) => [t, true]));
  }

  /** Returns the thresholds to alert for, highest first. */
  update(reading: BatteryReading): number[] {
    const alerts: number[] = [];
    for (const [threshold, armed] of this.armed) {
      if (reading.percent > threshold + REARM_MARGIN) {
        this.armed.set(threshold, true);
      } else if (armed && reading.percent <= threshold) {
        alerts.push(threshold);
        this.armed.set(threshold, false);
      }
    }
    return alerts.toSorted((a, b) => b - a);
  }
}
