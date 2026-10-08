import { describe, expect, it } from "vitest";
import { DEVICE_TABLE } from "./device-table.js";
import {
  NO_DEVICE,
  describeLowBattery,
  describePollResult,
  describeRound,
} from "./tray-display.js";

const NAME = "DeathAdder V3 Pro";

const model = (name: string) => {
  const found = DEVICE_TABLE.find((m) => m.name === name);
  if (!found) throw new Error(`${name} is not in the device table`);
  return found;
};

describe("describePollResult", () => {
  it("shows the percentage", () => {
    expect(
      describePollResult(NAME, { kind: "reading", reading: { percent: 87, charging: false } }),
    ).toEqual({
      tooltip: "DeathAdder V3 Pro — 87%",
      iconText: "87",
      tone: "normal",
    });
  });

  it("marks charging", () => {
    expect(
      describePollResult(NAME, { kind: "reading", reading: { percent: 15, charging: true } }),
    ).toEqual({
      tooltip: "DeathAdder V3 Pro — 15% (charging)",
      iconText: "15",
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
      describePollResult(NAME, { kind: "reading", reading: { percent, charging: false } }).tone,
    ).toBe(tone);
  });

  it("shows asleep", () => {
    expect(describePollResult(NAME, { kind: "asleep" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Asleep",
      iconText: "z",
      tone: "inactive",
    });
  });

  it("keeps the unavailable reason out of the tooltip but in the details", () => {
    expect(describePollResult(NAME, { kind: "unavailable", reason: "device not found" })).toEqual({
      tooltip: "DeathAdder V3 Pro — Unavailable",
      detail: "device not found",
      iconText: "-",
      tone: "inactive",
    });
  });
});

describe("describeRound", () => {
  it("gives each device its own icon", () => {
    const displays = describeRound({
      kind: "devices",
      devices: [
        {
          model: model(NAME),
          result: { kind: "reading", reading: { percent: 87, charging: false } },
        },
        { model: model("BlackWidow V3 Pro"), result: { kind: "asleep" } },
      ],
    });

    expect([...displays]).toEqual([
      ["DeathAdder V3 Pro", expect.objectContaining({ tooltip: "DeathAdder V3 Pro — 87%" })],
      ["BlackWidow V3 Pro", expect.objectContaining({ tooltip: "BlackWidow V3 Pro — Asleep" })],
    ]);
  });

  it("says when the device list could not be updated", () => {
    const displays = describeRound({
      kind: "devices",
      devices: [{ model: model(NAME), result: { kind: "unavailable", reason: "HID is busy" } }],
      stale: true,
    });

    expect(displays.get(NAME)?.detail).toBe(
      "HID is busy · A stuck HID request keeps devices from being listed again",
    );
  });

  it("shows a single icon when no device is found", () => {
    expect([...describeRound({ kind: "none" })]).toEqual([
      [NO_DEVICE, { tooltip: "No Razer device found", iconText: "-", tone: "inactive" }],
    ]);
  });

  it("puts why listing devices failed in the details", () => {
    expect(describeRound({ kind: "none", reason: "hid unavailable" }).get(NO_DEVICE)).toMatchObject(
      {
        tooltip: "No Razer device found",
        detail: "hid unavailable",
      },
    );
  });
});

describe("describeLowBattery", () => {
  it("names the device and asks to charge it", () => {
    expect(describeLowBattery(NAME, 20, { percent: 18, charging: false })).toEqual({
      title: "DeathAdder V3 Pro battery at or below 20%",
      body: "DeathAdder V3 Pro is at 18%. Charge it soon.",
    });
  });

  it("does not ask to charge a device that is already charging", () => {
    expect(describeLowBattery("BlackWidow V3 Pro", 10, { percent: 9, charging: true })).toEqual({
      title: "BlackWidow V3 Pro battery at or below 10%",
      body: "BlackWidow V3 Pro is at 9% and charging.",
    });
  });
});
