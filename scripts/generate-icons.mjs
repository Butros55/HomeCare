/**
 * Erzeugt PWA-Platzhalter-Icons (PNG) ohne externe Abhängigkeiten:
 * abgerundete violette Kachel mit stilisiertem „H“ aus Rechtecken.
 * Aufruf: npm run icons  (Ausgabe: public/icons/icon-{192,512}.png + maskable)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BRAND = [108, 92, 231]; // #6c5ce7
const BRAND_DARK = [90, 75, 210];
const WHITE = [255, 255, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, pixelFn) {
  // Rohdaten: je Zeile 1 Filterbyte (0) + RGBA.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelFn(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Icon-Pixel: abgerundete Kachel + „H“-Glyphe; maskable = volle Fläche. */
function iconPixel(size, maskable) {
  const radius = maskable ? 0 : size * 0.22;
  const pad = maskable ? size * 0.1 : 0; // Safe-Zone für maskable
  const barW = size * 0.14;
  const hLeft = size * 0.32 - barW / 2;
  const hRight = size * 0.68 - barW / 2;
  const hTop = size * 0.28;
  const hBottom = size * 0.72;
  const crossTop = size * 0.5 - barW / 2;

  return (x, y) => {
    // Abgerundete Ecken (nur Nicht-maskable).
    if (!maskable) {
      const cx = x < radius ? radius : x > size - radius ? size - radius : x;
      const cy = y < radius ? radius : y > size - radius ? size - radius : y;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
    }
    // Leichter vertikaler Verlauf.
    const t = y / size;
    const bg = [
      Math.round(BRAND[0] + (BRAND_DARK[0] - BRAND[0]) * t),
      Math.round(BRAND[1] + (BRAND_DARK[1] - BRAND[1]) * t),
      Math.round(BRAND[2] + (BRAND_DARK[2] - BRAND[2]) * t),
    ];
    // „H“
    const inH =
      y >= hTop + pad * 0 && y <= hBottom &&
      ((x >= hLeft && x <= hLeft + barW) ||
        (x >= hRight && x <= hRight + barW) ||
        (y >= crossTop && y <= crossTop + barW && x >= hLeft && x <= hRight + barW));
    if (inH && y >= hTop && y <= hBottom) return [...WHITE, 255];
    return [...bg, 255];
  };
}

const outDir = join(process.cwd(), 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size, iconPixel(size, false)));
  writeFileSync(join(outDir, `icon-maskable-${size}.png`), encodePng(size, iconPixel(size, true)));
}
console.log('Icons erzeugt: public/icons/icon-{192,512}.png (+ maskable)');
