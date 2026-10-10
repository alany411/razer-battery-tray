import type { HidDeviceInfo, HidHandle, HidTransport } from "./battery-reader.js";

/** A HID call the main process asks the HID process to make. */
export type HidCall =
  | { call: "list" }
  | { call: "open"; path: string }
  | { call: "sendFeatureReport"; path: string; data: Uint8Array }
  | { call: "getFeatureReport"; path: string; reportId: number; length: number }
  | { call: "close"; path: string };

export interface HidRequest {
  id: number;
  request: HidCall;
}

/** What the HID process sends back: that it is listening, or how a call went. */
export type HidMessage =
  | { kind: "ready" }
  | { kind: "reply"; id: number; ok: true; value: unknown }
  | { kind: "reply"; id: number; ok: false; error: string };

export interface HidProcess {
  post(request: HidRequest): void;
  kill(): void;
}

/** Starts a HID process. `onExit` runs when it ends, whether killed or not. */
export type SpawnHidProcess = (
  onMessage: (message: HidMessage) => void,
  onExit: () => void,
) => HidProcess;

/**
 * Runs in the HID process: makes each call on `transport` and posts the reply. Handles stay here,
 * keyed by path, so only paths and bytes cross between the processes.
 */
export function serveHid(
  transport: HidTransport,
  post: (message: HidMessage) => void,
): (request: HidRequest) => void {
  const handles = new Map<string, HidHandle>();
  const handleAt = (path: string) => {
    const handle = handles.get(path);
    if (!handle) throw new Error("device is not open");
    return handle;
  };
  const run = async (request: HidCall): Promise<unknown> => {
    switch (request.call) {
      case "list":
        return transport.list();
      case "open": {
        const handle = await transport.open(request.path);
        // Opened again after a timeout in the main process, which closed the one before.
        void handles
          .get(request.path)
          ?.close()
          .catch(() => {});
        handles.set(request.path, handle);
        return undefined;
      }
      case "sendFeatureReport":
        return handleAt(request.path).sendFeatureReport(request.data);
      case "getFeatureReport":
        return handleAt(request.path).getFeatureReport(request.reportId, request.length);
      case "close": {
        const handle = handles.get(request.path);
        handles.delete(request.path);
        return handle?.close();
      }
    }
  };
  return ({ id, request }) => {
    run(request).then(
      (value) => post({ kind: "reply", id, ok: true, value }),
      (error: unknown) =>
        post({
          kind: "reply",
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}

interface Connection {
  process?: HidProcess;
  ready: boolean;
  ended: boolean;
  /** Requests made before the process was listening. */
  waiting: HidRequest[];
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

/**
 * A transport that makes every HID call in a HID process, started on the first call. `restart`
 * kills it, ending every call still running in it, e.g. an open that never returns.
 */
export function remoteHidTransport(spawn: SpawnHidProcess): Required<HidTransport> {
  let current: Connection | undefined;
  let nextId = 0;

  const end = (connection: Connection, reason: string) => {
    if (current === connection) current = undefined;
    connection.ended = true;
    for (const { reject } of connection.pending.values()) reject(new Error(reason));
    connection.pending.clear();
  };

  const connect = (): Connection => {
    if (current) return current;
    const connection: Connection = { ready: false, ended: false, waiting: [], pending: new Map() };
    current = connection;
    connection.process = spawn(
      (message) => {
        if (message.kind === "ready") {
          connection.ready = true;
          for (const request of connection.waiting) connection.process?.post(request);
          connection.waiting = [];
          return;
        }
        const pending = connection.pending.get(message.id);
        connection.pending.delete(message.id);
        if (message.ok) pending?.resolve(message.value);
        else pending?.reject(new Error(message.error));
      },
      () => end(connection, "HID process exited"),
    );
    return connection;
  };

  const call = <T>(connection: Connection, request: HidCall): Promise<T> => {
    if (connection.ended) return Promise.reject(new Error("HID process restarted"));
    return new Promise<T>((resolve, reject) => {
      const message = { id: nextId++, request };
      connection.pending.set(message.id, { resolve: (value) => resolve(value as T), reject });
      if (connection.ready) connection.process?.post(message);
      else connection.waiting.push(message);
    });
  };

  return {
    list: () => call<HidDeviceInfo[]>(connect(), { call: "list" }),
    open: async (path) => {
      const connection = connect();
      await call(connection, { call: "open", path });
      // Calls on a handle go to the process that opened it, and fail once it is gone.
      return {
        sendFeatureReport: (data) => call(connection, { call: "sendFeatureReport", path, data }),
        getFeatureReport: (reportId, length) =>
          call(connection, { call: "getFeatureReport", path, reportId, length }),
        // Ending the process closed it already.
        close: async () => {
          if (!connection.ended) await call(connection, { call: "close", path });
        },
      };
    },
    restart: () => {
      const connection = current;
      if (!connection) return;
      end(connection, "HID process restarted");
      connection.process?.kill();
    },
  };
}
