import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const child = Object.assign(new EventEmitter(), { unref: vi.fn<() => void>() });
const openPath = vi.fn<(path: string) => Promise<string>>();

vi.mock("node:child_process", () => ({ spawn: () => child }));
vi.mock("electron", () => ({ shell: { openPath } }));

const { openSynapse } = await import("./synapse.js");

afterEach(() => {
  vi.restoreAllMocks();
  child.removeAllListeners();
});

describe("openSynapse", () => {
  it("logs a Synapse exe that cannot start instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    openSynapse({ kind: "exe", path: String.raw`C:\missing.exe`, args: [] });

    expect(() => child.emit("error", new Error("spawn ENOENT"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("spawn ENOENT"));
  });

  it("logs why a shortcut did not open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openPath.mockResolvedValue("Failed to open path");

    openSynapse({ kind: "shortcut", path: String.raw`C:\Razer Synapse.lnk` });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to open path"));
    });
  });

  it("logs nothing when the shortcut opened", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openPath.mockResolvedValue("");

    openSynapse({ kind: "shortcut", path: String.raw`C:\Razer Synapse.lnk` });
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).not.toHaveBeenCalled();
  });
});
