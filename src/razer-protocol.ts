// Razer HID control reports, as documented by OpenRazer (razercommon.h).
// Layout of the 90-byte report:
//   0      status (0x00 for a new request)
//   1      transaction ID
//   2-3    remaining packets
//   4      protocol type
//   5      data size
//   6      command class
//   7      command ID
//   8-87   arguments
//   88     CRC: XOR of bytes 2..87
//   89     reserved

export const REPORT_LENGTH = 90;

const STATUS_SUCCESS = 0x02;
// The statuses a dongle sends back when the mouse it relays to does not respond.
const STATUS_FAILURE = 0x03;
const STATUS_TIMEOUT = 0x04;
const VALUE_OFFSET = 9;
const CRC_OFFSET = 88;

export interface Command {
  readonly commandClass: number;
  readonly commandId: number;
  readonly dataSize: number;
}

/** Raw battery byte, 0–255 (OpenRazer's name for the command). */
export const BATTERY_LEVEL: Command = { commandClass: 0x07, commandId: 0x80, dataSize: 0x02 };

/** Charging flag, 0 or 1. */
export const CHARGING_STATUS: Command = { commandClass: 0x07, commandId: 0x84, dataSize: 0x02 };

/**
 * `mouseDidNotAnswer` is true when a well-formed response came back with a failure or timeout
 * status: whatever relayed the request answered, but the mouse did not.
 */
export type ParsedResponse =
  | { ok: true; value: number }
  | { ok: false; reason: string; mouseDidNotAnswer: boolean };

/** `transactionId` depends on the model and connection (0x1F on most current devices). */
export function buildRequest(command: Command, transactionId: number): Uint8Array {
  const report = new Uint8Array(REPORT_LENGTH);
  report[1] = transactionId;
  report[5] = command.dataSize;
  report[6] = command.commandClass;
  report[7] = command.commandId;
  report[CRC_OFFSET] = crc(report);
  return report;
}

export function parseResponse(command: Command, response: Uint8Array): ParsedResponse {
  // On Windows the report ID (0) comes back as the first byte.
  const report = response.length === REPORT_LENGTH + 1 ? response.subarray(1) : response;
  if (report.length !== REPORT_LENGTH) {
    return { ok: false, reason: `unexpected length ${response.length}`, mouseDidNotAnswer: false };
  }
  if (report[6] !== command.commandClass || report[7] !== command.commandId) {
    return { ok: false, reason: "mismatched command", mouseDidNotAnswer: false };
  }
  const status = report[0] ?? 0;
  if (status !== STATUS_SUCCESS) {
    return {
      ok: false,
      reason: `status 0x${status.toString(16).padStart(2, "0")}`,
      mouseDidNotAnswer: status === STATUS_FAILURE || status === STATUS_TIMEOUT,
    };
  }
  return { ok: true, value: report[VALUE_OFFSET] ?? 0 };
}

function crc(report: Uint8Array): number {
  let result = 0;
  for (let i = 2; i < CRC_OFFSET; i++) {
    result ^= report[i] ?? 0;
  }
  return result;
}
