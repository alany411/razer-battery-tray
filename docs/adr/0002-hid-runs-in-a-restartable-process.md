# HID runs in a restartable process

node-hid opens and lists devices one at a time behind a lock shared by the whole process, and a hung open (e.g. a confused dongle after resume) never returns, so every later open and listing waits behind it until the app restarts. All HID work therefore runs in an Electron `utilityProcess`, the HID process, which the main process kills and restarts at the start of a round when an open or listing from an earlier round is still running. The battery polling logic stays in the main process and talks to it through a `HidTransport` over a message port, so a restart keeps poll memory, low-battery alert state and tray icons.

## Considered Options

- **A worker thread**: node-hid's application context, and the lock with it, is shared by every thread in the process, and terminating a worker does not end a native call that hangs, so the lock stays held.
- **One process per device**: frees each device from the others' hangs without restarts, but costs a process per device and still needs restarting for a hung listing.
- **The whole poller in the HID process**: a restart would lose poll memory, and the main process would still need its own timeout on the poll.

## Consequences

- A restart closes every handle, so all devices are opened again in that round.
- A path whose open hung is quarantined so it cannot hang the new process before the other devices open.
- A battery request that hangs does not cause a restart; that interface is left alone as before.
