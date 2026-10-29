import test from 'node:test';
import assert from 'node:assert/strict';
import {createNpc} from '../src/npc-state.js';
import {OZARK_WORLD_PROFILE} from '../src/ozark-world-geometry.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {referenceGeometry,createIndicationPermit,publicIndicationGeometry} from '../src/discovery-actions.js';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {observeNpc,requestNpcAction,requestNpcIndication,tickNpc} from '../src/npc.js';
import {drawIndicationGeometry,drawNpc} from '../src/art.js';
import {REFERENCE_GEOMETRY_RULES,senseReferenceObjects,visibleIndicationGeometry,
  resolveIndication,perceiveReferenceGeometry,observeIndication} from '../src/visual-reference-perception.js';

const object=(id,x,y)=>({id:`object:${id}`,kind:'grass',scene:'valley',position:{x,y},moisture:.5,biomassGrams:100});
function fixture(objects=[object(1,100,0),object(2,0,100)],los=()=>true){
  const sender=createNpc({id:'aster',mode:'discovery'}),listener=createNpc({id:'mira',mode:'discovery'});
  sender.position={x:0,y:0};listener.position={x:0,y:40};
  const state={geometryIdentity:OZARK_WORLD_PROFILE.identity,agents:[sender,listener],elapsed:0,
    environment:{ecology:{elapsed:0,plants:objects,animals:[],materials:[]}}};
  const geometry={profile:OZARK_WORLD_PROFILE,sample(){return{};},classify(){return {walkable:true,reason:'dry-ground'};},
    canOccupy(){return true;},advance(){throw new Error('read-only sensing must never advance physics');},lineOfSight:los};
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  return {sender,listener,state,segment:referenceGeometry(sender.position,{x:100,y:0},'valley',.5)};
}
const own=(...points)=>points.map(([x,y])=>({position:{x,y}}));

test('numeric parser resolves an own visible index without using labels or hidden target identity',()=>{
  const g=referenceGeometry({x:0,y:0},{x:100,y:0},'valley',1),objects=own([100,0],[0,100]);
  const first=resolveIndication({...g,targetId:'object:1',targetPosition:{x:100,y:0}},objects);
  const changed=resolveIndication({...g,targetId:'object:2',targetPosition:{x:0,y:100},senderFeature:Array(48).fill(1)},objects);
  assert.deepEqual(first,{index:0,reason:'resolved'});assert.deepEqual(changed,first);
  assert.deepEqual(resolveIndication(referenceGeometry(g.origin,{x:0,y:100},g.scene,1),objects),{index:1,reason:'resolved'});
  assert.deepEqual(resolveIndication(g,objects.toReversed()),{index:1,reason:'resolved'});
});

test('every third visible distractor participates; no pair-only or nearest-object shortcut',()=>{
  const f=fixture([object(1,100,0),object(2,0,100),object(3,150,1)]);
  const snapshot=senseReferenceObjects(f.listener,f.state);
  assert.equal(snapshot.complete,true);assert.equal(snapshot.objects.length,3);
  assert.equal(resolveIndication(f.segment,snapshot.objects).reason,'ambiguous');
  const perceived=perceiveReferenceGeometry(f.listener,f.sender,f.segment,f.state);
  assert.equal(perceived.index,null);assert.equal(perceived.objectId,null);assert.equal(perceived.reason,'ambiguous');
});

test('cone and extrapolated distance have exact declared boundaries without distance-coded segment',()=>{
  const g=referenceGeometry({x:0,y:0},{x:100,y:0},'valley',1);
  assert.deepEqual(g,referenceGeometry({x:0,y:0},{x:300,y:0},'valley',1));
  const radians=degrees=>degrees*Math.PI/180;
  assert.equal(resolveIndication(g,own([100*Math.cos(radians(6)),100*Math.sin(radians(6))])).index,0);
  assert.equal(resolveIndication(g,own([100*Math.cos(radians(6.01)),100*Math.sin(radians(6.01))])).index,null);
  assert.equal(resolveIndication(g,own([400,0])).index,0);
  assert.equal(resolveIndication(g,own([400.001,0],[-50,0],[0,0])).index,null);
  assert.equal(resolveIndication({...g,progress:0},own([100,0])).reason,'invalid-geometry');
  assert.equal(resolveIndication({...g,tip:{x:400,y:0}},own([100,0])).reason,'invalid-geometry');
  assert.equal(resolveIndication(g,[{position:{x:NaN,y:0}}]).reason,'invalid-observation');
});

test('exact-cap and over-cap raw sensing fail closed even when LOS hides most objects',()=>{
  for(const count of [96,100]){
    const f=fixture(Array.from({length:count},(_,i)=>object(i+1,50+i,0)),()=>false);
    const snapshot=senseReferenceObjects(f.listener,f.state);
    assert.equal(snapshot.complete,false);assert.equal(snapshot.reason,'sensory-incomplete');
    assert.deepEqual(snapshot.objects,[]);assert.deepEqual(snapshot.bindings,[]);
  }
  const f=fixture(Array.from({length:95},(_,i)=>object(i+1,50+i,0)));
  assert.equal(senseReferenceObjects(f.listener,f.state).complete,true);
  assert.equal(senseReferenceObjects(f.listener,f.state).objects.length,95);
});

test('sensor uses only current ordinary visible unheld objects and numeric geometry, without mutation',()=>{
  const held={...object(3,50,0),heldBy:'aster'};
  const f=fixture([object(1,100,0),object(2,0,100),held,object(4,1000,0)],(from,to)=>to.y!==100);
  const before=structuredClone(f.state),snapshot=senseReferenceObjects(f.listener,f.state);
  assert.deepEqual(snapshot.bindings,['object:1']);assert.deepEqual(snapshot.objects,own([100,0]));
  assert.deepEqual(Object.keys(snapshot.objects[0]),['position']);assert.deepEqual(f.state,before);
  f.listener.lifecycle='COLLAPSED';assert.equal(senseReferenceObjects(f.listener,f.state).complete,false);
});

test('segment interior visibility matters independently of sender and target visibility',()=>{
  const f=fixture(undefined,(from,to)=>!(to.x===12&&to.y===0));
  assert.equal(visibleIndicationGeometry(f.listener,f.segment),null);
  const result=perceiveReferenceGeometry(f.listener,f.sender,{...f.segment,targetId:'object:1'},f.state);
  assert.equal(result.reason,'gesture-not-visible');
});

test('only short physical segment is checked, not the imaginary extrapolated ray',()=>{
  const sightChecks=[];
  const f=fixture(undefined,(from,to)=>{sightChecks.push({...to});return to.x<100;});
  assert.ok(visibleIndicationGeometry(f.listener,f.segment));
  assert.equal(sightChecks.length,25);assert.ok(sightChecks.every(p=>p.x>=0&&p.x<=24));
  const copy=visibleIndicationGeometry(f.listener,f.segment);
  assert.notStrictEqual(copy,f.segment);assert.ok(Object.isFrozen(copy));assert.ok(Object.isFrozen(copy.origin));
});

test('peer locality, scene, detached geometry and ordinary sight range fail closed',()=>{
  const f=fixture();
  assert.equal(perceiveReferenceGeometry(f.listener,f.sender,f.segment,f.state).objectId,'object:1');
  f.sender.position={x:300,y:0};assert.equal(perceiveReferenceGeometry(f.listener,f.sender,f.segment,f.state).reason,'peer-not-visible');
  f.sender.position={x:1,y:0};assert.equal(perceiveReferenceGeometry(f.listener,f.sender,f.segment,f.state).reason,'invalid-gesture');
  f.sender.scene='other';assert.equal(perceiveReferenceGeometry(f.listener,f.sender,f.segment,f.state).reason,'peer-unavailable');
  f.listener.position={x:-390,y:0};assert.equal(visibleIndicationGeometry(f.listener,f.segment),null,'tip beyond400 cannot be seen');
});

test('actual observation cannot use a forged/copied active action as an indication',()=>{
  const f=fixture();
  f.sender.active={kind:'interaction',request:{type:'indicate_object',targetId:'object:1'},worked:1,seconds:1.8};
  assert.equal(observeIndication(f.listener,f.sender,f.state).objectId,null);
  assert.equal(observeIndication(f.listener,f.sender,f.state).reason,'invalid-gesture');
});

test('renderer draws the exact copied public segment and never an extrapolation or target endpoint',()=>{
  const g=referenceGeometry({x:10.5,y:20.25},{x:110.5,y:50.25},'valley',.7),calls=[];
  const context=Object.fromEntries(['save','restore','beginPath','stroke','moveTo','lineTo'].map(name=>[name,(...args)=>calls.push([name,...args])]));
  const before=structuredClone(g);drawIndicationGeometry(context,g);
  assert.deepEqual(calls.filter(c=>c[0]==='moveTo'),[['moveTo',g.origin.x,g.origin.y]]);
  assert.deepEqual(calls.filter(c=>c[0]==='lineTo'),[['lineTo',g.tip.x,g.tip.y]]);
  assert.deepEqual(g,before);assert.equal(REFERENCE_GEOMETRY_RULES.segmentLength,24);
  const n=calls.length;drawIndicationGeometry(context,null);assert.equal(calls.length,n);
});


test('NPC sprite transforms cannot translate, scale or height-offset the public cue twice',()=>{
  const world=createOzarkWorldGeometry(),state=createOzarkState(world),[sender,listener]=state.agents;
  for(const n of state.agents){bindOzarkWorldAgent(n,world,state);observeNpc(n,state.environment);}
  const targetId=Object.keys(sender.discovery.observations).find(id=>listener.discovery.observations[id]);
  assert.ok(targetId);assert.notEqual(sender.position.x,0);assert.notEqual(sender.position.y,0);
  assert.equal(requestNpcAction(listener,{type:'inspect_object',targetId},state.environment).ok,true);
  const selected=listener.active;for(let i=0;i<20&&listener.active;i++)tickNpc(listener,.1,state.environment);
  const permit=createIndicationPermit(sender,listener,selected,targetId);assert.ok(permit);
  assert.equal(requestNpcIndication(sender,permit,state.environment).ok,true);tickNpc(sender,.1,state.environment);
  const publicGeometry=publicIndicationGeometry(sender);assert.ok(publicGeometry);
  const perceived=observeIndication(listener,sender,state);
  assert.deepEqual(perceived.geometry,publicGeometry,'actual sensor consumes precisely the displayed paid projection');
  assert.deepEqual(perceived,perceiveReferenceGeometry(listener,sender,publicGeometry,state));
  const before=structuredClone(state),calls=[],stack=[];
  let matrix=[1.7,0,0,1.7,-83,47];const camera=matrix.slice();
  const mapped=(x,y)=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  const context={save(){stack.push(matrix.slice());},restore(){matrix=stack.pop();},
    translate(x,y){matrix[4]+=matrix[0]*x+matrix[2]*y;matrix[5]+=matrix[1]*x+matrix[3]*y;},
    scale(x,y){matrix[0]*=x;matrix[1]*=x;matrix[2]*=y;matrix[3]*=y;},
    fillRect(){},beginPath(){},stroke(){},
    moveTo(x,y){calls.push(['moveTo',...mapped(x,y)]);},lineTo(x,y){calls.push(['lineTo',...mapped(x,y)]);}};
  drawNpc(context,sender,123);
  const expected=p=>[camera[0]*p.x+camera[2]*p.y+camera[4],camera[1]*p.x+camera[3]*p.y+camera[5]];
  assert.deepEqual(calls,[['moveTo',...expected(publicGeometry.origin)],['lineTo',...expected(publicGeometry.tip)]]);
  assert.deepEqual(matrix,camera);assert.equal(stack.length,0);assert.deepEqual(state,before);
});


test('finite coordinate components with overflowing derived geometry fail closed',()=>{
  const invalid={scene:'valley',origin:{x:-Number.MAX_VALUE,y:0},tip:{x:Number.MAX_VALUE,y:0},progress:1};
  assert.equal(resolveIndication(invalid,own([100,0])).reason,'invalid-geometry');
  const valid=referenceGeometry({x:0,y:0},{x:100,y:0},'valley',1);
  assert.equal(resolveIndication(valid,own([Number.MAX_VALUE,Number.MAX_VALUE])).reason,'invalid-observation');
  const f=fixture();assert.equal(visibleIndicationGeometry(f.listener,invalid),null);
});
