# razer-battery-tray

A Windows 11 tray app that shows the battery level of a Razer DeathAdder V3 Pro, connected through the HyperSpeed dongle or the USB cable.

- The tray icon shows the battery percentage. It turns amber at 20% or below, red at 10% or below, and green while charging.
- The tooltip and menu show the model, percentage and charging state, or **Asleep** when the dongle is plugged in but the mouse does not answer.
- A notification appears once when the battery drops to 20% and again at 10%.
- The battery is read every 60 seconds. **Refresh now** in the menu reads it immediately.
- **Start with Windows** in the menu launches the app at login.

Razer Synapse can occasionally get in the way of reads. The app retries and shows **Unavailable** if it still cannot read the battery.

## Development

Requires Node.js 24 and pnpm.

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
