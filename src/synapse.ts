import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";

export type SynapseLauncher =
  | { kind: "shortcut"; path: string }
  | { kind: "exe"; path: string; args: string[] };

interface Environment {
  /** Every Start menu shortcut, as full paths. */
  shortcuts: string[];
  exists: (file: string) => boolean;
  programFiles: string;
  programFilesX86: string;
}

// "Razer Synapse.lnk" or "Razer Synapse 3.lnk", but not e.g. "Uninstall Razer Synapse.lnk".
const SHORTCUT_NAME = /^Razer Synapse( \d+)?\.lnk$/i;

/**
 * Picks how to open Synapse: Razer's own Start menu shortcut if there is one, since that is
 * what the user would click; otherwise Synapse 4 through Razer App Engine, or Synapse 3.
 */
export function chooseSynapseLauncher(env: Environment): SynapseLauncher | undefined {
  const shortcut = env.shortcuts.find((file) => SHORTCUT_NAME.test(path.win32.basename(file)));
  if (shortcut) return { kind: "shortcut", path: shortcut };

  const appEngine = path.win32.join(
    env.programFiles,
    "Razer",
    "RazerAppEngine",
    "RazerAppEngine.exe",
  );
  // The same arguments Synapse's startup entry uses, minus the one that keeps it hidden.
  if (env.exists(appEngine))
    return { kind: "exe", path: appEngine, args: ["--url-params=apps=synapse"] };

  const synapse3 = path.win32.join(
    env.programFilesX86,
    "Razer",
    "Synapse3",
    "WPFUI",
    "Framework",
    "Razer Synapse 3 Host",
    "Razer Synapse 3.exe",
  );
  if (env.exists(synapse3)) return { kind: "exe", path: synapse3, args: [] };

  return undefined;
}

export async function findSynapse(): Promise<SynapseLauncher | undefined> {
  const startMenus = [process.env["ProgramData"], process.env["APPDATA"]]
    .filter((dir) => dir !== undefined)
    .map((dir) => path.join(dir, "Microsoft", "Windows", "Start Menu", "Programs"));
  const shortcuts = (await Promise.all(startMenus.map(listShortcuts))).flat();
  return chooseSynapseLauncher({
    shortcuts,
    exists: existsSync,
    programFiles: process.env["ProgramFiles"] ?? String.raw`C:\Program Files`,
    programFilesX86: process.env["ProgramFiles(x86)"] ?? String.raw`C:\Program Files (x86)`,
  });
}

export function openSynapse(launcher: SynapseLauncher): void {
  if (launcher.kind === "shortcut") {
    void shell.openPath(launcher.path);
    return;
  }
  spawn(launcher.path, launcher.args, { detached: true, stdio: "ignore" }).unref();
}

async function listShortcuts(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries
      .filter((entry) => entry.toLowerCase().endsWith(".lnk"))
      .map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}
