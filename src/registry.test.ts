import { describe, expect, it } from "vitest";
import { parseRegValue } from "./registry.js";

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
