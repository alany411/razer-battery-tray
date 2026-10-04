import { describe, expect, it } from "vitest";
import { describeReading } from "./tray-display.js";

describe("describeReading", () => {
  it("shows the percentage", () => {
    expect(describeReading({ kind: "ok", percent: 87, charging: false })).toEqual({
      tooltip: "DeathAdder V3 Pro — 87%",
      iconText: "87",
      tone: "normal",
    });
  });

  it("marks charging", () => {
    expect(describeReading({ kind: "ok", percent: 15, charging: true })).toEqual({
      tooltip: "DeathAdder V3 Pro — 15% (charging)",
      iconText: "15",
      tone: "charging",
    });
  });

  it.each([
    [21, "normal"],
    [20, "low"],
    [11, "low"],
    [10, "critical"],
  ] as const)("uses the %i%% tone %s", (percent, tone) => {
    expect(describeReading({ kind: "ok", percent, charging: false }).tone).toBe(tone);
  });

  it("shows asleep", () => {
    expect(describeReading({ kind: "asleep" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Asleep",
      iconText: "z",
      tone: "inactive",
    });
  });

  it("shows unavailable with the reason", () => {
    expect(describeReading({ kind: "unavailable", reason: "mouse not found" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Unavailable (mouse not found)",
      iconText: "-",
      tone: "inactive",
    });
  });
});
