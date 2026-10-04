import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderIcon } from "./tray-icon.js";

interface Image {
  format: [number, number];
  width: number;
  height: number;
  pixel(x: number, y: number): [number, number, number, number];
}

function decodePng(png: Buffer): Image {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let format: [number, number] = [0, 0];
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      format = [data[8] ?? 0, data[9] ?? 0];
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  return {
    format,
    width,
    height,
    pixel: (x, y) => {
      const i = y * stride + 1 + x * 4;
      return [raw[i] ?? -1, raw[i + 1] ?? -1, raw[i + 2] ?? -1, raw[i + 3] ?? -1];
    },
  };
}

function whitePixels(image: Image): { x: number; y: number }[] {
  const found = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = image.pixel(x, y);
      if (r === 255 && g === 255 && b === 255) found.push({ x, y });
    }
  }
  return found;
}

describe("renderIcon", () => {
  it.each([16, 32])("renders a %ipx square PNG", (size) => {
    const image = decodePng(renderIcon("87", "normal", size));

    expect(image.format).toEqual([8, 6]); // 8-bit RGBA
    expect([image.width, image.height]).toEqual([size, size]);
  });

  it("fills the background with the tone colour and leaves the corners clear", () => {
    const normal = decodePng(renderIcon("87", "normal", 32));
    const critical = decodePng(renderIcon("87", "critical", 32));

    expect(normal.pixel(0, 0)[3]).toBe(0);
    expect(normal.pixel(1, 16)[3]).toBe(255);
    expect(critical.pixel(1, 16)).not.toEqual(normal.pixel(1, 16));
  });

  it.each(["7", "87", "100", "z", "-"])("draws %s in white, centred inside the icon", (text) => {
    const ink = whitePixels(decodePng(renderIcon(text, "normal", 16)));
    const xs = ink.map((p) => p.x);
    const ys = ink.map((p) => p.y);

    expect(ink.length).toBeGreaterThan(0);
    // The ink's bounding box is centred on the icon's middle (7.5) to within half a pixel.
    expect(Math.min(...xs) + Math.max(...xs)).toBeGreaterThanOrEqual(14);
    expect(Math.min(...xs) + Math.max(...xs)).toBeLessThanOrEqual(16);
    expect(Math.min(...ys) + Math.max(...ys)).toBeGreaterThanOrEqual(14);
    expect(Math.min(...ys) + Math.max(...ys)).toBeLessThanOrEqual(16);
  });

  it("renders different text differently", () => {
    expect(renderIcon("87", "normal", 32).equals(renderIcon("86", "normal", 32))).toBe(false);
  });
});
