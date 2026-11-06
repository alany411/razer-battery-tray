import { describe, expect, it } from "vitest";
import { trayGuid, uuidV5 } from "./tray-guid.js";

const EXE = String.raw`C:\Users\me\AppData\Local\Programs\razer-battery-tray\Razer Battery Tray.exe`;

describe("uuidV5", () => {
  it("matches the RFC 9562 name-based UUID for a known name", () => {
    // www.example.com in the DNS namespace.
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });
});

describe("trayGuid", () => {
  it("is a version 5 UUID", () => {
    expect(trayGuid(EXE, "DeathAdder V3 Pro")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is the same for the same exe and key, so Windows keeps the icon's visibility", () => {
    expect(trayGuid(EXE, "DeathAdder V3 Pro")).toBe(trayGuid(EXE, "DeathAdder V3 Pro"));
  });

  it("differs per key, the no-device key included", () => {
    const guids = new Set(
      ["DeathAdder V3 Pro", "Viper V3 Pro", ""].map((key) => trayGuid(EXE, key)),
    );

    expect(guids.size).toBe(3);
  });

  it("differs per exe path, since Windows binds a GUID to the first path that uses it", () => {
    expect(trayGuid(EXE, "DeathAdder V3 Pro")).not.toBe(
      trayGuid(String.raw`C:\dev\node_modules\electron\dist\electron.exe`, "DeathAdder V3 Pro"),
    );
  });
});
