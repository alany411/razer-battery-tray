import { describe, expect, it } from "vitest";
import { createBatteryPoller } from "./battery-reader.js";
import type { HidHandle, HidTransport } from "./battery-reader.js";
import { remoteHidTransport, serveHid } from "./hid-process.js";
import type { SpawnHidProcess } from "./hid-process.js";

const DONGLE = { productId: 0x00b7, path: "dongle" };

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

  it("fails calls on a handle opened before a restart", async () => {
    const { spawn } = processes(dongle);
    const transport = remoteHidTransport(spawn);
    const handle = await transport.open("dongle");

    transport.restart();

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

  it("reads devices again on the next poll after the HID process exits", async () => {
    const { spawn, spawned } = processes(dongle);
    const poll = createBatteryPoller(remoteHidTransport(spawn), { sleep: async () => {} });

    await poll();
    spawned[0]?.exit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await poll()).toMatchObject({
      kind: "devices",
      devices: [{ result: { kind: "reading", reading: { percent: 100 } } }],
    });
    expect(spawned).toHaveLength(2);
  });
});
