import { execFile } from "node:child_process";

const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
// Where Task Manager and Settings > Startup Apps record whether a Run entry is enabled.
const APPROVED_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`;

/**
 * Whether Windows will launch the app at login, read from the registry the way Windows does.
 * Electron's `executableWillLaunchAtLogin` reports false when Startup Apps has no entry yet,
 * even though Windows then treats the Run entry as enabled.
 */
export async function readStartsAtLogin(name: string): Promise<boolean> {
  const [run, approved] = await Promise.all([
    queryValue(RUN_KEY, name),
    queryValue(APPROVED_KEY, name),
  ]);
  return startsAtLogin(run, approved);
}

/** On if the Run entry exists and Startup Apps has not disabled it (odd first byte). */
export function startsAtLogin(run: string | undefined, approved: string | undefined): boolean {
  if (run === undefined) return false;
  if (approved === undefined) return true;
  return Number.parseInt(approved.slice(0, 2), 16) % 2 === 0;
}

/** The data of value `name` in `reg query` output, or undefined if it is not listed. */
export function parseRegValue(output: string, name: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    if (match?.[1] === name) return match[2];
  }
  return undefined;
}

function queryValue(key: string, name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // reg exits with an error when the value does not exist.
    execFile("reg", ["query", key, "/v", name], { windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : parseRegValue(stdout, name));
    });
  });
}
