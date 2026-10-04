import { crc32, deflateSync } from "node:zlib";
import type { Tone } from "./tray-display.js";

/** The taskbar's colour scheme, which decides whether neutral text is light or dark. */
export type Taskbar = "dark" | "light";

type Rgb = readonly [number, number, number];

// Text colours, chosen to read on the given taskbar. There is no background.
const TONE_COLORS: Record<Taskbar, Record<Tone, Rgb>> = {
  dark: {
    normal: [255, 255, 255],
    low: [251, 191, 36],
    charging: [74, 222, 128],
    inactive: [156, 163, 175],
  },
  light: {
    normal: [32, 32, 32],
    low: [180, 83, 9],
    charging: [21, 128, 61],
    inactive: [107, 114, 128],
  },
};

const GLYPH_HEIGHT = 5;

// Pixel font, 5 rows high, one string per row. Most glyphs are 3 wide; "%" needs 4.
const GLYPHS: Record<string, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
  "%": ["#..#", "...#", "..#.", ".#..", "#..#"],
  "-": ["...", "...", "###", "...", "..."],
  z: ["###", "..#", ".#.", "#..", "###"],
};

/** Renders a square tray icon showing `text` (digits, "%", "-" or "z") as a PNG. */
export function renderIcon(text: string, tone: Tone, size: number, taskbar: Taskbar): Buffer {
  const pixels = new Uint8Array(size * size * 4);
  const [r, g, b] = TONE_COLORS[taskbar][tone];

  const glyphs = [...text].map((char) => GLYPHS[char] ?? ["...", "...", "...", "...", "..."]);
  // Glyph widths plus a one-column gap between neighbours.
  const columns = glyphs.reduce((sum, glyph) => sum + (glyph[0]?.length ?? 0) + 1, -1);
  const fitX = Math.max(1, Math.floor(size / columns));
  const fitY = Math.max(1, Math.floor(size / GLYPH_HEIGHT));
  // Glyphs may be up to twice as tall as wide, so "100%" stays legible at 16px.
  const scaleY = Math.min(fitY, 2 * fitX);
  const scaleX = Math.min(fitX, scaleY);
  const left = Math.floor((size - columns * scaleX) / 2);
  const top = Math.floor((size - GLYPH_HEIGHT * scaleY) / 2);

  let glyphLeft = left;
  for (const glyph of glyphs) {
    for (const [row, line] of glyph.entries()) {
      for (const [column, cell] of [...line].entries()) {
        if (cell !== "#") continue;
        for (let dy = 0; dy < scaleY; dy++) {
          for (let dx = 0; dx < scaleX; dx++) {
            const x = glyphLeft + column * scaleX + dx;
            const y = top + row * scaleY + dy;
            if (x < size && y < size) setPixel(pixels, size, x, y, r, g, b);
          }
        }
      }
    }
    glyphLeft += ((glyph[0]?.length ?? 0) + 1) * scaleX;
  }

  return encodePng(pixels, size, size);
}

function setPixel(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void {
  pixels.set([r, g, b, 255], (y * size + x) * 4);
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Each scanline starts with filter type 0 (none).
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}
