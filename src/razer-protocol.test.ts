import { describe, expect, it } from "vitest";
import {
  BATTERY_LEVEL,
  CHARGING_STATUS,
  REPORT_LENGTH,
  buildRequest,
  parseResponse,
} from "./razer-protocol.js";

function responseFor(request: Uint8Array, status: number, value: number): Uint8Array {
  const response = Uint8Array.from(request);
  response[0] = status;
  response[9] = value;
  return response;
}

describe("buildRequest", () => {
  it("builds the 90-byte battery level request", () => {
    const report = buildRequest(BATTERY_LEVEL);

    expect(report).toHaveLength(REPORT_LENGTH);
    expect(Array.from(report.subarray(0, 8))).toEqual([
      0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x07, 0x80,
    ]);
    // CRC is the XOR of bytes 2..87.
    expect(report[88]).toBe(0x02 ^ 0x07 ^ 0x80);
    expect(report[89]).toBe(0x00);
  });

  it("builds the charging status request", () => {
    const report = buildRequest(CHARGING_STATUS);

    expect(report[7]).toBe(0x84);
    expect(report[88]).toBe(0x02 ^ 0x07 ^ 0x84);
  });
});

describe("parseResponse", () => {
  it("returns the value byte of a successful response", () => {
    const request = buildRequest(BATTERY_LEVEL);

    expect(parseResponse(BATTERY_LEVEL, responseFor(request, 0x02, 200))).toEqual({
      ok: true,
      value: 200,
    });
  });

  it("strips a leading report ID byte", () => {
    const request = buildRequest(BATTERY_LEVEL);
    const withReportId = new Uint8Array(REPORT_LENGTH + 1);
    withReportId.set(responseFor(request, 0x02, 77), 1);

    expect(parseResponse(BATTERY_LEVEL, withReportId)).toEqual({ ok: true, value: 77 });
  });

  it("reports the status when the device did not succeed", () => {
    const request = buildRequest(BATTERY_LEVEL);

    expect(parseResponse(BATTERY_LEVEL, responseFor(request, 0x04, 0))).toEqual({
      ok: false,
      reason: "status 0x04",
    });
  });

  it("rejects a response to a different command", () => {
    const request = buildRequest(CHARGING_STATUS);

    expect(parseResponse(BATTERY_LEVEL, responseFor(request, 0x02, 1))).toEqual({
      ok: false,
      reason: "mismatched command",
    });
  });

  it("rejects a response of the wrong length", () => {
    expect(parseResponse(BATTERY_LEVEL, new Uint8Array(10))).toEqual({
      ok: false,
      reason: "unexpected length 10",
    });
  });
});
