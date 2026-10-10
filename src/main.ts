import { join } from "node:path";
import {
  Menu,
  Notification,
  Tray,
  app,
  nativeImage,
  nativeTheme,
  utilityProcess,
} from "electron";
import type { NativeImage } from "electron";
import { APP_ID } from "./app-id.js";
import { createBatteryPoller } from "./battery-reader.js";
import type { BatteryReading } from "./battery-reader.js";
import { remoteHidTransport } from "./hid-process.js";
import type { HidProcess, HidMessage } from "./hid-process.js";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import { READING_DISPLAYS, describeLowBattery, describeRound } from "./tray-display.js";
import type { TrayDisplay } from "./tray-display.js";
import { rerunQueue } from "./rerun-queue.js";
import { readStartsAtLogin } from "./startup-entry.js";
import { findSynapse, openSynapse } from "./synapse.js";
import type { SynapseLauncher } from "./synapse.js";
import { readTaskbar } from "./taskbar-theme.js";
import { renderIcon } from "./tray-icon.js";
import type { Taskbar } from "./tray-icon.js";

const POLL_INTERVAL_MS = 60_000;
// Icon sizes for 100%, 150% and 200% display scaling.
const ICON_SCALES = [1, 1.5, 2] as const;

// Keyed by model name, like the displays.
const alerts = new Map<string, LowBatteryAlerts>();
// HID runs in its own process, restarted when an open or listing hangs.
const pollBattery = createBatteryPoller(remoteHidTransport(forkHidProcess));
const trays = new Map<string, Tray>();
let taskbar: Taskbar = "dark";
let displays: ReadonlyMap<string, TrayDisplay> = READING_DISPLAYS;

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start);
} else {
  app.quit();
}

function start(): void {
  show(displays);

  // Redraw in the taskbar's colours when Windows switches between light and dark.
  nativeTheme.on("updated", () => void followTaskbar());
  void followTaskbar();

  void poll();
  setInterval(() => void poll(), POLL_INTERVAL_MS);
}

async function followTaskbar(): Promise<void> {
  const next = await readTaskbar();
  if (next === taskbar) return;
  taskbar = next;
  show(displays);
}

// Refresh now during a poll queues another poll instead of being dropped.
const poll = rerunQueue(async () => {
  const round = await pollBattery();
  // Also catches theme changes Electron does not report.
  taskbar = await readTaskbar();
  if (round.kind === "none" && round.reason) console.warn(`No device listed: ${round.reason}`);
  for (const { model, result } of round.kind === "devices" ? round.devices : []) {
    if (result.kind === "unavailable") {
      console.warn(`${model.name} battery unavailable: ${result.reason}`);
    }
    if (result.kind === "reading") notifyIfLow(model.name, result.reading);
  }
  show(describeRound(round));
});

/** Gives each display its own tray icon, removing icons for devices no longer listed. */
function show(next: ReadonlyMap<string, TrayDisplay>): void {
  displays = next;
  for (const [key, tray] of trays) {
    if (next.has(key)) continue;
    tray.destroy();
    trays.delete(key);
  }
  for (const [key, display] of next) {
    let tray = trays.get(key);
    if (tray) {
      tray.setImage(trayIcon(display));
    } else {
      tray = new Tray(trayIcon(display));
      onRightClick(tray, key);
      trays.set(key, tray);
    }
    tray.setToolTip(display.tooltip);
  }
}

function onRightClick(tray: Tray, key: string): void {
  // Build the menu as it opens, so the Start with Windows checkbox is never stale.
  tray.on("right-click", () => {
    void Promise.all([readStartsAtLogin(APP_ID), findSynapse()]).then(
      ([startsAtLogin, synapse]) => {
        const display = displays.get(key);
        if (display && !tray.isDestroyed()) {
          tray.popUpContextMenu(menu(display, startsAtLogin, synapse));
        }
      },
    );
  });
}

function menu(
  display: TrayDisplay,
  startsAtLogin: boolean,
  synapse: SynapseLauncher | undefined,
): Menu {
  return Menu.buildFromTemplate([
    { label: display.tooltip, enabled: false },
    ...(display.detail ? [{ label: display.detail, enabled: false }] : []),
    { type: "separator" },
    { label: "Refresh now", click: () => void poll() },
    {
      label: "Open Synapse",
      enabled: synapse !== undefined,
      click: () => synapse && openSynapse(synapse),
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: startsAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
}

function trayIcon({ iconText, tone }: TrayDisplay): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of ICON_SCALES) {
    image.addRepresentation({
      scaleFactor,
      buffer: renderIcon(iconText, tone, 16 * scaleFactor, taskbar),
    });
  }
  return image;
}

function notifyIfLow(name: string, reading: BatteryReading): void {
  let deviceAlerts = alerts.get(name);
  if (!deviceAlerts) alerts.set(name, (deviceAlerts = new LowBatteryAlerts()));
  const thresholds = deviceAlerts.update(reading);
  if (!Notification.isSupported()) return;
  for (const threshold of thresholds) {
    new Notification(describeLowBattery(name, threshold, reading)).show();
  }
}

function forkHidProcess(onMessage: (message: HidMessage) => void, onExit: () => void): HidProcess {
  const child = utilityProcess.fork(join(import.meta.dirname, "hid-process-entry.js"), [], {
    serviceName: "Razer Battery Tray HID",
  });
  child.on("message", onMessage);
  child.on("exit", onExit);
  return {
    post: (request) => child.postMessage(request),
    kill: () => void child.kill(),
  };
}
