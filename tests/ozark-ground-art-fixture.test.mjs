import test from 'node:test';
import assert from 'node:assert/strict';
import { groundColor, makeGroundChunk } from '../src/art.js';
import { OZARK_PREVIEW_PROFILE, selectFreshGeometryProfile } from '../src/geometry-profile.js';
import { createOzarkPreviewGroundSource, previewGroundColor } from '../src/preview-ground-dispatch.js';
import { createOzarkPreviewPixelAdapter } from '../scripts/ozark-preview-pixels.mjs';
import { generateOzarkPreview } from '../scripts/ozark-preview-model.mjs';

const adapter = createOzarkPreviewPixelAdapter(OZARK_PREVIEW_PROFILE);
const source = createOzarkPreviewGroundSource(
  selectFreshGeometryProfile(OZARK_PREVIEW_PROFILE), adapter,
);

test('production ground colors follow the approved sites and drawn water footprints', () => {
  const descriptor = generateOzarkPreview(74193);
  const found = new Set();
  for (const cell of descriptor.cells) {
    const p = adapter.relativeToPixel(cell.x, cell.y);
    const sample = source.sample(p.x, p.y);
    if (sample.paint !== cell.habitat || found.has(cell.habitat)) continue;
    found.add(cell.habitat);
    assert.deepEqual(groundColor(p.x, p.y, false, 0, source),
      previewGroundColor(cell.habitat));
  }
  for (const habitat of ['oak-pine-woodland', 'shaded-cove', 'open-clearing',
    'dry-rocky-glade', 'wet-terrace', 'spring-seep', 'sinkhole-basin']) {
    assert.ok(found.has(habitat), `fixture must show ${habitat}`);
  }
  const riverCell = descriptor.cells[descriptor.mainChannel[3]];
  const river = adapter.relativeToPixel(riverCell.x, riverCell.y);
  assert.equal(source.sample(river.x, river.y).paint, 'surface-water');
  assert.deepEqual(groundColor(river.x, river.y, false, 0, source),
    previewGroundColor('surface-water'));
  const sinkCell = descriptor.cells[descriptor.sinkhole.cell];
  const sink = adapter.relativeToPixel(sinkCell.x, sinkCell.y);
  assert.equal(source.sample(sink.x, sink.y).paint, 'internal-pond');
  assert.deepEqual(groundColor(sink.x, sink.y, false, 0, source),
    previewGroundColor('internal-pond'));
});

test('fixture chunk paints only sampled ground and refuses out-of-bounds tiles', () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: () => {
    const out = { width: 0, height: 0 };
    out.getContext = () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData(image) { out.pixels = image.data; },
    });
    return out;
  } };
  try {
    const chunk = makeGroundChunk(0, 0, 64, 0, source);
    assert.equal(chunk.width, 32);
    assert.equal(chunk.height, 32);
    assert.equal(chunk.pixels.length, 32 * 32 * 4);
    assert.deepEqual([...chunk.pixels.slice(0, 4)],
      [...groundColor(2, 2, false, 0, source), 255]);
    assert.throws(() => makeGroundChunk(-300, 0, 64, 0, source), /outside/i);
  } finally {
    if (prior === undefined) delete globalThis.document;
    else globalThis.document = prior;
  }
});

test('ordinary ground drawing still uses the original geometry', () => {
  for (const [x, y, expected] of [
    [480, 160, [99, 163, 107]],
    [-3280, -22480, [52, 133, 165]],
    [-11840, 6080, [72, 121, 64]],
  ]) {
    assert.deepEqual(groundColor(x, y), expected);
  }
  assert.notDeepEqual(groundColor(0, 0, false, 0, source), groundColor(0, 0));
});
