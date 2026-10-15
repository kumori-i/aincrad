import test from 'node:test';
import assert from 'node:assert/strict';
import { AtlasViewport, atlasActors } from '../src/atlas.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('atlas inverse preserves waypoint coordinates after zoom, drag and resize',()=>{
  const atlas=new AtlasViewport();atlas.zoomAt(8,420,280);atlas.pan(-73,51);atlas.resize(700,400);
  for(const world of [{x:0,y:0},{x:1800,y:-1200}]){const screen=atlas.toCanvas(world.x,world.y),back=atlas.toWorld(screen.x,screen.y);assert.ok(back);close(back.x,world.x);close(back.y,world.y);}
  assert.equal(atlas.toWorld(-1,10),null);assert.equal(atlas.toWorld(NaN,10),null);
});
test('atlas zoom anchors the pointer and clamps finite pan/zoom to world bounds',()=>{
  const atlas=new AtlasViewport();atlas.zoomAt(4);const before=atlas.toWorld(460,300);atlas.zoomAt(2,460,300);const after=atlas.toWorld(460,300);close(after.x,before.x);close(after.y,before.y);
  atlas.pan(Infinity,0);assert.ok(Number.isFinite(atlas.center.x));atlas.zoomAt(100000);assert.equal(atlas.zoom,64);atlas.centerOn(-100000,100000);assert.ok(atlas.center.x>-24000&&atlas.center.y<24000);
  atlas.fit();assert.equal(atlas.zoom,1);assert.deepEqual(atlas.center,{x:0,y:0});assert.equal(atlas.toWorld(0,0),null);
});
test('whole-world human markers use cave entrances without mutating actors or memories',()=>{
  const state={scene:'valley',player:{x:1,y:2},agents:[{id:'aster',name:'Aster',scene:'refuge',position:{x:1320,y:1510},memory:{cells:{}}},{id:'mira',name:'Mira',scene:'valley',position:{x:18000,y:-16000}}]};
  const original=structuredClone(state),markers=atlasActors(state,[{id:'refuge',name:'Willow Refuge',x:400,y:700}]);
  assert.equal(markers.length,3);assert.deepEqual(markers[1].position,{x:400,y:700});assert.equal(markers[1].place,'Willow Refuge');assert.equal(markers[1].inCave,true);assert.deepEqual(markers[2].position,{x:18000,y:-16000});assert.deepEqual(state,original);
});
