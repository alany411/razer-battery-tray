import { describe, expect, it } from "vitest";
import { DONGLE_PRODUCT_ID, WIRED_PRODUCT_ID, readBattery } from "./battery-reader.js";
import type { HidDeviceInfo, HidHandle, HidTransport } from "./battery-reader.js";

type Responder = (request: Uint8Array) => number | "error" | { status: number };

interface FakeDevice extends HidDeviceInfo {
  respond: Responder;
}

function fakeTransport(devices: FakeDevice[]): HidTransport & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    list: async () => devices.map(({ productId, path }) => ({ productId, path })),
    open: async (path): Promise<HidHandle> => {
      opened.push(path);
      const device = devices.find((d) => d.path === path);
      if (!device) throw new Error(`no device at ${path}`);
      let last = new Uint8Array(90);
      return {
        sendFeatureReport: async (data) => {
          last = Uint8Array.from(data.subarray(1));
        },
        getFeatureReport: async () => {
          const answer = device.respond(last);
          if (answer === "error") throw new Error("read failed");
          const response = Uint8Array.from(last);
          if (typeof answer === "number") {
            response[0] = 0x02;
            response[9] = answer;
          } else {
            response[0] = answer.status;
          }
          const withReportId = new Uint8Array(91);
          withReportId.set(response, 1);
          return withReportId;
        },
        close: async () => {},
      };
    },
  };
}

const awake =
  (level: number, charging: boolean): Responder =>
  (request) =>
    request[7] === 0x80 ? level : charging ? 1 : 0;

const options = { sleep: async () => {} };

describe("readBattery", () => {
  it("reads the percentage and charging flag through the dongle", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "ok",
      percent: 100,
      charging: false,
    });
  });

  it("reads through the cable and rounds the percentage", async () => {
    const transport = fakeTransport([
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: awake(128, true) },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "ok",
      percent: 50,
      charging: true,
    });
  });

  it("tries each matching interface until one answers", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "wrong-interface", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "control", respond: awake(51, false) },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "ok",
      percent: 20,
      charging: false,
    });
  });

  it("ignores other devices", async () => {
    const transport = fakeTransport([
      { productId: 0x1234, path: "keyboard", respond: awake(255, false) },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "mouse not found",
    });
    expect(transport.opened).toEqual([]);
  });

  it("retries a failed read", async () => {
    let calls = 0;
    const transport = fakeTransport([
      {
        productId: DONGLE_PRODUCT_ID,
        path: "dongle",
        respond: (request) => (calls++ < 2 ? "error" : awake(255, false)(request)),
      },
    ]);

    expect(await readBattery(transport, options)).toMatchObject({ kind: "ok", percent: 100 });
  });

  it("reports asleep when the dongle is present but the mouse never answers", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => ({ status: 0x04 }) },
    ]);

    expect(await readBattery(transport, options)).toEqual({ kind: "asleep" });
    // The first attempt plus 3 retries.
    expect(transport.opened).toHaveLength(4);
  });

  it("reports unavailable when the dongle cannot be opened", async () => {
    const transport: HidTransport = {
      list: async () => [{ productId: DONGLE_PRODUCT_ID, path: "dongle" }],
      open: async () => {
        throw new Error("access denied");
      },
    };

    expect(await readBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "access denied",
    });
  });

  it("reports unavailable when the dongle's reads fail", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => "error" },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "read failed",
    });
  });

  it("reports asleep when one dongle interface fails and another gets no answer", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "wrong-interface", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "control", respond: () => ({ status: 0x04 }) },
    ]);

    expect(await readBattery(transport, options)).toEqual({ kind: "asleep" });
  });

  it("reports unavailable when the cable is connected but every attempt fails", async () => {
    const transport = fakeTransport([
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: () => "error" },
    ]);

    expect(await readBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "read failed",
    });
  });

  it("reports unavailable when listing devices fails", async () => {
    const transport: HidTransport = {
      list: async () => {
        throw new Error("hid unavailable");
      },
      open: async () => {
        throw new Error("unreachable");
      },
    };

    expect(await readBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "hid unavailable",
    });
  });
});
