import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOzarkPreview } from '../scripts/ozark-preview-model.mjs';
import { createOzarkPreviewSampler } from '../scripts/ozark-preview-geometry.mjs';

const descriptor = generateOzarkPreview(74193);
const fields = ['elevation', 'moisture', 'canopy', 'light'];
const publicKeys = ['canopy', 'crestRise', 'drainage', 'elevation', 'habitat', 'light', 'moisture',
  'nearestChannel', 'sinkholePondDistance', 'substrate', 'surfaceWaterDistance',
  'terminalCell', 'watershedDistance'];

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`);
}

function center(descriptor, index) {
  const cell = descriptor.cells[index];
  return [cell.x, cell.y];
}

function blend(a, b, c, d, tx, ty) {
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) +
    c * (1 - tx) * ty + d * tx * ty;
}

function watershedEdges(preview) {
  const edges = [];
  for (let y = 0; y < preview.height; y += 1) {
    for (let x = 0; x < preview.width; x += 1) {
      const first = preview.cells[y * preview.width + x];
      if (x + 1 < preview.width) {
        const second = preview.cells[y * preview.width + x + 1];
        if (first.drainage !== second.drainage) {
          edges.push({ first, second, midpoint: [x + .5, y],
            endpoints: [[x + .5, Math.max(0, y - .5)],
              [x + .5, Math.min(preview.height - 1, y + .5)]],
            offset: [1, 0] });
        }
      }
      if (y + 1 < preview.height) {
        const second = preview.cells[(y + 1) * preview.width + x];
        if (first.drainage !== second.drainage) {
          edges.push({ first, second, midpoint: [x, y + .5],
            endpoints: [[Math.max(0, x - .5), y + .5],
              [Math.min(preview.width - 1, x + .5), y + .5]],
            offset: [0, 1] });
        }
      }
    }
  }
  return edges;
}

test('every lattice center returns its exact site values, labels, and separate terminal', () => {
  const sampler = createOzarkPreviewSampler(descriptor);
  for (let i = 0; i < descriptor.cells.length; i++) {
    const cell = descriptor.cells[i];
    const site = sampler.sample(cell.x, cell.y);
    assert.equal(site.elevation, cell.height, `elevation at ${i}`);
    assert.equal(site.crestRise, 0, `crest at ${i}`);
    for (const key of fields.slice(1)) assert.equal(site[key], cell[key], `${key} at ${i}`);
    assert.equal(site.habitat, cell.habitat, `habitat at ${i}`);
    assert.equal(site.substrate, cell.substrate, `substrate at ${i}`);
    assert.equal(site.drainage, cell.drainage, `drainage at ${i}`);
    assert.equal(site.terminalCell,
      cell.drainage === 'internal' ? descriptor.sinkhole.cell : descriptor.outlet.cell,
      `terminal at ${i}`);
  }
});

test('scalar base fields are bilinear and actual elevation remains continuous', () => {
  const sampler = createOzarkPreviewSampler(descriptor);
  for (const [x, y] of [[12.25, 20.6], [50.4, 30.35], [79.75, 52.1]]) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const at = (dx, dy) => descriptor.cells[(y0 + dy) * descriptor.width + x0 + dx];
    const four = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
    const site = sampler.sample(x, y);
    for (const key of fields) {
      const sourceKey = key === 'elevation' ? 'height' : key;
      const value = key === 'elevation' ? site.elevation - site.crestRise : site[key];
      near(value, blend(...four.map(row => row[sourceKey]), tx, ty));
    }
  }
  const seamX = 35, seamY = 25.37, epsilon = 1e-7;
  const left = sampler.sample(seamX - epsilon, seamY);
  const right = sampler.sample(seamX + epsilon, seamY);
  for (const key of fields) near(left[key], right[key], 1e-4);
  const top = sampler.sample(35.28, 25 - epsilon);
  const bottom = sampler.sample(35.28, 25 + epsilon);
  for (const key of fields) near(top[key], bottom[key], 1e-4);
});

test('categorical ties choose the lower cell index without blending labels', () => {
  const sampler = createOzarkPreviewSampler(descriptor);
  let pair;
  for (let i = 0; i < descriptor.cells.length - 1; i++) {
    const a = descriptor.cells[i], b = descriptor.cells[i + 1];
    if (a.y === b.y && (a.habitat !== b.habitat || a.substrate !== b.substrate)) {
      pair = [a, b];
      break;
    }
  }
  assert.ok(pair, 'need adjacent distinct site labels to test tie behavior');
  const [left] = pair;
  const halfway = sampler.sample(left.x + .5, left.y);
  assert.equal(halfway.habitat, left.habitat);
  assert.equal(halfway.substrate, left.substrate);
});

test('only the explicit watershed midline is a divide; off-line points use nearest basin', () => {
  assert.ok(descriptor.sinkhole);
  const sampler = createOzarkPreviewSampler(descriptor);
  const edges = watershedEdges(descriptor);
  assert.equal(edges.length, 31, 'the approved layout has 31 opposite-basin edges');
  const epsilon = 1e-6;
  for (const { first, second, midpoint: [x, y], endpoints, offset: [dx, dy] } of edges) {
    const divide = sampler.sample(x, y);
    assert.equal(divide.drainage, 'divide', `midpoint ${x},${y}`);
    assert.equal(divide.terminalCell, null);
    near(divide.watershedDistance, 0);
    assert.ok(divide.crestRise >= 0);
    assert.ok(divide.elevation >= Math.max(first.height, second.height) + 1 - 1e-9,
      `crest must exceed both source heights at ${x},${y}`);
    for (const fraction of [0, .25, .75, 1]) {
      const lineX = endpoints[0][0] * (1 - fraction) + endpoints[1][0] * fraction;
      const lineY = endpoints[0][1] * (1 - fraction) + endpoints[1][1] * fraction;
      const onLine = sampler.sample(lineX, lineY);
      assert.equal(onLine.drainage, 'divide');
      near(onLine.watershedDistance, 0);
      assert.ok(onLine.elevation >= Math.max(first.height, second.height) + 1 - 1e-9,
        `crest target at ${lineX},${lineY}`);
    }
    const nearFirst = sampler.sample(x - dx * epsilon, y - dy * epsilon);
    const nearSecond = sampler.sample(x + dx * epsilon, y + dy * epsilon);
    assert.equal(nearFirst.drainage, first.drainage);
    assert.equal(nearSecond.drainage, second.drainage);
    assert.equal(nearFirst.terminalCell,
      first.drainage === 'internal' ? descriptor.sinkhole.cell : descriptor.outlet.cell);
    assert.equal(nearSecond.terminalCell,
      second.drainage === 'internal' ? descriptor.sinkhole.cell : descriptor.outlet.cell);
    near(nearFirst.watershedDistance, epsilon, 1e-9);
    near(nearSecond.watershedDistance, epsilon, 1e-9);
    near(nearFirst.elevation, divide.elevation, 1e-3);
    near(nearSecond.elevation, divide.elevation, 1e-3);
  }
  const surface = sampler.sample(...center(descriptor, descriptor.outlet.cell));
  const internal = sampler.sample(...center(descriptor, descriptor.sinkhole.cell));
  assert.equal(surface.drainage, 'surface');
  assert.equal(surface.terminalCell, descriptor.outlet.cell);
  assert.equal(internal.drainage, 'internal');
  assert.equal(internal.terminalCell, descriptor.sinkhole.cell);
  assert.ok(internal.sinkholePondDistance < 0);
  assert.ok(internal.surfaceWaterDistance > 0,
    'the isolated sinkhole pond is not part of the surface river');
  near(internal.sinkholePondDistance, -Math.sqrt(3));
});

test('the compact ridge joins continuously at watershed vertices and stays off center sites', () => {
  const sampler = createOzarkPreviewSampler(descriptor);
  const vertices = new Map();
  for (const edge of watershedEdges(descriptor)) {
    for (const [x, y] of edge.endpoints) {
      const key = `${x},${y}`;
      vertices.set(key, (vertices.get(key) ?? 0) + 1);
    }
  }
  const shared = [...vertices].filter(([, count]) => count > 1);
  assert.ok(shared.length > 0);
  const epsilon = 1e-7;
  for (const [key] of shared) {
    const [x, y] = key.split(',').map(Number);
    const atVertex = sampler.sample(x, y);
    near(atVertex.watershedDistance, 0);
    assert.equal(atVertex.drainage, 'divide');
    for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const around = sampler.sample(x + dx * epsilon, y + dy * epsilon);
      near(around.elevation, atVertex.elevation, 1e-3);
      assert.ok(around.crestRise >= 0);
    }
  }
});

test('a seed without a sinkhole has no internal pond or artificial divide', () => {
  const bare = generateOzarkPreview(5);
  assert.equal(bare.sinkhole, null);
  const sampler = createOzarkPreviewSampler(bare);
  for (const [x, y] of [[0, 0], [13.5, 62.75], [50.25, 35.5], [bare.width - 1, bare.height - 1]]) {
    const site = sampler.sample(x, y);
    assert.equal(site.drainage, 'surface');
    assert.equal(site.terminalCell, bare.outlet.cell);
    assert.equal(site.sinkholePondDistance, null);
    assert.equal(site.watershedDistance, null);
    assert.equal(site.crestRise, 0);
  }
});

test('signed distances track the authored river, confluences, spring pool, and separate sinkhole pond', () => {
  const sampler = createOzarkPreviewSampler(descriptor);
  const main = descriptor.mainChannel[3];
  const mainSite = sampler.sample(...center(descriptor, main));
  near(mainSite.surfaceWaterDistance, -.5);
  assert.deepEqual(mainSite.nearestChannel, { kind: 'main', id: 'main' });
  for (const branch of descriptor.tributaries) {
    const head = sampler.sample(...center(descriptor, branch.cells[0]));
    near(head.surfaceWaterDistance, -.35);
    assert.deepEqual(head.nearestChannel, { kind: 'tributary', id: branch.id });
    const [ax, ay] = center(descriptor, branch.cells[0]);
    const [bx, by] = center(descriptor, branch.cells[1]);
    near(sampler.sample((ax + bx) / 2, (ay + by) / 2).surfaceWaterDistance, -.35);
    const meeting = sampler.sample(...center(descriptor, branch.cells.at(-1)));
    assert.ok(meeting.surfaceWaterDistance <= -.5);
    assert.deepEqual(meeting.nearestChannel, { kind: 'main', id: 'main' });
  }
  const outflow = sampler.sample(...center(descriptor, descriptor.spring.branchCells[2]));
  near(outflow.surfaceWaterDistance, -.28);
  assert.deepEqual(outflow.nearestChannel,
    { kind: 'spring-outflow', id: 'spring-outflow' });
  const pool = sampler.sample(...center(descriptor, descriptor.spring.poolCell));
  near(pool.surfaceWaterDistance, -.75);
  assert.deepEqual(pool.nearestChannel, { kind: 'spring-pool', id: 'spring-pool' });
  const sink = sampler.sample(...center(descriptor, descriptor.sinkhole.cell));
  near(sink.sinkholePondDistance, -Math.sqrt(3));
  const away = sampler.sample(0, 0);
  assert.ok(away.surfaceWaterDistance > 0);
  assert.ok(away.sinkholePondDistance > 0);
});

test('invalid descriptors and nonfinite or out-of-bounds queries are rejected', () => {
  const malformed = change => {
    const copy = structuredClone(descriptor);
    change(copy);
    assert.throws(() => createOzarkPreviewSampler(copy));
  };
  malformed(copy => { copy.previewVersion = 2; });
  malformed(copy => { copy.width = 129; });
  malformed(copy => { copy.cells.pop(); });
  malformed(copy => { copy.cells[0].height = Infinity; });
  malformed(copy => { copy.cells[0].flowTo = copy.cells.length + 1; });
  malformed(copy => { copy.cells[0].flowTo = copy.outlet.cell; });
  malformed(copy => { copy.outlet.cell = -1; });
  malformed(copy => { copy.mainChannel[0] = -1; });
  malformed(copy => { copy.spring.poolCell = -1; });
  malformed(copy => { copy.sinkhole.cell = -1; });
  const sampler = createOzarkPreviewSampler(descriptor);
  for (const point of [[NaN, 0], [Infinity, 0], [0, -Infinity], [-.001, 0],
    [descriptor.width - .999, 0], [0, descriptor.height], [descriptor.width - 1, descriptor.height + .01]]) {
    assert.throws(() => sampler.sample(...point), `accepted invalid query ${point}`);
  }
  assert.doesNotThrow(() => sampler.sample(descriptor.width - 1, descriptor.height - 1));
});

test('sampling is deterministic, does not mutate source data, and exposes no resource or travel oracle', () => {
  const copy = generateOzarkPreview(74193);
  const snapshot = JSON.stringify(copy);
  const sampler = createOzarkPreviewSampler(copy);
  for (const [x, y] of [[0, 0], [32.37, 20.91], [65.5, 64.25], [95, 71]]) {
    const a = sampler.sample(x, y);
    const b = sampler.sample(x, y);
    assert.deepEqual(a, b);
    assert.notEqual(a, b, 'sample must return a fresh record');
    assert.deepEqual(Object.keys(a).sort(), publicKeys);
    for (const key of ['elevation', 'moisture', 'canopy', 'light', 'surfaceWaterDistance']) {
      assert.ok(Number.isFinite(a[key]), `${key} is not finite at ${x},${y}`);
    }
    assert.ok(a.nearestChannel && typeof a.nearestChannel.id === 'string');
  }
  assert.equal(JSON.stringify(copy), snapshot, 'constructor or queries changed the descriptor');
  const first = sampler.sample(32.37, 20.91);
  try { first.elevation = -9999; } catch (error) { assert.ok(error instanceof TypeError); }
  try { first.nearestChannel.id = 'forged'; } catch (error) { assert.ok(error instanceof TypeError); }
  const second = sampler.sample(32.37, 20.91);
  assert.notEqual(second.elevation, -9999);
  assert.notEqual(second.nearestChannel.id, 'forged');
  assert.equal(JSON.stringify(copy), snapshot, 'mutating a result changed the descriptor');
});
