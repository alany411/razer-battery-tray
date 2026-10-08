# Razer Battery Tray

A Windows tray app that shows the battery percentage of Razer wireless devices.

## Language

**Device**:
One Razer wireless product the app reads: a mouse or keyboard in the device table, reached wired or through its dongle. It gets its own tray icon.
_Avoid_: Mouse (only one kind of device), product

**Device table**:
The list of supported models: for each, its name, whether it is rechargeable, and its connections, each a PID that is wired or wireless (a dongle or Bluetooth) with its own transaction ID. Facts taken from OpenRazer's device list.
_Avoid_: Device list, registry (that is the Windows registry)

**Dongle**:
The Razer wireless receiver that relays reports to a device, e.g. HyperSpeed (PID `0x00B7` for the DeathAdder V3 Pro) or HyperPolling (PID `0x00C3`). On some older mice the charging dock is the dongle.
_Avoid_: Receiver, transceiver

**Poll**:
One scheduled or requested try, retries included, to get a battery reading from one device. It ends with a battery reading, Asleep, or Unavailable.

**Battery reading**:
A percentage plus whether the device is charging.
_Avoid_: Battery status, level

**Asleep**:
The dongle is present but the device does not answer a battery request, or answers 0% while not charging (a truly empty device is off). Never applies while the cable is connected, since a cabled device is awake.
_Avoid_: Disconnected, offline

**Unavailable**:
No reading could be taken after all retries or within the poll's 10-second limit (requests kept failing, or the poll ran out of time). With no device found at all, the app shows a single **No Razer device found** icon that looks like Unavailable. If listing devices fails, the devices found last time stay and show Unavailable. If a stuck HID request keeps devices from being listed again, the devices found last time are still polled, and their menus say so.
_Avoid_: Error state
