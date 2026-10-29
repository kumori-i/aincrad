const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestVisualSamples } from '../src/visual-group-memory.js';
import { namingProposal, beginNamingProposal, acceptNamingProposal, categoryLabels, objectName, namedObject, resolveCategoryName, validCategoryNames, recordCategoryGrounding, validCategoryCorrespondence, CATEGORY_ATTEMPT_LIMIT } from '../src/category-names.js';
const cues = {shape:'tuft · narrow blades', color:'green', texture:'fibrous'};
const make = (id='aster') => legacyFixture({id, seed:42, rng:99, mode:'discovery', learning:true, lifecycle:'AWAKE', elapsed:0, scene:'valley',position:{x:0,y:0},discovery:{observations:{},effects:[],experiments:[],techniques:[]},memory:{experience:[]},social:{heard:[]},inventory:{items:[]}});
const object = (id=675, appearance=cues) => ({id:`object:${id}`,scene:'valley',position:{x:20,y:0},appearance});
const sample = (n,at,objects=[object()]) => {n.elapsed=at;ingestVisualSamples(n,objects);};
function propose(n, token='velora') {const request=namingProposal(n);assert.ok(request);assert.equal(beginNamingProposal(n,request),true);assert.equal(acceptNamingProposal(n,request,{token,model:'mock-only:not-real-inference'}),true);return request;}
const effectState = n => historicalClone({effects:n.discovery.effects,experiments:n.discovery.experiments,techniques:n.discovery.techniques,inventory:n.inventory,rng:n.rng,memory:n.memory});
const event = (num=1,at=1) => ({messageId:`message:${num}`,at,scene:'valley',speakerPosition:{x:0,y:0},listenerPosition:{x:0,y:0},objectPosition:{x:20,y:0}});

test('mock model token is reused for three separately observed tufts without changing safety or exact identities',()=>{
 const n=make(), objects=[object(675),object(669),object(672)];sample(n,0,objects);assert.equal(namingProposal(n),null);sample(n,1,objects);
 const before=effectState(n), request=propose(n);assert.deepEqual(Object.keys(request),['version','agentId','observedAt','example','lexicon','individualNames']);
 assert.deepEqual(categoryLabels(n)[0].members.map(m=>m.objectId).sort(),['object:669','object:672','object:675']);
 for(const o of objects){assert.equal(objectName(n,o.id).token,'velora');assert.equal(namedObject(n,o.id),`“velora” (${o.id})`);}
 assert.deepEqual(effectState(n),before);assert.equal(namingProposal(n),null);assert.equal(n.categoryNames.own.length,1);
 assert.equal(resolveCategoryName(n,'velora','aster',objects),null,'a category does not select one of several individuals');
 assert.equal(resolveCategoryName(n,'velora','aster',[objects[0]]),'object:675');
});
test('appearance change, missing cues and one-sighting replacement withdraw membership, not historical evidence',()=>{
 const n=make();sample(n,0);sample(n,1);propose(n);const historical=historicalClone(n.categoryNames);
 sample(n,2,[object(675,{...cues,color:'brown'}),object(900)]);assert.equal(objectName(n,'object:675'),null);assert.equal(objectName(n,'object:900'),null);
 assert.deepEqual(n.categoryNames,historical);sample(n,3,[object(675,{...cues,color:'brown'}),object(900)]);
 assert.equal(objectName(n,'object:900').token,'velora');assert.notEqual(namingProposal(n)?.example.cues.color,'green');
 sample(n,4,[object(900,{shape:cues.shape,color:cues.color})]);assert.equal(objectName(n,'object:900'),null);
 assert.equal(n.categoryNames.own[0].example.objectId,'object:675');
});
test('detached piece, carcass and offspring IDs inherit neither identity nor name from an unseen origin',()=>{
 const n=make();sample(n,0);sample(n,1);propose(n);
 for(const id of ['object:901','object:902','object:903'])assert.equal(objectName(n,id),null);
 sample(n,2,[object(901,{shape:'soft piece',color:'pale',texture:'moist'}),object(902,{shape:'still body',color:'brown',texture:'furry'}),object(903)]);
 for(const id of ['object:901','object:902','object:903'])assert.equal(objectName(n,id),null);
 assert.deepEqual(n.discovery.effects,[]);
});
test('only live admitted requests can apply; changed-away-and-back, copied request, reload and duplicate replies fail',()=>{
 for(const alteration of ['changed','copy','reload','duplicate','age']){
  const n=make();sample(n,0);sample(n,1);const request=namingProposal(n);beginNamingProposal(n,request);
  let target=n,r=request;
  if(alteration==='changed'){sample(n,2,[object(675,{...cues,color:'brown'})]);sample(n,3);sample(n,4);}
  if(alteration==='copy')r=historicalClone(request);
  if(alteration==='reload'){target=historicalClone(n);sample(target,2);}
  if(alteration==='duplicate')assert.equal(acceptNamingProposal(n,request,{token:'velora',model:'mock'}),true);
  if(alteration==='age')sample(n,62);
  assert.equal(acceptNamingProposal(target,r,{token:'velora',model:'mock'}),false,alteration);
 }
});
test('invalid/abstaining model proposals cannot mutate labels; admissions prevent repeat requests even after restore',()=>{
 for(const response of [{token:null,model:'mock'},{token:'safe',model:'mock'},{token:'fish',model:'mock'},{token:'velora',model:'mock',action:'eat'},{token:'velora',model:''},{token:'velora',model:'a\nb'}]){
  const n=make();sample(n,0);sample(n,1);const r=namingProposal(n);beginNamingProposal(n,r);assert.equal(acceptNamingProposal(n,r,response),false);assert.equal(n.categoryNames.own.length,0);assert.equal(namingProposal(n),null);
  const reopened=historicalClone(n);sample(reopened,2);assert.equal(namingProposal(reopened),null);
 }
});
test('existing attributed private vocabulary is supplied, not another agent dictionary or engine metadata',()=>{
 const n=make();n.hiddenSpecies='cattail';sample(n,0);sample(n,1);propose(n);
 sample(n,2,[object(999,{shape:'rounded',color:'grey',texture:'rough'})]);sample(n,3,[object(999,{shape:'rounded',color:'grey',texture:'rough'})]);
 const r=namingProposal(n);assert.deepEqual(r.lexicon,[{token:'velora',cues,source:'own',speakerId:'aster'}]);assert.equal(JSON.stringify(r).includes('cattail'),false);
});
test('listener learns its own grounded example and later matches its own newly observed members only',()=>{
 const a=make(),b=make('mira');sample(a,0,[object(675),object(669)]);sample(a,1,[object(675),object(669)]);propose(a);
 sample(b,0,[object(675)]);sample(b,1,[object(675)]);const before=effectState(b);
 assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:675',event()),true);
 assert.equal(validCategoryCorrespondence([a,b]),true);assert.deepEqual(categoryLabels(b)[0].members.map(m=>m.objectId),['object:675']);
 assert.deepEqual(b.categoryNames.heard[0].example,{objectId:'object:675',times:[0,1]});assert.equal(b.categoryNames.own.length,0);assert.deepEqual(effectState(b),before);
 sample(b,2,[object(672)]);assert.equal(objectName(b,'object:672'),null);sample(b,3,[object(672)]);assert.equal(objectName(b,'object:672').source,'heard-category');
 assert.equal(objectName(b,'object:669'),null,'unseen speaker member was not copied');
});
test('same text, stale samples, wrong speaker and ambiguous meaning cannot ground or singularly resolve',()=>{
 const a=make(),b=make('mira');sample(a,0);sample(a,1);propose(a);b.elapsed=1;
 b.social.heard.push({text:'I call things velora'});assert.equal(b.categoryNames,undefined);
 assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:675',event()),false);
 sample(b,0);sample(b,1);b.elapsed=2;a.elapsed=2;assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:675',event(1,2)),false);
});
test('strict optional vocabulary rejects extra fields, inconsistent admissions, tampered examples and chronology',()=>{
 const n=make();sample(n,0);sample(n,1);propose(n);const good=historicalClone(n.categoryNames);assert.equal(validCategoryNames(good,n),true);
 for(const change of [s=>s.version=2,s=>s.ownerId='mira',s=>s.extra=true,s=>s.own[0].action='eat',s=>s.own[0].token='safe',s=>s.own[0].model='\n',s=>s.own[0].example.times=[1,1],s=>s.own[0].example.objectId='object:99',s=>s.own[0].cues.material='hidden',s=>s.own[0].requestAt=2,s=>s.admissions=[],s=>s.admissions.push(historicalClone(s.admissions[0])),s=>s.own.push(historicalClone(s.own[0]))]){
  const bad=historicalClone(good);change(bad);assert.equal(validCategoryNames(bad,n),false);
 }
});
test('bounded attempts saturate without evicting old nonretry admissions',()=>{
 const n=make();for(let i=0;i<CATEGORY_ATTEMPT_LIMIT;i++){const objects=[object(675,{...cues,shape:`observed shape ${i}`})];sample(n,i*2,objects);sample(n,i*2+1,objects);const r=namingProposal(n);assert.ok(r);assert.equal(beginNamingProposal(n,r),true);}
 sample(n,130,[object(675,{...cues,shape:'another observed shape'})]);sample(n,131,[object(675,{...cues,shape:'another observed shape'})]);assert.equal(namingProposal(n),null);assert.equal(n.categoryNames.admissions.length,64);assert.equal(validCategoryNames(n.categoryNames,n),true);
});

 test('temporary failed or abstained naming may retry after bounded persisted cooldown',()=>{
 const n=make();sample(n,0);sample(n,1);const first=namingProposal(n);assert.equal(beginNamingProposal(n,first),true);
 acceptNamingProposal(n,first,{token:null,model:'mock'});sample(n,300);assert.equal(namingProposal(n),null);
 sample(n,301);const retry=namingProposal(n);assert.ok(retry);assert.equal(beginNamingProposal(n,retry),true);assert.equal(n.categoryNames.admissions.length,1);
 assert.equal(acceptNamingProposal(n,retry,{token:'velora',model:'mock'}),true);sample(n,1000);assert.equal(namingProposal(n),null,'accepted names never trigger duplicate proposals');
 });

 test('speaker-qualified homonyms preserve distinct meanings before visibility filtering',()=>{
 const a=make(),b=make('mira'),red=object(900,{shape:'round',color:'red',texture:'smooth'});
 sample(a,0);sample(a,1);propose(a);sample(b,0,[red]);sample(b,1,[red]);propose(b);
 sample(a,2);sample(b,2,[red,object()]);sample(a,3);sample(b,3,[red,object()]);
 assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:675',event(1,3)),true);
 assert.equal(resolveCategoryName(b,'velora',null,[object()]),null,'occluded different sense remains a conflict');
 assert.equal(resolveCategoryName(b,'velora','aster',[object()]),'object:675');
 assert.equal(resolveCategoryName(b,'velora','mira',[red]),'object:900');
 });

test('legacy same-cue individual names are preserved, not reinterpreted as category evidence', async()=>{
 const {chooseOwnName}=await import('../src/naming-state.js');const n=make();sample(n,99,[object(675),object(669)]);sample(n,100,[object(675),object(669)]);
 let own;
 for(let i=1;i<=10&&!own;i++){
  const e={id:i,actionId:i,primitive:'inspect_object',targetId:'object:675',ok:true,code:'OBJECT_OBSERVED',at:n.elapsed,durationSeconds:1.8};n.discovery.experiments.push(e);
  n.memory.experience.push({id:i,type:'action',at:n.elapsed,details:{action:{type:'inspect_object',targetId:e.targetId},result:{ok:true,code:e.code,durationSeconds:1.8,handling:{source:'experienced',activeActionSeconds:1.8,effort:'steady'}}}});
  own=chooseOwnName(n,e,{objectId:e.targetId,at:n.elapsed,scene:'valley',actorPosition:{...n.position},objectPosition:{x:20,y:0}});
 }
 assert.ok(own);const legacy=historicalClone(n.lexicon);assert.equal(objectName(n,'object:675').source,'individual');assert.equal(objectName(n,'object:669'),null);
 const r=namingProposal(n);assert.deepEqual(r.individualNames,[{token:own.token,objectId:'object:675',speakerId:'aster'}]);assert.equal(beginNamingProposal(n,r),true);
 assert.equal(acceptNamingProposal(n,r,{token:own.token,model:'mock'}),false);assert.deepEqual(n.lexicon,legacy);assert.deepEqual(categoryLabels(n),[]);
});

 test('public category projections cannot mutate retained examples, cues or admissions',()=>{
 const n=make();sample(n,0);sample(n,1);propose(n);const before=historicalClone(n.categoryNames),rows=categoryLabels(n);
 rows[0].cues.color='red';rows[0].examples[0].times[0]=500;rows[0].members[0].objectId='object:8';
 assert.deepEqual(n.categoryNames,before);assert.equal(rows[0].announcedTo,undefined);
 });

 test('six persistent cue triples get first consideration before eligible low-ID retries',()=>{
 const n=make(),objects=Array.from({length:6},(_,i)=>object(100+i,{...cues,shape:`observed shape ${i}`})),selected=[];
 sample(n,0,objects);
 for(let i=0;i<12;i++){sample(n,1+i*60,objects);const r=namingProposal(n);assert.ok(r);selected.push(r.example.objectId);assert.equal(beginNamingProposal(n,r),true);assert.equal(acceptNamingProposal(n,r,{token:null,model:'mock-unhelpful'}),false);}
 assert.deepEqual(selected.slice(0,6),objects.map(o=>o.id));assert.deepEqual(selected.slice(6),objects.map(o=>o.id));
 assert.equal(n.categoryNames.admissions.length,6);
 });

 test('overlapping retained sensory times cannot contradict own or heard category examples',()=>{
 const a=make(),b=make('mira');sample(a,0);sample(a,1);propose(a);sample(b,0);sample(b,1);
 assert.equal(recordCategoryGrounding(a,b,a.categoryNames.own[0],'object:675',event()),true);
 const bad=historicalClone(a.categoryNames);bad.admissions[0].cues.color='red';bad.own[0].cues.color='red';
 assert.equal(validCategoryNames(bad,a),false);const badHeard=historicalClone(b.categoryNames);badHeard.heard[0].cues.color='red';assert.equal(validCategoryNames(badHeard,b),false);
 sample(a,2,[object(675,{...cues,color:'brown'})]);sample(b,2,[object(675,{...cues,color:'brown'})]);
 assert.equal(validCategoryNames(a.categoryNames,a),true,'nonoverlapping later observations preserve truthful old evidence');
 assert.equal(validCategoryNames(b.categoryNames,b),true);
 });
