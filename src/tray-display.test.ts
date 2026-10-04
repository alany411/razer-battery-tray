import { describe, expect, it } from "vitest";
import { describeLowBattery, describePollResult } from "./tray-display.js";

describe("describePollResult", () => {
  it("shows the percentage", () => {
    expect(
      describePollResult({ kind: "reading", reading: { percent: 87, charging: false } }),
    ).toEqual({
      tooltip: "DeathAdder V3 Pro — 87%",
      iconText: "87%",
      tone: "normal",
    });
  });

  it("marks charging", () => {
    expect(
      describePollResult({ kind: "reading", reading: { percent: 15, charging: true } }),
    ).toEqual({
      tooltip: "DeathAdder V3 Pro — 15% (charging)",
      iconText: "15%",
      tone: "charging",
    });
  });

  it.each([
    [21, "normal"],
    [20, "low"],
    [11, "low"],
    [10, "low"],
  ] as const)("at %i percent uses the %s tone", (percent, tone) => {
    expect(
      describePollResult({ kind: "reading", reading: { percent, charging: false } }).tone,
    ).toBe(tone);
  });

  it("shows asleep", () => {
    expect(describePollResult({ kind: "asleep" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Asleep",
      iconText: "z",
      tone: "inactive",
    });
  });

  it("keeps the unavailable reason out of the tooltip but in the details", () => {
    expect(describePollResult({ kind: "unavailable", reason: "mouse not found" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Unavailable",
      detail: "mouse not found",
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
