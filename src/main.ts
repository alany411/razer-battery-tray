import { Menu, Notification, Tray, app, nativeImage } from "electron";
import type { NativeImage } from "electron";
import { pollBattery } from "./battery-reader.js";
import type { BatteryReading } from "./battery-reader.js";
import { LowBatteryAlerts } from "./low-battery-alerts.js";
import { nodeHidTransport } from "./node-hid-transport.js";
import { MOUSE_NAME, describePoll } from "./tray-display.js";
import type { TrayDisplay } from "./tray-display.js";
import { renderIcon } from "./tray-icon.js";

const APP_ID = "com.alanyang.razer-battery-tray";
const POLL_INTERVAL_MS = 60_000;
// Icon sizes for 100%, 150% and 200% display scaling.
const ICON_SCALES = [1, 1.5, 2] as const;

const alerts = new LowBatteryAlerts();
let tray: Tray | undefined;
let refreshing = false;

if (app.requestSingleInstanceLock()) {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start);
} else {
  app.quit();
}

function start(): void {
  const display: TrayDisplay = {
    tooltip: `${MOUSE_NAME} — Reading battery…`,
    iconText: "-",
    tone: "inactive",
  };
  tray = new Tray(trayIcon(display));
  tray.on("click", () => tray?.popUpContextMenu());
  show(display);

  void refresh();
  setInterval(() => void refresh(), POLL_INTERVAL_MS);
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const poll = await pollBattery(nodeHidTransport);
    if (poll.kind === "unavailable") console.warn(`Battery unavailable: ${poll.reason}`);
    show(describePoll(poll));
    if (poll.kind === "reading") notifyIfLow(poll.reading);
  } finally {
    refreshing = false;
  }
}

function show(display: TrayDisplay): void {
  if (!tray) return;
  tray.setImage(trayIcon(display));
  tray.setToolTip(display.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: display.tooltip, enabled: false },
      { type: "separator" },
      { label: "Refresh now", click: () => void refresh() },
      {
        label: "Start with Windows",
        type: "checkbox",
        // Unlike openAtLogin, this is false when the app is disabled in Startup Apps.
        checked: app.getLoginItemSettings().executableWillLaunchAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      { label: "Quit", role: "quit" },
    ]),
  );
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
    new Notification({
      title: `Mouse battery at or below ${threshold}%`,
      body: `${MOUSE_NAME} is at ${reading.percent}%. Charge it soon.`,
    }).show();
  }
}
