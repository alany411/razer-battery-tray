import { execFile } from "node:child_process";
import { win32 } from "node:path";

/** How long one `reg query` may run before it is killed and counts as a failure. */
export const REG_TIMEOUT_MS = 5_000;

/** The part of `execFile` that `queryRegValue` uses, so tests can pass a fake. */
export type RegExec = (
  file: string,
  args: readonly string[],
  options: { windowsHide: boolean; timeout: number },
  callback: (error: Error | null, stdout: string) => void,
) => void;

/** The data of value `name` in `reg query` output, or undefined if it is not listed. */
export function parseRegValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

/** Reads one value with `reg query`; undefined if it is missing, reg fails, or reg times out. */
export function queryRegValue(
  key: string,
  name: string,
  exec: RegExec = execFile,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    // reg exits with an error when the value does not exist.
    exec(
      regPath(),
      ["query", key, "/v", name],
      { windowsHide: true, timeout: REG_TIMEOUT_MS },
      (error, stdout) => resolve(error ? undefined : parseRegValue(stdout, name)),
    );
  });
}

/** reg.exe by its System32 path, so a `reg` earlier on PATH is not run instead. */
function regPath(): string {
  const systemRoot = process.env["SystemRoot"];
  return systemRoot ? win32.join(systemRoot, "System32", "reg.exe") : "reg";
}
