import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState } from '../src/ozark-save.js';
import { createPlayerFoodController } from '../src/player-food.js';
import { PopulationRuntime } from '../src/population.js';

test('player food native preparation generates an isolated actual-input close/reopen runner', async () => {
  const output = await mkdtemp(join(tmpdir(), 'player-food-prepare-'));
  let passed = false;
  try {
    const command = spawnSync(process.execPath,
      ['scripts/verify-player-food-desktop.mjs', '--prepare-only'],
      { encoding: 'utf8', timeout: 120000,
        env: { ...process.env, AINCRAD_PLAYER_FOOD_QA_OUTPUT: output } });
    assert.equal(command.status, 0, command.stderr);
    const prepared = JSON.parse(command.stdout.trim());
    const manifest = JSON.parse(await readFile(join(prepared.output, 'prepared.json'), 'utf8'));
    assert.equal(manifest.nativeExecutionPerformed, false);
    assert.deepEqual(manifest.sandboxBypassFlags, []);
    assert.deepEqual(manifest.phases, ['author', 'act', 'reopen']);
    assert.ok(manifest.sourceIdentity && manifest.sourceFingerprint);
    await assert.rejects(access(join(prepared.output, 'result.json')));
    for (const phase of manifest.phases)
      await assert.rejects(access(join(prepared.output, `${phase}-sandbox.json`)));
    const syntax = spawnSync(process.execPath, ['--check', prepared.harness], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const runner = await readFile(prepared.harness, 'utf8');
    assert.match(runner, /getLastWebPreferences\(\)/);
    assert.match(runner, /assert\.equal\(prefs\.sandbox,true\)/);
    assert.match(runner, /sendInputEvent\(\{type:'mouseDown'/);
    assert.match(runner, /sendInputEvent\(\{type:'mouseUp'/);
    assert.match(runner, /player-food-gather/);
    assert.match(runner, /player-food-taste/);
    assert.match(runner, /player-food-drop/);
    assert.match(runner, /afterRepeatedClick\.active\.worked>=firstAction\.active\.worked/);
    assert.match(runner, /Gather must be disabled while its first paid action remains active/);
    assert.match(runner, /afterRepeatedClick\.active\?\.\[key\],firstAction\.active\[key\]/);
    assert.match(runner, /A disabled repeated click cannot take an extra fruit/);
    assert.doesNotMatch(runner, /playerFoodSnapshot\(\)'\),firstAction\)/,
      'Native disabled-click audit must allow the original paid action to advance');
    assert.match(runner, /sourceQuantity-1/);
    assert.match(runner, /inquiry\.actorId,'player'/);
    assert.match(runner, /inquiry\.attempts\.length,0/);
    assert.match(runner, /No duplicate swallow, holding or pending action after reopening/);
    assert.match(runner, /captureWithReadiness\(\{/);
    assert.match(await readFile('scripts/verify-player-food-desktop.mjs', 'utf8'), /profile-evidence/);
    const acted = runner.split('async function actPhase(win) {')[1]?.split('async function reopenPhase(win) {')[0];
    assert.ok(acted, 'The action phase is present');
    assert.doesNotMatch(acted, /referenceFixture\(|createPlayerFoodController\(|ingestMaterial\(|interactEcologyObject\(/,
      'The action phase must use actual UI input and ordinary runtime hooks');
    assert.match(runner, /this is not an ordinary encounter/);
    assert.match(runner, /does not claim autonomous recipient trial/);
    const preservation = JSON.parse(await readFile(join(prepared.output, 'profile-evidence.json'), 'utf8'));
    assert.equal(preservation.nativeExecutionPerformed, false);
    assert.equal(preservation.copiedAfterProcessesClosed, false);
    passed = true;
  } finally {
    if (passed) await rm(output, { recursive: true, force: true });
    else console.error('Failed player-food preparation evidence retained at ' + output);
  }
});

test('authored visible apple source keeps an independently acting witness in sight for the paid demonstration window', () => {
  const geometry = createOzarkWorldGeometry();
  const state = createOzarkState(geometry, { communicationSeed: 211 });
  const plants = state.environment.ecology.plants.filter(plant =>
    plant.kind === 'apple_tree' && plant.quantity > 3 && plant.stage === 'ripe');
  plants.sort((a, b) => Math.hypot(a.position.x - 276, a.position.y - 760) -
    Math.hypot(b.position.x - 276, b.position.y - 760));
  let source, point;
  for (const plant of plants) {
    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI / 8;
      const candidate = { x: plant.position.x + 48 * Math.cos(angle),
        y: plant.position.y + 48 * Math.sin(angle) };
      if (geometry.canOccupy(candidate.x, candidate.y, CONFIG.playerRadius) &&
          geometry.lineOfSight(candidate, plant.position)) {
        source = plant; point = candidate; break;
      }
    }
    if (source) break;
  }
  assert.equal(source?.id, 'object:671', 'Controlled scene pins the existing physical seed and source');
  state.player = { ...point };
  state.agents[0].position = { ...point };
  assert.equal(createPlayerFoodController(state, geometry).visibleOptions()[0]?.targetId, source.id);
  const population = new PopulationRuntime(state, { cardinal: false });
  for (let step = 0; step < Math.ceil(5 / CONFIG.fixedStep); step++) {
    population.tick(CONFIG.fixedStep);
    state.elapsed = state.environment.elapsed;
    const witness = state.agents[0];
    assert.ok(Math.hypot(witness.position.x - state.player.x,
      witness.position.y - state.player.y) < NPC_RULES.visionRadius,
    'Ordinary unforced witness action remains within vision during the short paid window');
    assert.equal(geometry.lineOfSight(witness.position, state.player), true);
  }
  population.dispose();
});

test('Linux and macOS native workflow includes player food evidence without experiment activation', async () => {
  const workflow = await readFile('.github/workflows/learning-cycle.yml', 'utf8');
  assert.match(workflow, /macos-latest, ubuntu-22\.04/);
  assert.match(workflow, /scripts\/verify-player-food-desktop\.mjs/);
  assert.match(workflow, /test-results\/player-food-desktop\//);
  assert.match(workflow, /xvfb-run -a bash -c 'openbox/);
  assert.doesNotMatch(workflow, /on:\s*\n\s*create:/);
  assert.doesNotMatch(workflow, /refs\/experiments\//);
});
