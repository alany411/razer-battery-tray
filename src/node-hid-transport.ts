import nodeHid from "node-hid";
import { RAZER_VENDOR_ID } from "./battery-reader.js";
import type { HidDeviceInfo, HidHandle, HidTransport } from "./battery-reader.js";

export const nodeHidTransport: HidTransport = {
  async list(): Promise<HidDeviceInfo[]> {
    const devices = await nodeHid.devicesAsync();
    return devices.flatMap(({ vendorId, productId, path }) =>
      vendorId === RAZER_VENDOR_ID && path ? [{ productId, path }] : [],
    );
  },

  async open(path: string): Promise<HidHandle> {
    const device = await nodeHid.HIDAsync.open(path, { nonExclusive: true });
    return {
      sendFeatureReport: async (data) => {
        await device.sendFeatureReport(Buffer.from(data));
      },
      getFeatureReport: (reportId, length) => device.getFeatureReport(reportId, length),
      close: () => device.close(),
    };
  },
};
