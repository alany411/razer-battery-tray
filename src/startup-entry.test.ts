import { describe, expect, it } from "vitest";
import { startsAtLogin } from "./startup-entry.js";

const EXE = String.raw`C:\Users\User\AppData\Local\Programs\razer-battery-tray\Razer Battery Tray.exe`;
const ENABLED = "020000000000000000000000";
const DISABLED = "0300000006328549293EDB01";

describe("startsAtLogin", () => {
  it("is on when the run entry exists and Windows has no approval entry", () => {
    expect(startsAtLogin(`"${EXE}"`, undefined, EXE)).toBe(true);
  });

  it("is on when Startup Apps marks it enabled", () => {
    expect(startsAtLogin(`"${EXE}"`, ENABLED, EXE)).toBe(true);
  });

  it("is off when Startup Apps marks it disabled", () => {
    expect(startsAtLogin(`"${EXE}"`, DISABLED, EXE)).toBe(false);
  });

  it("is off when there is no run entry", () => {
    expect(startsAtLogin(undefined, ENABLED, EXE)).toBe(false);
  });

  it("is on when the quoted run entry has arguments", () => {
    expect(startsAtLogin(`"${EXE}" --hidden`, undefined, EXE)).toBe(true);
  });

  it("is on when the run entry is unquoted, with or without arguments", () => {
    expect(startsAtLogin(EXE, undefined, EXE)).toBe(true);
    expect(startsAtLogin(`${EXE} --hidden`, undefined, EXE)).toBe(true);
  });

  it("ignores case when comparing paths", () => {
    expect(startsAtLogin(`"${EXE.toUpperCase()}"`, undefined, EXE)).toBe(true);
  });

  it("is off when the run entry launches a different executable", () => {
    const devElectron = String.raw`"C:\src\razer-battery-tray\node_modules\electron\dist\electron.exe" .`;
    expect(startsAtLogin(devElectron, undefined, EXE)).toBe(false);
    const oldInstall = String.raw`"D:\Apps\razer-battery-tray\Razer Battery Tray.exe"`;
    expect(startsAtLogin(oldInstall, ENABLED, EXE)).toBe(false);
  });

  it("is off when an unquoted run entry only starts with this path", () => {
    expect(startsAtLogin(`${EXE}.old`, undefined, EXE)).toBe(false);
  });

  it("is off when quoted run data has no closing quote", () => {
    expect(startsAtLogin(`"${EXE}X`, undefined, EXE)).toBe(false);
  });
});
