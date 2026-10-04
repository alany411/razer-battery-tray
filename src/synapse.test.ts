import { describe, expect, it } from "vitest";
import { chooseSynapseLauncher } from "./synapse.js";

const PROGRAM_FILES = String.raw`C:\Program Files`;
const PROGRAM_FILES_X86 = String.raw`C:\Program Files (x86)`;
const APP_ENGINE = String.raw`C:\Program Files\Razer\RazerAppEngine\RazerAppEngine.exe`;
const SYNAPSE_3 = String.raw`C:\Program Files (x86)\Razer\Synapse3\WPFUI\Framework\Razer Synapse 3 Host\Razer Synapse 3.exe`;
const SHORTCUT = String.raw`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Razer\Razer Synapse.lnk`;

function choose(shortcuts: string[], files: string[]) {
  return chooseSynapseLauncher({
    shortcuts,
    exists: (path) => files.includes(path),
    programFiles: PROGRAM_FILES,
    programFilesX86: PROGRAM_FILES_X86,
  });
}

describe("chooseSynapseLauncher", () => {
  it("prefers Razer's Start menu shortcut", () => {
    expect(choose([SHORTCUT], [APP_ENGINE])).toEqual({ kind: "shortcut", path: SHORTCUT });
  });

  it("ignores other Razer shortcuts", () => {
    const uninstall = String.raw`C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Razer\Uninstall Razer Synapse.lnk`;

    expect(choose([uninstall], [])).toBeUndefined();
  });

  it("falls back to Razer App Engine with Synapse selected", () => {
    expect(choose([], [APP_ENGINE])).toEqual({
      kind: "exe",
      path: APP_ENGINE,
      args: ["--url-params=apps=synapse"],
    });
  });

  it("falls back to Synapse 3", () => {
    expect(choose([], [SYNAPSE_3])).toEqual({ kind: "exe", path: SYNAPSE_3, args: [] });
  });

  it("finds nothing when Synapse is not installed", () => {
    expect(choose([], [])).toBeUndefined();
  });
});
