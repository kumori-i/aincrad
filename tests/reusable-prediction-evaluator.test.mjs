import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePredictionArguments, runPredictionEvaluation, finalizePredictionReport } from '../scripts/evaluate-reusable-prediction.mjs';
test('scripted evaluator admits no seed, body, runtime, policy or gate overrides', () => {
  const good = parsePredictionArguments(['--preflight', 'gate.json', '--output', 'evidence']);
  assert.ok(good.preflight.endsWith('/gate.json')); assert.ok(good.output.endsWith('/evidence'));
  for (const args of [[], ['--preflight'], ['--output','x'], ['--preflight','x','--output','y','--seed','2'],
    ['--preflight','x','--output','y','--preflight','z'], ['--preflight','x','--output','y','--stage','cohort'],
    ['--preflight','--output','y']]) assert.throws(() => parsePredictionArguments(args));
});
test('invalid preflight stops before output creation or any physical fixture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prediction-evaluator-'));
  try {
    const preflight = join(dir, 'bad.json'), output = join(dir, 'untouched');
    await writeFile(preflight, JSON.stringify({ version: 99 }));
    await assert.rejects(runPredictionEvaluation({ preflight, output }), /preflight.*Wrong protocol/);
    await assert.rejects(access(output));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('final report write crossing the wall ceiling rewrites a failed preserved result', () => {
  for (const times of [[299,301], [301,302], [299,NaN], [299,298]]) {
    const report = { status:'passed', continuingAllowed:true }, writes = [];
    finalizePredictionReport(report, { elapsedSeconds:()=>times.shift(), persist:()=>writes.push(structuredClone(report)) });
    assert.equal(report.status,'failed'); assert.equal(report.continuingAllowed,false);
    assert.equal(writes.at(-1).status,'failed');
  }
  const report={status:'passed',continuingAllowed:true}, times=[299,300], writes=[];
  finalizePredictionReport(report,{elapsedSeconds:()=>times.shift(),persist:()=>writes.push(structuredClone(report))});
  assert.equal(report.status,'passed'); assert.equal(writes.length,1);
});
