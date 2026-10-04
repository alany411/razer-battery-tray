import { describe, expect, it } from "vitest";
import { startsAtLogin } from "./startup-entry.js";

describe("startsAtLogin", () => {
  it("is on when the run entry exists and Windows has no approval entry", () => {
    expect(startsAtLogin('"C:\\app.exe"', undefined)).toBe(true);
  });

  it("is on when Startup Apps marks it enabled", () => {
    expect(startsAtLogin('"C:\\app.exe"', "020000000000000000000000")).toBe(true);
  });

  it("is off when Startup Apps marks it disabled", () => {
    expect(startsAtLogin('"C:\\app.exe"', "0300000006328549293EDB01")).toBe(false);
  });

  it("is off when there is no run entry", () => {
    expect(startsAtLogin(undefined, "020000000000000000000000")).toBe(false);
  });
});
