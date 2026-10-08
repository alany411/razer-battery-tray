# Supported devices come from a device table; headsets and shared dongles are out of scope

The app supports every Razer wireless device that answers OpenRazer's 90-byte battery commands (mice, keyboards, docks), listed in a device table of name, wired and dongle PIDs, and transaction ID. A table, rather than probing every Razer HID interface, knows which wired PID and dongle PID are the same device, so the cable can be preferred and one device never shows as two, and it avoids sending requests with every transaction ID to unknown devices within the poll's time limit.

## Considered Options

- **Probe every Razer interface**, naming devices from the HID product string: supports unlisted models, but loses wired/dongle pairing and costs time per transaction ID.
- **Table plus probing fallback**: the same costs for unlisted models; a new model is a one-line table entry instead.

## Consequences

- Headsets (BlackShark, Barracuda) use a different, undocumented HID protocol and are not supported.
- A HyperSpeed dongle shared by a mouse and a keyboard shows only the model its PID maps to; the second device cannot be reached separately.
