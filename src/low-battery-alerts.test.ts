import { describe, expect, it } from "vitest";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import type { BatteryReading } from "./battery-reader.js";

const at = (percent: number, charging = false): BatteryReading => ({ percent, charging });

function feed(alerts: LowBatteryAlerts, readings: BatteryReading[]): number[][] {
  return readings.map((reading) => alerts.update(reading));
}

describe("LowBatteryAlerts", () => {
  it("alerts once at 20% and once at 10%", () => {
    expect(feed(new LowBatteryAlerts(), [at(25), at(20), at(18), at(10), at(5)])).toEqual([
      [],
      [20],
      [],
      [10],
      [],
    ]);
  });

  it("alerts for both thresholds when one reading crosses both", () => {
    expect(feed(new LowBatteryAlerts(), [at(25), at(8), at(7)])).toEqual([[], [20, 10], []]);
  });

  it("re-arms after the battery rises above the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(20), at(21), at(19)])).toEqual([[20], [], [20]]);
  });

  it("does not re-arm while still at the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(19), at(20), at(19)])).toEqual([[20], [], []]);
  });

  it("alerts while charging too", () => {
    expect(feed(new LowBatteryAlerts(), [at(15, true), at(15)])).toEqual([[20], []]);
  });
});
