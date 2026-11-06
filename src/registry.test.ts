import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ID } from "./app-id.js";
import { REG_TIMEOUT_MS, parseRegValue, queryRegValue } from "./registry.js";
import type { RegExec } from "./registry.js";

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

describe("queryRegValue", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** A fake exec that records its call and answers like execFile would. */
  function fakeExec(error: Error | null, stdout = "") {
    const calls: { file: string; args: readonly string[]; timeout?: number }[] = [];
    const exec: RegExec = (file, args, options, callback) => {
      calls.push({ file, args, timeout: options.timeout });
      callback(error, stdout);
    };
    return { exec, calls };
  }

  it("resolves to undefined when reg times out", async () => {
    const timedOut = Object.assign(new Error("spawnSync reg.exe ETIMEDOUT"), {
      killed: true,
      signal: "SIGTERM",
    });
    const { exec, calls } = fakeExec(timedOut);
    await expect(queryRegValue("HKCU\\Run", APP_ID, exec)).resolves.toBeUndefined();
    expect(calls[0]?.timeout).toBe(REG_TIMEOUT_MS);
    expect(REG_TIMEOUT_MS).toBe(5_000);
  });

  it("parses the value reg prints", async () => {
    const { exec } = fakeExec(null, runOutput);
    await expect(queryRegValue("HKCU\\Run", APP_ID, exec)).resolves.toBe(EXE);
  });

  it("invokes reg.exe by its System32 path when SystemRoot is set", async () => {
    vi.stubEnv("SystemRoot", String.raw`C:\Windows`);
    const { exec, calls } = fakeExec(null, runOutput);
    await queryRegValue("HKCU\\Run", APP_ID, exec);
    expect(calls[0]?.file).toBe(String.raw`C:\Windows\System32\reg.exe`);
    expect(calls[0]?.args).toEqual(["query", "HKCU\\Run", "/v", APP_ID]);
  });

  it("falls back to reg on PATH when SystemRoot is unset", async () => {
    vi.stubEnv("SystemRoot", undefined);
    const { exec, calls } = fakeExec(null, runOutput);
    await queryRegValue("HKCU\\Run", APP_ID, exec);
    expect(calls[0]?.file).toBe("reg");
  });
});
