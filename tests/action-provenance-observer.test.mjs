import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {enableActionProvenance,beginActionRequest,endActionRequest,recordActionCompletion,drainActionProvenance,disposeActionProvenance} from '../src/action-provenance-observer.js';
import {createNpc} from '../src/npc-state.js';
import {requestNpcAction,tickNpc,cancelNpcAction,observeNpc} from '../src/npc.js';
import {createEnvironment} from '../src/environment.js';
const fake=()=>({id:'actor',epoch:0,elapsed:0,position:{x:1,y:2},scene:'valley',active:null});
test('disabled observer does not allocate capture or alter actor',()=>{const n=fake(),before=structuredClone(n);assert.equal(beginActionRequest(n,{type:'wait'}),null);assert.equal(drainActionProvenance(n),null);assert.deepEqual(n,before);});
test('exact active identity links completion to original request and event',()=>{const n=fake();enableActionProvenance(n);const r={type:'move',target:{x:3,y:4}},scope=beginActionRequest(n,r);const a=n.active={request:r,route:[r.target],index:0};endActionRequest(n,scope,{ok:true,code:'STARTED'});n.active=null;n.position={x:3,y:4};recordActionCompletion(n,a,r,{ok:true,code:'ARRIVED'},{id:44});const d=drainActionProvenance(n);assert.equal(d.rows.length,3);assert.deepEqual(d.rows[0].token,d.rows[2].token);assert.equal(d.rows[2].eventId,44);assert.equal(d.rows[2].arrival.reported,true);assert.equal(d.counters.dropped,0);});
test('synchronous completion linked before dispatch return',()=>{const n=fake();enableActionProvenance(n);const r={type:'observe'},scope=beginActionRequest(n,r);recordActionCompletion(n,null,r,{ok:false,code:'INVALID_REQUEST'},{id:2});endActionRequest(n,scope,{ok:false,code:'INVALID_REQUEST',eventId:2});const d=drainActionProvenance(n);assert.deepEqual(d.rows[0].token,d.rows[1].token);assert.equal(d.rows[2].synchronousCompletion,true);assert.equal(d.rows[2].admitted,false);});
test('busy rejection never binds to existing active action',()=>{const n=fake();enableActionProvenance(n);let s=beginActionRequest(n,{type:'wait'});const a=n.active={request:{type:'wait'}};endActionRequest(n,s,{ok:true,code:'STARTED'});s=beginActionRequest(n,{type:'move'});endActionRequest(n,s,{ok:false,code:'ACTION_BUSY'});n.active=null;recordActionCompletion(n,a,a.request,{ok:false,code:'PRIORITY_CHANGED'},{id:7});const d=drainActionProvenance(n);assert.equal(d.rows.at(-1).token.sequence,1);assert.equal(d.rows[3].admitted,false);});
test('unobserved entry path does not synthesize identity',()=>{const n=fake();enableActionProvenance(n);recordActionCompletion(n,{}, {type:'grasp'},{ok:true,code:'object_held'},{id:1});assert.equal(drainActionProvenance(n).rows[0].token,null);});
test('epoch change and disappeared active are censored',()=>{const n=fake();enableActionProvenance(n);const s=beginActionRequest(n,{type:'wait'});n.active={request:{type:'wait'}};endActionRequest(n,s,{ok:true,code:'STARTED'});n.epoch++;n.active=null;const d=drainActionProvenance(n);assert.equal(d.counters.censored,1);assert.equal(d.rows.at(-1).kind,'censored');});
test('bounded buffer exposes dropped records and output is detached',()=>{const n=fake();enableActionProvenance(n,{capacity:1});const raw={type:'move',target:{x:1,y:2}},s=beginActionRequest(n,raw);raw.target.x=99;endActionRequest(n,s,{ok:false,code:'NO_ROUTE'});const d=drainActionProvenance(n);assert.equal(d.rows[0].requestCapture,'raw request deliberately not inspected');assert.equal(d.counters.dropped,1);assert.equal(d.counters.records,2);assert.deepEqual(drainActionProvenance(n).rows,[]);});
test('dispose emits unfinished censoring without cancelling action',()=>{const n=fake();enableActionProvenance(n);const s=beginActionRequest(n,{type:'wait'});const a=n.active={request:{type:'wait'}};endActionRequest(n,s,{ok:true,code:'STARTED'});const d=disposeActionProvenance(n);assert.equal(d.rows.at(-1).kind,'censored');assert.equal(n.active,a);assert.equal(drainActionProvenance(n),null);});
test('runtime wait, busy, cancel, observe and rejected action preserve complete actor/environment bytes',()=>{
 const base=createNpc({seed:123,preset:'accelerated'}),a=structuredClone(base),b=structuredClone(base),ea=createEnvironment({seed:123}),eb=structuredClone(ea);enableActionProvenance(a);
 const action=r=>{assert.deepEqual(requestNpcAction(a,r,ea),requestNpcAction(b,structuredClone(r),eb));assert.deepEqual(a,b);assert.deepEqual(ea,eb);};
 action({type:'wait',seconds:1});action({type:'wait',seconds:1});for(let i=0;i<20;i++){tickNpc(a,.1,ea);tickNpc(b,.1,eb);assert.deepEqual(a,b);assert.deepEqual(ea,eb);}action({type:'wait',seconds:10});assert.equal(cancelNpcAction(a),cancelNpcAction(b));action({type:'observe'});action({type:'invalid'});assert.deepEqual(a,b);assert.deepEqual(ea,eb);const d=drainActionProvenance(a);assert.equal(d.counters.errors,0);assert.equal(d.counters.dropped,0);assert.ok(d.rows.some(r=>r.kind==='completion'&&r.eventId));assert.ok(d.rows.some(r=>r.kind==='dispatch-return'&&r.result.code==='ACTION_BUSY'));
});

test('completion after epoch or learner replacement remains unresolved even before drain',()=>{for(const change of [n=>n.epoch++,n=>n.discovery={},n=>n.physiology={}]){const n=fake();enableActionProvenance(n);const s=beginActionRequest(n,{type:'wait'}),a=n.active={request:{type:'wait'}};endActionRequest(n,s,{ok:true,code:'STARTED'});change(n);n.active=null;recordActionCompletion(n,a,a.request,{ok:true,code:'WAITED'},{id:3});const d=drainActionProvenance(n);assert.equal(d.rows.at(-1).token,null);assert.equal(d.counters.censored,1);}});
test('raw request getters are not read by observer',()=>{const n=fake();enableActionProvenance(n);let reads=0;const raw={get type(){reads++;throw Error('not observer input');}};const s=beginActionRequest(n,raw);endActionRequest(n,s,null,true);assert.equal(reads,0);assert.equal(drainActionProvenance(n).rows.at(-1).threw,true);});
test('nonallowlisted result functions are omitted without inspecting or altering runtime',()=>{const n=fake();enableActionProvenance(n);const s=beginActionRequest(n,{});const result={ok:false,fn(){}};endActionRequest(n,s,result);const d=drainActionProvenance(n);assert.equal(d.counters.errors,0);assert.equal('fn' in d.rows.at(-1).result,false);assert.equal(n.active,null);});

test('runtime observed movement arrival keeps endpoint and event identity, with full parity',()=>{
 const base=createNpc({seed:123,preset:'accelerated'});observeNpc(base);const cells=Object.values(base.memory.cells);const target=cells.find(c=>c.walkable&&Math.hypot(c.x-base.position.x,c.y-base.position.y)>8&&Math.hypot(c.x-base.position.x,c.y-base.position.y)<100);assert.ok(target);
 const a=structuredClone(base),b=structuredClone(base);enableActionProvenance(a);
 const raw={type:'move',target:{x:target.x,y:target.y}};
 assert.deepEqual(requestNpcAction(a,raw),requestNpcAction(b,structuredClone(raw)));
 for(let i=0;i<400&&a.active;i++){tickNpc(a,.05);tickNpc(b,.05);assert.deepEqual(a,b);}
 assert.equal(a.active,null);const d=drainActionProvenance(a);const completion=d.rows.find(r=>r.kind==='completion');assert.ok(completion);assert.equal(completion.eventId,a.lastResult.eventId);assert.equal(completion.result.code,'ARRIVED');assert.deepEqual(completion.arrival.position,a.position);assert.deepEqual(completion.route.endpoint,raw.target);assert.equal(d.counters.errors,0);
 // Endpoint proximity is reported by the engine, not claimed as coordinate equality.
 assert.ok(Math.hypot(a.position.x-target.x,a.position.y-target.y)<6);
});
test('throwing request retains ordinary getter count with capture enabled',()=>{
 const base=createNpc({seed:123,preset:'accelerated'}),a=structuredClone(base),b=structuredClone(base);enableActionProvenance(a);let ca=0,cb=0;
 assert.throws(()=>requestNpcAction(a,{get type(){ca++;throw Error('bad raw');}}),/bad raw/);assert.throws(()=>requestNpcAction(b,{get type(){cb++;throw Error('bad raw');}}),/bad raw/);assert.equal(ca,cb);assert.deepEqual(a,b);assert.equal(drainActionProvenance(a).rows.at(-1).threw,true);
});
test('injected observer clone failure leaves real runtime result/state unchanged',()=>{
 const base=createNpc({seed:123,preset:'accelerated'}),a=structuredClone(base),b=structuredClone(base);enableActionProvenance(a);const clone=globalThis.structuredClone;let left;
 try{globalThis.structuredClone=()=>{throw Error('observer clone failed');};left=requestNpcAction(a,{type:'wait',seconds:1});}finally{globalThis.structuredClone=clone;}
 assert.deepEqual(left,requestNpcAction(b,{type:'wait',seconds:1}));assert.deepEqual(a,b);assert.ok(drainActionProvenance(a).counters.errors>0);
});
test('runtime already-arrived result uses same synchronous request token',()=>{
 const n=createNpc({seed:123,preset:'accelerated'});observeNpc(n);const c=Object.values(n.memory.cells).find(c=>c.walkable);assert.ok(c);n.position={x:c.x,y:c.y};enableActionProvenance(n);const r=requestNpcAction(n,{type:'move',target:{...n.position}});assert.equal(r.code,'ARRIVED');const d=drainActionProvenance(n);assert.equal(d.rows[1].eventId,r.eventId);assert.deepEqual(d.rows[1].token,d.rows[0].token);assert.equal(d.rows.at(-1).synchronousCompletion,true);
});

test('paid discovery acquisition and sample link real event IDs with full actor/world parity',async()=>{
 const {createEcology}=await import('../src/ecology.js');const {canStand}=await import('../src/world.js');
 const n=createNpc({mode:'discovery',seed:74193}),e=createEnvironment({seed:74193});e.ecology=createEcology(74193);const plant=e.ecology.plants.find(p=>canStand(p.position.x+45,p.position.y,'valley'));assert.ok(plant);n.position={x:plant.position.x+45,y:plant.position.y};observeNpc(n,e);assert.ok(n.discovery.observations[plant.id]);
 const a=structuredClone(n),b=structuredClone(n),ea=structuredClone(e),eb=structuredClone(e);enableActionProvenance(a);
 const paid=r=>{assert.deepEqual(requestNpcAction(a,r,ea),requestNpcAction(b,structuredClone(r),eb));for(let i=0;i<500&&a.active;i++){tickNpc(a,.05,ea);tickNpc(b,.05,eb);assert.deepEqual(a,b);assert.deepEqual(ea,eb);}assert.equal(a.active,null);assert.equal(a.lastResult.ok,true);};
 paid({type:'pull',targetId:plant.id});const material=a.inventory.items[0];assert.ok(material);paid({type:'sample',targetId:material});const d=drainActionProvenance(a);assert.equal(d.counters.errors,0);assert.equal(d.counters.dropped,0);const done=d.rows.filter(r=>r.kind==='completion');assert.equal(done.length,2);assert.equal(done[1].result.code,'SWALLOWED');assert.equal(done[1].result.ingestionId,a.lastResult.ingestionId);assert.equal(done[1].eventId,a.lastResult.eventId);for(const row of done)assert.ok(a.discovery.experiments.some(ex=>ex.actionId===row.eventId&&ex.primitive===row.request.type));
});

test('instrumented observer-off request wrapper matches pristine source fixture',async()=>{
 const baseline=await readFile(new URL('./fixtures/action-provenance/npc-baseline.js.txt',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(baseline).digest('hex'),'327eba23afea80a30bfb0c1ad0fa049cdc62bcc0fa74670956af9ed36eef5c59','exact upstream npc baseline');
 // Resolve only the pinned baseline's relative imports against this checkout.
 const absolute=baseline.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL('../src/'+p.slice(2),import.meta.url).href}'`);
 const pristine=await import(`data:text/javascript;base64,${Buffer.from(absolute).toString('base64')}`);const base=createNpc({seed:321,preset:'accelerated'}),a=structuredClone(base),b=structuredClone(base),ea=createEnvironment({seed:321}),eb=structuredClone(ea);
 for(const action of [{type:'wait',seconds:1},{type:'observe'},{type:'invalid'}]){assert.deepEqual(requestNpcAction(a,action,ea),pristine.requestNpcAction(b,structuredClone(action),eb));for(let i=0;i<20;i++){tickNpc(a,.1,ea);pristine.tickNpc(b,.1,eb);}assert.deepEqual(a,b);assert.deepEqual(ea,eb);}
});

test('nested-scope overflow and duplicate synchronous completions never steal attribution',()=>{
 const n=fake();enableActionProvenance(n);const scopes=Array.from({length:17},()=>beginActionRequest(n,{}));recordActionCompletion(n,null,{type:'observe'},{ok:true,code:'OBSERVED'},{id:1});endActionRequest(n,scopes.pop(),{});recordActionCompletion(n,null,{type:'observe'},{ok:true,code:'OBSERVED'},{id:2});recordActionCompletion(n,null,{type:'observe'},{ok:true,code:'OBSERVED'},{id:3});for(const s of scopes.reverse())endActionRequest(n,s,{});const d=drainActionProvenance(n),rows=d.rows.filter(r=>r.kind==='completion');assert.equal(rows[0].token,null);assert.equal(rows[1].token.sequence,16);assert.equal(rows[2].token,null);assert.equal(d.counters.errors,1);
});

test('nested admission retains inner owner when outer request rejects or returns other success',()=>{
 for(const outerResult of [{ok:false,code:'ACTION_BUSY'},{ok:true,code:'OBSERVED'},{ok:true,code:'STARTED'}]){
  const n=fake();enableActionProvenance(n);const outer=beginActionRequest(n,{}),inner=beginActionRequest(n,{});const active=n.active={request:{type:'wait'}};
  endActionRequest(n,inner,{ok:true,code:'STARTED'});endActionRequest(n,outer,outerResult);n.active=null;recordActionCompletion(n,active,active.request,{ok:true,code:'WAITED'},{id:4});
  const d=drainActionProvenance(n),returns=d.rows.filter(r=>r.kind==='dispatch-return');assert.equal(returns[0].admitted,true);assert.equal(returns[1].admitted,false);assert.equal(d.rows.at(-1).token.sequence,2);assert.equal(d.counters.censored,0);assert.equal(d.counters.errors,0);
 }
});
test('new active identity alone cannot turn failed dispatch into admission',()=>{const n=fake();enableActionProvenance(n);const scope=beginActionRequest(n,{});n.active={request:{type:'wait'}};endActionRequest(n,scope,{ok:false,code:'ACTION_BUSY'});const d=drainActionProvenance(n);assert.equal(d.rows.at(-1).admitted,false);assert.equal(d.activeToken,null);});
