import test from 'node:test';
import assert from 'node:assert/strict';
import {beginSurvivalDecision as begin,noteSurvivalDecision as note,noteCurrentSurvivalDecision as current,finishSurvivalDecision as finish,closeSurvivalDecision as close,survivalDecisionSnapshot as snapshot,SURVIVAL_DECISION_LIMITS as L} from '../src/survival-decision-observer.js';
function actor(){return {epoch:1,elapsed:10,discovery:{},physiology:{profile:'human',satietyHours:4,availableEnergyKcal:700,storedEnergyKcal:84000,health:99,totals:{ingestedKcal:95,absorbedKcal:40,metabolizedKcal:80}},stats:{independentMeals:3,independentDrinks:2}};}
const chosen={action:{type:'move',target:{x:2,y:3}},need:'food'};
function selected(a){const t=begin(a,{hunger:'hungry'});note(t,'visit:urgent-food');finish(t,{type:'sample'},chosen,'food');close(t);return t;}
test('records requested and actual recovery output, copied sensations and modeled satiety without policy mutation',()=>{
 const a=actor(),before=structuredClone(a),result=structuredClone(chosen),body={hunger:'hungry',digestion:'empty',bogus:'secret'};
 const t=begin(a,body);body.hunger='content';note(t,'visit:urgent-food');note(t,'enter:urgent-food');note(t,'food:urgent-candidates',2);finish(t,{type:'sample'},result,'food');
 const s=snapshot(a),r=s.records[0];assert.equal(r.requestedType,'sample');assert.equal(r.actualType,'move');assert.equal(r.requestedNeed,'food');assert.equal(r.actualNeed,'food');assert.equal(r.body.qualitative.hunger,'hungry');assert.equal(r.body.qualitative.bogus,undefined);assert.equal(r.phases.urgentFood,'entered');assert.equal(r.phases.ordinaryFood,'not-visited');assert.equal(s.body.satietyMaximumHours,6);assert.equal(s.body.satietyPercent,4/6*100);assert.equal(s.body.foodFeedbackEvents,3);assert.equal(s.body.hoursSinceMeal,undefined);assert.deepEqual(a,before);assert.deepEqual(result,chosen);
});
test('retains at most 64 records and 32 notes with explicit dropped and evicted counters',()=>{
 const a=actor();for(let i=0;i<70;i++){const t=begin(a,{});for(let j=0;j<40;j++)note(t,'sample:eligible');close(t);}
 const s=snapshot(a);assert.equal(s.records.length,64);assert.equal(s.records[0].sequence,7);assert.equal(s.counters.evictedRecords,6);assert.equal(s.counters.droppedNotes,560);assert.equal(s.counters.incomplete,70);assert.equal(s.gateCounts['sample:eligible'],2800);assert.ok(s.records.every(r=>r.notes.length===32));
});
test('fixed count counters saturate, reject arbitrary notes and never retain their payloads',()=>{
 const a=actor(),t=begin(a,{});note(t,'food:urgent-candidates',L.counter);note(t,'food:urgent-candidates',100);note(t,'unbounded-secret');note(t,'sample:eligible',Infinity);note(t,'sample:eligible',-1);note(t,'sample:eligible',{});note(t,'sample:eligible',0);close(t);const s=snapshot(a);assert.equal(s.gateCounts['food:urgent-candidates'],L.counter);assert.equal(s.counters.rejectedNotes,4);assert.equal(s.records[0].notes.length,3);assert.equal(JSON.stringify(s).includes('unbounded-secret'),false);
});
test('nested scope supersedes prior scope; stale, forged and outside-decision notes cannot attach',()=>{
 const a=actor(),first=begin(a,{});note(first,'visit:urgent-food');const second=begin(a,{});note(first,'enter:urgent-food');finish(first,{type:'sample'},chosen,'food');note({},'sample:eligible');current(a,'visit:ordinary-food');finish(second,{type:'wait'},chosen,'understanding');const before=snapshot(a);current(a,'sample:eligible');close(first);close(second);finish(second,{},chosen);assert.deepEqual(snapshot(a),before);assert.equal(before.counters.superseded,1);assert.deepEqual(before.records.map(r=>r.status),['superseded','selected']);assert.equal(before.records[0].notes.length,1);assert.equal(before.records[1].phases.ordinaryFood,'visited');
});
test('epoch/collapse changes retain tagged history while discovery, physiology and whole actors start fresh',()=>{
 const a=actor();selected(a);a.epoch++;a.lifecycle='COLLAPSED';selected(a);assert.deepEqual(snapshot(a).records.map(r=>r.epoch),[1,2]);const t=begin(a,{});a.discovery={};assert.equal(snapshot(a).records.length,0);note(t,'sample:eligible');close(t);selected(a);assert.equal(snapshot(a).counters.begun,1);a.physiology=structuredClone(a.physiology);assert.equal(snapshot(a).records.length,0);selected(a);assert.equal(snapshot(a).counters.begun,1);assert.equal(snapshot(structuredClone(a)).records.length,0);
});
test('snapshot is copied and does not mutate active scopes, notes, body, or counters',()=>{
 const a=actor();selected(a);const before=snapshot(a),s=snapshot(a);s.records[0].body.qualitative.hunger='other';s.records[0].notes[0].count=100;s.gateCounts['visit:urgent-food']=999;s.body.health=0;s.counters.begun=99;assert.deepEqual(snapshot(a),before);const t=begin(a,{}),active=snapshot(a);snapshot(a);assert.deepEqual(snapshot(a),active);close(t);
});
test('accessor fields are never invoked in actor, body, action, result, nested totals and stats',()=>{
 let calls=0;const getter=()=>{calls++;throw Error('must not read');};const a=actor();Object.defineProperty(a,'elapsed',{get:getter});Object.defineProperty(a.physiology,'satietyHours',{get:getter});Object.defineProperty(a.physiology.totals,'ingestedKcal',{get:getter});Object.defineProperty(a.stats,'independentMeals',{get:getter});const body={};Object.defineProperty(body,'hunger',{get:getter});const request={};Object.defineProperty(request,'type',{get:getter});const result={};Object.defineProperty(result,'action',{get:getter});Object.defineProperty(result,'need',{get:getter});const t=begin(a,body);finish(t,request,result,'food');const s=snapshot(a);assert.equal(calls,0);assert.equal(s.body.satietyHours,null);assert.equal(s.body.ingestedKcal,null);assert.equal(s.records[0].at,null);assert.equal(s.records[0].body.qualitative.hunger,null);assert.equal(s.records[0].actualType,null);const b=actor();Object.defineProperty(b,'discovery',{get:getter});assert.equal(begin(b,{}),null);assert.equal(calls,0);
});
test('malformed, nonplain, proxy exceptions and unknown fields fail closed without throwing',()=>{
 const badProxy=new Proxy({}, {getPrototypeOf(){throw Error('bad proxy');}});for(const value of [null,undefined,3,'actor',[],()=>{},new Date(),badProxy]){assert.doesNotThrow(()=>{begin(value,value);note(value,value,value);current(value,value,value);finish(value,value,value,value);close(value);snapshot(value);});}const a=actor(),t=begin(a,{});finish(t,{type:'secret'}, {action:{type:'secret'},need:'secret'},'secret');assert.equal(snapshot(a).records[0].actualType,null);assert.equal(snapshot(a).records[0].actualNeed,null);assert.equal(snapshot(a).records[0].requestedNeed,null);
});
test('body is a live read-only projection, not gut fullness or last-swallow time; nonhuman satiety is unavailable',()=>{
 const a=actor();selected(a);a.physiology.satietyHours=0;a.physiology.availableEnergyKcal=420;a.physiology.hoursSinceMeal=10;const s=snapshot(a);assert.equal(s.body.satietyPercent,0);assert.equal(s.body.availableEnergyKcal,420);assert.equal(s.body.storedEnergyKcal,84000);assert.equal(s.records[0].body.satietyHours,4);a.physiology.profile='rabbit';assert.equal(snapshot(a).body.satietyHours,null);assert.equal(snapshot(a).body.satietyMaximumHours,null);
});

test('invalid intermediate identities retire tokens and history rather than revive on restoration',()=>{
 const a=actor();selected(a);const original=a.discovery,t=begin(a,{});a.discovery=null;assert.equal(snapshot(a).active,false);a.discovery=original;note(t,'sample:eligible');finish(t,{type:'sample'},chosen,'food');assert.equal(snapshot(a).records.length,0);assert.equal(snapshot(a).active,false);selected(a);assert.equal(snapshot(a).counters.begun,1);
});
