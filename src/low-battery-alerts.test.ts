import { describe, expect, it } from "vitest";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import type { BatteryReading } from "./battery-reader.js";

const at = (percent: number, charging = false): BatteryReading => ({
  kind: "ok",
  percent,
  charging,
});

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

  it("only gives the lowest alert when starting below both thresholds", () => {
    expect(feed(new LowBatteryAlerts(), [at(8), at(7)])).toEqual([10, undefined]);
  });

  it("re-arms after the battery rises above the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(20), at(21), at(19)])).toEqual([20, undefined, 20]);
  });

  it("does not re-arm while still at the threshold", () => {
    expect(feed(new LowBatteryAlerts(), [at(19), at(20), at(19)])).toEqual([
      20,
      undefined,
      undefined,
    ]);
  });

  it("does not alert while charging", () => {
    expect(feed(new LowBatteryAlerts(), [at(15, true), at(15)])).toEqual([undefined, 20]);
  });

  it("ignores readings without a percentage", () => {
    expect(
      feed(new LowBatteryAlerts(), [
        at(15),
        { kind: "asleep" },
        { kind: "unavailable", reason: "x" },
        at(15),
      ]),
    ).toEqual([20, undefined, undefined, undefined]);
  });
});
