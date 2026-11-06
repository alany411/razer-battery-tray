import type { BatteryReading } from "./battery-reader.js";

export const ALERT_THRESHOLDS = [20, 10] as const;
/** How far above a threshold the battery must rise before it can alert again. */
const REARM_MARGIN = 3;

/**
 * Decides when to send a low-battery alert: once per threshold until a reading rises more than
 * REARM_MARGIN above it, and never while charging.
 */
export class LowBatteryAlerts {
  private readonly armed: Map<number, boolean>;

  constructor(thresholds: readonly number[] = ALERT_THRESHOLDS) {
    this.armed = new Map(thresholds.map((t) => [t, true]));
  }

  /**
   * Returns the threshold to alert for: the lowest armed one the reading is at or below.
   * A charging reading never alerts or disarms, but still re-arms.
   */
  update(reading: BatteryReading): number | undefined {
    let alert: number | undefined;
    for (const [threshold, armed] of this.armed) {
      if (reading.percent > threshold + REARM_MARGIN) {
        this.armed.set(threshold, true);
      } else if (armed && reading.percent <= threshold && !reading.charging) {
        if (alert === undefined || threshold < alert) alert = threshold;
      }
    }
    // One drop gives one alert, so every threshold the reading is at or below disarms with it.
    if (alert !== undefined) {
      for (const threshold of this.armed.keys()) {
        if (reading.percent <= threshold) this.armed.set(threshold, false);
      }
    }
    return alert;
  }
}
