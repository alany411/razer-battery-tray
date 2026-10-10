# razer-battery-tray

A Windows 11 tray app that shows the battery percentage of Razer wireless mice and keyboards, connected through their dongle or the USB cable.

- Each connected device gets its own tray icon showing its battery percentage as a number, e.g. `87`. The text turns amber at 20% or below and green while charging, and is white or near-black to suit a dark or light taskbar.
- The tooltip and menu show the model, percentage and charging state, or **Asleep** when the dongle is plugged in but the device does not answer (or reports 0% while not charging).
- With no supported device connected, a single icon shows **No Razer device found**. A device's icon goes away when it is unplugged.
- A notification appears once per device when its battery drops to 20% and again at 10%.
- Batteries are read every 60 seconds. **Refresh now** in any menu reads them all immediately.
- **Open Synapse** in the menu opens Razer Synapse, the same way as its Start menu shortcut. It is greyed out if Synapse is not installed.
- **Start with Windows** in the menu launches the app at login.
- Right-click any tray icon to open its menu. Launching the app again while it runs does nothing, so only one copy of the app runs.

Razer Synapse can occasionally get in the way of reads. Once a device is found, the app retries it for up to 10 seconds and shows **Unavailable** if it still cannot read its battery. Finding devices has its own 10-second limit, so a refresh takes at most about 20 seconds.

If a device stops answering while being opened, node-hid holds up every later open and device listing behind it. The app does its HID work in a separate HID process, so at the next read it restarts that process, which picks up newly connected and unplugged devices again. The interface that stopped answering is left unopened for the next read, then for twice as many reads each time it hangs again, up to 15 reads (about 15 minutes), so it cannot hold up the others. Its device keeps reading through another interface if it has one that answers, and otherwise shows **Unavailable** (device stopped responding). Leaving it unplugged until the next read (or **Refresh now**) lets it be tried again right away once plugged back in (see `docs/adr/0002-hid-runs-in-a-restartable-process.md`).

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

See `CONTEXT.md` for the glossary.
