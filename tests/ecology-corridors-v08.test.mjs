import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHabitatCorridors,sampleCorridor,corridorSegmentClear} from '../src/ecology-corridors.js';
import {canStandOutside,riverX,riverWidth,onBridge,distance} from '../src/world.js';
import {createEnvironment,environmentConditions} from '../src/environment.js';
import {habitatConditions} from '../src/ecology-regions.js';
import {regionalHabitatAnchors} from '../src/ecology.js';
import {createPhysiology,tickPhysiology} from '../src/biology.js';
import {CONFIG} from '../src/config.js';

// These are engine geometry checks. They do not grant routes to a controller,
// prove a nutritious corridor, or establish that an inhabitant has migrated.
test('hydric refuges have real connected paths and bounded arc-length steps',()=>{
  const anchors=regionalHabitatAnchors(),routes=buildHabitatCorridors(anchors);
  assert.equal(routes.failures.length,0);assert.equal(routes.length,anchors.length-1);
  const connected=new Set([anchors[0].key]);
  for(const route of routes){
    assert.ok(connected.has(route.from));connected.add(route.to);
    let length=0;
    for(let i=1;i<route.points.length;i++){
      assert.ok(corridorSegmentClear(route.points[i-1],route.points[i]));length+=distance(route.points[i-1],route.points[i]);
    }
    assert.ok(Math.abs(length-route.length)<1e-7);
    const samples=sampleCorridor(route.points,300);
    assert.ok(samples.length>=2);assert.deepEqual(samples[0],route.points[0]);assert.deepEqual(samples.at(-1),route.points.at(-1));
    for(let i=0;i<samples.length;i++){
      assert.ok(canStandOutside(samples[i].x,samples[i].y,16));
      if(i)assert.ok(distance(samples[i],samples[i-1])<=300+1e-7);
    }
  }
  assert.equal(connected.size,anchors.length);
  assert.deepEqual(buildHabitatCorridors(anchors),routes);
  assert.ok(Object.isFrozen(routes)&&Object.isFrozen(routes[0].points[0]));
});

test('opposite river banks route through a real bridge instead of crossing water',()=>{
  const y=6000,x=riverX(y),width=riverWidth(y);
  const anchors=[{key:'west',x:x-width-240,y},{key:'east',x:x+width+240,y}];
  assert.equal(corridorSegmentClear(...anchors),false);
  const routes=buildHabitatCorridors(anchors);assert.equal(routes.length,1);assert.equal(routes.failures.length,0);
  assert.ok(routes[0].length>distance(...anchors)*2);
  assert.ok(sampleCorridor(routes[0].points,12).some(p=>onBridge(p.x,p.y)));
});

test('invalid endpoints, cap failures and blocked sample paths stay explicit',()=>{
  const a={key:'valid',x:0,y:0},before=structuredClone(a);
  const routes=buildHabitatCorridors([a,{key:'lake',x:-3550,y:-6500},{key:'invalid',x:NaN,y:0},a]);
  assert.ok(routes.failures.some(f=>f.to==='lake'&&f.reason==='invalid_anchor'));
  assert.ok(routes.failures.some(f=>f.to==='invalid'));
  assert.ok(routes.failures.some(f=>f.to==='valid'));
  assert.deepEqual(a,before);
  const capped=buildHabitatCorridors(Array.from({length:33},(_,i)=>({key:`bad:${i}`,x:24000,y:24000})));
  assert.ok(capped.failures.some(f=>f.reason==='anchor_limit'));
  assert.equal(capped.length,0);
  assert.deepEqual(sampleCorridor([{x:-3550,y:-6500},{x:0,y:0}]),[]);
});

test('actual discovery environment applies regional temperature to body exposure',()=>{
  const env=createEnvironment(3,{mode:'discovery'});env.settings.hourOverride=14;env.settings.weatherOverride='clear';
  const points=regionalHabitatAnchors().filter(a=>a.key==='river:0'||a.key==='river:3');
  assert.equal(points.length,2);
  const records=points.map(position=>{
    const actor={position,scene:'valley',physiology:createPhysiology('human')};
    const local=environmentConditions(env,actor),legacy=environmentConditions({...env,mode:'legacy'},actor);
    assert.ok(Math.abs(local.airTemperature-legacy.airTemperature-habitatConditions(position).temperatureOffsetC)<1e-10);
    tickPhysiology(actor,CONFIG.dayRealSeconds/24,local,{activity:'awake'});
    const expected=2100/24*(1+Math.max(0,local.feltTemperature-26)*.09);
    assert.ok(Math.abs(actor.physiology.totals.waterLostMl-expected)<1e-7);
    return local;
  });
  assert.notEqual(records[0].airTemperature,records[1].airTemperature);
  assert.equal(environmentConditions(env,{position:points[0],scene:'refuge'}).airTemperature,18);
});
