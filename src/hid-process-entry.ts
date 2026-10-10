import type { ParentPort } from "electron";
import { serveHid } from "./hid-process.js";
import type { HidMessage, HidRequest } from "./hid-process.js";
import { nodeHidTransport } from "./node-hid-transport.js";

// The HID process, started by the main process with Electron's utilityProcess.
const port: ParentPort = process.parentPort;
const post = (message: HidMessage) => port.postMessage(message);
const handle = serveHid(nodeHidTransport, post);
port.on("message", ({ data }: { data: HidRequest }) => handle(data));
post({ kind: "ready" });
