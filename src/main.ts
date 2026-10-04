import { Menu, Notification, Tray, app, nativeImage } from "electron";
import type { NativeImage } from "electron";
import { APP_ID } from "./app-id.js";
import { createBatteryPoller } from "./battery-reader.js";
import type { BatteryReading } from "./battery-reader.js";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import { nodeHidTransport } from "./node-hid-transport.js";
import { MOUSE_NAME, describeLowBattery, describePollResult } from "./tray-display.js";
import type { TrayDisplay } from "./tray-display.js";
import { rerunQueue } from "./rerun-queue.js";
import { renderIcon } from "./tray-icon.js";

const POLL_INTERVAL_MS = 60_000;
// Icon sizes for 100%, 150% and 200% display scaling.
const ICON_SCALES = [1, 1.5, 2] as const;

const alerts = new LowBatteryAlerts();
const pollBattery = createBatteryPoller(nodeHidTransport);
let tray: Tray | undefined;
let display: TrayDisplay = {
  tooltip: `${MOUSE_NAME} — Reading battery…`,
  iconText: "-",
  tone: "inactive",
};

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start);
} else {
  app.quit();
}

function start(): void {
  tray = new Tray(trayIcon(display));
  tray.setToolTip(display.tooltip);
  // Build the menu as it opens, so the Start with Windows checkbox is never stale.
  tray.on("right-click", () => tray?.popUpContextMenu(menu()));

  void poll();
  setInterval(() => void poll(), POLL_INTERVAL_MS);
}

// Refresh now during a poll queues another poll instead of being dropped.
const poll = rerunQueue(async () => {
  const result = await pollBattery();
  if (result.kind === "unavailable") console.warn(`Battery unavailable: ${result.reason}`);
  show(describePollResult(result));
  if (result.kind === "reading") notifyIfLow(result.reading);
});

function show(next: TrayDisplay): void {
  display = next;
  tray?.setImage(trayIcon(display));
  tray?.setToolTip(display.tooltip);
}

function menu(): Menu {
  return Menu.buildFromTemplate([
    { label: display.tooltip, enabled: false },
    ...(display.detail ? [{ label: display.detail, enabled: false }] : []),
    { type: "separator" },
    { label: "Refresh now", click: () => void poll() },
    {
      label: "Start with Windows",
      type: "checkbox",
      // Unlike openAtLogin, this is false when the app is disabled in Startup Apps.
      checked: app.getLoginItemSettings().executableWillLaunchAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
}

function trayIcon({ iconText, tone }: TrayDisplay): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of ICON_SCALES) {
    image.addRepresentation({ scaleFactor, buffer: renderIcon(iconText, tone, 16 * scaleFactor) });
  }
  return image;
}

function notifyIfLow(reading: BatteryReading): void {
  const thresholds = alerts.update(reading);
  if (!Notification.isSupported()) return;
  for (const threshold of thresholds) {
    new Notification(describeLowBattery(threshold, reading)).show();
  }
}
