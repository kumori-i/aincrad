/** Headless tests of the finite native QA plumbing. Actual process/disk proof is
 * deliberately left to the Linux Electron CI step, never inferred from mocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { freshState } from '../src/world.js';
import { writeSave } from '../src/save.js';
import { OZARK_SAVE_KEY, loadOzarkSave, writeOzarkSave } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { PopulationRuntime } from '../src/population.js';
import { geometry, syntheticOzarkSelfEdge } from './ozark-self-edge-fixture.mjs';

const { runNativeProfileQa } = createRequire(import.meta.url)('./native-profile-qa-driver.cjs');

async function disposable(callback) {
  const scratch = await mkdtemp(join(tmpdir(), 'aincrad-ozark-driver-'));
  const originalPath = join(scratch, 'original'), copyPath = join(scratch, 'recovered');
  await mkdir(originalPath);
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); } };
  const profileRoute = { kind: 'original', originalPath, copyPath, isTest: true, usesTestPaths: true };
  let sequence = 0;
  const run = async (action, { config = {}, route = profileRoute, noOpSave = false } = {}) => {
    const number = ++sequence, output = join(scratch, `result-${number}.json`);
    const configPath = join(scratch, `config-${number}.json`);
    await writeFile(configPath, JSON.stringify({ version: 1, action, output, ...config }));
    let url = 'aincrad://app/index.html?test=1', state = null, saveStatus = '', population;
    const snapshot = () => ({ geometryIdentity: state.geometryIdentity,
      player: { ...state.player }, playerBody: { ...state.playerBody },
      agents: state.agents.map(actor => ({ id: actor.id, position: { ...actor.position },
        elapsed: actor.elapsed, memory: structuredClone(actor.memory),
        discovery: structuredClone(actor.discovery), physiology: structuredClone(actor.physiology) })),
      ecology: { plants: state.environment.ecology.plants.length,
        animals: state.environment.ecology.animals.length, materials: state.environment.ecology.materials.length },
      elapsed: state.elapsed, saveStatus, started: false, paused: false, blocked: false });
    const context = createContext({ localStorage: storage,
      document: { getElementById: () => ({ textContent: 'Ready', classList: { contains: () => true } }) } });
    context.window = { __aincrad: { save: () => writeSave(storage, freshState()), snapshot: () => ({ elapsed: 0 }) },
      aincradWorld: { open: target => {
        assert.equal(target, 'ozark');
        const loaded = loadOzarkSave(storage, geometry);
        assert.equal(loaded.blocked, false, loaded.error);
        state = loaded.state;
        for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
        population = new PopulationRuntime(state, { cardinal: false });
        url = 'aincrad://app/index.html?test=1&ozarkWorld=1';
        delete context.window.__aincrad;
        context.window.__ozarkWorld = { snapshot, save: () => {
          const ok = noOpSave || writeOzarkSave(storage, state, geometry);
          saveStatus = ok ? 'Ozark world saved locally' : 'Ozark save unavailable';
          return ok;
        } };
        return { ok: true };
      } } };
    const exits = [];
    try {
      await runNativeProfileQa({ profileRoute: route, configPath,
        app: { isPackaged: false, getPath: () => originalPath,
          quit: () => exits.push(0), exit: code => exits.push(code) },
        win: { webContents: {
          getLastWebPreferences: () => ({ sandbox: true, contextIsolation: true, nodeIntegration: false }),
          getURL: () => url,
          executeJavaScript: async script => structuredClone(await runInContext(script, context)),
          capturePage: async () => ({ toPNG: () => Buffer.alloc(128) }),
        } },
        session: { defaultSession: { storagePath: originalPath, flushStorageData: async () => {} } },
        recoveredProfile: { status: async () => ({ kind: 'original', phase: 'none' }) },
      });
      return { result: JSON.parse(await readFile(output, 'utf8')), exits };
    } finally { population?.dispose(); }
  };
  try { await callback({ run, storage, profileRoute }); }
  finally { await rm(scratch, { recursive: true, force: true }); }
}

test('finite Ozark probes exercise the real validators and preserve frozen generated evidence', async () => {
  await disposable(async ({ run }) => {
    const written = await run('ozark-self-edge-write');
    assert.equal(written.result.ok, true, written.result.error);
    assert.deepEqual(written.exits, [0]);
    const before = written.result.ozark;
    assert.notEqual(before.sha256, before.seedSha256);
    assert.equal(before.edgeKey, '7,29>7,29');
    assert.equal(before.receipt.details.result.code, 'ROUTE_BLOCKED');
    assert.ok(before.snapshot.agents[0].memory.experience.length > 0);
    const reopened = await run('ozark-self-edge-reopen');
    assert.equal(reopened.result.ok, true, reopened.result.error);
    assert.deepEqual(reopened.exits, [0]);
    assert.equal(reopened.result.ozark.sha256, before.sha256);
    assert.equal(reopened.result.ozark.originalSha256, before.originalSha256);
    assert.deepEqual(reopened.result.ozark.snapshot, before.snapshot);
  });
});

test('a fake successful save that never writes cannot pass the Ozark probe', async () => {
  await disposable(async ({ run }) => {
    const { result, exits } = await run('ozark-self-edge-write', { noOpSave: true });
    assert.equal(result.ok, false);
    assert.deepEqual(exits, [1]);
    assert.match(result.error, /native write\/reopen preserves the exact canonical fixture/);
  });
});

test('reopen cannot silently reseed or repair a changed Ozark slot', async () => {
  await disposable(async ({ run, storage }) => {
    const original = '{"synthetic":' + JSON.stringify('original control'.repeat(100)) + '}';
    storage.setItem('aincrad.save.v1', original);
    const altered = JSON.stringify(JSON.parse(syntheticOzarkSelfEdge().raw), null, 2);
    storage.setItem(OZARK_SAVE_KEY, altered);
    const { result, exits } = await run('ozark-self-edge-reopen');
    assert.equal(result.ok, false);
    assert.deepEqual(exits, [1]);
    assert.match(result.error, /reopen starts with the exact native checkpoint bytes/);
    assert.equal(storage.getItem(OZARK_SAVE_KEY), altered);
    assert.equal(storage.getItem('aincrad.save.v1'), original);
  });
});

test('Ozark native QA accepts only its two finite actions and fixed synthetic inputs', async () => {
  await disposable(async ({ run, profileRoute }) => {
    await assert.rejects(run('ozark-self-edge-eval'), /Invalid finite native QA action/);
    for (const action of ['ozark-self-edge-write', 'ozark-self-edge-reopen']) {
      await assert.rejects(run(action, { route: { ...profileRoute, kind: 'recovered' } }),
        /original disposable profile and fixed synthetic inputs/);
      await assert.rejects(run(action, { config: { waitMs: 1 } }), /fixed synthetic inputs/);
      await assert.rejects(run(action, { config: { saveKey: 'another-slot' } }), /Unknown native QA configuration key/);
      await assert.rejects(run(action, { config: { script: 'arbitrary()' } }), /Unknown native QA configuration key/);
    }
  });
});
