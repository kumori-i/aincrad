import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc } from '../src/npc.js';
import { namingProposal, beginNamingProposal, acceptNamingProposal, categoryLabels } from '../src/category-names.js';
import { visualSampleCurrent } from '../src/visual-group-memory.js';
const storage=()=>{const rows=new Map();return {getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};};

test('actual original three-tuft objects reuse a mocked word; exact optional saves roundtrip and corrupt data stays protected',()=>{
 const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),[actor]=state.agents,env=state.environment,disk=storage();
 actor.position={x:450,y:1000};for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
 for(const at of [60,61]){state.elapsed=env.elapsed=env.ecology.elapsed=at;for(const n of state.agents)n.elapsed=at;observeNpc(actor,env);}
 const ids=['object:675','object:669','object:672'];for(const id of ids)assert.deepEqual(Object.fromEntries(['shape','color','texture'].map(k=>[k,actor.discovery.observations[id].appearance[k]])),{shape:'tuft of narrow blades',color:'green',texture:'fibrous'});
 // Controlled mocking only: other actual observed cue proposals abstain. No
 // changed perception, engineered cue match, real model or autonomy claim.
 let accepted=false;
 for(let i=0;i<32;i++){const request=namingProposal(actor);if(!request)break;assert.ok(beginNamingProposal(actor,request));
  const target=request.example.cues.shape==='tuft of narrow blades'&&request.example.cues.color==='green'&&request.example.cues.texture==='fibrous';
  accepted=acceptNamingProposal(actor,request,{token:target?'velora':null,model:'explicit-mock-save-test'});if(accepted)break;
 }
 assert.equal(accepted,true);const label=categoryLabels(actor).find(r=>r.token==='velora');for(const id of ids)assert.ok(label.members.some(m=>m.objectId===id),id);
 const effects=structuredClone(state.agents.map(n=>({effects:n.discovery.effects,experiments:n.discovery.experiments,physiology:n.physiology})));
 assert.equal(writeOzarkSave(disk,state,geometry),true,state.saveError);const original=disk.getItem(OZARK_SAVE_KEY),saved=JSON.parse(original);
 const loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);assert.deepEqual(loaded.state.agents[0].categoryNames,actor.categoryNames);assert.equal(visualSampleCurrent(loaded.state.agents[0],ids[0]),false);
 assert.deepEqual(loaded.state.agents.map(n=>({effects:n.discovery.effects,experiments:n.discovery.experiments,physiology:n.physiology})),effects);
 for(const change of [s=>{s.agents[0].categoryNames.own[0].cues.color='red';const own=s.agents[0].categoryNames.own[0];s.agents[0].categoryNames.admissions.find(a=>a.at===own.requestAt&&a.example.objectId===own.example.objectId).cues.color='red';},s=>s.agents[0].categoryNames.extra=true,s=>s.agents[0].categoryNames.ownerId='mira',s=>s.agents[0].categoryNames.own[0].token='safe',s=>s.agents[0].categoryNames.own[0].model='\n',s=>s.agents[0].categoryNames.own[0].example.objectId='object:42',s=>s.agents[0].categoryNames.admissions=[],s=>s.agents[0].categoryNames.own[0].cues.material='grass',s=>s.agents[0].categoryNames.own[0].announcedTo=[{peerId:'mira',objectId:ids[0],event:{messageId:'message:1',at:61,scene:'valley',speakerPosition:{x:450,y:1000},listenerPosition:{x:450,y:1000},objectPosition:{x:450,y:1000}}}]]){
  const corrupt=structuredClone(saved);change(corrupt);const bytes=JSON.stringify(corrupt),testDisk=storage();testDisk.setItem(OZARK_SAVE_KEY,bytes);assert.equal(loadOzarkSave(testDisk,geometry).blocked,true);assert.equal(testDisk.getItem(OZARK_SAVE_KEY),bytes);
 }
 const old=structuredClone(saved);delete old.agents[0].categoryNames;const oldDisk=storage();oldDisk.setItem(OZARK_SAVE_KEY,JSON.stringify(old));const restored=loadOzarkSave(oldDisk,geometry);assert.equal(restored.blocked,false,restored.error);assert.equal(restored.state.agents[0].categoryNames,undefined);
});
