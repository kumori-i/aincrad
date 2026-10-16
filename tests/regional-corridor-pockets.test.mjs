import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG} from '../src/config.js';
import {ECOLOGY_RULES as R, ECOLOGY_MATERIALS as MATERIALS} from '../src/ecology-config.js';
import {createEcology, ecologyEnergy, ecologyHabitatAudit, interactEcologyObject, senseEcology, tickEcology} from '../src/ecology.js';
import {habitatConditions, plantSuitability, regionAt, regionalResourceAudit} from '../src/ecology-regions.js';
import {corridorSegmentClear, sampleCorridor} from '../src/ecology-corridors.js';
import {tickPhysiology, exertPhysiology} from '../src/biology.js';
import {createNpc} from '../src/npc-state.js';
import {freshState, distance, moveActor, canStandOutside, waterDistance} from '../src/world.js';
import {loadSave, writeSave} from '../src/save.js';
import {SocialCoordinator} from '../src/social.js';

const POCKETS=[
  {near:{x:-5471.77,y:9600},from:'river:2',to:'pond:oldwood',end:'from'},
  {near:{x:8576.85,y:9696.85},from:'pond:meadow',to:'pond:south',end:'from'},
  {near:{x:9849.64,y:10969.64},from:'pond:meadow',to:'pond:south',end:'to'},
];
const clone=value=>structuredClone(value);
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,
  `expected ${expected}, received ${actual}`);
const pocket=(e,entry)=>{
  const found=e.plants.filter(p=>p.kind==='bramble'&&distance(p.position,entry.near)<5);
  assert.equal(found.length,1,`one fruiting pocket near ${JSON.stringify(entry.near)}`);
  return found[0];
};
const route=(audit,entry)=>{
  const found=audit.corridors.find(r=>r.from===entry.from&&r.to===entry.to);
  assert.ok(found,`${entry.from} to ${entry.to} route exists`);return found;
};
const gap=(route,fruit)=>Math.max(...sampleCorridor(route.points,300).map(p=>
  Math.min(...fruit.map(f=>distance(p,f.position)))));
function independentEnergy(e){
  const plants=e.plants.reduce((sum,p)=>sum+(p.kind==='grass'?p.biomassGrams*.35:
    p.quantity*(p.kind==='apple_tree'?95:19)),0);
  const animals=e.animals.reduce((sum,a)=>sum+a.structureKcal+a.physiology.availableEnergyKcal+
    a.physiology.storedEnergyKcal+a.physiology.stomach.reduce((n,item)=>n+item.remainingKcal,0),0);
  return plants+animals+e.materials.reduce((sum,m)=>sum+m.energyKcal,0)+e.detritus.energyKcal;
}

test('two fresh seeds gain three finite, suitable pockets without extra objects or hidden observations',()=>{
  for(const [seed,plantCount,berryCount] of [[74193,745,67],[424242,744,64]]){
    const e=createEcology(seed),other=createEcology(seed),audit=ecologyHabitatAudit(e);
    assert.deepEqual(e,other,`seed ${seed} is deterministic`);
    assert.equal(e.plants.length,plantCount);assert.equal(e.animals.length,108);
    assert.ok(e.plants.length<=R.maxPlants);
    assert.equal(e.plants.filter(p=>p.kind==='grass').length,610);
    assert.equal(e.plants.filter(p=>p.kind==='bramble').length,114);
    const sites=POCKETS.map(entry=>pocket(e,entry));
    assert.equal(new Set([...e.plants,...e.animals].map(o=>o.id)).size,e.plants.length+e.animals.length);
    assert.equal(sites.reduce((sum,p)=>sum+p.quantity,0),berryCount);
    for(const site of sites){
      assert.ok(canStandOutside(site.position.x,site.position.y,16));
      assert.ok(plantSuitability('bramble',site.position));
      assert.ok(habitatConditions(site.position).moisture>.32);
      assert.ok(site.quantity>0&&site.quantity<=site.capacity);
      const observed=senseEcology(e,site.position,'valley',50).find(o=>o.id===site.id);
      assert.ok(observed);
      assert.deepEqual(Object.keys(observed).sort(),['appearance','count','id','motion','position','scene']);
      assert.doesNotMatch(JSON.stringify(observed),/moisture|growth|capacity|kind|fruit|suitability|region/i);
    }
    const oldFruit=e.plants.filter(p=>['bramble','apple_tree'].includes(p.kind)&&!sites.includes(p));
    const newFruit=[...oldFruit,...sites];
    for(const entry of [POCKETS[0],POCKETS[1]]){
      const corridor=route(audit,entry);
      assert.ok(gap(corridor,oldFruit)>2000,'the original traverse had a remote fruit gap');
      assert.ok(gap(corridor,newFruit)<1200,'the suitable pockets shorten that gap');
    }
    close(ecologyEnergy(e),independentEnergy(e));close(e.ledger.initialKcal,independentEnergy(e));
    close(regionalResourceAudit(e).soilBalanceError,0);
  }
});

function siteOnRoute(points,site){
  let best=null;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((site.x-a.x)*dx+(site.y-a.y)*dy)/(dx*dx+dy*dy)));
    const projection={x:a.x+t*dx,y:a.y+t*dy},error=distance(site,projection);
    if(!best||error<best.error)best={i,projection,error};
  }
  assert.ok(best.error<1e-5,'pocket is on its original validated corridor');
  assert.ok(corridorSegmentClear(points[best.i-1],site));
  assert.ok(corridorSegmentClear(site,points[best.i]));
  return best.i;
}
function traverse(actor,targets,body){
  let travelled=0,seconds=0;
  for(const target of targets){
    let frames=0,stalled=0;
    while(distance(actor,target)>1e-5){
      assert.ok(++frames<2000,'each original corridor leg completes in a bounded time');
      const remaining=distance(actor,target),dt=Math.min(CONFIG.fixedStep,remaining/CONFIG.walkSpeed);
      const moved=moveActor(actor,target.x-actor.x,target.y-actor.y,dt);
      stalled=moved<.05?stalled+1:0;assert.ok(stalled<60,'physical movement must not stall');
      body.elapsed+=dt;tickPhysiology(body,dt,{feltTemperature:18,hour:8});
      exertPhysiology(body,moved/CONFIG.walkSpeed,1);
      travelled+=moved;seconds+=dt;
    }
  }
  return {travelled,seconds};
}
function reachableBank(anchor){
  for(let radius=20;radius<=400;radius+=20)for(let angle=0;angle<Math.PI*2;angle+=Math.PI/12){
    const p={x:anchor.x+radius*Math.cos(angle),y:anchor.y+radius*Math.sin(angle)};
    if(waterDistance(p.x,p.y)>=10&&waterDistance(p.x,p.y)<=45&&
       canStandOutside(p.x,p.y,16)&&corridorSegmentClear(anchor,p))return p;
  }
  assert.fail('water anchor has a physically reachable water-bank continuation');
}

test('actual fixed-step movement reaches each pocket, returns, and pays bodily travel cost',()=>{
  for(const seed of [74193,424242]){
    const e=createEcology(seed),audit=ecologyHabitatAudit(e);
    for(const entry of POCKETS){
      const site=pocket(e,entry).position,points=route(audit,entry).points;
      const i=siteOnRoute(points,site);
      const out=entry.end==='from'?[...points.slice(0,i),site]:[...points.slice(i).reverse(),site];
      const anchor=out[0],actor={...anchor},body=createNpc({id:'aster',mode:'discovery'});
      const before={kcal:body.physiology.totals.metabolizedKcal,water:body.physiology.totals.waterLostMl};
      const going=traverse(actor,out.slice(1),body),back=traverse(actor,out.slice(0,-1).reverse(),body);
      assert.ok(distance(actor,anchor)<1e-5);
      assert.ok(going.travelled>4000&&back.travelled>4000);
      close(going.travelled,back.travelled,12);
      assert.ok(body.physiology.totals.metabolizedKcal-before.kcal>100);
      assert.ok(body.physiology.totals.waterLostMl-before.water>120);
      assert.ok(body.physiology.health>0);
      const bank=reachableBank(anchor);
      traverse(actor,[bank,anchor],body);
      assert.ok(distance(actor,anchor)<1e-5);
    }
  }
});

test('depletion spends finite stock and clear weather does not instantly refill a remote pocket',()=>{
  const e=createEcology(74193),site=pocket(e,POCKETS[1]);
  e.plants=[site];e.animals=[];e.materials=[];
  for(const key of Object.keys(e.ledger))e.ledger[key]=0;
  e.ledger.initialKcal=ecologyEnergy(e);
  const initial=site.quantity,soil=regionAt(e,site.position).nutrients,moisture=site.moisture;
  for(let i=0;i<initial;i++)assert.ok(interactEcologyObject(e,site.id,'pull',
    {actorId:'aster',position:site.position,scene:'valley'}).ok);
  assert.equal(site.quantity,0);
  assert.equal(interactEcologyObject(e,site.id,'pull',
    {actorId:'aster',position:site.position,scene:'valley'}).code,'nothing_detached');
  for(let i=0;i<1200;i++)tickEcology(e,.5,{settings:{weatherOverride:'clear'}},[]);
  assert.equal(site.quantity,0,'ten real minutes do not create instant fruit');
  assert.ok(site.moisture<moisture,'marginal pocket dries under clear weather');
  for(let i=0;i<6000;i++)tickEcology(e,.5,{settings:{weatherOverride:'clear'}},[]);
  assert.equal(site.quantity,1,'one berry regrows after a whole clear-weather game day');
  assert.ok(site.quantity<=site.capacity);
  close(soil-regionAt(e,site.position).nutrients,site.quantity*MATERIALS.berry.massGrams*.004,1e-6);
  close(ecologyEnergy(e)+e.ledger.metabolizedKcal+e.ledger.decomposedKcal+
    e.ledger.discardedKcal+e.ledger.humanRemovedKcal,
    e.ledger.initialKcal+e.ledger.photosynthesisKcal+e.ledger.externalKcal,1e-4);
});

test('an existing depleted world keeps exact stock, body, notes and time through two disk reopenings',()=>{
  const state=freshState(),e=state.environment.ecology,removed=POCKETS.map(entry=>pocket(e,entry));
  e.plants=e.plants.filter(p=>!removed.includes(p));
  state.elapsed=state.environment.elapsed=e.elapsed=123.5;
  for(const agent of state.agents)agent.elapsed=123.5;
  const surviving=e.plants.find(p=>p.kind==='bramble');surviving.quantity=0;
  tickPhysiology(state.agents[0],25,{feltTemperature:18,hour:8});
  e.ledger.initialKcal=ecologyEnergy(e);
  const social=new SocialCoordinator({getAgents:()=>state.agents,getCommunity:()=>state.community,
    getEnvironment:()=>state.environment});
  assert.ok(social.action(state.agents[1],{type:'write_note',title:'Earlier field record',
    text:'Observed before this save was reopened.',beliefIds:[]}).ok);
  const directory=mkdtempSync(join(tmpdir(),'aincrad-corridor-save-')),path=join(directory,'save.json');
  const storage={getItem:()=>readFileSync(path,'utf8'),setItem:(_key,value)=>writeFileSync(path,value)};
  try{
    writeFileSync(path,JSON.stringify(state));
    const first=loadSave(storage);assert.equal(first.blocked,false);
    assert.equal(first.state.environment.ecology.plants.length,e.plants.length);
    assert.ok(removed.every(p=>!first.state.environment.ecology.plants.some(q=>q.id===p.id)));
    assert.equal(first.state.environment.ecology.plants.find(p=>p.id===surviving.id).quantity,0);
    const snapshot=JSON.stringify({ecology:first.state.environment.ecology,agents:first.state.agents,
      community:first.state.community,elapsed:first.state.elapsed});
    assert.equal(writeSave(storage,first.state),true);
    const second=loadSave(storage);assert.equal(second.blocked,false);
    assert.equal(writeSave(storage,second.state),true);
    const third=loadSave(storage);assert.equal(third.blocked,false);
    for(const reopened of [second,third])assert.equal(JSON.stringify({ecology:reopened.state.environment.ecology,
      agents:reopened.state.agents,community:reopened.state.community,elapsed:reopened.state.elapsed}),snapshot);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
