import { describe, expect, it } from "vitest";
import { createBatteryPoller } from "./battery-reader.js";
import type { HidHandle, HidTransport } from "./battery-reader.js";
import { remoteHidTransport, serveHid } from "./hid-process.js";
import type { HidCall, HidMessage, SpawnHidProcess } from "./hid-process.js";

const DONGLE = { productId: 0x00b7, path: "dongle" };
const CRASH = { productId: 0x00b7, path: "crash" };
const CONTROL = { productId: 0x00b7, path: "control" };
const VIPER = { productId: 0x00c1, path: "viper" };

const hang = () => new Promise<never>(() => {});

/** A dongle that answers every request with the battery byte (and charging flag) set. */
function dongle(): HidTransport {
  return {
    list: async () => [DONGLE],
    open: async (): Promise<HidHandle> => {
      let last = new Uint8Array(90);
      return {
        sendFeatureReport: async (data) => {
          last = Uint8Array.from(data.subarray(1));
        },
        getFeatureReport: async () => {
          const response = new Uint8Array(91);
          response.set(last, 1);
          response[1] = 0x02;
          response[10] = last[7] === 0x80 ? 255 : 0;
          return response;
        },
        close: async () => {},
      };
    },
  };
}

/**
 * Starts HID processes in memory, each serving `transport`. A process takes posts only once it
 * said it is ready, and stops answering once it is killed or exits.
 */
function processes(transport: () => HidTransport) {
  const spawned: { killed: boolean; exit: () => void }[] = [];
  const spawn: SpawnHidProcess = (onMessage, onExit) => {
    let ready = false;
    let alive = true;
    const handle = serveHid(transport(), (message) => {
      if (alive) queueMicrotask(() => onMessage(message));
    });
    const process = {
      killed: false,
      exit: () => {
        alive = false;
        queueMicrotask(onExit);
      },
    };
    spawned.push(process);
    queueMicrotask(() => {
      ready = true;
      onMessage({ kind: "ready" });
    });
    return {
      post: (request) => {
        if (!ready) throw new Error("posted before the process was listening");
        if (alive) queueMicrotask(() => handle(request));
      },
      kill: () => {
        process.killed = true;
        process.exit();
      },
    };
  };
  return { spawn, spawned };
}

/** A dongle whose handles count how often they were closed. */
function countingDongle() {
  const closed: number[] = [];
  let opens = 0;
  const transport: HidTransport = {
    list: async () => [DONGLE],
    open: async () => {
      const id = opens++;
      return { ...(await dongle().open(DONGLE.path)), close: async () => void closed.push(id) };
    },
  };
  return { transport, closed };
}

describe("serveHid", () => {
  const serve = (transport: HidTransport) => {
    const replies: HidMessage[] = [];
    const handle = serveHid(transport, (message) => replies.push(message));
    let id = 0;
    const send = async (request: HidCall) => {
      const sent = id++;
      handle({ id: sent, request });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return replies.find((reply) => reply.kind === "reply" && reply.id === sent);
    };
    return send;
  };

  it("closes the handle it held when a path is opened again", async () => {
    const { transport, closed } = countingDongle();
    const send = serve(transport);

    await send({ call: "open", path: DONGLE.path });
    await send({ call: "open", path: DONGLE.path });

    expect(closed).toEqual([0]);
  });

  it("forgets a handle once it is closed", async () => {
    const { transport, closed } = countingDongle();
    const send = serve(transport);

    await send({ call: "open", path: DONGLE.path });
    await send({ call: "close", path: DONGLE.path });

    expect(closed).toEqual([0]);
    expect(await send({ call: "getFeatureReport", path: DONGLE.path, reportId: 0, length: 91 })).toEqual(
      expect.objectContaining({ ok: false, error: "device is not open" }),
    );
  });
});

describe("remoteHidTransport", () => {
  it("lists, opens and reads a device in the HID process", async () => {
    const { spawn, spawned } = processes(dongle);
    const transport = remoteHidTransport(spawn);

    expect(await transport.list()).toEqual([DONGLE]);
    const handle = await transport.open("dongle");
    const request = new Uint8Array(91);
    request[8] = 0x80;
    await handle.sendFeatureReport(request);
    expect((await handle.getFeatureReport(0, 91))[10]).toBe(255);
    await handle.close();

    expect(spawned).toHaveLength(1);
  });

  it("passes on why a HID call failed", async () => {
    const { spawn } = processes(() => ({
      list: async () => [DONGLE],
      open: async () => {
        throw new Error("access denied");
      },
    }));

    await expect(remoteHidTransport(spawn).open("dongle")).rejects.toThrow("access denied");
  });

  it("ends a hung open when it restarts, and makes later calls in a new process", async () => {
    let first = true;
    const { spawn, spawned } = processes(() => {
      const hangs = first;
      first = false;
      return { ...dongle(), open: hangs ? hang : dongle().open };
    });
    const transport = remoteHidTransport(spawn);

    const opening = transport.open("dongle");
    transport.restart();

    await expect(opening).rejects.toThrow("HID process restarted");
    expect(spawned[0]?.killed).toBe(true);
    await expect(transport.open("dongle")).resolves.toBeDefined();
    expect(spawned).toHaveLength(2);
  });

  it("ends a hung request already sent to the HID process when it restarts", async () => {
    let first = true;
    const { spawn, spawned } = processes(() => {
      const hangs = first;
      first = false;
      const inner = dongle();
      return {
        ...inner,
        open: async (path) => ({
          ...(await inner.open(path)),
          ...(hangs ? { getFeatureReport: hang } : {}),
        }),
      };
    });
    const transport = remoteHidTransport(spawn);
    const handle = await transport.open(DONGLE.path);

    const reading = handle.getFeatureReport(0, 91);
    // Let the request reach the process before it restarts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.restart();

    await expect(reading).rejects.toThrow("HID process restarted");
    const fresh = await transport.open(DONGLE.path);
    await expect(fresh.getFeatureReport(0, 91)).resolves.toBeDefined();
    expect(spawned).toHaveLength(2);
  });

  it("fails calls on a handle opened before a restart", async () => {
    const { spawn } = processes(dongle);
    const transport = remoteHidTransport(spawn);
    const handle = await transport.open("dongle");

    transport.restart();
    // The killed process exits afterwards, which must not change why it ended.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(handle.getFeatureReport(0, 91)).rejects.toThrow("HID process restarted");
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("ends calls when the HID process exits on its own, and starts a new one", async () => {
    const { spawn, spawned } = processes(() => ({ ...dongle(), list: hang }));
    const transport = remoteHidTransport(spawn);

    const listing = transport.list();
    await Promise.resolve();
    spawned[0]?.exit();

    await expect(listing).rejects.toThrow("HID process exited");
    void transport.list().catch(() => {});
    expect(spawned).toHaveLength(2);
  });

  it("says the HID process exited when a handle from it is used", async () => {
    const { spawn, spawned } = processes(dongle);
    const transport = remoteHidTransport(spawn);
    const handle = await transport.open("dongle");

    spawned[0]?.exit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(handle.getFeatureReport(0, 91)).rejects.toThrow("HID process exited");
  });

  it("starts a HID process on the next call when starting one failed", async () => {
    const { spawn, spawned } = processes(dongle);
    let fail = true;
    const transport = remoteHidTransport((onMessage, onExit) => {
      if (fail) {
        fail = false;
        throw new Error("could not start the HID process");
      }
      return spawn(onMessage, onExit);
    });

    await expect(transport.list()).rejects.toThrow("could not start the HID process");

    expect(await transport.list()).toEqual([DONGLE]);
    expect(spawned).toHaveLength(1);
  });

  it("reads every device on the first attempt of the next poll after the HID process exits", async () => {
    const { spawn, spawned } = processes(() => ({
      ...dongle(),
      list: async () => [DONGLE, VIPER],
    }));
    const sleeps: number[] = [];
    const poll = createBatteryPoller(remoteHidTransport(spawn), {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await poll();
    spawned[0]?.exit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sleeps.length = 0;

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [
        { result: { kind: "reading", reading: { percent: 100 } } },
        { result: { kind: "reading", reading: { percent: 100 } } },
      ],
    });
    // No attempt was spent on a handle from the process that exited, so nothing waited to retry.
    expect(sleeps.every((ms) => ms < 500)).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  it("quarantines an interface whose open makes the HID process exit", async () => {
    const opened: string[] = [];
    const { spawn, spawned } = processes(() => ({
      list: async () => [CRASH, CONTROL, VIPER],
      open: (path) => {
        opened.push(path);
        if (path === CRASH.path) {
          spawned.at(-1)?.exit();
          return hang();
        }
        return dongle().open(path);
      },
    }));
    const poll = createBatteryPoller(remoteHidTransport(spawn), {
      sleep: async () => {},
      timeoutMs: 50,
    });
    const stoppedResponding = { kind: "unavailable", reason: "device stopped responding" };

    // The interface on the same dongle waits too, in case it makes the new process exit as well.
    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ result: stoppedResponding }, { result: { kind: "reading" } }],
    });
    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ result: stoppedResponding }, { result: { kind: "reading" } }],
    });
    expect(opened.filter((path) => path === CRASH.path)).toEqual([CRASH.path]);
    expect(opened).not.toContain(CONTROL.path);

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ result: { kind: "reading" } }, { result: { kind: "reading" } }],
    });
    expect(opened.filter((path) => path === CRASH.path)).toEqual([CRASH.path]);
  });
});
