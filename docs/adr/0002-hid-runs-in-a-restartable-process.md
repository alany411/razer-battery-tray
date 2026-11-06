# HID runs in a restartable process

node-hid opens and lists devices one at a time behind a lock shared by the whole process, and a hung open (e.g. a confused dongle after resume) never returns, so every later open and listing waits behind it until the app restarts. All HID work therefore runs in an Electron `utilityProcess`, the HID process, which the main process kills and restarts at the start of a round when an open or listing from an earlier round has been running for at least the HID timeout; a younger one is left to finish. The battery polling logic stays in the main process and talks to it through a `HidTransport` over a message port, so a restart keeps poll memory, low-battery alert state and tray icons.

## Considered Options

- **A worker thread**: node-hid's application context, and the lock with it, is shared by every thread in the process, and terminating a worker does not end a native call that hangs, so the lock stays held.
- **One process per device**: frees each device from the others' hangs without restarts, but costs a process per device and still needs restarting for a hung listing.
- **The whole poller in the HID process**: a restart would lose poll memory, and the main process would still need its own timeout on the poll.

## Consequences

- A restart closes every handle, so all devices are opened again in that round.
- The main process starts one open or listing at a time from a queue, and a new one waits its turn (up to the HID timeout) instead of failing, so devices that open in the same round do not use up each other's retries. A wait that times out leaves the queue and never starts its call.
- An interface whose open hung is quarantined so it cannot hang the new process before the other devices open, and right after a restart so are the other interfaces on its cable or dongle.
- A battery request that hangs holds only its own interface, so it does not cause a restart at once; that interface (and its connection) is left alone. If the request has been running for at least the HID timeout at the start of 3 rounds in a row, the HID process is restarted all the same and the interface is quarantined like a hung open, so it can recover without restarting the app. Hung opens and hung requests share one hang count.
- When the HID process exits on its own (e.g. node-hid crashes), every handle and queued call is dropped so the next attempt opens afresh. An open running at that moment is quarantined at once, and the other interfaces on its connection wait for the rest of that round and the next, as after a restart.
