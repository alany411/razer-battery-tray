import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_ID } from "./app-id.js";

describe("APP_ID", () => {
  it("matches the installer's app ID so Windows attributes notifications to the app", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

    expect(APP_ID).toBe(pkg.build.appId);
  });
});
