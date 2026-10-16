import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotRenderer } from '../src/ozark-pilot-renderer.js';
import { previewGroundColor } from '../src/preview-ground-dispatch.js';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';

class Canvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.calls = [];
    const calls = this.calls;
    this.context = {
      fillStyle: '',
      save() {}, restore() {}, scale() {}, setTransform() {}, translate() {},
      fillRect(...args) { calls.push(['fillRect', this.fillStyle, ...args]); },
      drawImage() {},
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: image => { this.pixels = image.data; },
    };
  }
  getContext() { return this.context; }
}

function withCanvas(fn) {
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  globalThis.document = { createElement: () => new Canvas() };
  globalThis.window = { innerWidth: 96, innerHeight: 72, devicePixelRatio: 1 };
  try { return fn(); } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
}

test('real shallow reach paints a downstream arrow while blocked core stays dark', () => {
  const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);
  const shallow = { x: -1198, y: 238 };
  const deep = { x: -1198, y: 202 };
  assert.equal(geometry.sample(shallow.x, shallow.y).waterBand, 'shallow-water');
  assert.equal(geometry.classify(shallow.x, shallow.y, 10).reason, 'shallow-water');
  const direction = geometry.sample(shallow.x, shallow.y).currentDirection;
  assert.ok(Math.abs(direction.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(direction.y + Math.SQRT1_2) < 1e-12);
  assert.equal(geometry.sample(deep.x, deep.y).waterBand, 'deep-water');
  assert.equal(geometry.classify(deep.x, deep.y, 10).reason, 'surface-water');
  withCanvas(() => {
    const renderer = new PilotRenderer(new Canvas(), geometry);
    const chunk = renderer.chunk(-5, 0);
    const pixel = point => {
      const artX = (point.x + 1280) / 2;
      const artY = point.y / 2;
      const offset = (artY * 128 + artX) * 4;
      return [...chunk.pixels.slice(offset, offset + 4)];
    };
    assert.deepEqual(pixel(shallow), [187, 229, 211, 255],
      'arrow shaft follows the approved northeast downstream tangent');
    assert.deepEqual(pixel(deep),
      [...previewGroundColor(geometry.sample(deep.x, deep.y).paint), 255]);
    assert.notDeepEqual(pixel(shallow), pixel(deep));
    // Wading did not recolor a dry site or the existing grade barrier.
    const dry = { x: -678, y: 382 };
    assert.deepEqual(renderer.terrainColor(dry.x, dry.y),
      previewGroundColor(geometry.sample(dry.x, dry.y).paint));
    assert.deepEqual(renderer.terrainColor(-1450, -850), [200, 136, 99]);
  });
});

test('radius contact at a dry painted center still shows a foot splash', () => {
  const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);
  const point = { x: -1200, y: 290 };
  assert.notEqual(geometry.sample(point.x, point.y).paint, 'surface-water');
  assert.equal(geometry.classify(point.x, point.y, 10).reason, 'shallow-water');
  withCanvas(() => {
    const renderer = new PilotRenderer(new Canvas(), geometry);
    renderer.draw({ player: point, wetness: 0 });
    const splashes = renderer.pixels.calls.filter(call =>
      call[0] === 'fillRect' && call[1] === '#bde6d3');
    assert.equal(splashes.length, 2);
    renderer.pixels.calls.length = 0;
    renderer.draw({ player: { x: -680, y: 380 }, wetness: 1 });
    assert.equal(renderer.pixels.calls.filter(call =>
      call[0] === 'fillRect' && call[1] === '#bde6d3').length, 0,
    'wet boots on dry ground should not look like a water splash');
  });
});
