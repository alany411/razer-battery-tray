import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderIcon } from "./tray-icon.js";
import type { Taskbar } from "./tray-icon.js";
import type { Tone } from "./tray-display.js";

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

type Pixel = { x: number; y: number; color: [number, number, number] };

/** Every pixel that is not fully transparent. */
function ink(image: Image): Pixel[] {
  const found: Pixel[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b, a] = image.pixel(x, y);
      if (a !== 0) found.push({ x, y, color: [r, g, b] });
    }
  }
  return found;
}

function inkOf(text: string, tone: Tone = "normal", size = 16, taskbar: Taskbar = "dark"): Pixel[] {
  return ink(decodePng(renderIcon(text, tone, size, taskbar)));
}

function inkHeight(text: string, size: number): number {
  const ys = inkOf(text, "normal", size).map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys) + 1;
}

function inkColors(pixels: Pixel[]): string[] {
  return [...new Set(pixels.map((p) => p.color.join(",")))];
}

describe("renderIcon", () => {
  it.each([16, 24, 32])("renders a %ipx square PNG", (size) => {
    const image = decodePng(renderIcon("87%", "normal", size, "dark"));

    expect(image.format).toEqual([8, 6]); // 8-bit RGBA
    expect([image.width, image.height]).toEqual([size, size]);
  });

  it("leaves everything but the text transparent", () => {
    const image = decodePng(renderIcon("87%", "normal", 32, "dark"));

    expect(image.pixel(0, 0)[3]).toBe(0);
    expect(image.pixel(1, 16)[3]).toBe(0);
    expect(inkColors(ink(image))).toEqual(["255,255,255"]);
  });

  it("draws the text in a single colour per tone", () => {
    const colors = (["normal", "low", "charging", "inactive"] as const).map((tone) =>
      inkColors(inkOf("87%", tone)),
    );

    for (const tone of colors) expect(tone).toHaveLength(1);
    expect(new Set(colors.flat()).size).toBe(4);
  });

  it("uses dark text on a light taskbar", () => {
    expect(inkColors(inkOf("87%", "normal", 16, "light"))).not.toEqual(
      inkColors(inkOf("87%", "normal", 16, "dark")),
    );
    expect(inkColors(inkOf("87%", "inactive", 16, "light"))).not.toEqual(
      inkColors(inkOf("87%", "inactive", 16, "dark")),
    );
  });

  it.each(["7%", "87%", "100%", "z", "-"])("draws %s centred in the icon", (text) => {
    const pixels = inkOf(text);
    const xs = pixels.map((p) => p.x);
    const ys = pixels.map((p) => p.y);

    expect(pixels.length).toBeGreaterThan(0);
    // The ink's bounding box is centred on the icon's middle (7.5) to within half a pixel.
    expect(Math.min(...xs) + Math.max(...xs)).toBeGreaterThanOrEqual(14);
    expect(Math.min(...xs) + Math.max(...xs)).toBeLessThanOrEqual(16);
    expect(Math.min(...ys) + Math.max(...ys)).toBeGreaterThanOrEqual(14);
    expect(Math.min(...ys) + Math.max(...ys)).toBeLessThanOrEqual(16);
  });

  it("draws a percent sign", () => {
    // A trailing blank keeps the same layout, so the only difference is the % glyph.
    expect(inkOf("87%").length).toBeGreaterThan(inkOf("87 ").length);
  });

  it.each([16, 32])("keeps 100%% as tall as 87%% at %ipx", (size) => {
    expect(inkHeight("100%", size)).toBe(inkHeight("87%", size));
  });

  it("renders different text differently", () => {
    expect(
      renderIcon("87%", "normal", 32, "dark").equals(renderIcon("86%", "normal", 32, "dark")),
    ).toBe(false);
  });
});
