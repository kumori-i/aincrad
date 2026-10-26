import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { knownRoute, createKnownRouteIndex } from '../src/navigation.js';
import { tileKey } from '../src/perception.js';
import { OZARK_SAVE_KEY, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { geometry, SAME_TILE_START, SAME_TILE_TARGET, HISTORICAL_BYTES,
  blockedMove, timedOutWadingMove, evidence } from './ozark-self-edge-fixture.mjs';

function roundTrip(fixture) {
  const { state, actor, disk, previousBytes } = fixture;
  const before = evidence(actor);
  assert.equal(writeOzarkSave(disk, state, geometry), true,
    'a physically generated blocked edge must be saveable');
  assert.notEqual(disk.getItem(OZARK_SAVE_KEY), previousBytes);
  assert.deepEqual(evidence(actor), before, 'saving must not repair live evidence');
  const stored = JSON.parse(disk.getItem(OZARK_SAVE_KEY)).agents[0];
  assert.deepEqual(evidence(stored), before);
  const loaded = loadOzarkSave(disk, geometry);
  assert.equal(loaded.blocked, false, loaded.error);
  assert.deepEqual(evidence(loaded.state.agents[0]), before,
    'reopening must preserve exact route evidence and its original receipt');
  assert.equal(disk.getItem(CONFIG.saveKey), HISTORICAL_BYTES);
  return loaded.state.agents[0];
}

test('native blocked snap within one observed tile survives Ozark save and route reuse', () => {
  const fixture = blockedMove(SAME_TILE_START, SAME_TILE_TARGET);
  const { actor, route, receipt } = fixture;
  const center = { x: 560, y: 2320 };
  assert.equal(geometry.classify(SAME_TILE_START.x, SAME_TILE_START.y).reason,
    'deep-water');
  assert.deepEqual(route[0], center);
  assert.equal(tileKey(SAME_TILE_START), tileKey(center));
  assert.deepEqual(receipt.details.result.blockedTarget, center);
  assert.equal(receipt.details.result.movement.traversal, 'adrift');
  assert.equal(receipt.details.result.movement.progress, 'negligible');
  assert.ok(receipt.details.result.distance > 0,
    'passive current displaced the body without purposeful progress');
  const key = '7,29>7,29';
  assert.deepEqual(actor.memory.blockedEdges, {
    [key]: { observedAt: receipt.at, retryAfter: receipt.at + 60 },
  });
  const nextRoute = npc => knownRoute(npc.memory.cells, npc.position,
    SAME_TILE_TARGET, 30, npc.memory.blockedEdges, npc.elapsed, npc.navigationAnchor);
  const expectedRoute = nextRoute(actor);
  assert.ok(expectedRoute);
  assert.deepEqual(expectedRoute[0], { x: 640, y: 2320 },
    'the real self-edge makes navigation choose another observed entry node');
  assert.deepEqual(knownRoute(actor.memory.cells, actor.position, SAME_TILE_TARGET,
    30, {}, actor.elapsed, actor.navigationAnchor)[0], center,
  'the comparison without this evidence retries the obstructed center');

  const restored = roundTrip(fixture);
  assert.equal(restored.navigationAnchor, actor.navigationAnchor);
  assert.deepEqual(nextRoute(restored), expectedRoute);
  assert.deepEqual(createKnownRouteIndex(restored.memory.cells, restored.position,
    restored.memory.blockedEdges, restored.elapsed, restored.navigationAnchor)
    .route(SAME_TILE_TARGET), expectedRoute);
  assert.deepEqual(knownRoute(restored.memory.cells, restored.position,
    SAME_TILE_TARGET, 30, restored.memory.blockedEdges,
    restored.memory.blockedEdges[key].retryAfter, restored.navigationAnchor)[0],
  center, 'the retained self-edge expires under the existing retry contract');
});

test('opposite physical directions retain the same lexicographically sorted different-cell edge', () => {
  // Both ends must reject walking. The old800,2160 endpoint is shallow
  // water and funded input can genuinely wade against current there.
  const left = { x: 720, y: 2080 }, right = { x: 800, y: 2080 };
  for (const [from, to] of [[left, right], [right, left]]) {
    for(const point of [from,to])assert.equal(geometry.classify(point.x,point.y).reason,'deep-water');
    const fixture = blockedMove(from, to);
    assert.ok(fixture.steps<=120,'retain original blocked-action bound');
    assert.deepEqual(fixture.route[0], to);
    assert.notEqual(tileKey(from), tileKey(to));
    assert.deepEqual(Object.keys(fixture.actor.memory.blockedEdges), ['10,26>9,26'],
      'canonical ordering is lexicographic, independent of physical direction');
    roundTrip(fixture);
  }
});

test('original shallow-water reverse attempt pays wading against current until its exact deadline, without fabricating an edge',()=>{
  const from={x:800,y:2160},to={x:720,y:2160};
  assert.equal(geometry.classify(from.x,from.y).reason,'shallow-water');
  assert.equal(geometry.classify(to.x,to.y).reason,'deep-water');
  const f=timedOutWadingMove(from,to),a=f.admittedAction,b=f.openingPhysiology,p=f.actor.physiology;
  assert.equal(a.expiresAt-a.startedAt,12,'unchanged admitted move allowance');
  assert.equal(f.steps,720,'exact native fixed-step deadline, not an enlarged blocked fixture timeout');
  assert.equal(f.receipt.details.result.code,'ACTION_TIMEOUT');
  assert.equal(f.receipt.details.result.movement.traversal,'wading');
  assert.ok(a.forwardProgress>0&&a.travelled>0,'real input and current displacement were observed');
  assert.ok(p.totals.metabolizedKcal-b.totals.metabolizedKcal>12*100/150,'motor work was paid in addition to unchanged awake basal cost');
  assert.ok(Math.abs((b.availableEnergyKcal+b.storedEnergyKcal)-(p.availableEnergyKcal+p.storedEnergyKcal)-(p.totals.metabolizedKcal-b.totals.metabolizedKcal))<1e-7,'measured debit and metabolic ledger conserve the un-fed body');
  assert.deepEqual(f.actor.memory.blockedEdges,{},'paid wading/current opposition is not a witnessed wholly blocked edge');
  roundTrip(f);
});

test('malformed, reversed, out-of-bounds and future edges still protect exact Ozark bytes', () => {
  const fixture = blockedMove({ x: 720, y: 2160 }, { x: 800, y: 2160 });
  assert.deepEqual(Object.keys(fixture.actor.memory.blockedEdges),['10,27>9,27'],'original forward case retains lexicographic rather than numeric ordering');
  roundTrip(fixture);
  const { disk } = fixture, goodBytes = disk.getItem(OZARK_SAVE_KEY);
  const good = JSON.parse(goodBytes), elapsed = good.elapsed;
  const valid = { observedAt: elapsed, retryAfter: elapsed + 60 };
  const cases = [
    ['malformed key', '7,29:7,29', valid],
    ['noninteger key', '7.5,29>7.5,29', valid],
    ['reversed canonical order', '9,27>10,27', valid],
    ['past west boundary', '-238,29>-238,29', valid],
    ['past east boundary', '238,29>238,29', valid],
    ['past north boundary', '7,-178>7,-178', valid],
    ['past south boundary', '7,178>7,178', valid],
    ['negative observation', '7,29>7,29', { ...valid, observedAt: -1 }],
    ['future observation', '7,29>7,29', { ...valid, observedAt: elapsed + 1 }],
    ['negative retry', '7,29>7,29', { ...valid, retryAfter: -1 }],
    ['future retry', '7,29>7,29', { ...valid, retryAfter: elapsed + 61 }],
    ['missing timestamp', '7,29>7,29', { retryAfter: elapsed + 60 }],
    ['invalid edge record', '7,29>7,29', null],
  ];
  for (const [label, key, edge] of cases) {
    disk.setItem(OZARK_SAVE_KEY, goodBytes);
    const opened = loadOzarkSave(disk, geometry);
    assert.equal(opened.blocked, false, opened.error);
    opened.state.agents[0].memory.blockedEdges[key] = structuredClone(edge);
    assert.equal(writeOzarkSave(disk, opened.state, geometry), false, label);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), goodBytes, label);

    const forged = structuredClone(good);
    forged.agents[0].memory.blockedEdges[key] = structuredClone(edge);
    const bytes = JSON.stringify(forged);
    disk.setItem(OZARK_SAVE_KEY, bytes);
    const rejected = loadOzarkSave(disk, geometry);
    assert.equal(rejected.blocked, true, label);
    assert.equal(rejected.state, null, label);
    assert.match(rejected.error, /invalid Ozark terrain or legacy-site memory/, label);
    assert.equal(disk.getItem(OZARK_SAVE_KEY), bytes, label);
    assert.equal(disk.getItem(CONFIG.saveKey), HISTORICAL_BYTES, label);
  }
});
