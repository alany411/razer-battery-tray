import { describe, expect, it } from "vitest";
import { APP_ID } from "./app-id.js";
import { parseRegValue } from "./registry.js";

const EXE = String.raw`"C:\Users\User\AppData\Local\Programs\razer-battery-tray\Razer Battery Tray.exe"`;

const runOutput = String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
    OtherApp    REG_SZ    "C:\Users\User\AppData\Local\OtherApp\OtherApp.exe"
    ${APP_ID}    REG_SZ    ${EXE}
`;

describe("parseRegValue", () => {
  it("returns the data of the named value", () => {
    expect(parseRegValue(runOutput, APP_ID)).toBe(EXE);
  });

  it("returns undefined when the value is missing", () => {
    expect(parseRegValue(runOutput, "Missing")).toBeUndefined();
  });

  it("does not match a value whose name only starts the same", () => {
    expect(parseRegValue(`    ${APP_ID}.old    REG_SZ    x\n`, APP_ID)).toBeUndefined();
  });
});
