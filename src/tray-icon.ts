import { crc32, deflateSync } from "node:zlib";
import type { Tone } from "./tray-display.js";

const TONE_COLORS: Record<Tone, readonly [number, number, number]> = {
  normal: [64, 64, 64],
  low: [217, 119, 6],
  critical: [220, 38, 38],
  charging: [22, 163, 74],
  inactive: [107, 114, 128],
};

const GLYPH_WIDTH = 3;
const GLYPH_HEIGHT = 5;

// 3×5 pixel font, one string per row.
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
  "-": ["...", "...", "###", "...", "..."],
  z: ["###", "..#", ".#.", "#..", "###"],
};

/** Renders a square tray icon showing `text` (digits, "-" or "z") as a PNG. */
export function renderIcon(text: string, tone: Tone, size: number): Buffer {
  const pixels = new Uint8Array(size * size * 4);
  const [r, g, b] = TONE_COLORS[tone];
  const radius = Math.max(2, size / 8);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRoundedSquare(x, y, size, radius)) setPixel(pixels, size, x, y, r, g, b);
    }
  }

  const padding = Math.max(1, Math.floor(size / 16));
  const available = size - 2 * padding;
  const columns = text.length * (GLYPH_WIDTH + 1) - 1;
  const fitX = Math.max(1, Math.floor(available / columns));
  const fitY = Math.max(1, Math.floor(available / GLYPH_HEIGHT));
  // Glyphs may be up to twice as tall as wide, so three digits stay legible at 16px.
  const scaleY = Math.min(fitY, 2 * fitX);
  const scaleX = Math.min(fitX, scaleY);
  const left = Math.floor((size - columns * scaleX) / 2);
  const top = Math.floor((size - GLYPH_HEIGHT * scaleY) / 2);

  for (const [index, char] of [...text].entries()) {
    const glyph = GLYPHS[char] ?? [];
    const glyphLeft = left + index * (GLYPH_WIDTH + 1) * scaleX;
    for (const [row, line] of glyph.entries()) {
      for (const [column, cell] of [...line].entries()) {
        if (cell !== "#") continue;
        for (let dy = 0; dy < scaleY; dy++) {
          for (let dx = 0; dx < scaleX; dx++) {
            const x = glyphLeft + column * scaleX + dx;
            const y = top + row * scaleY + dy;
            if (x < size && y < size) setPixel(pixels, size, x, y, 255, 255, 255);
          }
        }
      }
    }
  }

  return encodePng(pixels, size, size);
}

function insideRoundedSquare(x: number, y: number, size: number, radius: number): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  const cx = Math.min(Math.max(px, radius), size - radius);
  const cy = Math.min(Math.max(py, radius), size - radius);
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
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
