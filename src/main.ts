import { join } from "node:path";
import { Menu, Notification, Tray, app, nativeImage, nativeTheme, utilityProcess } from "electron";
import type { NativeImage } from "electron";
import { APP_ID } from "./app-id.js";
import { cachedValue } from "./cached-value.js";
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
import { trayGuid } from "./tray-guid.js";
import { ICON_SCALES, renderIcon } from "./tray-icon.js";
import type { Taskbar } from "./tray-icon.js";

const POLL_INTERVAL_MS = 60_000;

// Keyed by model name, like the displays.
const alerts = new Map<string, LowBatteryAlerts>();
// HID runs in its own process, restarted when an open or listing hangs.
const pollBattery = createBatteryPoller(remoteHidTransport(forkHidProcess));
const trays = new Map<string, Tray>();
let taskbar: Taskbar = "dark";
let displays: ReadonlyMap<string, TrayDisplay> = READING_DISPLAYS;
// What the menu shows, read at start and after each poll instead of as the menu opens.
const startsAtLogin = cachedValue(false, () => readStartsAtLogin(APP_ID, process.execPath));
const synapseLauncher = cachedValue<SynapseLauncher | undefined>(undefined, findSynapse);

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start);
} else {
  app.quit();
}

function start(): void {
  show(displays);
  refreshMenuState();

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
  refreshMenuState();
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
      tray = createTray(key, trayIcon(display));
      onRightClick(tray, key);
      trays.set(key, tray);
    }
    tray.setToolTip(display.tooltip);
  }
}

/** A tray with its stable GUID, or without one should Windows refuse it (see ADR 0003). */
function createTray(key: string, image: NativeImage): Tray {
  const guid = trayGuid(app.getPath("exe"), key);
  try {
    return new Tray(image, guid);
  } catch (error) {
    console.warn(
      `Tray icon GUID ${guid} refused, so Windows will not remember its visibility:`,
      error,
    );
    return new Tray(image);
  }
}

// Only one menu at a time, so a quick second right-click does not queue another.
let menuOpen = false;

function onRightClick(tray: Tray, key: string): void {
  // Built from cached state, so the menu opens without waiting on the registry or a disk scan.
  tray.on("right-click", () => {
    const display = displays.get(key);
    if (menuOpen || !display || tray.isDestroyed()) return;
    const contextMenu = menu(display);
    menuOpen = true;
    contextMenu.once("menu-will-close", () => {
      menuOpen = false;
    });
    tray.popUpContextMenu(contextMenu);
  });
}

function menu(display: TrayDisplay): Menu {
  const synapse = synapseLauncher.get();
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
      checked: startsAtLogin.get(),
      // A dev run would write a Run entry that launches the dev electron.exe.
      enabled: app.isPackaged,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        startsAtLogin.set(item.checked);
      },
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
}

/** Reads what the menu shows again in the background. */
function refreshMenuState(): void {
  void startsAtLogin.refresh();
  void synapseLauncher.refresh();
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
  const threshold = deviceAlerts.update(reading);
  if (threshold === undefined || !Notification.isSupported()) return;
  new Notification(describeLowBattery(name, threshold, reading)).show();
}

function forkHidProcess(onMessage: (message: HidMessage) => void, onExit: () => void): HidProcess {
  const child = utilityProcess.fork(join(import.meta.dirname, "hid-process-entry.js"), [], {
    serviceName: "Razer Battery Tray HID",
  });
  child.on("message", onMessage);
  child.on("exit", onExit);
  return {
    // A utility process takes no target origin, unlike a window.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (request) => child.postMessage(request),
    kill: () => void child.kill(),
  };
}
