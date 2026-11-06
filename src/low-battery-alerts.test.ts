import { describe, expect, it } from "vitest";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import type { BatteryReading } from "./battery-reader.js";

const at = (percent: number, charging = false): BatteryReading => ({ percent, charging });

function feed(alerts: LowBatteryAlerts, readings: BatteryReading[]): (number | undefined)[] {
  return readings.map((reading) => alerts.update(reading));
}

describe("LowBatteryAlerts", () => {
  it("alerts once at 20% and once at 10%", () => {
    expect(feed(new LowBatteryAlerts(), [at(25), at(20), at(18), at(10), at(5)])).toEqual([
      undefined,
      20,
      undefined,
      10,
      undefined,
    ]);
  });

  it("alerts only for the lowest threshold when one reading crosses both", () => {
    expect(feed(new LowBatteryAlerts(), [at(8), at(7)])).toEqual([10, undefined]);
  });

  it("does not alert for the higher threshold after alerting for the lower", () => {
    expect(feed(new LowBatteryAlerts(), [at(8), at(12), at(18)])).toEqual([
      10,
      undefined,
      undefined,
    ]);
  });

  it("does not re-arm on a wobble just above the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(21), at(20), at(21), at(20)])).toEqual([
      undefined,
      20,
      undefined,
      undefined,
    ]);
  });

  it("re-arms once the battery rises above threshold + 3", () => {
    expect(feed(new LowBatteryAlerts(), [at(20), at(23), at(20), at(24), at(20)])).toEqual([
      20,
      undefined,
      undefined,
      undefined,
      20,
    ]);
  });

  it("does not re-arm while still at the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(19), at(20), at(19)])).toEqual([
      20,
      undefined,
      undefined,
    ]);
  });

  it("alerts while charging too", () => {
    expect(feed(new LowBatteryAlerts(), [at(15, true), at(15)])).toEqual([20, undefined]);
  });
});
