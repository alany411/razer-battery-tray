import { queryRegValue } from "./registry.js";

const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
// Where Task Manager and Settings > Startup Apps record whether a Run entry is enabled.
const APPROVED_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`;

/**
 * Whether Windows will launch the app at login, read from the registry the way Windows does.
 * Electron's `executableWillLaunchAtLogin` reports false when Startup Apps has no entry yet,
 * even though Windows then treats the Run entry as enabled.
 */
export async function readStartsAtLogin(name: string, exePath: string): Promise<boolean> {
  const [run, approved] = await Promise.all([
    queryRegValue(RUN_KEY, name),
    queryRegValue(APPROVED_KEY, name),
  ]);
  return startsAtLogin(run, approved, exePath);
}

/**
 * On if the Run entry launches `exePath` and Startup Apps has not disabled it (odd first byte).
 * A Run entry left by a dev run or an install in another folder launches something else.
 */
export function startsAtLogin(
  run: string | undefined,
  approved: string | undefined,
  exePath: string,
): boolean {
  if (run === undefined || !launches(run, exePath)) return false;
  if (approved === undefined) return true;
  return Number.parseInt(approved.slice(0, 2), 16) % 2 === 0;
}

/** Whether Run entry data starts `exePath`, quoted or not, with any arguments after it. */
function launches(run: string, exePath: string): boolean {
  const data = run.toLowerCase();
  const exe = exePath.toLowerCase();
  if (data.startsWith('"')) return data.slice(1, data.indexOf('"', 1)) === exe;
  return data === exe || data.startsWith(`${exe} `);
}
