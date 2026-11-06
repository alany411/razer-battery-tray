# razer-battery-tray

A Windows 11 tray app that shows the battery percentage of Razer wireless mice and keyboards, connected through their dongle or the USB cable.

- Each connected device gets its own tray icon showing its battery percentage as a number, e.g. `87`. The text turns amber at 20% or below and green while charging, and is white or near-black to suit a dark or light taskbar.
- The tooltip and menu show the model, percentage and charging state, or **Asleep** when the dongle is plugged in but the device does not answer (or reports 0% while not charging).
- With no supported device connected, a single icon shows **No Razer device found**. A device's icon goes away when it is unplugged.
- A low-battery alert appears once per device when its battery drops to 20% and again at 10%, but not while it is charging. If one reading is already at 10% or below (the first reading, or a device waking up), only the 10% alert appears. A threshold alerts again only after the battery has risen more than 3 points above it (to 24% or 14%), so a reading that wobbles around 20% does not alert each time.
- Batteries are read every 60 seconds, and 5 seconds after the PC wakes from sleep or the screen is unlocked. **Refresh now** in any menu reads them all immediately.
- **Open Synapse** in the menu opens Razer Synapse, the same way as its Start menu shortcut. It is greyed out if Synapse is not installed.
- **Start with Windows** in the menu launches the app at login (installed builds only; it is disabled under `pnpm start`).
- Right-click any tray icon to open its menu. Whether Synapse is installed and whether the app starts with Windows are checked at launch and after each read, so the menu opens at once. Launching the app again while it runs does nothing, so only one copy of the app runs.
- Each icon keeps the show or hide choice made in Windows' taskbar settings across unplugging, replugging and restarts. Moving the installed app resets it (see `docs/adr/0003-stable-tray-guids.md`).

Razer Synapse can occasionally get in the way of reads. Once a device is found, the app retries it for up to 10 seconds and shows **Unavailable** if it still cannot read its battery. Finding devices has its own 10-second limit, so a refresh takes at most about 20 seconds.

If a device stops answering while being opened, node-hid holds up every later open and device listing behind it. The app opens devices one at a time, each waiting its turn for up to 2 seconds, and does its HID work in a separate HID process. At the next read, if the open has been stuck for those 2 seconds, it restarts that process, which picks up newly connected and unplugged devices again; an open that is merely slow is left to finish. The interface that stopped answering is left unopened for the next read, then for twice as many reads each time it hangs again, up to 15 reads (about 15 minutes), so it cannot hold up the others. Its device keeps reading through another interface if it has one that answers, except on the read right after the restart, when the other interfaces on its cable or dongle wait too; otherwise it shows **Unavailable** (device stopped responding). A battery request that stops answering shows **Unavailable** (device is not responding); if it is still stuck after 3 reads, the HID process restarts and that interface is left alone the same way. An interface whose open crashes the HID process is left alone the same way, starting at once. Leaving it unplugged until the next read (or **Refresh now**) lets it be tried again right away once plugged back in (see `docs/adr/0002-hid-runs-in-a-restartable-process.md`).

## Supported devices

Razer wireless mice and keyboards whose battery OpenRazer reads, from the DeathAdder, Viper, Basilisk, Cobra, Naga, Pro Click, Orochi, Lancehead and Mamba mice to the BlackWidow, DeathStalker and Joro keyboards. The full list, with product IDs, is in `src/device-table.ts`. Headsets are not supported (see `docs/adr/0001-device-table-and-scope.md`).

## Development

Requires Node.js 24 and pnpm 12 or newer (pnpm settings live in `pnpm-workspace.yaml`).

```sh
pnpm install
pnpm start          # build and run
pnpm test           # unit tests (vitest)
pnpm lint           # oxlint
pnpm format         # oxfmt (format:check to verify)
pnpm typecheck
pnpm dist           # Windows x64 NSIS installer in release/
```

`pnpm dist` must run on Windows. On Linux, electron-builder needs wine to build the NSIS installer.

Toast notifications (low battery) only appear from the installed build: Windows shows them only for an AppUserModelID with a Start menu shortcut, which the installer creates. They don't show under `pnpm start`.

See `CONTEXT.md` for the glossary.
