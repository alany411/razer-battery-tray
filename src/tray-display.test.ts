import { describe, expect, it } from "vitest";
import { describeLowBattery, describePoll } from "./tray-display.js";

describe("describePoll", () => {
  it("shows the percentage", () => {
    expect(describePoll({ kind: "reading", reading: { percent: 87, charging: false } })).toEqual({
      tooltip: "DeathAdder V3 Pro — 87%",
      iconText: "87",
      tone: "normal",
    });
  });

  it("marks charging", () => {
    expect(describePoll({ kind: "reading", reading: { percent: 15, charging: true } })).toEqual({
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
    expect(describePoll({ kind: "reading", reading: { percent, charging: false } }).tone).toBe(
      tone,
    );
  });

  it("shows asleep", () => {
    expect(describePoll({ kind: "asleep" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Asleep",
      iconText: "z",
      tone: "inactive",
    });
  });

  it("shows unavailable without the reason", () => {
    expect(describePoll({ kind: "unavailable", reason: "mouse not found" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Unavailable",
      iconText: "-",
      tone: "inactive",
    });
  });
});

describe("describeLowBattery", () => {
  it("asks to charge the mouse", () => {
    expect(describeLowBattery(20, { percent: 18, charging: false })).toEqual({
      title: "Mouse battery at or below 20%",
      body: "DeathAdder V3 Pro is at 18%. Charge it soon.",
    });
  });

  it("does not ask to charge a mouse that is already charging", () => {
    expect(describeLowBattery(10, { percent: 9, charging: true })).toEqual({
      title: "Mouse battery at or below 10%",
      body: "DeathAdder V3 Pro is at 9% and charging.",
    });
  });
});
