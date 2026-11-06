import { beforeEach, describe, expect, it, vi } from "vitest";

const devicesAsync = vi.fn();
vi.mock("node-hid", () => ({ default: { devicesAsync, HIDAsync: { open: vi.fn() } } }));

const { nodeHidTransport } = await import("./node-hid-transport.js");

describe("nodeHidTransport", () => {
  beforeEach(() => {
    devicesAsync.mockReset();
  });

  it("asks hidapi for Razer devices only", async () => {
    devicesAsync.mockResolvedValue([{ vendorId: 0x1532, productId: 0x00b7, path: "dongle" }]);

    expect(await nodeHidTransport.list()).toEqual([{ productId: 0x00b7, path: "dongle" }]);
    expect(devicesAsync).toHaveBeenCalledWith(0x1532, 0);
  });
});
