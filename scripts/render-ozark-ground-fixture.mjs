// Render the approved geometry through production groundColor, offline only.
// This terrain-only PNG contains no collision, resources, actors, or playable UI.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { groundColor } from '../src/art.js';
import { OZARK_PREVIEW_PROFILE, selectFreshGeometryProfile } from '../src/geometry-profile.js';
import { createOzarkPreviewGroundSource } from '../src/preview-ground-dispatch.js';
import { createOzarkPreviewPixelAdapter } from './ozark-preview-pixels.mjs';

const width = 768;
const height = 576;
const destination = resolve('test-results/ozark-preview/ozark-ground-fixture-seed74193.png');

const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function chunk(type, data) {
  const label = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let checksum = 0xffffffff;
  for (const byte of Buffer.concat([label, data])) {
    checksum = table[(checksum ^ byte) & 255] ^ (checksum >>> 8);
  }
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, label, data, crc]);
}

const adapter = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);
const source = createOzarkPreviewGroundSource(
  selectFreshGeometryProfile(OZARK_PREVIEW_PROFILE), adapter,
);
const { minX, maxX, minY, maxY } = source.pixelBounds;
const rows = Buffer.alloc(height * (1 + width * 4));
for (let row = 0; row < height; row += 1) {
  const y = minY + row / (height - 1) * (maxY - minY);
  const start = row * (1 + width * 4);
  for (let col = 0; col < width; col += 1) {
    const x = minX + col / (width - 1) * (maxX - minX);
    const rgb = groundColor(x, y, false, 0, source);
    const offset = start + 1 + col * 4;
    rows[offset] = rgb[0];
    rows[offset + 1] = rgb[1];
    rows[offset + 2] = rgb[2];
    rows[offset + 3] = 255;
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('tEXt', Buffer.from('Comment\0Offline terrain-only design fixture; not playable.')),
  chunk('IDAT', deflateSync(rows)),
  chunk('IEND', Buffer.alloc(0)),
]);
await mkdir(resolve('test-results/ozark-preview'), { recursive: true });
await writeFile(destination, png);
console.log(`${destination} ${width}x${height} ${source.profile.identity} png-sha256:${createHash('sha256').update(png).digest('hex')}`);
