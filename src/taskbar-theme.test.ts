import { describe, expect, it } from "vitest";
import { taskbarFromRegistry } from "./taskbar-theme.js";

describe("taskbarFromRegistry", () => {
  it("is light when Windows uses the light theme", () => {
    expect(taskbarFromRegistry("0x1")).toBe("light");
  });

  it("is dark when Windows uses the dark theme", () => {
    expect(taskbarFromRegistry("0x0")).toBe("dark");
  });

  it("defaults to dark, Windows 11's default, when the value is missing", () => {
    expect(taskbarFromRegistry(undefined)).toBe("dark");
  });
});
