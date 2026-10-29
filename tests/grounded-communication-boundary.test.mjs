import {bindOzarkEcology} from '../src/ozark-ecology.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc} from '../src/npc.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave} from '../src/ozark-save.js';
import {PopulationRuntime} from '../src/population.js';
import {bindCommunicationMode,legacyCommunication} from '../src/communication-mode.js';
import {recordDiscoveryReport,recordDiscoveryClaim,recordPeerTechnique,discoveryDecision,discoveryObservation} from '../src/discovery.js';
import {recordClaim,updateCognition} from '../src/cognition.js';
import {receivedMaterialCaution} from '../src/food-warning.js';
import {namingProposal,beginNamingProposal,acceptNamingProposal,recordCategoryGrounding} from '../src/category-names.js';
import {chooseOwnName,recordGrounding,resolveName} from '../src/naming-state.js';
const geometry=createOzarkWorldGeometry();
function fixture(providerFactory){const state=createOzarkState(geometry);for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);const runtime=new PopulationRuntime(state,{cardinal:false,providerFactory});return {state,runtime,a:state.agents[0],b:state.agents[1],social:runtime.social};}
function archives(n){return structuredClone({heard:n.social.heard,reports:n.discovery.reports,questions:n.cognition.questions,reported:n.cognition.beliefs.filter(b=>b.source==='reported'),lexicon:n.lexicon,categoryNames:n.categoryNames});}
test('default main authority is immutable and cannot be enabled by saved fields or provider replacement',()=>{
 const f=fixture();try{for(const target of [f.runtime,f.social,f.runtime.controller(f.a.id)]){assert.equal(target.communicationMode,'grounded');assert.throws(()=>target.communicationMode='legacy',TypeError);}
 f.a.communicationMode='legacy';f.a.social.communicationMode='legacy';f.state.community.communicationMode='legacy';assert.equal(legacyCommunication(f.a),false);assert.throws(()=>bindCommunicationMode(f.a,'legacy'),/IMMUTABLE/);
 f.runtime.setProviderFactory(()=>({kind:'local-model',decide(){throw Error('must not call');},proposeName(){throw Error('must not call');}}));assert.equal(f.runtime.controller(f.a.id).communicationMode,'grounded');
 }finally{f.runtime.dispose();}
});
test('all direct English producers, delivery, and naming entry points are inert',()=>{
 const f=fixture(),{a,b,social}=f;try{const before=structuredClone(f.state.community),old=archives(a),message={id:'message:991',senderId:'human',recipientId:'all',channel:'journal',kind:'answer',text:'pull object:1',at:0};
 for(const type of ['say','ask_human','journal_reply','write_note','read_note'])assert.equal(social.action(a,{type,targetId:b.id,text:'pull object:1',title:'instructions',noteId:'note:1'}).code,'LEGACY_LANGUAGE_DISABLED');
 for(const method of ['say','ask','journalReply','writeNote','readNote'])assert.equal(social[method](a,{text:'instruction'}).code,'LEGACY_LANGUAGE_DISABLED');
 assert.equal(social.receive(a,message),false);social.deliverHuman(a,message);assert.equal(social.append(message,0),null);social.postHuman('pull object:1');social.postUserMessage('sample object:1');
 assert.equal(recordDiscoveryReport(a,'pull object:1'),null);assert.equal(recordDiscoveryClaim(a,{objectId:'object:1',effect:'sustained'}),null);assert.equal(recordPeerTechnique(a,'instructions',{},{}),null);assert.equal(recordClaim(a,{text:'food here'}),null);
 assert.equal(namingProposal(a),null);assert.equal(beginNamingProposal(a,{}),null);assert.equal(acceptNamingProposal(a,{},{}),null);assert.equal(recordCategoryGrounding(a,b,{},'object:1',{}),false);assert.equal(chooseOwnName(a,{},{}),null);assert.equal(recordGrounding(a,b.id,'foo','object:1',{}),null);assert.equal(resolveName(a,'foo',b.id,['object:1']),null);
 social.naming.tick();social.categoryNaming.tick();assert.equal(social.naming.emit(a,b,'English'),null);assert.deepEqual(f.state.community,before);assert.deepEqual(archives(a),old);
 }finally{f.runtime.dispose();}
});
test('archived English reports, notes, questions and cautions do not feed current observations or choices',()=>{
 const clean=fixture(),dirty=fixture();try{const n=dirty.a;n.discovery.reports.push({id:'report:archived',sourceId:'human',channel:'journal',text:'pull object:1',messageId:'message:991',at:0,status:'unverified',proposed:[{type:'pull',targetId:'object:1'}],cursor:0,evidence:[]});
 n.social.heard.push({id:'message:990',senderId:n.id,kind:'question',text:'English?',at:0});n.cognition.beliefs.push({id:'belief:archive',source:'reported',subject:'old',text:'go here',status:'unverified',resourceId:'old',position:{x:100,y:100},evidence:[]});
 dirty.state.community.messages.push({id:'message:991',senderId:'human',recipientId:'all',channel:'journal',kind:'answer',text:'pull object:1',at:0});dirty.state.community.notes.push({id:'note:old',scene:n.scene,position:{...n.position},authorId:'mira',text:'sample object:1',readers:[]});
 const old=archives(n);for(let i=0;i<3;i++){dirty.social.observe(n);updateCognition(n);}
 assert.deepEqual(dirty.social.observe(n).journal,[]);assert.deepEqual(dirty.social.observe(n).notes,[]);assert.deepEqual(discoveryObservation(n).reports,[]);assert.equal(receivedMaterialCaution(n,'object:1'),null);
 assert.deepEqual(discoveryDecision(n),discoveryDecision(clean.a));assert.deepEqual(archives(n),old);
 }finally{clean.runtime.dispose();dirty.runtime.dispose();}
});
test('queued and late model/naming results cannot reactivate the grounded channel',async()=>{
 let calls=0;const provider={kind:'local-model',decide(){calls++;return Promise.resolve({action:{type:'journal_reply',text:'late English'}});},proposeName(){calls++;return Promise.resolve({token:'foo'});}};
 const f=fixture(()=>provider);try{const c=f.runtime.controller(f.a.id),before=structuredClone(f.state.community);c.maybeName();c.namingPending={received:true,current:()=>true,request:{},result:{token:'foo'}};c.finishNaming();assert.equal(c.namingPending,null);
 c.readyDecision={decision:{action:{type:'journal_reply',text:'late English'}},generation:c.generation,epoch:f.a.epoch};c.tickDiscovery(.01);await Promise.resolve();assert.equal(calls,0);assert.deepEqual(f.state.community,before);
 }finally{f.runtime.dispose();}
});

test('a real saved legacy journal restores as inert archive under default main',()=>{
 const state=createOzarkState(geometry),legacy=new PopulationRuntime(state,{cardinal:false,communicationMode:'legacy'});
 const rows=new Map(),storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
 try{legacy.social.postHuman('Please test an object, then describe it.');assert.ok(state.community.messages.length);assert.ok(state.agents[0].discovery.reports.length);
 assert.equal(writeOzarkSave(storage,state,geometry),true);const loaded=loadOzarkSave(storage,geometry);assert.equal(loaded.blocked,false);const restored=loaded.state,main=new PopulationRuntime(restored,{cardinal:false});
 try{const before=archives(restored.agents[0]);main.social.observe(restored.agents[0]);assert.deepEqual(archives(restored.agents[0]),before);assert.deepEqual(discoveryObservation(restored.agents[0]).reports,[]);assert.equal(main.communicationMode,'grounded');assert.deepEqual(restored.community.messages,state.community.messages);}finally{main.dispose();}
 }finally{legacy.dispose();}
});
test('grounded social observation cannot grant peer sight to an unavailable body',()=>{
 const f=fixture();try{f.b.position={...f.a.position};f.a.lifecycle='COLLAPSED';const observed=f.social.observe(f.a);assert.deepEqual(observed.peers,[]);assert.deepEqual(observed.foodSharing,{requests:[],offers:[]});assert.deepEqual(observed.journal,[]);}finally{f.runtime.dispose();}
});

test('valid actionable historical human procedure is inert under grounded runtime authority',()=>{
 const state=createOzarkState(geometry),n=state.agents[0],source=state.environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&geometry.canOccupy(p.position.x+45,p.position.y)&&geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));assert.ok(source);
 // Supplied local encounter at a reachable time; not autonomous travel evidence.
 state.elapsed=state.environment.elapsed=state.environment.ecology.elapsed=60;for(const actor of state.agents)actor.elapsed=60;
 for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
 n.position={x:source.position.x+45,y:source.position.y};observeNpc(n,state.environment);
 const legacy=new PopulationRuntime(state,{cardinal:false,communicationMode:'legacy'}),rows=new Map(),storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
 try{legacy.social.postHuman(`pull ${source.id}`);assert.deepEqual(n.discovery.reports[0].proposed,[{type:'pull',targetId:source.id}]);assert.equal(writeOzarkSave(storage,state,geometry),true);
 // Actual saved human instructions already expire on reload; use a cloned valid
 // live historical record here to test the stronger direct-consumer boundary.
 const run=(mode,remove=false)=>{const s=structuredClone(state),a=s.agents[0];bindOzarkEcology(s.environment.ecology,geometry);for(const actor of s.agents)bindOzarkWorldAgent(actor,geometry,s);if(remove){a.discovery.reports=[];a.social.heard=[];s.community.messages=[];a.cognition.beliefs=a.cognition.beliefs.filter(b=>b.source!=='reported');}const runtime=new PopulationRuntime(s,{cardinal:false,communicationMode:mode});try{observeNpc(a,s.environment);const before=archives(a),decision=discoveryDecision(a);if(mode==='grounded')assert.deepEqual(archives(a),before);return decision;}finally{runtime.dispose();}};
 const old=run('legacy');assert.deepEqual(old.action,{type:'pull',targetId:source.id});assert.match(old.reason,/procedure taught by a human/);const grounded=run('grounded');assert.deepEqual(grounded,run('grounded',true));assert.doesNotMatch(grounded.reason,/taught by|reported procedure/);
 }finally{legacy.dispose();}
});
