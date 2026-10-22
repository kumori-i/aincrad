import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, writeOzarkSave, loadOzarkSave, OZARK_SAVE_KEY } from '../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../src/ozark-agent-world.js';
import { observeNpc, requestNpcAction, tickNpc } from '../src/npc.js';
import { discoveryDecision, freshMethodAppearance, rememberDirectDiscoveryObject } from '../src/discovery.js';
import { handlingInquiries, handlingExperiment, recordHandlingOutcome, retireHandlingInquiries, validHandlingInquiries, HANDLING_ADMISSION_LIMIT, HANDLING_QUESTION_LIMIT } from '../src/handling-inquiry.js';
import { bodySignals } from '../src/interoception.js';
import { recordEvent } from '../src/npc-events.js';
import { retainedProofIntegrityError } from '../src/proof-retention.js';
const geometry=createOzarkWorldGeometry(),clone=structuredClone;
function pair(state){
  const plants=state.environment.ecology.plants.filter(p=>p.kind==='apple_tree'&&p.quantity>2);
  for(const source of plants)for(const target of plants){
    const distance=Math.hypot(source.position.x-target.position.x,source.position.y-target.position.y);
    const a={x:source.position.x+45,y:source.position.y},b={x:target.position.x+45,y:target.position.y};
    if(distance>120&&distance<260&&[a,b].every(p=>geometry.canOccupy(p.x,p.y,CONFIG.playerRadius))&&geometry.lineOfSight(b,source.position)&&geometry.lineOfSight(b,target.position)&&geometry.lineOfSight(a,source.position))return {source,target};
  }
  assert.fail('Distinct real source encounter missing');
}
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
function fixture({train=true,fail=true}={}){
  let visible=true;
  const g=Object.freeze({...geometry,lineOfSight:(...args)=>visible&&geometry.lineOfSight(...args)});
  const state=createOzarkState(g),[a,b]=state.agents,e=state.environment,{source,target}=pair(state);
  state.elapsed=e.elapsed=e.ecology.elapsed=60;
  for(const n of [a,b]){n.elapsed=60;bindOzarkWorldAgent(n,g,state);}
  const advance=seconds=>{for(let t=0;t<seconds-1e-8;t+=.1){e.elapsed+=.1;state.elapsed=e.elapsed;e.ecology.elapsed=e.elapsed;for(const n of state.agents)tickNpc(n,.1,e);}};
  const finish=(n,action)=>{const r=requestNpcAction(n,action,e);if(r.code==='ACTION_STARTED')for(let i=0;n.active&&i<100;i++)advance(.1);return r.code==='ACTION_STARTED'?n.lastResult:r;};
  a.position={x:source.position.x+45,y:source.position.y};observeNpc(a,e);
  if(train)assert.equal(finish(a,{type:'pull',targetId:source.id}).code,'piece_detached');
  a.position={x:target.position.x+45,y:target.position.y};observeNpc(a,e);
  assert.ok(freshMethodAppearance(a,source.id));assert.ok(freshMethodAppearance(a,target.id));
  if(fail)assert.equal(finish(a,{type:'grasp',targetId:target.id}).code,'object_still_attached');
  return {state,a,b,e,source,target,advance,finish,setVisible:v=>visible=v};
}
function selector(n,overrides={}){return handlingExperiment(n,{body:bodySignals(n),appearance:id=>freshMethodAppearance(n,id),local:id=>!!freshMethodAppearance(n,id)&&Math.hypot(n.position.x-n.discovery.observations[id].position.x,n.position.y-n.discovery.observations[id].position.y)<=80,blocked:()=>false,...overrides});}

test('own failed paid grasp motivates one different-source pull through ordinary controller, not automatic sampling',()=>{
  const f=fixture(),{a,target}=f,q=a.discovery.handlingQuestions[0];assert.ok(q);
  assert.equal(q.actorId,a.id);assert.equal(q.priorSourceId,f.source.id);assert.equal(q.sourceId,target.id);
  assert.deepEqual(a.discovery.effects,[]);assert.deepEqual(a.discovery.techniques,[]);assert.deepEqual(a.discovery.inquiries,[]);
  assert.equal(validHandlingInquiries(a.discovery,a),true);
  const before={at:a.elapsed,cost:a.physiology.totals.metabolizedKcal,quantity:target.quantity,items:a.inventory.items.length};
  const decision=discoveryDecision(a);assert.deepEqual(decision.action,{type:'pull',targetId:target.id});assert.match(decision.reason,/Could pulling work here/);
  assert.equal(q.state,'attempting');assert.equal(selector(a),null);
  assert.equal(f.finish(a,decision.action).code,'piece_detached');
  assert.ok(a.elapsed>before.at+4.8);assert.ok(a.physiology.totals.metabolizedKcal>before.cost);assert.equal(target.quantity,before.quantity-1);assert.equal(a.inventory.items.length,before.items+1);
  assert.equal(handlingInquiries(a)[0].status,'detached');assert.equal(selector(a),null);
  assert.equal(a.discovery.experiments.some(e=>e.primitive==='sample'),false);assert.deepEqual(a.discovery.effects,[]);assert.deepEqual(a.discovery.techniques,[]);
  f.finish(a,{type:'grasp',targetId:target.id});assert.equal(a.discovery.handlingAdmissions.length,1);assert.equal(selector(a),null);
  assert.equal(retainedProofIntegrityError(a),null);
});

test('matched selector-only ablation reports actual choice and cost without forcing control failure',t=>{
  const results=[];let before;
  for(const enabled of [false,true]){
    const f=fixture(),snapshot=clone({npc:f.a,source:f.source,target:f.target});
    if(before)assert.deepEqual(snapshot,before);else before=snapshot;
    const cost=f.a.physiology.totals.metabolizedKcal,at=f.a.elapsed,quantity=f.target.quantity;
    const decision=discoveryDecision(f.a,{handlingCuriosity:enabled});const result=f.finish(f.a,decision.action);
    results.push({enabled,action:decision.action,code:result.code,elapsed:f.a.elapsed-at,cost:f.a.physiology.totals.metabolizedKcal-cost,sourceReduction:quantity-f.target.quantity});
    if(enabled)assert.deepEqual(decision.action,{type:'pull',targetId:f.target.id});
    else assert.doesNotMatch(decision.reason,/Could pulling work here/);
  }
  t.diagnostic(JSON.stringify(results));
});

test('no success, testimony or forged/missing own physical receipt cannot admit a question',()=>{
  const none=fixture({train:false});assert.deepEqual(none.a.discovery.handlingQuestions,[]);
  for(const scenario of ['missing','false-success','missing-handling','wrong-source','foreign','testimony']){
    const f=fixture({fail:false}),n=f.a,e=n.discovery.experiments[0],r=n.memory.experience.find(r=>r.id===e.actionId);
    if(scenario==='missing')n.memory.experience=n.memory.experience.filter(x=>x!==r);
    if(scenario==='false-success')e.ok=false;
    if(scenario==='missing-handling')delete r.details.result.handling;
    if(scenario==='wrong-source')r.details.action.targetId=f.target.id;
    if(scenario==='foreign'){n.discovery.experiments=[];f.b.discovery.experiments=[e];f.b.memory.experience.push(r);}
    if(scenario==='testimony'){n.discovery.experiments=[];n.discovery.reports.push({sourceId:'mira',text:'Pulling worked.',status:'unverified',proposed:[],cursor:0,evidence:[]});}
    f.finish(n,{type:'grasp',targetId:f.target.id});assert.equal(n.discovery.handlingQuestions.length,0,scenario);
  }
});

test('only completed physical grasp failures admit, not command/capacity/access/interruption rejection',()=>{
  for(const code of ['HANDS_FULL','OUT_OF_REACH','INTERACTION_BLOCKED','PRIORITY_CHANGED','OBJECT_GONE','ACTION_TIMEOUT','NOT_HELD']){
    const f=fixture({fail:false}),n=f.a;
    const event={id:n.memory.nextId++,at:n.elapsed,type:'action',details:{action:{type:'grasp',targetId:f.target.id},result:{ok:false,code,durationSeconds:2.5,handling:{source:'experienced',activeActionSeconds:2.5,effort:'rising'}}}};
    n.memory.experience.push(event);const e={id:n.discovery.nextId++,actionId:event.id,at:n.elapsed,primitive:'grasp',targetId:f.target.id,ok:false,code,durationSeconds:2.5};n.discovery.experiments.push(e);
    recordHandlingOutcome(n,e,{appearance:id=>freshMethodAppearance(n,id)});assert.equal(n.discovery.handlingQuestions.length,0,code);
  }
});

test('fresh local matching sights and bodily care gate an existing question without remote approach',()=>{
  for(const scenario of ['stale','occluded','nonmatching','range','prior-gone','fullhands','pain','depleted','exhausted','urgent-hunger','adverse','attempted','differentactor']){
    const f=fixture(),n=f.a;
    if(scenario==='stale')f.advance(9);
    if(scenario==='occluded')f.setVisible(false);
    if(scenario==='nonmatching')n.discovery.observations[f.target.id].appearance.color='different';
    if(scenario==='range')n.position.x+=100;
    if(scenario==='prior-gone')delete n.discovery.observations[f.source.id];
    if(scenario==='fullhands')n.inventory.items=['object:900001','object:900002','object:900003','object:900004'];
    if(scenario==='adverse')n.discovery.effects.push({objectId:f.target.id,effect:'discomfort'});
    if(scenario==='attempted')n.discovery.handlingQuestions[0].state='attempting';
    if(scenario==='differentactor'){n.id='mira';assert.equal(validHandlingInquiries(n.discovery,n),false);continue;}
    const body=bodySignals(n);if(scenario==='pain')body.pain='aching';if(scenario==='depleted')body.energy='depleted';if(scenario==='exhausted')body.stamina='exhausted';if(scenario==='urgent-hunger')body.hunger='ravenous';
    assert.equal(selector(n,{body}),null,scenario);
  }
});

test('pending, completed, selected and physically interrupted saves preserve one-shot semantics and current corrupt bytes',()=>{
  for(const state of ['pending','completed','selected','active']){
    const f=fixture(),disk=storage(),n=f.a;
    if(state!=='pending'){const action=discoveryDecision(n).action;if(state==='completed')f.finish(n,action);if(state==='active'){requestNpcAction(n,action,f.e);f.advance(.5);}}
    const cost=n.physiology.totals.metabolizedKcal,quantity=f.target.quantity;
    assert.equal(writeOzarkSave(disk,f.state,geometry),true,`${state}: ${f.state.saveError}`);
    const bytes=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);
    const resumed=loaded.state.agents[0];assert.equal(resumed.physiology.totals.metabolizedKcal,cost);assert.equal(loaded.state.environment.ecology.plants.find(p=>p.id===f.target.id).quantity,quantity);
    assert.equal(resumed.active,null);assert.equal(selector(resumed),null,'save cannot restore fresh sensory receipt');
    assert.equal(handlingInquiries(resumed)[0].status,state==='completed'?'detached':state==='pending'?'uncertain':'unavailable');
    const rearms=state==='completed'?[d=>{d.handlingQuestions[0].state='pending';d.handlingQuestions[0].attemptId=null;}]:[];
    for(const mutate of [...rearms,d=>d.handlingAdmissions.push(d.handlingAdmissions[0]),d=>d.handlingQuestions[0].extra=true,d=>d.handlingQuestions[0].failedId=99999,d=>d.handlingQuestions[0].priorId=d.handlingQuestions[0].failedId,d=>d.handlingQuestions[0].actorId='mira',d=>d.handlingQuestions[0].priorSourceId=f.target.id,d=>d.handlingQuestions[0].at=n.elapsed+1,d=>d.handlingQuestions[0].cues.edible=true,d=>delete d.handlingAdmissions]){
      const raw=JSON.parse(bytes);mutate(raw.agents[0].discovery);const bad=JSON.stringify(raw);disk.setItem(OZARK_SAVE_KEY,bad);assert.equal(loadOzarkSave(disk,geometry).blocked,true,String(mutate));assert.equal(disk.getItem(OZARK_SAVE_KEY),bad);
    }
    if(state==='active'||state==='selected'){
      const resumedState=loaded.state,env=resumedState.environment;bindOzarkWorldAgent(resumed,geometry,resumedState);observeNpc(resumed,env);
      assert.equal(requestNpcAction(resumed,{type:'pull',targetId:f.target.id},env).code,'ACTION_STARTED');
      for(let i=0;resumed.active&&i<100;i++){env.elapsed+=.1;env.ecology.elapsed=env.elapsed;resumedState.elapsed=env.elapsed;for(const actor of resumedState.agents)tickNpc(actor,.1,env);}
      assert.equal(resumed.lastResult.code,'piece_detached');assert.equal(handlingInquiries(resumed)[0].status,'unavailable');
      disk.setItem(OZARK_SAVE_KEY,bytes);assert.equal(writeOzarkSave(disk,resumedState,geometry),true,'later ordinary work after terminal interruption remains saveable');
    }
  }
});

test('proof compaction retires optional detail without immortal pins or refreshed admissions',()=>{
  const f=fixture(),n=f.a,prior=n.discovery.handlingQuestions[0].priorId;
  // Ordinary unrelated records eventually age out optional motor proof. No
  // mandatory owner is introduced merely to preserve this question forever.
  for(let i=0;i<170;i++)f.finish(n,{type:'inspect_object',targetId:f.target.id});
  for(let i=0;i<410;i++)recordEvent(n,'debug',{message:'bounded unrelated event'});
  assert.ok(!n.discovery.experiments.some(e=>e.id===prior)||n.discovery.handlingQuestions[0].state==='retired');
  assert.equal(n.discovery.handlingQuestions[0].state,'retired');assert.equal(validHandlingInquiries(n.discovery,n),true);
  assert.deepEqual(n.discovery.handlingAdmissions,[f.target.id]);
  const disk=storage();assert.equal(writeOzarkSave(disk,f.state,geometry),true);assert.equal(loadOzarkSave(disk,geometry).blocked,false);
  f.finish(n,{type:'grasp',targetId:f.target.id});assert.equal(n.discovery.handlingQuestions.length,1);assert.equal(selector(n),null);
});

test('non-evicting admissions and detail limits fail closed on duplicates, saturation and evidence retirement',()=>{
  const f=fixture(),n=f.a,q=clone(n.discovery.handlingQuestions[0]);
  const copy=clone(n);copy.discovery.experiments=[];retireHandlingInquiries(copy);assert.equal(copy.discovery.handlingQuestions[0].state,'retired');assert.equal(selector(copy),null);
  n.discovery.handlingAdmissions=Array.from({length:HANDLING_ADMISSION_LIMIT},(_,i)=>`object:${900000+i}`);
  n.discovery.handlingQuestions=[];assert.equal(validHandlingInquiries(n.discovery,n),true);
  const e=n.discovery.experiments.find(e=>e.id===q.failedId);recordHandlingOutcome(n,e,{appearance:id=>freshMethodAppearance(n,id)});assert.equal(n.discovery.handlingQuestions.length,0);assert.equal(n.discovery.handlingAdmissions.length,64);
  n.discovery.handlingQuestions=Array.from({length:HANDLING_QUESTION_LIMIT+1},()=>q);assert.equal(validHandlingInquiries(n.discovery,n),false);
});


test('admission needs both fresh matching firsthand appearances, never saved descriptions alone',()=>{
  for(const scenario of ['nonmatching','prior-stale','target-stale','missing','occluded']){
    const f=fixture({fail:false}),n=f.a;
    if(scenario==='nonmatching')n.discovery.observations[f.source.id].appearance.color='different';
    if(scenario==='missing')delete n.discovery.observations[f.source.id];
    if(scenario==='prior-stale'){f.advance(9);rememberDirectDiscoveryObject(n,n.discovery.observations[f.target.id]);}
    if(scenario==='target-stale'){f.advance(9);rememberDirectDiscoveryObject(n,n.discovery.observations[f.source.id]);}
    if(scenario==='occluded')f.setVisible(false);
    f.finish(n,{type:'grasp',targetId:f.target.id});assert.deepEqual(n.discovery.handlingQuestions,[],scenario);
  }
});

test('same visible cues do not reveal depleted stock: paid pull reports no detachment, not a causal or food conclusion',()=>{
  const f=fixture(),n=f.a;f.target.quantity=0;
  const choice=discoveryDecision(n);assert.deepEqual(choice.action,{type:'pull',targetId:f.target.id});
  const before=n.physiology.totals.metabolizedKcal;assert.equal(f.finish(n,choice.action).code,'nothing_detached');
  assert.ok(n.physiology.totals.metabolizedKcal>before);assert.equal(handlingInquiries(n)[0].status,'did-not-detach');
  assert.equal(selector(n),null);assert.deepEqual(n.discovery.effects,[]);assert.deepEqual(n.discovery.techniques,[]);
});

test('old schema-12 saves without optional handling fields remain valid and cannot manufacture history',()=>{
  const f=fixture(),disk=storage();assert.equal(writeOzarkSave(disk,f.state,geometry),true);
  const raw=JSON.parse(disk.getItem(OZARK_SAVE_KEY));for(const n of raw.agents){delete n.discovery.handlingAdmissions;delete n.discovery.handlingQuestions;}
  disk.setItem(OZARK_SAVE_KEY,JSON.stringify(raw));const loaded=loadOzarkSave(disk,geometry);assert.equal(loaded.blocked,false,loaded.error);
  assert.deepEqual(loaded.state.agents[0].discovery.handlingQuestions,[]);
});


test('an already personally attempted pull is not presented as an untested alternate operation',()=>{
  for(const depleted of [false,true]){
    const f=fixture({fail:false});if(depleted)f.target.quantity=0;
    f.finish(f.a,{type:'pull',targetId:f.target.id});observeNpc(f.a,f.e);
    f.finish(f.a,{type:'grasp',targetId:f.target.id});assert.deepEqual(f.a.discovery.handlingQuestions,[]);
  }
});
