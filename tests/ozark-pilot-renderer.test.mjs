import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotRenderer } from '../src/ozark-pilot-renderer.js';
import { groundColor } from '../src/art.js';
import { previewGroundColor } from '../src/preview-ground-dispatch.js';
import { OZARK_WALKING_PILOT_PROFILE } from '../src/geometry-profile.js';
import { createOzarkWalkingPilot } from '../src/ozark-pilot-geometry.js';

class Canvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.calls = [];
    this.context = {
      calls: this.calls,
      save() {}, restore() {}, scale() {}, setTransform() {}, fillRect() {},
      translate: (x, y) => this.calls.push(['translate', x, y]),
      drawImage: (...args) => this.calls.push(['drawImage', ...args]),
      createImageData: (width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: image => { this.pixels = image.data; },
    };
  }
  getContext() { return this.context; }
}

test('pilot renderer paints only its supplied source and draws the actor at its position', () => {
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  const canvases = [];
  globalThis.document = { createElement: () => {
    const canvas = new Canvas();
    canvases.push(canvas);
    return canvas;
  } };
  globalThis.window = { innerWidth: 96, innerHeight: 72, devicePixelRatio: 1 };
  try {
    const queried = [];
    const geometry = Object.freeze({
      profile: Object.freeze({ identity: 'test-pilot-identity' }),
      spawn: Object.freeze({ x: 12, y: -6 }),
      bounds: Object.freeze({ minX: -32, maxX: 32, minY: -32, maxY: 32 }),
      sample(x, y) {
        queried.push({ x, y });
        if (Math.abs(x) > 32 || Math.abs(y) > 32) {
          throw new Error('Renderer queried beyond the approved pilot rectangle');
        }
        return { paint: x < 0 ? 'open-clearing' : 'surface-water' };
      },
      classify(x) {
        return x < 0 ? { walkable: true, reason: 'dry-ground' } :
          { walkable: false, reason: 'surface-water' };
      },
    });
    const target = new Canvas();
    const renderer = new PilotRenderer(target, geometry);
    renderer.draw({ player: { x: 12, y: -6 } });
    assert.equal(renderer.frame, 1);
    assert.ok(queried.length > 0);
    assert.ok(queried.every(({ x, y }) => Math.abs(x) <= 32 && Math.abs(y) <= 32));
    assert.deepEqual([...renderer.chunk(0, 0).pixels.slice(0, 4)],
      [...previewGroundColor('surface-water'), 255]);
    // The last four-pixel square in the chunk to the west is dry.
    const west = renderer.chunk(-1, 0);
    const westIndex = (127 * 4);
    assert.deepEqual([...west.pixels.slice(westIndex, westIndex + 4)],
      [...previewGroundColor('open-clearing'), 255]);
    assert.ok(renderer.pixelCtx.calls.some(call =>
      call[0] === 'translate' && call[1] === 12 && call[2] === -6),
    'avatar draw should use the supplied player position');
    assert.ok(target.calls.some(call => call[0] === 'drawImage' && call[1] === renderer.pixels));
    assert.ok(canvases.length >= 2, 'offscreen pixels and terrain chunks were created');
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('real dry steep site is visibly blocked by the same pilot grade policy', () => {
  const geometry = createOzarkWalkingPilot(OZARK_WALKING_PILOT_PROFILE);
  const point = { x: -1450, y: -850 };
  const site = geometry.sample(point.x, point.y);
  assert.notEqual(site.paint, 'surface-water');
  assert.notEqual(site.paint, 'internal-pond');
  assert.equal(geometry.classify(point.x, point.y, 10).reason, 'excessive-grade');
  const priorDocument = globalThis.document;
  const priorWindow = globalThis.window;
  globalThis.document = { createElement: () => new Canvas() };
  globalThis.window = { innerWidth: 96, innerHeight: 72, devicePixelRatio: 1 };
  try {
    const renderer = new PilotRenderer(new Canvas(), geometry);
    const cx = Math.floor(point.x / 256), cy = Math.floor(point.y / 256);
    const relativeX = point.x - cx * 256, relativeY = point.y - cy * 256;
    assert.equal(relativeX % 4, 2);
    assert.equal(relativeY % 4, 2);
    const artX = relativeX / 2, artY = relativeY / 2;
    const chunk = renderer.chunk(cx, cy);
    const offset = (artY * 128 + artX) * 4;
    const painted = [...chunk.pixels.slice(offset, offset + 4)];
    assert.deepEqual(painted, [200, 136, 99, 255]);
    assert.notDeepEqual(painted, [...previewGroundColor(site.paint), 255]);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('ordinary art defaults still select the historical terrain', () => {
  assert.deepEqual(groundColor(480, 160), [99, 163, 107]);
  assert.deepEqual(groundColor(-3280, -22480), [52, 133, 165]);
});
