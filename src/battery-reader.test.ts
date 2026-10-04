import { describe, expect, it } from "vitest";
import { DONGLE_PRODUCT_ID, WIRED_PRODUCT_ID, pollBattery } from "./battery-reader.js";
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

const hang = () => new Promise<never>(() => {});

describe("pollBattery", () => {
  it("reads the percentage and charging flag through the dongle", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "reading",
      reading: { percent: 100, charging: false },
    });
  });

  it("reads through the cable and rounds the percentage", async () => {
    const transport = fakeTransport([
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: awake(128, true) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "reading",
      reading: { percent: 50, charging: true },
    });
  });

  it("tries each matching interface until one answers", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "wrong-interface", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "control", respond: awake(51, false) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "reading",
      reading: { percent: 20, charging: false },
    });
  });

  it("ignores other devices", async () => {
    const transport = fakeTransport([
      { productId: 0x1234, path: "keyboard", respond: awake(255, false) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
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

    expect(await pollBattery(transport, options)).toMatchObject({
      kind: "reading",
      reading: { percent: 100 },
    });
  });

  it("reports asleep when the dongle is present but the mouse never answers", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => ({ status: 0x04 }) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
    // The first attempt plus 3 retries.
    expect(transport.opened).toHaveLength(4);
  });

  it("reports asleep when the dongle relays a 0% reading", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(0, false) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
  });

  it("reports unavailable when the dongle cannot be opened", async () => {
    const transport: HidTransport = {
      list: async () => [{ productId: DONGLE_PRODUCT_ID, path: "dongle" }],
      open: async () => {
        throw new Error("access denied");
      },
    };

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "access denied",
    });
  });

  it("reports unavailable when the dongle's reads fail", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => "error" },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "read failed",
    });
  });

  it("reports asleep when one dongle interface fails and another gets no answer", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "wrong-interface", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "control", respond: () => ({ status: 0x04 }) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
  });

  it("reports unavailable when the cable is connected but every attempt fails", async () => {
    const transport = fakeTransport([
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: () => "error" },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "read failed",
    });
  });

  it("gives up on a HID call that never returns", async () => {
    const transport: HidTransport = {
      list: async () => [{ productId: WIRED_PRODUCT_ID, path: "wired" }],
      open: async () => ({
        sendFeatureReport: async () => {},
        getFeatureReport: hang,
        close: async () => {},
      }),
    };

    expect(await pollBattery(transport, { ...options, timeoutMs: 5 })).toEqual({
      kind: "unavailable",
      reason: "HID request timed out",
    });
  });

  it("closes a handle that opens only after its timeout", async () => {
    let closed = false;
    let finishOpening: ((handle: HidHandle) => void) | undefined;
    const transport: HidTransport = {
      list: async () => [{ productId: WIRED_PRODUCT_ID, path: "wired" }],
      open: () =>
        new Promise<HidHandle>((resolve) => {
          finishOpening = resolve;
        }),
    };

    await pollBattery(transport, { ...options, timeoutMs: 5 });
    finishOpening?.({
      sendFeatureReport: hang,
      getFeatureReport: hang,
      close: async () => {
        closed = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closed).toBe(true);
  });

  it("gives up when listing devices never returns", async () => {
    const transport: HidTransport = {
      list: hang,
      open: async () => {
        throw new Error("unreachable");
      },
    };

    expect(await pollBattery(transport, { ...options, timeoutMs: 5 })).toEqual({
      kind: "unavailable",
      reason: "HID request timed out",
    });
  });

  it("retries when listing devices fails", async () => {
    let lists = 0;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: async () => {
        if (lists++ === 0) throw new Error("hid busy");
        return dongle.list();
      },
      open: dongle.open,
    };

    expect(await pollBattery(transport, options)).toMatchObject({ kind: "reading" });
  });

  it("retries when the dongle shows up late", async () => {
    let lists = 0;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: async () => (lists++ === 0 ? [] : dongle.list()),
      open: dongle.open,
    };

    expect(await pollBattery(transport, options)).toMatchObject({ kind: "reading" });
  });

  it("stops trying once the poll runs past its deadline", async () => {
    let clock = 0;
    const transport = fakeTransport(
      ["a", "b", "c"].map((path) => ({
        productId: DONGLE_PRODUCT_ID,
        path,
        respond: () => {
          clock += 2_000; // each failed request takes a full timeout
          return "error" as const;
        },
      })),
    );

    const result = await pollBattery(transport, {
      ...options,
      now: () => clock,
      deadlineMs: 10_000,
    });

    expect(result).toEqual({ kind: "unavailable", reason: "poll timed out" });
    // 5 failed requests reach the deadline, well short of 4 attempts × 3 interfaces.
    expect(transport.opened).toHaveLength(5);
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

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "hid unavailable",
    });
  });
});
