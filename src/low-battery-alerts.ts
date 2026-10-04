import type { BatteryReading } from "./battery-reader.js";

export const ALERT_THRESHOLDS = [20, 10] as const;

/** Decides when to warn about a low battery: once per threshold until it recharges above it. */
export class LowBatteryAlerts {
  private readonly armed: Map<number, boolean>;

  constructor(thresholds: readonly number[] = ALERT_THRESHOLDS) {
    this.armed = new Map(thresholds.map((t) => [t, true]));
  }

  /** Returns the threshold to alert for, if any. */
  update(reading: BatteryReading): number | undefined {
    if (reading.kind !== "ok") return undefined;

    for (const threshold of this.armed.keys()) {
      if (reading.percent > threshold) this.armed.set(threshold, true);
    }
    if (reading.charging) return undefined;

    let alert: number | undefined;
    for (const [threshold, armed] of this.armed) {
      if (reading.percent > threshold) continue;
      if (armed && (alert === undefined || threshold < alert)) alert = threshold;
      this.armed.set(threshold, false);
    }
    return alert;
  }
}
