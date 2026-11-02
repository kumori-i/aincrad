import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreshPlayerLessons, validatePlayerLessons, reconcilePlayerLessons,
  predictPlayerWord, learnPlayerLesson, PLAYER_LESSON_LIMITS} from '../src/player-lesson-bank.js';

const worldId='550e8400-e29b-41d4-a716-446655440000';
const lineage=(aster=1,mira=2,nextSerial=3)=>({version:2,instanceId:worldId,
  nextSerial,agents:[{agentId:'aster',serial:aster},{agentId:'mira',serial:mira}]});
const crop=value=>Array(PLAYER_LESSON_LIMITS.features).fill(value);
const add=(bank,owner,word,features)=>learnPlayerLesson(bank,
  {agentId:owner,serial:owner==='aster'?1:2,word,features});

test('fresh individual banks abstain and validation copies every numeric crop',()=>{
  const fresh=createFreshPlayerLessons(lineage());
  assert.deepEqual(fresh,{version:1,worldId,agents:[
    {agentId:'aster',serial:1,examples:[]},
    {agentId:'mira',serial:2,examples:[]}]});
  assert.deepEqual(predictPlayerWord([],crop(.2)),{
    word:null,labels:0,nearestRms:null,runnerRms:null,
    status:'abstained',reason:'insufficient-labels'});
  const input=crop(.25),first=add(fresh,'aster','nava',input);
  input[0]=.9;
  assert.equal(first.bank.agents[0].examples[0].features[0],.25);
  assert.deepEqual(fresh.agents[0].examples,[],'learning cannot mutate input state');
  const copied=validatePlayerLessons(first.bank,lineage());
  copied.agents[0].examples[0].features[1]=.8;
  assert.equal(first.bank.agents[0].examples[0].features[1],.25);
  assert.deepEqual(first.bank.agents[1].examples,[],'Mira has a private bank');
});

test('prequential prediction is frozen before update and needs two learned labels',()=>{
  let bank=createFreshPlayerLessons(lineage());
  let result=add(bank,'aster','nava',crop(0));bank=result.bank;
  assert.equal(result.prequential.prediction.reason,'insufficient-labels');
  assert.equal(result.prequential.correct,null);
  result=add(bank,'aster','tomi',crop(1));bank=result.bank;
  assert.equal(result.prequential.prediction.reason,'insufficient-labels');
  const novel=add(bank,'aster','siri',crop(.02));
  assert.equal(novel.prequential.prediction.word,'nava');
  assert.equal(novel.prequential.comparable,false);
  assert.equal(novel.prequential.correct,null,
    'An unseen word is not a known-class classification error');
  assert.equal(novel.prequential.uniformChance,null);
  result=add(bank,'aster','nava',crop(.03));bank=result.bank;
  assert.equal(result.prequential.prediction.status,'predicted');
  assert.equal(result.prequential.prediction.word,'nava');
  assert.equal(result.prequential.correct,true);
  assert.equal(result.prequential.comparable,true);
  assert.equal(result.prequential.uniformChance,.5);
  assert.equal(bank.agents[0].examples.length,3);
  assert.deepEqual(bank.agents[1].examples,[]);
  assert.equal(predictPlayerWord(bank.agents[0].examples,crop(.97)).word,'tomi');
});

test('novel crops and visually ambiguous labels abstain instead of inventing meanings',()=>{
  const examples=[{word:'nava',features:crop(0)},
    {word:'tomi',features:crop(.04)}];
  const nearMiddle=predictPlayerWord(examples,crop(.02));
  assert.equal(nearMiddle.reason,'ambiguous');
  assert.equal(nearMiddle.word,null);
  const far=predictPlayerWord(examples,crop(.8));
  assert.equal(far.reason,'out-of-distribution');
  assert.equal(far.word,null);
  assert.equal(predictPlayerWord(examples.slice(0,1),crop(0)).reason,
    'insufficient-labels');
});

test('held-out numeric instances outperform a shuffled-word control without object IDs',()=>{
  const trained=[{word:'nava',features:crop(0)},
    {word:'tomi',features:crop(1)}];
  const heldOut=[{word:'nava',features:crop(.035)},
    {word:'tomi',features:crop(.965)}];
  const actual=heldOut.map(row=>predictPlayerWord(trained,row.features));
  assert.deepEqual(actual.map(row=>row.word),['nava','tomi']);
  const shuffled=trained.map(row=>({...row,word:row.word==='nava'?'tomi':'nava'}));
  assert.deepEqual(heldOut.map(row=>predictPlayerWord(shuffled,row.features).word),
    ['tomi','nava']);
  assert.equal(1/new Set(trained.map(row=>row.word)).size,.5,
    'The two-label uniform chance reference is one half');
});

test('completed examples are a deterministic 64-row FIFO, never a word dictionary',()=>{
  let bank=createFreshPlayerLessons(lineage());
  for(let i=0;i<66;i++)bank=add(bank,'aster',i%2?'nava':'tomi',crop(i/100)).bank;
  const rows=bank.agents[0].examples;
  assert.equal(rows.length,64);
  assert.equal(rows[0].features[0],.02);
  assert.equal(rows.at(-1).features[0],.65);
  assert.equal(rows.every(row=>Reflect.ownKeys(row).length===2),true);
  assert.deepEqual(add(bank,'mira','nava',crop(.3)).bank.agents[0].examples,rows);
});

test('replacement resets only that individual and a different world never reconciles',()=>{
  let bank=createFreshPlayerLessons(lineage());
  bank=add(bank,'aster','nava',crop(.1)).bank;
  bank=add(bank,'mira','tomi',crop(.9)).bank;
  const replaced=reconcilePlayerLessons(bank,lineage(3,2,4));
  assert.deepEqual(replaced.agents[0],{agentId:'aster',serial:3,examples:[]});
  assert.deepEqual(replaced.agents[1].examples,bank.agents[1].examples);
  assert.deepEqual(bank.agents[0].examples.length,1,'reconciliation is pure');
  assert.deepEqual(validatePlayerLessons(replaced,lineage(3,2,4)),replaced);
  assert.throws(()=>validatePlayerLessons(bank,lineage(3,2,4)),/individual binding/);
  assert.throws(()=>reconcilePlayerLessons(bank,{...lineage(),instanceId:
    '650e8400-e29b-41d4-a716-446655440000'}),/world binding/);
});

test('malformed, partial, overcap and foreign rows reject before learning',()=>{
  const bank=createFreshPlayerLessons(lineage());
  const bad=[];
  bad.push({...bank,version:2});
  bad.push({...bank,extra:true});
  bad.push({...bank,agents:bank.agents.slice(0,1)});
  bad.push({...bank,agents:[{...bank.agents[0],agentId:'mira'},bank.agents[1]]});
  bad.push({...bank,agents:[{...bank.agents[0],serial:2},bank.agents[1]]});
  for(const examples of [
    [{word:'Apple',features:crop(.2)}],
    [{word:'applepie',features:crop(.2)}],
    [{word:'nava',features:crop(NaN)}],
    [{word:'nava',features:crop(1.01)}],
    [{word:'nava',features:crop(.2).slice(1)}],
    Array.from({length:65},()=>({word:'nava',features:crop(.2)})),
  ])bad.push({...bank,agents:[{...bank.agents[0],examples},bank.agents[1]]});
  const hole=new Array(1);
  bad.push({...bank,agents:[{...bank.agents[0],examples:hole},bank.agents[1]]});
  for(const row of bad)assert.throws(()=>validatePlayerLessons(row,lineage()),
    /Invalid player lesson bank/);
  assert.throws(()=>learnPlayerLesson(bank,{agentId:'mira',serial:1,
    word:'nava',features:crop(.3)}),/lesson owner/);
  assert.throws(()=>learnPlayerLesson(bank,{agentId:'aster',serial:1,
    word:'nava',features:crop(Infinity)}),/numeric own-view/);
});
