import test from 'node:test';
import assert from 'node:assert/strict';
import { OzarkWorldRenderer } from '../src/ozark-world-renderer.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { previewGroundColor } from '../src/preview-ground-dispatch.js';

class Canvas {
  constructor(width = 96, height = 72) {
    this.width = width;
    this.height = height;
    this.calls = [];
    const calls = this.calls;
    this.context = {
      fillStyle: '',
      save() {}, restore() {}, scale() {}, setTransform() {}, beginPath() {},
      rect() {}, clip() {},
      translate(x, y) { calls.push(['translate', x, y]); },
      fillRect(...args) { calls.push(['fillRect', this.fillStyle, ...args]); },
      strokeRect(...args) { calls.push(['strokeRect', ...args]); },
      fillText(...args) { calls.push(['fillText', ...args]); },
      measureText(text) { return { width: text.length * 7 }; },
      drawImage(...args) { calls.push(['drawImage', ...args]); },
      createImageData(width, height) {
        return { data: new Uint8ClampedArray(width * height * 4) };
      },
      putImageData: image => { this.pixels = image.data; },
    };
  }
  getContext() { return this.context; }
}

function withCanvases(fn) {
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

function fixture() {
  const sampled = [];
  const classified = [];
  const geometry = Object.freeze({
    profile: Object.freeze({ identity: 'test-new-world' }),
    bounds: Object.freeze({ minX: -128, maxX: 128, minY: -128, maxY: 128 }),
    spawn: Object.freeze({ x: -80, y: 0 }),
    sample(x, y) {
      assert.ok(x >= -128 && x <= 128 && y >= -128 && y <= 128,
        'renderer must not sample outside the playable rectangle');
      sampled.push([x, y]);
      if (x >= 0 && x < 40) return { paint: 'surface-water',
        waterBand: 'shallow-water', currentDirection: { x: 1, y: 0 } };
      if (x >= 40 && x < 80) return { paint: 'surface-water',
        waterBand: 'deep-water', currentDirection: { x: 1, y: 0 } };
      return { paint: 'open-clearing', waterBand: null, currentDirection: null };
    },
    classify(x, y, radius, mode) {
      classified.push([x, y, radius, mode]);
      if (x >= 110) return { walkable: false, reason: 'excessive-grade' };
      if (x >= 80) return mode === 'climb' ?
        { walkable: true, reason: 'steep-ground' } :
        { walkable: false, reason: 'excessive-grade' };
      return { walkable: true, reason: x >= 0 && x < 40 ?
        'shallow-water' : 'dry-ground' };
    },
  });
  return { geometry, sampled, classified };
}

function state() {
  return {
    player: { x: -80, y: 0 },
    waypoint: { x: -72, y: 4 },
    agents: [
      { id: 'aster', name: 'Aster', scene: 'valley', position: { x: -70, y: 1 } },
      { id: 'mira', name: 'Mira', scene: 'valley', position: { x: -90, y: -1 } },
    ],
    environment: { elapsed: 12, ecology: {
      plants: [{ id: 'object:1', kind: 'grass', scene: 'valley',
        position: { x: -84, y: 0 }, biomassGrams: 10, capacity: 20,
        moisture: .5, stage: 'green' }],
      animals: [], materials: [],
    } },
  };
}

test('new-world terrain uses physical water and climb classes, never samples beyond bounds', () => {
  withCanvases(() => {
    const { geometry, sampled, classified } = fixture();
    const renderer = new OzarkWorldRenderer(new Canvas(), geometry);
    assert.deepEqual(renderer.terrainColor(16, 16), [187, 229, 211]);
    assert.deepEqual(renderer.terrainColor(50, 0),
      previewGroundColor('surface-water'), 'deep water keeps its darker palette');
    assert.notDeepEqual(renderer.terrainColor(90, 0),
      previewGroundColor('open-clearing'), 'climbable grade is marked');
    assert.notDeepEqual(renderer.terrainColor(120, 0),
      renderer.terrainColor(90, 0), 'unclimbable grade is distinct');
    assert.deepEqual(renderer.terrainColor(129, 0), [28, 43, 43]);
    assert.ok(classified.some(([, , , mode]) => mode === 'climb'));
    const before = sampled.length;
    renderer.chunk(-1, -1);
    renderer.chunk(-1, -1);
    assert.equal(renderer.chunks.size, 1);
    assert.equal(sampled.length - before, 256,
      'cached chunk samples each in-bounds 8-unit cell once');
  });
});

test('new-world view renders both agents and nearby ecology without changing state', () => {
  withCanvases(() => {
    const { geometry } = fixture();
    const renderer = new OzarkWorldRenderer(new Canvas(), geometry);
    const world = state();
    const before = JSON.stringify(world);
    renderer.draw(world);
    assert.equal(renderer.frame, 1);
    for (const x of [-80, -70, -90, -84]) {
      assert.ok(renderer.pixels.calls.some(call =>
        call[0] === 'translate' && call[1] === x),
      `expected actor or ecology sprite at x=${x}`);
    }
    assert.equal(JSON.stringify(world), before, 'rendering is read-only');
    renderer.followNpc = true;
    world.selectedAgentId = 'mira';
    renderer.draw(world);
    assert.deepEqual(renderer.camera, world.agents[1].position);
    assert.deepEqual(renderer.viewSubject(world), world.agents[1].position);
    assert.equal(renderer.viewScene(world), 'valley');
    assert.equal(renderer.agents(world).length, 2);
  });
});

test('overview is cached; zoomed atlas and mini map show all three actors', () => {
  withCanvases(() => {
    const { geometry, sampled } = fixture();
    const renderer = new OzarkWorldRenderer(new Canvas(), geometry);
    const world = state();
    const atlas = new Canvas(480, 360);
    renderer.drawAtlas(atlas, world);
    const firstSamples = sampled.length;
    assert.ok(atlas.calls.some(call =>
      call[0] === 'fillRect' && call[1] === '#efd184'),
    'user waypoint should be visible on the new atlas');
    assert.equal(renderer.atlasMarkers.length, 3);
    assert.deepEqual(renderer.atlasMarkers.map(marker => marker.id),
      ['you', 'aster', 'mira']);
    renderer.drawAtlas(atlas, world);
    assert.equal(sampled.length, firstSamples, 'overview does not resample on redraw');
    assert.equal(renderer.atlasMarkerAt(renderer.atlasMarkers[2].x,
      renderer.atlasMarkers[2].y), 'mira');
    assert.equal(renderer.atlasCenter('mira', world), true);
    assert.ok(renderer.atlasStatus().zoom >= 8);
    renderer.drawAtlas(atlas, world);
    assert.ok(sampled.length > firstSamples, 'zoomed view samples visible detail');
    assert.ok(renderer.atlasPoint(240, 180));
    renderer.atlasPan(20, 0);
    renderer.atlasFit();
    assert.equal(renderer.atlasStatus().zoom, 1);
    const mini = new Canvas(120, 90);
    renderer.drawMini(mini, world);
    const colors = mini.calls.filter(call => call[0] === 'fillRect')
      .map(call => call[1]);
    for (const color of ['#f6d68b', '#c2df88', '#d4b4e5']) {
      assert.ok(colors.includes(color), `mini map should mark ${color}`);
    }
  });
});

test('production geometry drives matching water, pond, and climbing cues', () => {
  withCanvases(() => {
    const geometry = createOzarkWorldGeometry();
    const renderer = new OzarkWorldRenderer(new Canvas(), geometry);
    const shallow = geometry.sample(-1200, 240);
    assert.equal(shallow.waterBand, 'shallow-water');
    assert.notDeepEqual(renderer.terrainColor(-1200, 240),
      previewGroundColor(shallow.paint));
    const deep = geometry.sample(-1200, 220);
    assert.equal(deep.waterBand, 'deep-water');
    assert.deepEqual(renderer.terrainColor(-1200, 220),
      previewGroundColor(deep.paint));
    assert.equal(geometry.classify(-11800, 11800).reason, 'internal-pond');
    assert.deepEqual(renderer.terrainColor(-11800, 11800),
      previewGroundColor('internal-pond'));
    const climbable = renderer.terrainColor(-12000, 9800);
    const cliff = renderer.terrainColor(-12000, 9900);
    assert.notDeepEqual(climbable, cliff);
    assert.notDeepEqual(climbable,
      previewGroundColor(geometry.sample(-12000, 9800).paint));
    const nearSpawn = [];
    for (let y = 300; y <= 460; y += 8) {
      for (let x = -776; x <= -584; x += 8) {
        if (geometry.sample(x, y).paint === 'wet-terrace' &&
            geometry.classify(x, y).reason === 'dry-ground') {
          nearSpawn.push(renderer.terrainColor(x, y));
        }
      }
    }
    const shades = nearSpawn.map(color => color[1]);
    assert.ok(new Set(nearSpawn.map(color => color.join(','))).size > 25,
      'the immediate native spawn view should have varied substrate colors');
    assert.ok(Math.max(...shades) - Math.min(...shades) >= 12,
      'nearby wet terrace variation should be visible at desktop scale');
    assert.deepEqual(renderer.terrainColor(-680, 380),
      renderer.terrainColor(-680, 380), 'substrate texture is deterministic');
    const overview = renderer.atlasBaseImage();
    assert.equal(overview.width, 192);
    assert.equal(overview.height, 144);
    assert.equal(renderer.atlasBaseImage(), overview,
      'whole-map image is sampled once and reused');
  });
});
