import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, CAVES, SPAWN, CAVE_SPAWN, CAVE_EXIT } from '../src/config.js';
import { hash, noise, terrain, canStand, canStandOutside, canStandCave, moveActor, riverX, BRIDGES, CAVE_ROOMS, nearestInteraction, freshState, clockTime, objectsInRect, caveDistance } from '../src/world.js';

test('world width and walking speed define a five-minute reference crossing',()=>{assert.equal(CONFIG.valleyRadius*2/CONFIG.walkSpeed,300);});
test('one day is one real hour of active simulation',()=>{assert.equal(CONFIG.dayRealSeconds,3600);assert.deepEqual(clockTime(0),{day:1,hour:8,minute:0,fraction:1/3});assert.equal(clockTime(3600).day,2);assert.equal(clockTime(3600).hour,8);});
test('seeded generation is deterministic and bounded',()=>{for(let x=-100;x<100;x++){assert.equal(hash(x,9),hash(x,9));assert.ok(hash(x,9)>=0&&hash(x,9)<1);assert.ok(noise(x*8,89)>=0&&noise(x*8,89)<=1);}});
test('spawn is valid and dry',()=>{assert.ok(canStandOutside(SPAWN.x,SPAWN.y));});
test('all four edges and corners of the mountain boundary block the player',()=>{for(const[x,y]of[[23000,0],[-23000,0],[0,23000],[0,-23000],[22000,22000],[-22000,-22000]])assert.equal(canStandOutside(x,y),false);});
test('deep lake and river water are not walkable',()=>{assert.equal(canStandOutside(-3550,-6500),false);for(const y of [2500,6800,16000])assert.equal(canStandOutside(riverX(y),y),false);});
test('all three bridge centers are walkable',()=>{for(const b of BRIDGES)assert.ok(canStandOutside(b.x,b.y));});
test('central path is continuously passable from mountain to mountain',()=>{for(let x=-22480;x<=22480;x+=20)assert.ok(canStandOutside(x,0),`blocked at ${x}`);});
test('a real movement simulation traverses the central trail in ~300 seconds',()=>{
  const p={x:-22480,y:0};for(let i=0;i<18000;i++)moveActor(p,1,0,1/60);
  assert.ok(p.x>22470,`only reached ${p.x}`);assert.ok(p.x<22500);assert.equal(p.y,0);
});
test('diagonal input is normalized to the same speed as axial input',()=>{
  const a={x:5000,y:0},b={...a};moveActor(a,1,0,.1);moveActor(b,1,1,.1);
  assert.ok(Math.abs(Math.hypot(a.x-5000,a.y)-Math.hypot(b.x-5000,b.y))<1e-8);
});
test('sprinting is explicitly faster than the reference walking speed',()=>{
  const a={x:5000,y:0},b={...a};moveActor(a,1,0,.1);moveActor(b,1,0,.1,true);assert.ok(Math.abs((b.x-5000)/(a.x-5000)-CONFIG.sprintMultiplier)<1e-8);
});
test('large frame gaps are capped and cannot teleport a player across a lake',()=>{const p={x:0,y:0};moveActor(p,1,0,900);assert.ok(p.x<=CONFIG.walkSpeed*.25+1e-6);});
test('nonfinite positions and invalid timesteps are rejected',()=>{assert.equal(canStand(NaN,0),false);assert.equal(canStand(Infinity,0),false);const p={...SPAWN};assert.equal(moveActor(p,1,0,NaN),0);assert.equal(moveActor(p,1,0,-1),0);assert.deepEqual(p,SPAWN);});
test('trees and rocks have solid trunks / bases',()=>{const objects=objectsInRect(4000,3500,2200,2200);assert.ok(objects.length>0);for(const o of objects)assert.equal(canStandOutside(o.x,o.y),false);});
test('all three cave mouths have a walkable approach and interaction',()=>{
  for(const c of CAVES){for(let y=c.y+55;y<c.y+500;y+=20)assert.ok(canStandOutside(c.x,y),`${c.id}: ${y}`);assert.equal(nearestInteraction({x:c.x,y:c.y+55},'valley')?.id,c.id);}
});
test('caves have a safe spawn and a nearby exit',()=>{assert.ok(canStandCave(CAVE_SPAWN.x,CAVE_SPAWN.y));assert.equal(nearestInteraction(CAVE_SPAWN,'lantern').type,'exit');assert.ok(canStandCave(CAVE_EXIT.x,CAVE_EXIT.y));});
test('cave walls are solid',()=>{for(const p of [[0,0],[200,200],[2500,1700],[1320,1800]])assert.equal(canStandCave(...p),false);});
test('all cave chambers can be reached from the entrance without crossing walls',()=>{
  const grid=25,key=(x,y)=>`${x},${y}`,start=[Math.round(CAVE_SPAWN.x/grid),Math.round(CAVE_SPAWN.y/grid)],queue=[start],seen=new Set([key(...start)]);
  for(let head=0;head<queue.length;head++){
    const[x,y]=queue[head];for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,k=key(nx,ny);if(!seen.has(k)&&canStandCave(nx*grid,ny*grid)){seen.add(k);queue.push([nx,ny]);}}
  }
  for(const room of CAVE_ROOMS)assert.ok(queue.some(([x,y])=>Math.hypot(x*grid-room.x,y*grid-room.y)<70),`unreachable room ${room.x},${room.y}`);
});
test('world and cave collision rules remain separate',()=>{assert.ok(terrain(0,0)!=='mountain');assert.equal(canStand(0,0,'lantern'),false);});
test('fresh worlds have independent human and NPC state',()=>{const a=freshState(),b=freshState();a.player.x=12;a.discoveries.push('lake');assert.notEqual(a.player.x,b.player.x);assert.deepEqual(b.discoveries,['trailhead']);assert.equal(b.scene,'valley');assert.notEqual(a.npc,b.npc);assert.equal(b.npc.id,'aster');assert.deepEqual(b.npc.memory.skills,[]);});
