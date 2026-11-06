# Tray icons have stable GUIDs per key and exe path

Windows 11 remembers whether a tray icon always shows or hides in the overflow by the icon's GUID, so each tray gets one: a UUIDv5 of the app's exe path and the tray's key (the model name, or the no-device key). The key keeps a device's choice across unplug and replug and across restarts. The exe path is in the hash because Windows binds an unsigned app's GUID to the path that first used it, and the same GUID from another path (`electron.exe` in development, a moved install) makes `new Tray` fail. If creating the tray with its GUID still throws, it is logged and the tray is created without one.

## Considered Options

- **One GUID per slot** (first tray, second tray, …): one device's choice would also cover its "Reading battery…" and "No Razer device found" icons, but with two devices, unplugging the first hands its visibility to the second.
- **Reusing the "Reading battery…" tray for the first device**: that tray would carry the no-device GUID, so the device's GUID would change on the next launch.

## Consequences

- Changing the derivation, or moving the install, resets every user's show/hide choice.
- The "No Razer device found" icon has its own choice, separate from any device's.
