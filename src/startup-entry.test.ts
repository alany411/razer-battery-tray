import { describe, expect, it } from "vitest";
import { parseRegValue, startsAtLogin } from "./startup-entry.js";

const NAME = "com.alanyang.razer-battery-tray";

const runOutput = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
    Discord    REG_SZ    "C:\\Users\\Alan\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe
    ${NAME}    REG_SZ    "C:\\Users\\Alan\\AppData\\Local\\Programs\\razer-battery-tray\\Razer Battery Tray.exe"
`;

describe("parseRegValue", () => {
  it("returns the data of the named value", () => {
    expect(parseRegValue(runOutput, NAME)).toBe(
      '"C:\\Users\\Alan\\AppData\\Local\\Programs\\razer-battery-tray\\Razer Battery Tray.exe"',
    );
  });

  it("returns undefined when the value is missing", () => {
    expect(parseRegValue(runOutput, "Spotify")).toBeUndefined();
  });

  it("does not match a value whose name only starts the same", () => {
    expect(parseRegValue(`    ${NAME}.old    REG_SZ    x\n`, NAME)).toBeUndefined();
  });
});

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
