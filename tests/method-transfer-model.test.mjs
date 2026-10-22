import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import modelProvider from '../desktop/model-provider.cjs';
import { createNpc } from '../src/npc-state.js';
import { decisionObservation } from '../src/controller.js';

const clone=structuredClone;
const teaching=()=>({version:1,sourceObjectId:'object:10',senderTechniqueId:'technique:aster:1',
  acquisition:'pull',receivedAt:0,state:'ready',transfer:{version:1,observedAt:0,
    cues:{shape:'branching trunk with a leafy crown',color:'brown and green',texture:'rough bark'},targetObjectId:'object:20'}});
function fixture(){
  const raw=decisionObservation(createNpc({id:'mira',mode:'discovery'}));
  raw.discovery.reports=[{id:'report:mira:1',sourceId:'aster',channel:'peer',messageId:'message:1',at:0,
    text:'A reported method, not proof.',status:'unverified',proposed:[],cursor:0,evidence:[],teaching:teaching()}];
  return raw;
}
test('model bridge preserves bounded local-match testimony without granting action authority',()=>{
  const raw=fixture();assert.deepEqual(modelProvider.validateObservation(raw).discovery.reports,raw.discovery.reports);
  for(const action of [{type:'pull',targetId:'object:20'},{type:'say',targetId:'aster',text:'Try this method.'}])
    assert.throws(()=>modelProvider.parseDecision(JSON.stringify({action,reason:'Reported method'}),{mode:'discovery'}));
});
test('model bridge rejects nested, hidden, oversized and executable transfer fields',()=>{
  const edits=[
    t=>t.transfer=null,t=>t.transfer.version=2,t=>t.transfer.observedAt=-1,t=>t.transfer.observedAt=1e11,
    t=>t.transfer.observedAt={value:0},t=>t.transfer.targetObjectId=t.sourceObjectId,
    t=>t.transfer.targetObjectId={id:'object:20'},t=>t.transfer.targetObjectId='object:0',
    t=>t.transfer.cues.shape={code:'run'},t=>t.transfer.cues.color='',t=>t.transfer.cues.color='   ',
    t=>t.transfer.cues.texture='x'.repeat(101),t=>t.transfer.cues.shape='rough\ntrunk',
    t=>delete t.transfer.cues.texture,t=>t.transfer.cues.extra='arbitrary',
    t=>t.transfer.execute='shell',t=>t.transfer.position={x:1,y:2},
    t=>t.transfer.species='apple_tree',t=>t.transfer.cues.edible=true,
    t=>t.acquisition='strike',t=>t.lastCode={nested:'payload'},t=>t.senderTechniqueId={nested:'payload'},
    t=>t.receivedAt={nested:'payload'},t=>t.state='verified',t=>t.execute='shell',
  ];
  for(const edit of edits){const raw=fixture();edit(raw.discovery.reports[0].teaching);assert.throws(()=>modelProvider.validateObservation(raw),undefined,String(edit));}
});
test('nearby speech carries cues, never a remotely assigned receiver target',()=>{
  const raw=fixture(),speech=clone(raw.discovery.reports[0].teaching);delete speech.transfer.targetObjectId;
  raw.social.nearbyMessages=[{senderId:'aster',recipientId:'mira',channel:'peer',text:'Reported appearance',teaching:speech}];
  assert.doesNotThrow(()=>modelProvider.validateObservation(raw));
  const relayed=clone(raw);relayed.discovery.reports[0].sourceId='unknown';assert.throws(()=>modelProvider.validateObservation(relayed),/provenance/);
  const journal=clone(raw);journal.social.nearbyMessages[0].channel='journal';assert.throws(()=>modelProvider.validateObservation(journal),/provenance/);
  raw.social.nearbyMessages[0].teaching.transfer.targetObjectId='object:20';
  assert.throws(()=>modelProvider.validateObservation(raw),/appearance-based teaching/);
  delete raw.social.nearbyMessages[0].teaching.transfer.targetObjectId;
  raw.social.nearbyMessages=Array(7).fill(raw.social.nearbyMessages[0]);
  assert.throws(()=>modelProvider.validateObservation(raw),/nearbyMessages/);
});
test('knowledge presentation distinguishes heard appearance match and personal outcomes',()=>{
  const source=readFileSync(new URL('../src/npc-panel.js',import.meta.url),'utf8');
  for(const phrase of ['Heard appearance-based trial','teacher source','my locally observed candidate','Similar appearance does not establish safety or benefit','later bodily feedback'])assert.ok(source.includes(phrase));
});
