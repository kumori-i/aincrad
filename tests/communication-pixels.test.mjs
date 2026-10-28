import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { createEnvironment } from '../src/environment.js';
import { observeNpc,requestNpcAction,tickNpc } from '../src/npc.js';
import { canStand } from '../src/world.js';
import { createCommunicationPixelSensor,poolCommunicationPixels } from '../src/communication-pixels.js';

// Canvas plumbing fixture, NOT evidence about real rendered appearance. Native
// comparisons use actual drawEcologyObject and browser Canvas2D.
function documentFixture(){
  return {createElement(){const canvas={width:0,height:0};const context={setTransform(){},clearRect(){},fillRect(){},drawImage(){},getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){data[i]=200;data[i+1]=100;data[i+2]=50;data[i+3]=255;}return {data};}};canvas.getContext=()=>context;return canvas;}};
}
function fixture(){const n=createNpc({mode:'discovery',seed:74193}),environment=createEnvironment(74193,{mode:'discovery'});const plant=environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>0);n.position=[{x:plant.position.x+45,y:plant.position.y},{x:plant.position.x-45,y:plant.position.y}].find(p=>canStand(p.x,p.y,'valley'));observeNpc(n,environment);return {n,plant,state:{environment,elapsed:0}};}

test('fixed pooling is numeric bounded RGB processing without semantic labels',()=>{
  const pixels=Array.from({length:768},(_,i)=>[255,128,0][i%3]);const pooled=poolCommunicationPixels(pixels);assert.equal(pooled.length,48);for(let i=0;i<48;i+=3){assert.equal(pooled[i],1);assert.ok(Math.abs(pooled[i+1]-128/255)<1e-12);assert.equal(pooled[i+2],0);}
  assert.throws(()=>poolCommunicationPixels([255]));assert.throws(()=>poolCommunicationPixels(Array(768).fill(NaN)));
});

test('sensor only renders genuinely observed current objects and returns numeric crops',()=>{
  const {n,plant,state}=fixture(),drawn=[],sensor=createCommunicationPixelSensor(documentFixture(),{draw:(g,sprite)=>drawn.push(sprite.id)});
  const crops=sensor.capture(n,state);assert.ok(crops.has(plant.id));assert.ok(drawn.includes(plant.id));
  const crop=crops.get(plant.id);assert.deepEqual(Object.keys(crop).sort(),['at','epoch','features','observedAt','pixels']);assert.equal(crop.pixels.length,768);assert.equal(crop.features.length,48);
  n.elapsed+=2;assert.equal(sensor.capture(n,state).size,0,'stale observations are not rendered');
  observeNpc(n,state.environment);n.lifecycle='COLLAPSED';assert.equal(sensor.capture(n,state).size,0);n.lifecycle='AWAKE';sensor.dispose();assert.equal(sensor.capture(n,state).size,0);
});

test('missing, transferred, and no longer locally visible objects cannot supply fresh crops',()=>{
  const {n,plant,state}=fixture(),sensor=createCommunicationPixelSensor(documentFixture(),{draw(){}});
  plant.heldBy='someone-else';assert.equal(sensor.capture(n,state).has(plant.id),false);delete plant.heldBy;
  const previous={...plant.position};plant.position={x:n.position.x+10000,y:n.position.y};assert.equal(sensor.capture(n,state).has(plant.id),false);plant.position=previous;
  state.environment.ecology.plants=state.environment.ecology.plants.filter(p=>p!==plant);assert.equal(sensor.capture(n,state).has(plant.id),false);sensor.dispose();
});


test('held crop uses the same visual projection only after personal acquisition',()=>{
  const {n,plant,state}=fixture(),drawn=[],sensor=createCommunicationPixelSensor(documentFixture(),{draw:(g,sprite)=>drawn.push(sprite.id)});
  assert.equal(requestNpcAction(n,{type:'pull',targetId:plant.id},state.environment).code,'ACTION_STARTED');
  for(let i=0;i<100&&n.active;i++)tickNpc(n,.25,state.environment);
  assert.equal(n.lastResult.ok,true);const id=n.inventory.items[0];assert.ok(id);observeNpc(n,state.environment);
  assert.ok(sensor.capture(n,state).has(id));assert.ok(drawn.includes(id));
  const material=state.environment.ecology.materials.find(m=>m.id===id);assert.equal(material.heldBy,n.id,'rendering must preserve ownership');
  material.heldBy='other';assert.equal(sensor.capture(n,state).has(id),false);sensor.dispose();
});
