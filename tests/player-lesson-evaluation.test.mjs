import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreshPlayerLessons,learnPlayerLesson} from '../src/player-lesson-bank.js';
import {createPlayerLessonEvaluation,reconcilePlayerLessonEvaluation,
  recordPlayerLessonEvaluation,playerLessonEvaluationSnapshot}
  from '../src/player-lesson-evaluation.js';

const lineage={version:2,instanceId:'550e8400-e29b-41d4-a716-446655440000',
  nextSerial:3,agents:[{agentId:'aster',serial:1},{agentId:'mira',serial:2}]};
const crop=value=>Array(48).fill(value);

test('scores are frozen before each example, with separate known-label and chance denominators',()=>{
  let bank=createFreshPlayerLessons(lineage),scores=createPlayerLessonEvaluation(lineage);
  for(const [word,features] of [['nava',crop(.2)],['tomi',crop(.8)],
    ['nava',crop(.2)],['nava',crop(.8)],['nava',crop(.65)],['nova',crop(.8)]]) {
    const before=structuredClone(scores),prior=scores;
    const update=learnPlayerLesson(bank,{agentId:'aster',serial:1,word,features});
    bank=update.bank;
    scores=recordPlayerLessonEvaluation(scores,{agentId:'aster',serial:1,
      prequential:update.prequential});
    assert.deepEqual(prior,before,'record must not mutate prior scores');
  }
  const row=playerLessonEvaluationSnapshot(scores).agents[0];
  assert.deepEqual({examples:row.completedExamples,comparable:row.comparable,
    predicted:row.predicted,correct:row.correct,abstained:row.abstained,
    chance:row.uniformChanceSum},
  {examples:6,comparable:3,predicted:2,correct:1,abstained:1,chance:1.5});
  assert.equal(playerLessonEvaluationSnapshot(scores).agents[1].completedExamples,0);
  assert.equal(JSON.stringify(scores).includes('features'),false);
  assert.equal(JSON.stringify(scores).includes('nava'),false);
});

test('individual replacement clears its scores while continuing peer retains its own',()=>{
  const base=createPlayerLessonEvaluation(lineage);
  const bank=createFreshPlayerLessons(lineage);
  const update=learnPlayerLesson(bank,{agentId:'aster',serial:1,word:'nava',features:crop(.2)});
  const scored=recordPlayerLessonEvaluation(base,{agentId:'aster',serial:1,
    prequential:update.prequential});
  const next={...lineage,nextSerial:4,agents:[{agentId:'aster',serial:3},
    {agentId:'mira',serial:2}]};
  const reconciled=reconcilePlayerLessonEvaluation(scored,next);
  assert.equal(reconciled.agents[0].serial,3);
  assert.equal(reconciled.agents[0].completedExamples,0);
  assert.deepEqual(reconciled.agents[1],scored.agents[1]);
  assert.throws(()=>recordPlayerLessonEvaluation(reconciled,{agentId:'aster',serial:1,
    prequential:update.prequential}),/Invalid player lesson evaluation/);
  assert.throws(()=>reconcilePlayerLessonEvaluation(scored,{...lineage,
    instanceId:'550e8400-e29b-41d4-a716-446655440001'}),/Invalid player lesson evaluation/);
});

test('observer snapshots cannot mutate counters; malformed scores and summaries fail closed',()=>{
  const scores=createPlayerLessonEvaluation(lineage);
  const snapshot=playerLessonEvaluationSnapshot(scores);
  snapshot.agents[0].completedExamples=40;
  snapshot.agents.push(snapshot.agents[0]);
  assert.equal(playerLessonEvaluationSnapshot(scores).agents[0].completedExamples,0);
  const update=learnPlayerLesson(createFreshPlayerLessons(lineage),
    {agentId:'aster',serial:1,word:'nava',features:crop(.2)});
  for(const candidate of [
    {...update.prequential,uniformChance:1},
    {...update.prequential,correct:false},
    {...update.prequential,prediction:{...update.prequential.prediction,labels:999}},
  ]) assert.throws(()=>recordPlayerLessonEvaluation(scores,{agentId:'aster',serial:1,
    prequential:candidate}),/Invalid player lesson evaluation/);
  assert.throws(()=>playerLessonEvaluationSnapshot({...scores,extra:true}),
    /Invalid player lesson evaluation/);
});

test('counters saturate without wrapping or losing their saturation flag',()=>{
  const scores=createPlayerLessonEvaluation(lineage);
  scores.agents[0].completedExamples=1_000_000_000;
  const update=learnPlayerLesson(createFreshPlayerLessons(lineage),
    {agentId:'aster',serial:1,word:'nava',features:crop(.2)});
  const next=recordPlayerLessonEvaluation(scores,{agentId:'aster',serial:1,
    prequential:update.prequential});
  assert.equal(next.agents[0].completedExamples,1_000_000_000);
  assert.equal(next.agents[0].saturated,true);
  assert.equal(scores.agents[0].saturated,false);
});
