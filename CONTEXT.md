# Razer Battery Tray

A Windows tray app that shows the battery percentage of a Razer DeathAdder V3 Pro.

## Language

**Mouse**:
The Razer DeathAdder V3 Pro itself, reached either wired (PID `0x00B6`) or through the dongle.
_Avoid_: Device (ambiguous with the dongle)

**Dongle**:
The Razer HyperSpeed wireless receiver (PID `0x00B7`) that relays reports to the mouse.
_Avoid_: Receiver, transceiver

**Poll**:
One scheduled or requested try, retries included, to get a battery reading from the mouse. It ends with a battery reading, Asleep, or Unavailable.

**Battery reading**:
A percentage plus whether the mouse is charging.
_Avoid_: Battery status, level

**Asleep**:
The dongle is present but the mouse does not answer a battery request, or answers 0% while not charging (a truly empty mouse is off). Never applies while the cable is connected, since a cabled mouse is awake.
_Avoid_: Disconnected, offline

**Unavailable**:
No reading could be taken after all retries or within the poll's 10-second limit (no mouse or dongle found, requests kept failing, or the poll ran out of time).
_Avoid_: Error state
