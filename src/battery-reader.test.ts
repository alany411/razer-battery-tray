import { describe, expect, it } from "vitest";
import { createBatteryPoller, pollDevice } from "./battery-reader.js";
import type { HidDeviceInfo, HidHandle, HidTransport, PollOptions } from "./battery-reader.js";
import { DEVICE_TABLE } from "./device-table.js";
import type { DeviceModel } from "./device-table.js";

type Responder = (request: Uint8Array) => number | "error" | { status: number };

interface FakeDevice extends HidDeviceInfo {
  respond: Responder;
  /** The transaction ID the device answers to; requests with another one fail. */
  transactionId?: number;
}

const model = (name: string): DeviceModel => {
  const found = DEVICE_TABLE.find((m) => m.name === name);
  if (!found) throw new Error(`${name} is not in the device table`);
  return found;
};

const DEATHADDER_V3_PRO = model("DeathAdder V3 Pro");
const WIRED_PRODUCT_ID = 0x00b6;
const DONGLE_PRODUCT_ID = 0x00b7;

const pollBattery = (transport: HidTransport, opts: PollOptions) =>
  pollDevice(transport, DEATHADDER_V3_PRO, opts);

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
          const answer =
            last[1] === (device.transactionId ?? 0x1f) ? device.respond(last) : "error";
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

/**
 * A fake HID process: an open of a path in `hangs` never returns, and holds up every later open and
 * listing until the process restarts, which ends them.
 */
function hidProcess(devices: FakeDevice[], hangs: Set<string>) {
  const inner = fakeTransport(devices);
  let ended: (() => void)[] = [];
  let locked = false;
  const waitForRestart = () =>
    new Promise<never>((_, reject) => {
      ended.push(() => reject(new Error("HID process restarted")));
    });
  const process = {
    opened: inner.opened,
    restarts: 0,
    list: () => (locked ? waitForRestart() : inner.list()),
    open: (path: string) => {
      if (locked) return waitForRestart();
      if (!hangs.has(path)) return inner.open(path);
      inner.opened.push(path);
      locked = true;
      return waitForRestart();
    },
    restart: () => {
      process.restarts++;
      locked = false;
      for (const end of ended) end();
      ended = [];
    },
  };
  return process satisfies HidTransport;
}

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

  it.each([
    { productId: 0x00c3, name: "HyperPolling dongle (0xc3)" },
    { productId: 0x00c2, name: "HyperPolling model's cable (0xc2)" },
  ])("reads through the $name", async ({ productId }) => {
    const transport = fakeTransport([{ productId, path: "mouse", respond: awake(255, false) }]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "reading",
      reading: { percent: 100, charging: false },
    });
  });

  it("reports asleep through the HyperPolling dongle", async () => {
    const transport = fakeTransport([
      { productId: 0x00c3, path: "dongle", respond: () => ({ status: 0x04 }) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
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
      reason: "device not found",
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

  it("reports asleep when the dongle is present but the device never answers", async () => {
    let requests = 0;
    const transport = fakeTransport([
      {
        productId: DONGLE_PRODUCT_ID,
        path: "dongle",
        respond: () => {
          requests++;
          return { status: 0x04 };
        },
      },
    ]);

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
    // The first attempt plus 3 retries, all through the one handle.
    expect(requests).toBe(4);
    expect(transport.opened).toHaveLength(1);
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
      reason: "device is not responding",
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

  it("still reports asleep when the deadline cuts the poll short", async () => {
    let clock = 0;
    const transport = fakeTransport([
      {
        productId: DONGLE_PRODUCT_ID,
        path: "control",
        respond: () => ({ status: 0x04 }),
      },
      {
        productId: DONGLE_PRODUCT_ID,
        path: "stuck",
        respond: () => {
          clock += 2_000;
          return "error" as const;
        },
      },
    ]);

    const result = await pollBattery(transport, {
      ...options,
      now: () => clock,
      deadlineMs: 3_000,
    });

    expect(result).toEqual({ kind: "asleep" });
  });

  it("does not report asleep once the dongle disappears mid-poll", async () => {
    let lists = 0;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => ({ status: 0x04 }) },
    ]);
    const transport: HidTransport = {
      list: async () => (lists++ === 0 ? dongle.list() : []),
      open: dongle.open,
    };

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "device not found",
    });
  });

  it("reports asleep when the cable is unplugged mid-poll", async () => {
    let lists = 0;
    const both = fakeTransport([
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: () => ({ status: 0x04 }) },
    ]);
    const transport: HidTransport = {
      list: async () => {
        const interfaces = await both.list();
        return lists++ === 0 ? interfaces : interfaces.filter((i) => i.path === "dongle");
      },
      open: both.open,
    };

    expect(await pollBattery(transport, options)).toEqual({ kind: "asleep" });
  });

  it("does not sleep past the poll deadline", async () => {
    let clock = 0;
    const transport = fakeTransport([
      {
        productId: DONGLE_PRODUCT_ID,
        path: "dongle",
        respond: () => {
          clock += 2_900;
          return "error" as const;
        },
      },
    ]);
    const sleep = async (ms: number) => {
      clock += ms;
    };

    await pollBattery(transport, { sleep, now: () => clock, deadlineMs: 10_000 });

    expect(clock).toBeLessThanOrEqual(10_000);
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

describe("pollDevice", () => {
  it("uses the model's transaction ID for each connection", async () => {
    const blackWidow = model("BlackWidow V3 Pro");
    const wireless = fakeTransport([
      { productId: 0x025c, path: "dongle", transactionId: 0x9f, respond: awake(204, false) },
    ]);
    const wired = fakeTransport([
      { productId: 0x025a, path: "wired", transactionId: 0x3f, respond: awake(51, true) },
    ]);

    expect(await pollDevice(wireless, blackWidow, options)).toEqual({
      kind: "reading",
      reading: { percent: 80, charging: false },
    });
    expect(await pollDevice(wired, blackWidow, options)).toEqual({
      kind: "reading",
      reading: { percent: 20, charging: true },
    });
  });

  it("reads an older model with transaction ID 0xFF", async () => {
    const transport = fakeTransport([
      { productId: 0x007b, path: "dongle", transactionId: 0xff, respond: awake(255, true) },
    ]);

    expect(await pollDevice(transport, model("Viper Ultimate"), options)).toEqual({
      kind: "reading",
      reading: { percent: 100, charging: true },
    });
  });

  it("does not ask a model on disposable batteries whether it is charging", async () => {
    const requests: number[] = [];
    const transport = fakeTransport([
      {
        productId: 0x0083,
        path: "dongle",
        transactionId: 0xff,
        respond: (request) => {
          requests.push(request[7] ?? 0);
          return request[7] === 0x80 ? 128 : "error";
        },
      },
    ]);

    expect(await pollDevice(transport, model("Basilisk X HyperSpeed"), options)).toEqual({
      kind: "reading",
      reading: { percent: 50, charging: false },
    });
    expect(requests).toEqual([0x80]);
  });

  it("ignores another model's interfaces", async () => {
    const transport = fakeTransport([
      { productId: 0x00c1, path: "viper", respond: awake(255, false) },
    ]);

    expect(await pollBattery(transport, options)).toEqual({
      kind: "unavailable",
      reason: "device not found",
    });
    expect(transport.opened).toEqual([]);
  });
});

describe("createBatteryPoller", () => {
  it("tries the interface that last answered first", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "stuck", respond: () => "error" },
      { productId: DONGLE_PRODUCT_ID, path: "control", respond: awake(255, false) },
    ]);
    const poll = createBatteryPoller(transport, options);

    await poll();
    await poll();

    // The interface that answered stays open for the next poll.
    expect(transport.opened).toEqual(["stuck", "control"]);
  });

  it("polls every connected device in the table", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "mouse", respond: awake(255, false) },
      { productId: 0x025c, path: "keyboard", transactionId: 0x9f, respond: awake(51, false) },
      { productId: 0x1234, path: "other", respond: awake(255, false) },
    ]);

    expect(await createBatteryPoller(transport, options)()).toEqual({
      kind: "devices",
      devices: [
        {
          model: DEATHADDER_V3_PRO,
          result: { kind: "reading", reading: { percent: 100, charging: false } },
        },
        {
          model: model("BlackWidow V3 Pro"),
          result: { kind: "reading", reading: { percent: 20, charging: false } },
        },
      ],
    });
  });

  it("shows the DeathAdder V3 Pro's cable and dongle as one device", async () => {
    const transport = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: awake(128, true) },
    ]);

    expect(await createBatteryPoller(transport, options)()).toEqual({
      kind: "devices",
      devices: [
        {
          model: DEATHADDER_V3_PRO,
          result: { kind: "reading", reading: { percent: 50, charging: true } },
        },
      ],
    });
    expect(transport.opened).toEqual(["wired"]);
  });

  it("keeps a device that stalls from making another one unavailable", async () => {
    const devices = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "stuck", respond: awake(255, false) },
      { productId: 0x00c1, path: "viper", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: devices.list,
      open: async (path) => {
        const handle = await devices.open(path);
        return path === "stuck" ? { ...handle, getFeatureReport: hang } : handle;
      },
    };

    const round = await createBatteryPoller(transport, { ...options, timeoutMs: 5 })();

    expect(round).toEqual({
      kind: "devices",
      devices: [
        {
          model: DEATHADDER_V3_PRO,
          result: { kind: "unavailable", reason: "device is not responding" },
        },
        {
          model: model("Viper V3 Pro"),
          result: { kind: "reading", reading: { percent: 100, charging: false } },
        },
      ],
    });
  });

  it("does not call an interface again while an earlier call on it still hangs", async () => {
    const devices = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "stuck", respond: awake(255, false) },
      { productId: 0x00c1, path: "viper", respond: awake(255, false) },
    ]);
    const transport: HidTransport & { opened: string[] } = {
      opened: devices.opened,
      list: devices.list,
      open: async (path) => {
        const handle = await devices.open(path);
        return path === "stuck" ? { ...handle, getFeatureReport: hang } : handle;
      },
    };
    const poll = createBatteryPoller(transport, { ...options, timeoutMs: 5 });

    await poll();
    const round = await poll();

    // Each hung call holds a thread, so stacking more on the same interface would starve the rest.
    expect(transport.opened.filter((path) => path === "stuck")).toEqual(["stuck"]);
    expect(round).toEqual({
      kind: "devices",
      devices: [
        {
          model: DEATHADDER_V3_PRO,
          result: { kind: "unavailable", reason: "device is not responding" },
        },
        {
          model: model("Viper V3 Pro"),
          result: { kind: "reading", reading: { percent: 100, charging: false } },
        },
      ],
    });
  });

  it("stops calling a device once any of its interfaces has a hung call", async () => {
    const devices = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "first", respond: awake(255, false) },
      { productId: DONGLE_PRODUCT_ID, path: "second", respond: awake(255, false) },
    ]);
    const transport: HidTransport & { opened: string[] } = {
      opened: devices.opened,
      list: devices.list,
      open: async (path) => ({ ...(await devices.open(path)), getFeatureReport: hang }),
    };
    const poll = createBatteryPoller(transport, { ...options, timeoutMs: 5 });

    await poll();
    await poll();

    // Each hung call holds one of node-hid's few threads, so a device may hold only one.
    expect(transport.opened).toEqual(["first"]);
  });

  it("still reads the cable while a dongle call hangs", async () => {
    let cable = false;
    const devices = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
      { productId: WIRED_PRODUCT_ID, path: "wired", respond: awake(128, true) },
    ]);
    const transport: HidTransport = {
      list: async () => (await devices.list()).filter((i) => cable || i.path === "dongle"),
      open: async (path) => {
        const handle = await devices.open(path);
        return path === "dongle" ? { ...handle, getFeatureReport: hang } : handle;
      },
    };
    const poll = createBatteryPoller(transport, { ...options, timeoutMs: 5 });

    await poll();
    cable = true;

    expect(await poll()).toEqual({
      kind: "devices",
      devices: [
        {
          model: DEATHADDER_V3_PRO,
          result: { kind: "reading", reading: { percent: 50, charging: true } },
        },
      ],
    });
  });

  it("restarts HID to drop an unplugged device while another device's open hangs", async () => {
    // node-hid opens and lists one at a time, so a hung open holds up every later open and list.
    const devices: FakeDevice[] = [
      { productId: 0x00c1, path: "viper", respond: awake(255, false) },
      { productId: DONGLE_PRODUCT_ID, path: "stuck", respond: awake(255, false) },
    ];
    const hid = hidProcess(devices, new Set(["stuck"]));
    const poll = createBatteryPoller(hid, { ...options, timeoutMs: 5 });

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ model: model("Viper V3 Pro"), result: { kind: "reading" } }, {}],
    });
    devices.splice(0, 1);

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ model: DEATHADDER_V3_PRO, result: { kind: "unavailable" } }],
    });
    expect(hid.restarts).toBe(1);
  });

  it("restarts HID to list devices again when an earlier listing still hangs", async () => {
    let hung = true;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: () => (hung ? hang() : dongle.list()),
      open: dongle.open,
      restart: () => {
        hung = false;
      },
    };
    const poll = createBatteryPoller(transport, { ...options, timeoutMs: 5 });

    expect(await poll()).toMatchObject({ kind: "none" });

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ model: DEATHADDER_V3_PRO, result: { kind: "reading" } }],
    });
  });

  it("does not list devices again while an earlier listing still hangs and HID cannot restart", async () => {
    let lists = 0;
    const transport: HidTransport = {
      list: () => {
        lists++;
        return hang();
      },
      open: async () => {
        throw new Error("unreachable");
      },
    };
    const poll = createBatteryPoller(transport, { ...options, timeoutMs: 5 });

    await poll();
    await poll();

    expect(lists).toBe(1);
  });

  it("reports when no supported device is connected", async () => {
    const transport = fakeTransport([
      { productId: 0x1234, path: "other", respond: awake(255, false) },
    ]);

    expect(await createBatteryPoller(transport, options)()).toEqual({ kind: "none" });
    expect(transport.opened).toEqual([]);
  });

  it("reports why listing devices failed", async () => {
    const transport: HidTransport = {
      list: async () => {
        throw new Error("hid unavailable");
      },
      open: async () => {
        throw new Error("unreachable");
      },
    };

    expect(await createBatteryPoller(transport, options)()).toEqual({
      kind: "none",
      reason: "hid unavailable",
    });
  });

  it("gives each device its full time limit after finding it", async () => {
    let clock = 0;
    let lists = 0;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      // Finding the device takes the whole limit.
      list: async () => {
        if (lists++ === 0) clock += 10_000;
        return dongle.list();
      },
      open: dongle.open,
    };

    const round = await createBatteryPoller(transport, {
      ...options,
      now: () => clock,
      deadlineMs: 10_000,
    })();

    expect(round).toMatchObject({
      kind: "devices",
      devices: [{ model: DEATHADDER_V3_PRO, result: { kind: "reading" } }],
    });
  });

  it("keeps the devices it found last time when listing devices fails", async () => {
    let failing = false;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: async () => {
        if (failing) throw new Error("hid busy");
        return dongle.list();
      },
      open: dongle.open,
    };
    const poll = createBatteryPoller(transport, options);

    await poll();
    failing = true;

    expect(await poll()).toEqual({
      kind: "devices",
      devices: [{ model: DEATHADDER_V3_PRO, result: { kind: "unavailable", reason: "hid busy" } }],
    });
  });

  it("finds a dongle that shows up late", async () => {
    let lists = 0;
    const dongle = fakeTransport([
      { productId: DONGLE_PRODUCT_ID, path: "dongle", respond: awake(255, false) },
    ]);
    const transport: HidTransport = {
      list: async () => (lists++ === 0 ? [] : dongle.list()),
      open: dongle.open,
    };

    expect(await createBatteryPoller(transport, options)()).toMatchObject({
      kind: "devices",
      devices: [{ model: DEATHADDER_V3_PRO, result: { kind: "reading" } }],
    });
  });
});
