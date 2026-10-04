# razer-battery-tray

A Windows 11 tray app that shows the battery percentage of a Razer DeathAdder V3 Pro, connected through the HyperSpeed dongle or the USB cable.

- The tray icon shows the battery percentage, e.g. `87%`. The text turns amber at 20% or below and green while charging, and is white or near-black to suit a dark or light taskbar.
- The tooltip and menu show the model, percentage and charging state, or **Asleep** when the dongle is plugged in but the mouse does not answer (or reports 0% while not charging).
- A notification appears once when the battery drops to 20% and again at 10%.
- The battery is read every 60 seconds. **Refresh now** in the menu reads it immediately.
- **Start with Windows** in the menu launches the app at login.
- Right-click the tray icon to open the menu. Launching the app again while it runs does nothing, so there is only ever one tray icon.

Razer Synapse can occasionally get in the way of reads. The app retries for up to 10 seconds and shows **Unavailable** if it still cannot read the battery.

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
