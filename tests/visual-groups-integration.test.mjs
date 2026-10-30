const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
const createOzarkState=(...args)=>legacyFixture(rawcreateOzarkState(...args));
const loadOzarkSave=(...args)=>legacyFixture(rawloadOzarkSave(...args));
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState as rawcreateOzarkState, writeOzarkSave, loadOzarkSave as rawloadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc } from '../src/npc.js';
import { rememberDiscoveryObservation, rememberDirectDiscoveryObject } from '../src/discovery.js';
import { SocialCoordinator } from '../src/social.js';
import { visualGroups, ingestVisualSamples } from '../src/visual-group-memory.js';

const geometry=createOzarkWorldGeometry(), clone=value=>legacyFixture(historicalClone(value));
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function fixture(){
  let visible=true,selected=[];
  // Disclosed sensory fixture: real ecological objects and ordinary perception,
  // with LOS restricted to two fixed tree positions, not fabricated cue rows.
  const g=Object.freeze({...geometry,lineOfSight:(from,to)=>visible&&selected.some(p=>p.position.x===to.x&&p.position.y===to.y)&&geometry.lineOfSight(from,to)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment;
  const spawn=geometry.agentSpawns.aster;
  const trees=e.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>2&&Math.hypot(p.position.x-spawn.x,p.position.y-spawn.y)<3000);
  for(const source of trees){
    const point={x:source.position.x+45,y:source.position.y};
    if(!geometry.canOccupy(point.x,point.y,CONFIG.playerRadius))continue;
    const target=trees.find(p=>p!==source&&Math.hypot(point.x-p.position.x,point.y-p.position.y)<350&&geometry.lineOfSight(point,p.position));
    if(target&&geometry.lineOfSight(point,source.position)){selected=[source,target];a.position=point;break;}
  }
  assert.equal(selected.length,2,'controlled actual sensed pair exists');
  const time=t=>{state.elapsed=e.elapsed=e.ecology.elapsed=t;for(const n of state.agents)n.elapsed=t;};
  time(60);for(const n of state.agents)bindOzarkWorldAgent(n,g,state);
  return {state,a,b,e,g,pair:selected,time,visible:v=>visible=v};
}
const rows=n=>n.discovery.visualSamples?.records||[];
const sample=f=>observeNpc(f.a,f.e);

test('two actual perceived individuals need two distinct simulation times; no single-sighting group',()=>{
  const f=fixture();sample(f);
  assert.equal(rows(f.a).length,2);assert.ok(rows(f.a).every(r=>r.times.length===1));assert.equal(visualGroups(f.a).length,0);
  sample(f);sample(f);assert.ok(rows(f.a).every(r=>r.times.length===1));
  f.time(61);sample(f);assert.equal(visualGroups(f.a).length,1);
  assert.ok(rows(f.a).every(r=>r.times.length===2));
  assert.equal(rows(f.b).length,0,'other actor does not receive my observations');
  assert.deepEqual(f.a.discovery.experiments,[]);assert.equal(f.a.lexicon,undefined);
});

test('ordinary ingress excludes speech, naming refresh and direct action descriptions',()=>{
  const f=fixture(),objects=sample(f).objects,before=clone(rows(f.a));f.time(61);
  const social=new SocialCoordinator({communicationMode:'legacy',getAgents:()=>f.state.agents,getEnvironment:()=>f.e,getCommunity:()=>f.state.community});
  social.naming.visible(f.a);
  rememberDiscoveryObservation(f.a,objects);
  for(const o of objects)rememberDirectDiscoveryObject(f.a,o);
  assert.deepEqual(rows(f.a),before);
  sample(f);assert.equal(visualGroups(f.a).length,1);
});

test('sleep, occlusion, wrong scene and absence cannot add support or disprove remembered similarity',()=>{
  const f=fixture();sample(f);f.time(61);sample(f);const before=clone(rows(f.a));
  f.time(62);f.visible(false);assert.deepEqual(sample(f).objects,[]);assert.deepEqual(rows(f.a),before);
  f.visible(true);f.a.physiology.sleep.state='sleeping';f.time(63);sample(f);assert.deepEqual(rows(f.a),before);
  f.a.physiology.sleep.state='awake';f.a.scene='elsewhere';f.time(64);sample(f);assert.deepEqual(rows(f.a),before);
  f.a.scene='valley';assert.equal(visualGroups(f.a).length,1,'absence is not disproof');
});

test('same-time held-plus-visible duplicate is one sample, never an independent encounter',()=>{
  const f=fixture();
  // Deliberately duplicate ordinary perception's inventory projection without
  // claiming physical acquisition. The fixture never writes this invalid inventory.
  f.a.inventory.items.push(f.pair[0].id);
  const observed=sample(f);assert.equal(observed.objects.filter(o=>o.id===f.pair[0].id).length,2);
  assert.equal(rows(f.a).find(r=>r.objectId===f.pair[0].id).times.length,1);
  f.time(61);sample(f);assert.deepEqual(rows(f.a).find(r=>r.objectId===f.pair[0].id).times,[60,61]);
});

test('valid optional current save roundtrips without sensing; old current save remains valid',()=>{
  const f=fixture(),disk=storage();sample(f);f.time(61);sample(f);
  assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const bytes=disk.getItem(OZARK_SAVE_KEY),saved=clone(rows(f.a));
  for(let i=0;i<2;i++){
    const reopened=loadOzarkSave(disk,f.g);assert.equal(reopened.blocked,false,reopened.error);
    assert.deepEqual(rows(reopened.state.agents[0]),saved);assert.equal(reopened.state.elapsed,61);
    assert.equal(writeOzarkSave(disk,reopened.state,f.g),true);
  }
  const old=JSON.parse(bytes);for(const n of old.agents)delete n.discovery.visualSamples;
  const prior=storage();prior.setItem(OZARK_SAVE_KEY,JSON.stringify(old));
  const reopened=loadOzarkSave(prior,f.g);assert.equal(reopened.blocked,false,reopened.error);
  assert.equal(reopened.state.agents[0].discovery.visualSamples,undefined);
});

test('malformed, foreign, duplicate, future, overcap and extra optional evidence fail closed',()=>{
  const f=fixture(),disk=storage();sample(f);f.time(61);sample(f);assert.equal(writeOzarkSave(disk,f.state,f.g),true);
  const raw=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  const mutations=[
    v=>v.ownerId='mira',v=>v.version=2,v=>v.extra=true,v=>v.records[0].extra=true,
    v=>v.records[0].times=[60,60],v=>v.records[0].times=[60,62],v=>v.records[0].times=[59,60,61],
    v=>v.records[0].scene='elsewhere',v=>v.records[0].objectId='object:no',
    v=>delete v.records[0].cues.texture,v=>v.records[0].cues.category='food',
    v=>v.records.push(clone(v.records[0])),
    v=>{v.records=Array.from({length:33},(_,i)=>({...clone(v.records[0]),objectId:`object:${900000+i}`}));},
  ];
  for(const mutate of mutations){
    const bad=clone(raw);mutate(bad.agents[0].discovery.visualSamples);const occupied=JSON.stringify(bad),d=storage();d.setItem(OZARK_SAVE_KEY,occupied);
    const reopened=loadOzarkSave(d,f.g);assert.equal(reopened.blocked,true,mutate.toString());assert.equal(d.getItem(OZARK_SAVE_KEY),occupied);
  }
});

test('enabled and disabled observer have exact ordinary-controller world parity',t=>{
  const run=disabled=>{
    const r=spawnSync(process.execPath,['tests/visual-groups-parity-fixture.mjs',...(disabled?['--disabled']:[])],{encoding:'utf8',maxBuffer:32*1024*1024});
    assert.equal(r.status,0,r.stderr||r.stdout);return JSON.parse(r.stdout);
  };
  const enabled=run(false),disabled=run(true);
  t.diagnostic(JSON.stringify({purpose:'Fixed natural-frequency and whole-runtime timing diagnostic only; not autonomous learning or isolated ingestion cost',enabled:enabled.diagnostic,disabled:disabled.diagnostic}));
  assert.ok(enabled.sampleCount>0);assert.equal(disabled.sampleCount,0);
  assert.notEqual(enabled.world.worldLineage.instanceId,disabled.world.worldLineage.instanceId,
    'Independent fresh-world processes receive distinct nonsemantic identities');
  for(const {world} of [enabled,disabled]){
    assert.equal(world.worldLineage.instanceId,world.visualReference.worldId);
    assert.equal(world.worldLineage.instanceId,world.characterMessages.worldId);
  }
  const normalized=world=>{
    const copy=structuredClone(world);
    copy.worldLineage.instanceId='<fresh-world-instance>';
    copy.visualReference.worldId='<fresh-world-instance>';
    copy.characterMessages.worldId='<fresh-world-instance>';
    return copy;
  };
  assert.deepEqual(normalized(enabled.world),normalized(disabled.world),
    'Actions, RNG, clocks, effort, stocks, learning and lexicons are unchanged apart from fresh world identity');
});


test('bounded ingestion timing diagnostic retains only the declared sample budget',t=>{
  const f=fixture(),objects=sample(f).objects;
  const count=500,started=performance.now();
  for(let i=0;i<count;i++){f.a.elapsed=62+i;ingestVisualSamples(f.a,objects);}
  const milliseconds=performance.now()-started;
  assert.equal(rows(f.a).length,2);assert.ok(rows(f.a).every(r=>r.times.length===2));
  t.diagnostic(JSON.stringify({purpose:'Controlled two-object ingestion timing, not laptop guarantee',batches:count,objectsPerBatch:objects.length,milliseconds,microsecondsPerBatch:milliseconds*1000/count,retainedIndividuals:rows(f.a).length}));
});
