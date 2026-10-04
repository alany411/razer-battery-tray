import { queryRegValue } from "./registry.js";
import type { Taskbar } from "./tray-icon.js";

// The taskbar follows Windows mode, which can differ from the app mode Electron's nativeTheme reports.
const PERSONALIZE_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`;

export async function readTaskbar(): Promise<Taskbar> {
  return taskbarFromRegistry(await queryRegValue(PERSONALIZE_KEY, "SystemUsesLightTheme"));
}

/** `SystemUsesLightTheme` is a DWORD that `reg query` prints as `0x1` (light) or `0x0` (dark). */
export function taskbarFromRegistry(value: string | undefined): Taskbar {
  return value !== undefined && Number.parseInt(value, 16) === 1 ? "light" : "dark";
}
