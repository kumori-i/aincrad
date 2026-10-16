import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateOzarkPreview } from '../scripts/ozark-preview-model.mjs';
import { renderOzarkPreview } from '../scripts/render-ozark-preview.mjs';

const DESIGN_SEED = 74193;
const CONTRAST_SEED = 92741;
const preview = generateOzarkPreview(DESIGN_SEED);

function validCell(descriptor, index) {
  return Number.isInteger(index) && index >= 0 && index < descriptor.cells.length;
}

function featureIsConnected(descriptor, indices, label) {
  assert.ok(indices.length >= 2, `${label} has too few cells`);
  for (const index of indices) assert.ok(validCell(descriptor, index), `${label} has an invalid cell`);
  for (let i = 1; i < indices.length; i++) {
    const a = descriptor.cells[indices[i - 1]];
    const b = descriptor.cells[indices[i]];
    assert.ok(Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1,
      `${label} jumps between cells ${indices[i - 1]} and ${indices[i]}`);
  }
}

function featureFollowsFlow(descriptor, indices, label) {
  featureIsConnected(descriptor, indices, label);
  for (let i = 1; i < indices.length; i++) {
    assert.equal(descriptor.cells[indices[i - 1]].flowTo, indices[i],
      `${label} must follow real downstream receivers`);
  }
}

function destination(descriptor, start) {
  const visited = new Set();
  let index = start;
  while (true) {
    assert.ok(validCell(descriptor, index), `invalid receiver from ${start}`);
    assert.ok(!visited.has(index), `drainage cycle from ${start} at ${index}`);
    visited.add(index);
    const cell = descriptor.cells[index];
    if (cell.flowTo === null) return index;
    assert.ok(validCell(descriptor, cell.flowTo), `invalid receiver at ${index}`);
    assert.ok(descriptor.cells[cell.flowTo].height < cell.height,
      `non-descending flow from ${index} to ${cell.flowTo}`);
    index = cell.flowTo;
  }
}

function mean(rows, key) {
  assert.ok(rows.length > 0, `no ${key} samples`);
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function habitatComponentSizes(descriptor, habitat) {
  const seen = new Set();
  const sizes = [];
  for (let start = 0; start < descriptor.cells.length; start++) {
    if (descriptor.cells[start].habitat !== habitat || seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % descriptor.width;
      const y = Math.floor(index / descriptor.width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= descriptor.width || ny >= descriptor.height) continue;
        const neighbor = ny * descriptor.width + nx;
        if (!seen.has(neighbor) && descriptor.cells[neighbor].habitat === habitat) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

function shareAlongChannelOffset(descriptor, offset, habitat) {
  const land = [];
  for (const mainIndex of descriptor.mainChannel) {
    const { x, y } = descriptor.cells[mainIndex];
    const sampleY = y + offset;
    if (sampleY < 0 || sampleY >= descriptor.height) continue;
    const sample = descriptor.cells[sampleY * descriptor.width + x];
    if (sample.waterKind || sample.habitat === 'sinkhole-basin') continue;
    land.push(sample);
  }
  assert.ok(land.length >= 40, `too few land sites at offset ${offset}`);
  return land.filter(cell => cell.habitat === habitat).length / land.length;
}

test('same fixed seed yields byte-identical bounded model and preview artwork', () => {
  const again = generateOzarkPreview(DESIGN_SEED);
  assert.equal(preview.previewVersion, 1);
  assert.equal(preview.seed, DESIGN_SEED);
  assert.equal(JSON.stringify(preview), JSON.stringify(again));
  assert.ok(preview.width > 8 && preview.width <= 128);
  assert.ok(preview.height > 8 && preview.height <= 128);
  assert.equal(preview.cells.length, preview.width * preview.height);
  assert.ok(Buffer.byteLength(JSON.stringify(preview)) < 4 * 1024 * 1024,
    'model should remain a bounded offline preview');
  for (let i = 0; i < preview.cells.length; i++) {
    const cell = preview.cells[i];
    assert.equal(cell.x, i % preview.width);
    assert.equal(cell.y, Math.floor(i / preview.width));
    for (const key of ['height', 'canopy', 'moisture', 'light']) {
      assert.ok(Number.isFinite(cell[key]), `nonfinite ${key} at ${i}`);
    }
    assert.ok(typeof cell.habitat === 'string' && cell.habitat.length > 0);
    assert.ok(typeof cell.substrate === 'string' && cell.substrate.length > 0);
  }
  const svg = renderOzarkPreview(preview);
  assert.equal(svg, renderOzarkPreview(again));
  assert.ok(svg.startsWith('<svg') || svg.startsWith('<?xml'));
  assert.ok(Buffer.byteLength(svg) < 4 * 1024 * 1024,
    'SVG should remain a bounded, inspectable artifact');
});

test('contrasting fixed seed changes the geography, not only its label', () => {
  const other = generateOzarkPreview(CONTRAST_SEED);
  assert.equal(other.previewVersion, preview.previewVersion);
  assert.equal(other.width, preview.width);
  assert.equal(other.height, preview.height);
  assert.notDeepEqual(other.mainChannel, preview.mainChannel);
  let changedElevation = 0;
  for (let i = 0; i < preview.cells.length; i++) {
    if (other.cells[i].height !== preview.cells[i].height) changedElevation++;
  }
  assert.ok(changedElevation >= preview.cells.length * .05,
    `only ${changedElevation} elevations changed`);
  assert.notEqual(renderOzarkPreview(other), renderOzarkPreview(preview));
});

test('fixed seeds preserve the earlier preview watershed and elevation while habitats change', () => {
  // These digests capture only the original terrain, receiver, drainage and
  // water graph, plus authored feature paths. Habitat and site scores may vary.
  const baselines = new Map([
    [74193, {
      geometry: 'f330ef035feb7d3659cd3013ceb16dea90d0b3c471e9ed6ec00ab26cf3d8c5e1',
      paths: 'daa0a8aaa62ce12fc84668942d69dbafceed1504694327c5412b63aed6d5dd24',
    }],
    [92741, {
      geometry: 'bcb22b47bd5e3907e7c5a8a74aa8f16827cb404ffa4d40652e7d083f51197d7a',
      paths: '2865b09e681f06d4386563739b382b85ce6c88dbce1b6c7092fa7103ae92a859',
    }],
    [5, {
      geometry: '9277182a4947be67db3d9999bc71e71055dd0dff6f4d76f6eee208dbf28fdee4',
      paths: 'c344477989d2c4d8a44bdec40ee142c87cbfa17d8bd02d91381db5006a2d9151',
    }],
  ]);
  for (const [seed, expected] of baselines) {
    const descriptor = generateOzarkPreview(seed);
    const again = generateOzarkPreview(seed);
    assert.equal(JSON.stringify(descriptor), JSON.stringify(again), `nondeterministic seed ${seed}`);
    const geometry = descriptor.cells.map(cell =>
      [cell.height, cell.flowTo, cell.drainage, cell.waterKind]);
    const paths = {
      main: descriptor.mainChannel,
      tributaries: descriptor.tributaries,
      spring: descriptor.spring,
      sinkhole: descriptor.sinkhole,
      outlet: descriptor.outlet,
    };
    assert.equal(digest(geometry), expected.geometry, `watershed geometry changed at seed ${seed}`);
    assert.equal(digest(paths), expected.paths, `water feature paths changed at seed ${seed}`);
  }
});

test('surface drainage descends to one mapped outlet; only explicit karst cells terminate internally', () => {
  assert.ok(validCell(preview, preview.outlet.cell));
  assert.ok(preview.outlet.name);
  assert.ok(preview.sinkhole && preview.sinkhole.kind === 'internal-drainage');
  assert.ok(validCell(preview, preview.sinkhole.cell));
  assert.notEqual(preview.sinkhole.cell, preview.outlet.cell);
  assert.equal(preview.cells[preview.outlet.cell].drainage, 'surface');
  assert.equal(preview.cells[preview.sinkhole.cell].drainage, 'internal');
  assert.equal(preview.cells[preview.outlet.cell].flowTo, null);
  assert.equal(preview.cells[preview.sinkhole.cell].flowTo, null);
  let internalCount = 0;
  for (let i = 0; i < preview.cells.length; i++) {
    const cell = preview.cells[i];
    assert.ok(cell.drainage === 'surface' || cell.drainage === 'internal');
    if (cell.flowTo === null) {
      assert.ok(i === preview.outlet.cell || i === preview.sinkhole.cell,
        `unmarked terminal at ${i}`);
    }
    const end = destination(preview, i);
    if (cell.drainage === 'surface') {
      assert.equal(end, preview.outlet.cell, `surface cell ${i} missed outlet`);
    } else {
      internalCount++;
      assert.equal(end, preview.sinkhole.cell, `internal cell ${i} missed sinkhole`);
    }
  }
  assert.ok(internalCount > 1, 'sinkhole should be a basin, not a label on one cell');
});

test('a fixed seed without a sinkhole has no phantom internal basin or drawn pond', () => {
  const without = generateOzarkPreview(5);
  assert.equal(without.sinkhole, null);
  assert.ok(without.cells.every(cell => cell.drainage === 'surface'));
  for (let i = 0; i < without.cells.length; i++) {
    assert.equal(destination(without, i), without.outlet.cell);
  }
  const svg = renderOzarkPreview(without);
  assert.doesNotMatch(svg, /data-feature="internal-sinkhole"/);
  assert.doesNotMatch(svg, /the internal sinkhole has no surface outlet/i,
    'accessible description must not claim an absent sinkhole');
});

test('spring outflow and tributaries are actual connected parts of the drainage network', () => {
  assert.ok(validCell(preview, preview.spring.poolCell));
  assert.equal(preview.cells[preview.spring.poolCell].drainage, 'surface');
  assert.equal(destination(preview, preview.spring.poolCell), preview.outlet.cell);
  featureFollowsFlow(preview, preview.mainChannel, 'main channel');
  featureFollowsFlow(preview, preview.spring.branchCells, 'spring branch');
  assert.equal(preview.mainChannel.at(-1), preview.outlet.cell);
  assert.equal(preview.spring.branchCells[0], preview.spring.poolCell);
  assert.ok(preview.mainChannel.includes(preview.spring.branchCells.at(-1)),
    'spring branch should actually meet the main channel');
  assert.ok(preview.tributaries.length >= 1);
  for (const branch of preview.tributaries) {
    featureFollowsFlow(preview, branch.cells, branch.id);
    assert.ok(preview.mainChannel.includes(branch.cells.at(-1)),
      `${branch.id} should actually meet the main channel`);
    assert.equal(destination(preview, branch.cells[0]), preview.outlet.cell);
  }
});

test('site descriptions visibly distinguish wet terrace, shaded cove, and dry rocky glade', () => {
  for (const seed of [DESIGN_SEED, CONTRAST_SEED, 5]) {
    const descriptor = generateOzarkPreview(seed);
    const byHabitat = new Map();
    for (const cell of descriptor.cells) {
      const rows = byHabitat.get(cell.habitat) ?? [];
      rows.push(cell);
      byHabitat.set(cell.habitat, rows);
    }
    const wet = byHabitat.get('wet-terrace') ?? [];
    const cove = byHabitat.get('shaded-cove') ?? [];
    const glade = byHabitat.get('dry-rocky-glade') ?? [];
    const clearing = byHabitat.get('open-clearing') ?? [];
    for (const [name, rows] of [['wet terrace', wet], ['shaded cove', cove],
      ['rocky glade', glade], ['open clearing', clearing]]) {
      assert.ok(rows.length >= 8, `${name} is absent or only decorative at seed ${seed}`);
    }
    assert.ok(wet.filter(cell => cell.substrate === 'alluvium').length >= wet.length * .8,
      `wet terraces should mostly follow alluvial substrate at seed ${seed}`);
    assert.ok(cove.filter(cell => cell.substrate === 'deep-loam').length >= cove.length * .8,
      `shaded coves should mostly follow deeper soil at seed ${seed}`);
    assert.ok(glade.filter(cell => cell.substrate === 'thin-limestone').length >= glade.length * .8,
      `dry glades should mostly follow thin limestone at seed ${seed}`);
    assert.ok(clearing.filter(cell => ['weathered-soil', 'thin-limestone'].includes(cell.substrate))
      .length >= clearing.length * .8,
      `clearings should mostly follow exposed, well-drained ground at seed ${seed}`);
    assert.ok(mean(wet, 'moisture') > mean(glade, 'moisture') + .1,
      `wet terrace should have materially wetter sites at seed ${seed}`);
    assert.ok(mean(cove, 'canopy') > mean(glade, 'canopy') + .1,
      `shaded cove should have materially more canopy at seed ${seed}`);
    assert.ok(mean(cove, 'light') < mean(glade, 'light') - .1,
      `shaded cove should admit materially less light at seed ${seed}`);
    assert.ok(mean(clearing, 'canopy') < mean(cove, 'canopy') - .2,
      `clearings should have materially less canopy at seed ${seed}`);
    assert.ok(mean(clearing, 'light') > mean(cove, 'light') + .2,
      `clearings should admit materially more light at seed ${seed}`);
    assert.ok(mean(clearing, 'moisture') < mean(wet, 'moisture') - .1,
      `clearings should be drier than wet terraces at seed ${seed}`);
  }
});

test('seeded landforms support varied, spatially coherent patches and clearings', () => {
  for (const seed of [DESIGN_SEED, CONTRAST_SEED, 5]) {
    const descriptor = generateOzarkPreview(seed);
    const glades = habitatComponentSizes(descriptor, 'dry-rocky-glade');
    const coves = habitatComponentSizes(descriptor, 'shaded-cove');
    const clearings = habitatComponentSizes(descriptor, 'open-clearing');
    assert.ok(glades.filter(size => size >= 16).length >= 2,
      `glades form only one broad repeated band at seed ${seed}`);
    assert.ok(coves.filter(size => size >= 16).length >= 2,
      `coves form only one broad repeated band at seed ${seed}`);
    assert.ok(clearings.filter(size => size >= 8).length >= 2,
      `clearings do not make several coherent patches at seed ${seed}`);
    const clearingCells = clearings.reduce((sum, size) => sum + size, 0);
    const isolatedCells = clearings.filter(size => size <= 2)
      .reduce((sum, size) => sum + size, 0);
    assert.ok(isolatedCells <= clearingCells * .1,
      `clearings scatter as isolated confetti at seed ${seed}`);

    // A constant offset from the river used to be almost entirely one habitat
    // across the map. Site-dependent patch widths should mix land cover along
    // both sides without requiring any exact shape or every forest to fragment.
    const northShares = [-25, -20, -18, -15, -12].map(offset =>
      shareAlongChannelOffset(descriptor, offset, 'dry-rocky-glade'));
    const southShares = [8, 12, 15, 18, 20].map(offset =>
      shareAlongChannelOffset(descriptor, offset, 'shaded-cove'));
    assert.ok(northShares.some(share => share >= .2 && share <= .8),
      `north forest/glade boundary remains a repeated band at seed ${seed}`);
    assert.ok(southShares.some(share => share >= .2 && share <= .8),
      `south forest/cove boundary remains a repeated band at seed ${seed}`);
  }
});

test('SVG marks modeled water and limitations without implying human construction or playable food', () => {
  const svg = renderOzarkPreview(preview);
  for (const label of ['DESIGN PREVIEW', 'NOT PLAYABLE', 'NOT SCIENTIFICALLY CALIBRATED',
    'OUTLET', 'BLUFF SPRING', 'INTERNAL SINKHOLE']) {
    assert.ok(svg.includes(label), `missing visible preview label ${label}`);
  }
  assert.equal((svg.match(/data-feature="main-channel"/g) ?? []).length, 1);
  assert.equal((svg.match(/data-feature="tributary"/g) ?? []).length, preview.tributaries.length);
  assert.equal((svg.match(/data-feature="spring-branch"/g) ?? []).length, 1);
  assert.equal((svg.match(/data-feature="internal-sinkhole"/g) ?? []).length, 1);
  assert.match(svg, /data-habitat="open-clearing"/);
  assert.match(svg, /open clearing \/ exposed soil/);
  assert.doesNotMatch(svg, /data-feature="(?:bridge|road|tent|campfire|sign|food-source)"/i);
});
