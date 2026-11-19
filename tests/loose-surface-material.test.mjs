import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,loadOzarkSave,getOzarkSaveValidationFailure} from '../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {tickOzarkEcology,validateOzarkEcology,bindOzarkEcology} from '../src/ozark-ecology.js';
import {lookupEcologyObject,interactEcologyObject} from '../src/ecology.js';
import {advectLooseSurfaceMaterial} from '../src/loose-surface-material.js';
const g=createOzarkWorldGeometry(),flow={x:-1200,y:220},pond={x:-11800,y:11800};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function fixture(){
 const state=createOzarkState(g,{communicationSeed:97531}),n=state.agents[0],env=state.environment,e=env.ecology;
 const source=e.plants.filter(o=>o.kind==='grass'&&g.canOccupy(o.position.x,o.position.y,10)).sort((a,b)=>dist(n.position,a.position)-dist(n.position,b.position))[0];
 n.position={...source.position};state.agents.forEach(a=>bindOzarkWorldAgent(a,g,state));
 const advance=()=>{state.elapsed+=.25;env.elapsed=state.elapsed;for(const a of state.agents)tickNpc(a,.25,env);};
 const pay=(type,id)=>{
  observeNpc(n,env);const r=requestNpcAction(n,{type,targetId:id},env);assert.equal(r.ok,true,JSON.stringify(r));
  for(let i=0;i<200&&n.active;i++)advance();assert.equal(n.active,null);
  assert.equal(n.lastResult.ok,true,JSON.stringify(n.lastResult));return n.lastResult;
 };
 const pulled=pay('pull',source.id),piece=lookupEcologyObject(e,pulled.materialId);assert.ok(piece);
 const eco=dt=>tickOzarkEcology(e,dt,env,state.agents,{},g);
 return {n,env,e,source,piece,pay,eco};
}
test('actual paid pull and release let only loose grass in flowing water drift; current position becomes visible',()=>{
 assert.equal(g.classify(flow.x,flow.y,10,'swim').waterKind,'surface');
 assert.equal(g.classify(pond.x,pond.y,10,'swim').waterKind,'pond');
 for(const [kind,where] of [['dry',null],['pond',pond],['flow',flow]]){
  const f=fixture(),{n,env,e,piece}=f;
  const held={...piece.position},rng=n.rng;
  if(where)n.position={...where}; // authored placement before paid release, not chosen travel
  f.eco(.5);assert.deepEqual(piece.position,held);
  f.pay('release',piece.id);assert.equal(piece.heldBy,null);
  const start={...piece.position};n.position={...start};observeNpc(n,env);
  const remembered={...n.discovery.observations[piece.id].position};
  const stock=[piece.id,piece.massGrams,piece.energyKcal,piece.waterMl,e.nextId];
  f.eco(2);
  assert.deepEqual([piece.id,piece.massGrams,piece.energyKcal,piece.waterMl,e.nextId],stock);
  assert.deepEqual(n.discovery.observations[piece.id].position,remembered,'world motion cannot rewrite old sight');
  const visible=observeNpc(n,env).objects.find(o=>o.id===piece.id);assert.ok(visible);
  assert.deepEqual(visible.position,piece.position);
  if(kind==='flow')assert.ok(dist(start,piece.position)>1);else assert.deepEqual(piece.position,start);
  console.log(JSON.stringify({kind,release:start,observed:visible.position,distance:dist(start,piece.position)}));
  assert.equal(n.rng,rng);
  if(kind==='flow'){
   // Choose a valid authored position within reach of original sight, but
   // outside the new physical reach. The current, not the ledger, decides.
   const reference=Array.from({length:32},(_,i)=>({
    x:start.x+79*Math.cos(i*Math.PI/16),y:start.y+79*Math.sin(i*Math.PI/16)
   })).find(p=>g.canOccupy(p.x,p.y,10)&&dist(p,piece.position)>80);
   assert.ok(reference);n.position=reference;
   assert.equal(requestNpcAction(n,{type:'grasp',targetId:piece.id},env).code,'OUT_OF_REACH');
   n.position={...piece.position};f.pay('grasp',piece.id);assert.equal(piece.heldBy,'aster');
   const caught={...piece.position};f.eco(.5);assert.deepEqual(piece.position,caught);
   assert.equal(e.materials.filter(o=>o.id===piece.id).length,1);
  }
 }
});
test('bounded sweep stops on bank, rock and bounds without crossing; unsupported and held records are untouched',()=>{
 const make=()=>({id:'object:1',kind:'material',materialType:'grass',scene:'valley',heldBy:null,position:{x:0,y:0}});
 for(const reason of ['bank','solid-rock','outside-approved-bounds']){
  const geometry={profile:{currentMaxSpeed:28,wadeMaxDepthProxy:1},canSweepSwimFootprint(_a,b){return b.x<2.5;},classify(x){
   return x>=2.5?{walkable:reason==='bank',waterKind:null,reason}:{walkable:true,waterKind:'surface',depthProxy:1,currentDirection:{x:1,y:0}};
  }};
  const material=make();assert.equal(advectLooseSurfaceMaterial(material,.5,geometry),true);assert.equal(material.position.x,2);
  assert.equal(advectLooseSurfaceMaterial(material,.5,geometry),false);
  assert.equal(advectLooseSurfaceMaterial(material,1e9,geometry),false);
  for(const m of [{...make(),materialType:'apple'},{...make(),heldBy:'aster'},{...make(),kind:'carcass'}]){
   assert.equal(advectLooseSurfaceMaterial(m,.5,geometry),false);assert.deepEqual(m.position,{x:0,y:0});
  }
 }
});
test('fixed ecology ticks partition equivalently and a moved material roundtrips exact canonical save',()=>{
 const state=createOzarkState(g,{communicationSeed:97531}),env=state.environment,e=env.ecology;
 const grass=e.plants.find(o=>o.kind==='grass'&&o.biomassGrams>=45);
 const p=interactEcologyObject(e,grass.id,'pull',{actorId:'aster',position:grass.position});assert.ok(p.ok);
 const drop=interactEcologyObject(e,p.materialId,'release',{actorId:'aster',position:flow});assert.ok(drop.ok);
 const original=lookupEcologyObject(e,p.materialId);assert.deepEqual(original.position,flow);
 const fruit=e.plants.find(o=>o.kind==='apple_tree'&&o.quantity>0);
 const unsupported=interactEcologyObject(e,fruit.id,'pull',{actorId:'aster',position:fruit.position});assert.ok(unsupported.ok);
 assert.equal(interactEcologyObject(e,unsupported.materialId,'release',{actorId:'aster',position:flow}).ok,true);
 const copy=structuredClone(e);bindOzarkEcology(copy,g);
 tickOzarkEcology(e,2,env,[],{},g);
 for(let i=0;i<8;i++)tickOzarkEcology(copy,.25,env,[],{},g);
 assert.deepEqual(copy,e);
 assert.deepEqual(lookupEcologyObject(e,unsupported.materialId).position,flow);
 assert.ok(dist(original.position,flow)>1);assert.ok(g.canOccupy(original.position.x,original.position.y,10));
 assert.deepEqual(validateOzarkEcology(structuredClone(e),g,{seed:e.seed,elapsed:2}).materials,e.materials);
 state.elapsed=env.elapsed=2;for(const n of state.agents)n.elapsed=2;
 let raw=null;const storage={getItem:()=>raw,setItem:(_k,v)=>{raw=v;}};
 assert.equal(writeOzarkSave(storage,state,g),true,JSON.stringify(getOzarkSaveValidationFailure(state)));
 const loaded=loadOzarkSave(storage,g);
 assert.equal(loaded.blocked,false,loaded.error);
 assert.deepEqual(lookupEcologyObject(loaded.state.environment.ecology,p.materialId),original);
});

test('grazing circle missed by point samples is stopped by native-style exact segment gate',()=>{
 const material={kind:'material',materialType:'grass',scene:'valley',heldBy:null,position:{x:0,y:0}};
 // The collider center falls between the first two point probes. Its
 // effective radius includes the 10-unit material footprint.
 const center={x:.25,y:10.999},radius=11;
 assert.ok([0,.5,1].every(x=>Math.hypot(x-center.x,center.y)>radius));
 let calls=0;
 const geometry={profile:{currentMaxSpeed:28,wadeMaxDepthProxy:1},
  classify(x,y){return {walkable:Math.hypot(x-center.x,y-center.y)>radius,waterKind:'surface',depthProxy:1,currentDirection:{x:1,y:0}};},
  canSweepSwimFootprint(a,b,actualRadius){
   calls++;assert.equal(actualRadius,10);
   const closest=Math.max(a.x,Math.min(b.x,center.x));
   return Math.hypot(closest-center.x,center.y)>radius;
  }};
 assert.equal(advectLooseSurfaceMaterial(material,.5,geometry),false);
 assert.equal(calls,1);assert.deepEqual(material.position,{x:0,y:0});
});
test('pure native geometry guard rejects a real rock grazing segment missed by point probes',()=>{
 const objects=g.structures.objectsInRect({left:-6000,right:6000,top:-6000,bottom:6000});
 let example;
 for(const o of objects){
  if(o.kind!=='rock')continue;
  const r=10+o.radius*o.scale,y=o.y+r-.0001;
  const a={x:o.x-.25,y},b={x:o.x+.75,y};
  const midpoint={x:o.x+.25,y};
  if(![a,midpoint,b].every(q=>g.classify(q.x,q.y,10,'swim').walkable))continue;
  if(g.structures.sweptObstruction(a,b,10)!==o)continue;
  const up=p=>({x:p.x,y:p.y+2});
  if(!g.canSweepSwimFootprint(up(a),up(b),10))continue;
  example={a,b};break;
 }
 assert.ok(example,'construct a real Ozark rock near-graze with clear point probes and outward control');
 assert.equal(g.canSweepSwimFootprint(example.a,example.b,10),false);
});
