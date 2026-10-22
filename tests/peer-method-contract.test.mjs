import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAppearanceCues, appearanceCuesMatch, cleanPeerTeaching, peerTeachingText, restorePeerTeaching } from '../src/peer-teaching.js';

const cues={shape:'branching trunk with a leafy crown',color:'brown and green',texture:'rough bark'};
const teaching=()=>({version:1,sourceObjectId:'object:1',senderTechniqueId:'technique:aster:1',acquisition:'pull',receivedAt:60,state:'ready',transfer:{version:1,cues:{...cues},observedAt:59,targetObjectId:'object:2'}});
const report=()=>({sourceId:'aster',channel:'peer',teaching:teaching(),status:'unverified',cursor:0,evidence:[],proposed:[{type:'pull',targetId:'object:2'},{type:'sample',targetId:'object:2'}]});

test('appearance transfer accepts only three bounded observed cues, never engine fields or executable payloads',()=>{
  assert.deepEqual(cleanAppearanceCues(cues),cues);
  assert.equal(appearanceCuesMatch({...cues,details:'bare branches'},cues),true);
  assert.equal(appearanceCuesMatch({...cues,color:'green'},cues),false);
  for(const value of [{...cues,species:'apple_tree'},{...cues,quantity:4},{...cues,shape:''},{...cues,shape:'x'.repeat(101)},{...cues,texture:'rough\nbark'},null,[]]) assert.equal(cleanAppearanceCues(value),null);
  for(const mutate of [t=>t.transfer.species='apple_tree',t=>t.transfer.targetObjectId=t.sourceObjectId,t=>t.transfer.targetObjectId='unknown',t=>t.transfer.cues.execute='shell',t=>t.transfer.observedAt=-1,t=>t.transfer=null]){
    const t=teaching();mutate(t);assert.equal(cleanPeerTeaching(t),null);
  }
  const exact=teaching();delete exact.transfer;assert.deepEqual(cleanPeerTeaching(exact),exact);
  assert.match(peerTeachingText('object:1','pull',teaching().transfer),/Appearance is uncertain, not proof of safety or benefit/);
});

test('transfer restore binds recipient own target and receipts, never speaker source or copied proof',()=>{
  const raw=report(),d={observations:{'object:2':{appearance:cues},'object:3':{}},experiments:[],effects:[]},npc={id:'mira',elapsed:60};
  const restored={};restorePeerTeaching(restored,raw,d,npc);assert.deepEqual(restored.proposed,raw.proposed);assert.equal(restored.status,'unverified');
  const acquired={id:1,primitive:'pull',targetId:'object:2',materialId:'object:3',at:61,ok:true};
  const sample={id:2,primitive:'sample',targetId:'object:3',at:62,ok:true,ingestionId:'ingestion:1',actionId:2};
  raw.cursor=2;raw.evidence=[1,2];raw.teaching.state='waiting';d.experiments=[acquired,sample];npc.elapsed=63;
  restorePeerTeaching(restored,raw,d,npc);assert.equal(restored.teaching.state,'waiting');assert.equal(restored.status,'unverified');
  d.effects=[{ingestionId:'ingestion:1',actionId:2,effect:'sustained'}];restorePeerTeaching(restored,raw,d,npc);assert.equal(restored.status,'supported');
  acquired.targetId='object:1';restorePeerTeaching(restored,raw,d,npc);assert.equal(restored.teaching.state,'unavailable');assert.deepEqual(restored.proposed,[]);assert.equal(restored.status,'unverified');
});

test('transfer restart cancels interrupted acquisition and rejects missing local binding',()=>{
  const raw=report(),d={observations:{'object:2':{}},experiments:[],effects:[]},npc={id:'mira',elapsed:60};
  const restored={};restorePeerTeaching(restored,raw,d,npc,{type:'pull',targetId:'object:2'});assert.equal(restored.teaching.state,'unavailable');assert.deepEqual(restored.proposed,[]);
  delete raw.teaching.transfer.targetObjectId;restorePeerTeaching(restored,raw,d,npc);assert.equal(restored.teaching.state,'unavailable');assert.deepEqual(restored.proposed,[]);
});

test('a completed inconclusive transfer remains personally tested without inventing support when effect retention expires',()=>{
  const raw=report(),d={observations:{'object:2':{},'object:3':{}},experiments:[
    {id:1,primitive:'pull',targetId:'object:2',materialId:'object:3',at:61,ok:true},
    {id:2,primitive:'sample',targetId:'object:3',at:62,ok:true,ingestionId:'ingestion:1',actionId:2}
  ],effects:[]};
  raw.cursor=2;raw.evidence=[1,2];raw.teaching.state='complete';
  const restored={};restorePeerTeaching(restored,raw,d,{id:'mira',elapsed:63});
  assert.equal(restored.teaching.state,'complete');assert.equal(restored.status,'unverified');
  assert.equal(restored.cursor,2);
});
