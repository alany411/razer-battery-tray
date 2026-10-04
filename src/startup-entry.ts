import { queryRegValue } from "./registry.js";

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
    queryRegValue(RUN_KEY, name),
    queryRegValue(APPROVED_KEY, name),
  ]);
  return startsAtLogin(run, approved);
}

/** On if the Run entry exists and Startup Apps has not disabled it (odd first byte). */
export function startsAtLogin(run: string | undefined, approved: string | undefined): boolean {
  if (run === undefined) return false;
  if (approved === undefined) return true;
  return Number.parseInt(approved.slice(0, 2), 16) % 2 === 0;
}
