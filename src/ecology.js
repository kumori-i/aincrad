import { CONFIG, PONDS, APPLE_PATCHES, CAVES, CAVE_SPAWN } from './config.js';
import { ECOLOGY_RULES as R, ECOLOGY_SPECIES as SPECIES, ECOLOGY_MATERIALS as MATERIALS } from './ecology-config.js';
import { hash, distance, canStandOutside, canStandCave, waterDistance, riverX, riverWidth } from './world.js';
import { environmentConditions } from './environment.js';
import { createPhysiology, validatePhysiology, tickPhysiology, exertPhysiology, ingestMaterial, beginSleep, wakePhysiology, isSleeping } from './biology.js';
import { BIOLOGY_PROFILES } from './biology-config.js';

const finite = (v,f=0) => Number.isFinite(v)?v:f;
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,finite(v,lo)));
const hours = seconds => seconds / CONFIG.dayRealSeconds * 24;
const positionOf = actor => actor?.position || actor;
const idPattern = /^object:[1-9][0-9]{0,8}$/;
const speciesNames = Object.keys(SPECIES);
const materialNames = Object.keys(MATERIALS);
const activities = ['idle','moving','fleeing','chasing','feeding','drinking','resting','sleeping'];
const emptyLedger = () => ({initialKcal:0,photosynthesisKcal:0,humanRemovedKcal:0,metabolizedKcal:0,decomposedKcal:0,discardedKcal:0,birthTransferredKcal:0,externalKcal:0,waterConsumedMl:0});
const nextId = e => `object:${e.nextId++}`;
function safePoint(x,y,radius=10) {
  x=clamp(x,-CONFIG.halfSize+100,CONFIG.halfSize-100);y=clamp(y,-CONFIG.halfSize+100,CONFIG.halfSize-100);
  if(canStandOutside(x,y,radius))return{x,y};
  for(let ring=1;ring<32;ring++)for(let a=0;a<12;a++){
    const px=x+Math.cos(a*Math.PI/6)*ring*22,py=y+Math.sin(a*Math.PI/6)*ring*22;
    if(canStandOutside(px,py,radius))return{x:px,y:py};
  }
  return {x:276,y:760};
}
function plant(e,kind,p,index) {
  const point=safePoint(p.x,p.y),capacity=kind==='grass'?R.grassCapacityGrams:kind==='apple_tree'?10:28;
  const count=kind==='grass'?0:Math.round(capacity*(.55+hash(index,8,e.seed)*.35));
  const out={id:nextId(e),kind,scene:'valley',position:point,capacity,quantity:count,
    biomassGrams:kind==='grass'?capacity*(.7+hash(index,9,e.seed)*.2):0,moisture:.65,
    stage:kind==='grass'?'green':'ripe',growth:0,seasonIndex:0,fallHours:0,ageDays:kind==='apple_tree'?2000:400};
  e.plants.push(out);return out;
}
function animal(e,species,p,elapsed=0,{juvenile=false,energyKcal,structureKcal}={}){
  const rules=SPECIES[species],pos=safePoint(p.x,p.y,rules.radius);
  const capacity=BIOLOGY_PROFILES[species].availableCapacityKcal;
  const body=createPhysiology(species,{availableEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.4:Math.min(capacity,energyKcal),storedEnergyKcal:energyKcal===undefined?rules.initialReserveKcal*.6:Math.max(0,energyKcal-capacity)});
  const out={id:nextId(e),species,scene:'valley',position:pos,physiology:body,health:100,
    energy:80,hydration:100,nourishment:80,stamina:100,fatigue:0,sleepPressure:0,
    thermal:{hot:0,cold:0,wetness:0},bodyMode:'awake',activity:'idle',ageDays:juvenile?0:60,
    structureKcal:structureKcal ?? rules.structureKcal,lastBirthHours:hours(elapsed)-rules.birthIntervalDays*24,
    targetId:null,targetPosition:null,targetKind:null,homePosition:{...pos},lastAttackAt:-100,cooldownHours:0,bornAt:elapsed,
    direction:hash(e.nextId,44,e.seed)*Math.PI*2,actionHours:0};
  e.animals.push(out);return out;
}
/** Authoritative starting ecosystem. Tree/animal labels remain private to the engine. */
export function createEcology(seed=CONFIG.seed,elapsed=0) {
  const e={version:R.version,seed:Number.isInteger(seed)?seed>>>0:CONFIG.seed,elapsed:Math.max(0,finite(elapsed)),pending:0,nextId:1,
    plants:[],animals:[],materials:[],detritus:{massGrams:0,nutrients:2500,energyKcal:0},ledger:emptyLedger(),births:0,deaths:0};
  const anchors=[{x:360,y:1080},...APPLE_PATCHES.map(p=>({x:p.x,y:p.y})),...PONDS.slice(1).map(p=>({x:p.x-280,y:p.y+230}))];
  anchors.forEach((p,i)=>{
    plant(e,i%2===0?'apple_tree':'bramble',p,i);
    plant(e,'bramble',{x:p.x+130,y:p.y+90},i+25);
    for(let n=0;n<4;n++)plant(e,'grass',{x:p.x+(n%2?160:-120),y:p.y+(n<2?160:-145)},i*4+n);
  });
  // Starter creatures are close enough to observe; predators begin farther away.
  for(let i=0;i<14;i++)animal(e,'rabbit',{x:anchors[i%7].x-80+(i>=7?75:0),y:anchors[i%7].y+200},elapsed);
  for(const p of [anchors[7],anchors[9]])for(let i=0;i<2;i++)animal(e,'rabbit',{x:p.x-60+i*60,y:p.y+150},elapsed);
  for(const [species,point] of [['fox',{x:1750,y:1500}],['fox',{x:5100,y:4850}],['fox',{x:-10400,y:7650}],['bobcat',{x:9000,y:-6750}],['bobcat',{x:11900,y:15100}]])animal(e,species,point,elapsed);
  e.ledger.initialKcal=ecologyEnergy(e);return e;
}
function plantEnergy(p){return p.kind==='grass'?p.biomassGrams*R.grassKcalPerGram:p.quantity*(p.kind==='apple_tree'?MATERIALS.apple.energyKcal:MATERIALS.berry.energyKcal);}
function bodyEnergy(p){return Math.max(0,finite(p?.availableEnergyKcal))+Math.max(0,finite(p?.storedEnergyKcal))+(p?.stomach||[]).reduce((n,v)=>n+Math.max(0,finite(v.remainingKcal)),0);}
/** An engine audit, never an agent observation. Transfers are counted once. */
export function ecologyEnergy(e) {
  return (e.plants||[]).reduce((n,p)=>n+plantEnergy(p),0)+(e.animals||[]).reduce((n,a)=>n+a.structureKcal+bodyEnergy(a.physiology),0)+
    (e.materials||[]).reduce((n,m)=>n+m.energyKcal,0)+finite(e.detritus?.energyKcal);
}
export function lookupEcologyObject(e,id) {
  if(!e || typeof id!=='string' || !idPattern.test(id))return null;
  return [...e.plants,...e.animals,...e.materials].find(o=>o.id===id)||null;
}
function appearance(o){
  if(o.species){
    const s=o.species;
    return {shape:s==='rabbit'?'small furry body with long ears':s==='bobcat'?'stocky furry body with a short tail':'slender furry body with a long bushy tail',color:s==='rabbit'?'brown-grey':s==='bobcat'?'mottled brown':'russet and pale',texture:'fur',sound:o.activity==='chasing'?'rapid footfalls':o.activity==='sleeping'?'quiet breathing':'soft rustling'};
  }
  if(o.kind==='apple_tree')return{shape:'branching trunk with a leafy crown',color:o.stage==='flowering'?'green and pale blossoms':'brown and green',texture:'rough bark',details:o.quantity?'round red-green growths among leaves':o.stage==='growing'?'small green growths among leaves':'bare branches among leaves'};
  if(o.kind==='bramble')return{shape:'low tangled stems',color:'green and purple',texture:'prickly stems',details:o.quantity?'small purple clusters':'leaves and stems'};
  if(o.kind==='grass')return{shape:'tuft of narrow blades',color:o.moisture<.2?'yellow-green':'green',texture:'fibrous',details:o.biomassGrams<100?'closely cropped':'dense blades'};
  if(o.kind==='carcass')return{shape:'still furry body',color:'brown and dark red',texture:'fur and exposed soft tissue',smell:o.spoiled?'sharp and unpleasant':'strong'};
  const m=MATERIALS[o.materialType]||MATERIALS.grass;
  return{shape:m.shape,color:m.color,texture:m.texture,smell:o.spoiled?'sharp and unpleasant':m.smell};
}
function publicObject(o){return{id:o.id,scene:o.scene,position:{...o.position},appearance:appearance(o),
  motion:o.species?(['moving','fleeing','chasing'].includes(o.activity)?'moving':o.activity==='sleeping'?'still with slow breathing':'still'):'still',
  count:o.species?1:o.kind==='grass'?Math.floor(o.biomassGrams/45):Math.max(1,Math.ceil(o.quantity ?? o.massGrams/100))};}
/** Sensory data contains no diet, food, calorie, species or edibility labels. */
export function senseEcology(e,position,scene='valley',radius=400) {
  if(!e||!position||!Number.isFinite(position.x)||!Number.isFinite(position.y))return[];
  const r=clamp(radius,0,1200);
  return [...e.plants,...e.animals,...e.materials].filter(o=>o.scene===scene&&!o.heldBy&&distance(o.position,position)<=r)
    .slice(0,96).map(publicObject);
}
export function describeEcologyObject(e,id,{actorId}={}) {
  const o=lookupEcologyObject(e,id);if(!o||o.heldBy&&o.heldBy!==actorId)return null;return publicObject(o);
}
/** Private visual-only projection; controllers must use senseEcology instead. */
export function renderEcology(e,scene='valley') {
  if(!e)return[];
  return [...e.plants,...e.animals,...e.materials].filter(o=>o.scene===scene&&!o.heldBy).map(o=>({id:o.id,kind:o.species||o.kind,scene:o.scene,position:{...o.position},x:o.position.x,y:o.position.y,
    stage:o.stage|| (o.spoiled?'spoiled':'fresh'),quantity:o.quantity??1,biomass:o.biomassGrams,biomassRatio:o.kind==='grass'?clamp(o.biomassGrams/o.capacity,0,1):undefined,
    facing:o.species?{x:Math.cos(o.direction),y:Math.sin(o.direction)}:undefined,
    activity:o.activity||'idle',sleeping:o.species?isSleeping(o):false,shape:appearance(o).shape,color:appearance(o).color}));
}
function addDetritus(e,mass,energy){e.detritus.massGrams=Math.min(R.maxDetritus,e.detritus.massGrams+Math.max(0,mass));e.detritus.energyKcal+=Math.max(0,energy);}
function addMaterial(e,type,pos,{massGrams,energyKcal,waterMl,heldBy=null,kind='material'}={}) {
  const def=MATERIALS[type];
  if(e.materials.length>=R.maxMaterials){e.ledger.discardedKcal+=Math.max(0,finite(energyKcal,def.energyKcal));addDetritus(e,finite(massGrams,def.massGrams),0);return null;}
  const m={id:nextId(e),kind,materialType:type,scene:'valley',position:{...pos},heldBy,
    massGrams:Math.max(0,finite(massGrams,def.massGrams)),energyKcal:Math.max(0,finite(energyKcal,def.energyKcal)),waterMl:Math.max(0,finite(waterMl,def.waterMl)),
    createdAt:e.elapsed,ageHours:0,spoiled:false,digestHours:def.digestHours,toxicity:def.toxicity||0};
  e.materials.push(m);return m;
}
function detached(e,p,actorId){
  if(p.kind==='apple_tree'||p.kind==='bramble'){
    if(p.quantity<=0)return null;p.quantity--;
    return addMaterial(e,p.kind==='apple_tree'?'apple':'berry',p.position,{heldBy:actorId});
  }
  if(p.kind==='grass'){
    const amount=Math.min(MATERIALS.grass.massGrams,p.biomassGrams);if(amount<1)return null;
    p.biomassGrams-=amount;
    // Human digestion cannot access the cellulose energy rabbits obtain.
    const energy=amount*R.grassKcalPerGram;
    e.ledger.discardedKcal+=energy;
    return addMaterial(e,'grass',p.position,{heldBy:actorId,massGrams:amount,energyKcal:0,waterMl:amount*MATERIALS.grass.waterMl/MATERIALS.grass.massGrams});
  }
  return null;
}
function removeMaterial(e,m){const i=e.materials.indexOf(m);if(i>=0)e.materials.splice(i,1);}
function death(e,a){
  if(!e.animals.includes(a))return;
  const energy=a.structureKcal+bodyEnergy(a.physiology),mass=energy/MATERIALS.flesh.energyKcal*MATERIALS.flesh.massGrams;
  addMaterial(e,'flesh',a.position,{kind:'carcass',massGrams:mass,energyKcal:energy,waterMl:mass*.7});
  e.animals.splice(e.animals.indexOf(a),1);e.deaths++;
}
/** Engine interaction. Reach and ownership are checked again at completion. */
export function interactEcologyObject(e,id,verb,{actorId,position,scene='valley',power=1,amount=.02}={}){
  const o=lookupEcologyObject(e,id);
  if(!o)return{ok:false,code:'object_missing'};
  if(!['aster','mira'].includes(actorId)||!position||!Number.isFinite(position.x)||!Number.isFinite(position.y)||!['valley',...CAVES.map(c=>c.id)].includes(scene)||(scene!==o.scene||distance(position,o.position)>R.reach)&&o.heldBy!==actorId)return{ok:false,code:'object_out_of_reach'};
  if(o.heldBy&&o.heldBy!==actorId)return{ok:false,code:'object_held_elsewhere'};
  if(verb==='inspect_object')return{ok:true,code:'object_observed',targetId:id,object:publicObject(o)};
  if(verb==='grasp'){
    if(o.species)return{ok:false,code:'object_resists_grasp',targetId:id};
    if(o.kind!=='material'&&o.kind!=='carcass')return{ok:false,code:'object_still_attached',targetId:id};
    if(o.kind==='carcass')return{ok:false,code:'object_too_heavy',targetId:id};
    o.heldBy=actorId;return{ok:true,code:'object_held',targetId:id,materialId:id,material:{id}};
  }
  if(verb==='release'){
    if(o.heldBy!==actorId)return{ok:false,code:'object_not_held'};
    o.heldBy=null;o.position={...position};o.scene=scene;return{ok:true,code:'object_released',targetId:id};
  }
  if(verb==='pull'){
    if(o.species)return{ok:false,code:'object_resists_pull',targetId:id};
    if(o.kind==='carcass'){
      const grams=Math.min(100,o.massGrams),fraction=grams/o.massGrams;
      if(grams<1)return{ok:false,code:'nothing_detached',targetId:id};
      const m=addMaterial(e,'flesh',o.position,{heldBy:actorId,massGrams:grams,energyKcal:o.energyKcal*fraction,waterMl:o.waterMl*fraction});
      o.massGrams-=grams;o.energyKcal*=1-fraction;o.waterMl*=1-fraction;if(o.massGrams<1){addDetritus(e,o.massGrams,o.energyKcal);removeMaterial(e,o);}
      if(!m)return{ok:false,code:'object_limit',targetId:id};m.spoiled=o.spoiled;m.ageHours=o.ageHours;
      return{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}};
    }
    const m=detached(e,o,actorId);
    return m?{ok:true,code:'piece_detached',targetId:id,materialId:m.id,material:{id:m.id}}:{ok:false,code:'nothing_detached',targetId:id};
  }
  if(verb==='strike'){
    if(o.species){
      o.physiology.health=Math.max(0,o.physiology.health-clamp(power,0,4)*7);o.health=o.physiology.health;
      wakePhysiology(o,{kind:'contact',strength:1});o.activity='fleeing';o.targetId=null;
      o.targetPosition=safePoint(o.position.x+(o.position.x-position.x)*4,o.position.y+(o.position.y-position.y)*4,SPECIES[o.species].radius);
      if(o.health<=0)death(e,o);
      return{ok:true,code:o.health<=0?'object_stopped_moving':'object_recoiled',targetId:id};
    }
    return{ok:true,code:'object_struck',targetId:id};
  }
  return{ok:false,code:'unknown_primitive',targetId:id};
}
/** A finite held portion; nutrition is returned only to authoritative biology. */
export function consumeEcologyMaterial(e,id,amount=.02,{actorId,accept}={}){
  const m=lookupEcologyObject(e,id);
  if(!m||m.kind!=='material'||m.heldBy!==actorId)return{ok:false,code:'object_not_held'};
  const fraction=clamp(amount,.001,1),energyKcal=m.energyKcal*fraction,waterMl=m.waterMl*fraction,massGrams=m.massGrams*fraction;
  const material={energyKcal,waterMl,massGrams,digestHours:m.digestHours,toxicity:m.toxicity+(m.spoiled?.3:0),objectId:m.id};
  const ingestion=typeof accept==='function'?accept({...material}):null;
  if(ingestion&&ingestion.ok!==true)return{ok:false,code:ingestion.code||'cannot_swallow',ingestion};
  m.energyKcal-=energyKcal;m.waterMl-=waterMl;m.massGrams-=massGrams;e.ledger.humanRemovedKcal+=energyKcal;
  if(m.massGrams<.1){e.ledger.discardedKcal+=m.energyKcal;removeMaterial(e,m);}
  return{ok:true,code:'object_sampled',material,materialId:id,remaining:!!lookupEcologyObject(e,id),...(ingestion?{ingestion}:{})};
}
function season(e){const absolute=R.startSeasonDay+e.elapsed/CONFIG.dayRealSeconds;return{day:absolute%R.yearDays,index:Math.floor(absolute/R.yearDays)};}
function growPlants(e,dt,environment){
  const day=hours(dt)/24,s=season(e),weather=environment?.settings?.weatherOverride||environment?.weather?.kind||'clear';
  const hour=(CONFIG.startHour+hours(e.elapsed))%24,sun=hour>=6&&hour<=19?1:.08;
  const temperature=weather==='rainy'?16:weather==='cloudy'?20:weather==='windy'?18:24;
  for(const p of e.plants){
    p.ageDays+=day;p.moisture=clamp(p.moisture+day*(weather==='rainy'?.42:-.06),0,1);
    if(p.kind==='grass'){
      const before=p.biomassGrams,growth=Math.min(e.detritus.nutrients/.004,R.grassGrowthGramsPerDay*day*sun*(.15+p.moisture*.85)*Math.max(.03,p.biomassGrams/p.capacity)*(1-p.biomassGrams/p.capacity));
      p.biomassGrams=Math.min(p.capacity,p.biomassGrams+Math.max(0,growth));e.detritus.nutrients=Math.max(0,e.detritus.nutrients-(p.biomassGrams-before)*.004);
      e.ledger.photosynthesisKcal+=(p.biomassGrams-before)*R.grassKcalPerGram;
      if(p.moisture<.1){const lost=p.biomassGrams*day*.06;p.biomassGrams-=lost;addDetritus(e,lost,lost*R.grassKcalPerGram);}
      p.stage=p.moisture<.2?'dry':'green';continue;
    }
    const start=p.kind==='apple_tree'?65:40,end=p.kind==='apple_tree'?85:95;
    if(s.index!==p.seasonIndex){p.seasonIndex=s.index;p.growth=0;p.fallHours=0;}
    if(s.day>=start&&s.day<end){
      p.stage='ripe';p.growth+=day*sun*p.moisture*(p.kind==='apple_tree'?.13:10);
      if(p.growth>=1&&p.quantity<p.capacity){const added=Math.min(Math.floor(p.growth),p.capacity-p.quantity);p.quantity+=added;p.growth-=added;e.ledger.photosynthesisKcal+=added*(p.kind==='apple_tree'?95:19);}
    }else if(s.day<start&&s.day>=start-12){p.stage=s.day<start-8?'flowering':'growing';}
    else p.stage='bare';
    if(p.quantity){
      p.fallHours+=hours(dt);
      const fallAt=(s.day>end?12:R.fruitFallDays*24);
      if(p.fallHours>=fallAt){p.fallHours%=fallAt;p.quantity--;const def=MATERIALS[p.kind==='apple_tree'?'apple':'berry'];
        addMaterial(e,p.kind==='apple_tree'?'apple':'berry',safePoint(p.position.x+45,p.position.y+30),{energyKcal:def.energyKcal});}
    }
  }
}
function nearest(list,a,predicate=()=>true,radius=Infinity){let best=null,d=radius;for(const o of list){if(o===a||o.scene!==a.scene||!predicate(o))continue;const n=distance(a.position,o.position);if(n<d){d=n;best=o;}}return best;}
function waterBank(a){
  let best=null,d=Infinity;
  for(const p of PONDS){const angle=Math.atan2(a.position.y-p.y,a.position.x-p.x),candidate={x:p.x+Math.cos(angle)*(p.rx+35),y:p.y+Math.sin(angle)*(p.ry+35)},dist=distance(a.position,candidate);if(dist<d){d=dist;best=candidate;}}
  const river={x:riverX(a.position.y)+(a.position.x>=riverX(a.position.y)?1:-1)*(riverWidth(a.position.y)+38),y:a.position.y};
  if(distance(a.position,river)<d)best=river;return safePoint(best.x,best.y,SPECIES[a.species].radius);
}
function travel(a,destination,dt,stopDistance=0){
  if(!destination)return 0;
  const p=a.position,startX=p.x,startY=p.y,dx=destination.x-p.x,dy=destination.y-p.y,len=Math.hypot(dx,dy);if(len<Math.max(3,stopDistance))return 0;
  const bodyFactor=clamp((a.stamina??100)/100,.35,1),speed=SPECIES[a.species].speed*bodyFactor;
  const move=Math.min(speed*dt,Math.max(0,len-stopDistance)),steps=Math.max(1,Math.ceil(move/12));let moved=0;
  for(let i=0;i<steps;i++){
    const vx=dx/len*move/steps,vy=dy/len*move/steps,x=p.x,y=p.y;
    if(canStandOutside(p.x+vx,p.y,SPECIES[a.species].radius))p.x+=vx;
    if(canStandOutside(p.x,p.y+vy,SPECIES[a.species].radius))p.y+=vy;
    if(Math.hypot(p.x-x,p.y-y)<move/steps*.2){
      const side=Number(a.id.split(':')[1])%2?1:-1;
      for(const angle of [side*Math.PI/3,-side*Math.PI/3,side*Math.PI/2,-side*Math.PI/2]){
        const cos=Math.cos(angle),sin=Math.sin(angle),rx=vx*cos-vy*sin,ry=vx*sin+vy*cos;
        if(canStandOutside(p.x+rx,p.y+ry,SPECIES[a.species].radius)){p.x+=rx;p.y+=ry;break;}
      }
    }
    moved+=Math.hypot(p.x-x,p.y-y);
  }
  if(moved>0)a.direction=Math.atan2(p.y-startY,p.x-startX);
  return moved;
}
function consumeForAnimal(e,a,source,grams){
  let energy=0,water=0,mass=0;
  if(source.kind==='grass'){
    mass=Math.min(grams,source.biomassGrams);energy=mass*R.grassKcalPerGram;water=mass*R.grassWaterPerGram;
  }else if(source.kind==='apple_tree'||source.kind==='bramble'){
    if(source.quantity<=0)return false;
    const def=MATERIALS[source.kind==='apple_tree'?'apple':'berry'];energy=def.energyKcal;water=def.waterMl;mass=def.massGrams;
  }else{
    if(source.heldBy||source.massGrams<.1)return false;
    mass=Math.min(grams,source.massGrams);const f=mass/source.massGrams;energy=source.energyKcal*f;water=source.waterMl*f;
  }
  if(mass<=0)return false;
  const accepted=ingestMaterial(a,{energyKcal:energy,waterMl:water,massGrams:mass,digestHours:a.species==='rabbit'?2:3,toxicity:source.spoiled?.08:0},{objectId:source.id,source:'instinct'});
  if(accepted?.ok!==true)return false;
  if(source.kind==='grass')source.biomassGrams-=mass;
  else if(source.kind==='apple_tree'||source.kind==='bramble')source.quantity--;
  else {source.massGrams-=mass;source.energyKcal-=energy;source.waterMl-=water;if(source.massGrams<.1){e.ledger.discardedKcal+=source.energyKcal;removeMaterial(e,source);}}
  a.cooldownHours=SPECIES[a.species].biteHours;e.ledger.waterConsumedMl+=water;return true;
}
function selectFood(e,a){
  const rules=SPECIES[a.species],availablePlants=p=>p.kind==='grass'?p.biomassGrams>10:p.quantity>0;
  const availableMaterials=m=>!m.heldBy&&m.massGrams>1&&(a.species==='rabbit'?m.materialType!=='flesh':a.species==='bobcat'?m.materialType==='flesh':m.materialType!=='grass');
  const detachedFood=nearest(e.materials,a,availableMaterials,rules.sight);
  if(a.species==='bobcat')return detachedFood;
  const growingFood=nearest(e.plants,a,p=>availablePlants(p)&&(a.species==='rabbit'?p.kind==='grass':p.kind!=='grass'),rules.sight);
  if(!growingFood)return detachedFood;if(!detachedFood)return growingFood;return distance(a.position,growingFood.position)<distance(a.position,detachedFood.position)?growingFood:detachedFood;
}
function decide(e,a,agents,callbacks){
  const rules=SPECIES[a.species],p=a.physiology,threat=nearest(e.animals,a,b=>rules.diet==='herbivore'&&b.species!=='rabbit'&&b.activity!=='sleeping',rules.sight*.65);
  const humanThreat=agents.find(h=>h.scene===a.scene&&distance(a.position,h.position)<65);
  if(threat||humanThreat&&a.species==='rabbit'){
    const source=threat||humanThreat,sp=positionOf(source);wakePhysiology(a,{kind:'sound',strength:.9});a.activity='fleeing';a.targetId=null;
    a.targetPosition={x:clamp(a.position.x+(a.position.x-sp.x)*3,-22000,22000),y:clamp(a.position.y+(a.position.y-sp.y)*3,-22000,22000)};a.targetKind='flee';return;
  }
  if(isSleeping(a)){
    if((a.hydration??100)<35||(a.energy??100)<20)wakePhysiology(a,{kind:'distress',strength:.9});
    else{a.activity='sleeping';a.targetId=null;return;}
  }
  if((a.hydration??100)<60){
    if(waterDistance(a.position.x,a.position.y)<=65){const drank=Math.min(40,p.waterDeficitMl);p.waterDeficitMl-=drank;a.activity='drinking';a.targetPosition=null;e.ledger.waterConsumedMl+=drank;return;}
    if(a.targetKind!=='water'||!a.targetPosition||distance(a.position,a.targetPosition)<5)a.targetPosition=waterBank(a);
    a.activity='moving';a.targetId=null;a.targetKind='water';return;
  }
  if(((a.sleepPressure??0)>75||(a.fatigue??0)>80)&&(a.energy??100)>12){beginSleep(a,{hours:Math.min(4,rules.sleepHours),at:e.elapsed});a.activity='sleeping';a.targetId=null;a.targetPosition=null;a.targetKind=null;return;}
  const hungry=(a.energy??100)<20||finite(p.hoursSinceMeal)>6||finite(p.storedEnergyKcal)<BIOLOGY_PROFILES[a.species].storedCapacityKcal*.92;
  if(hungry){
    const source=selectFood(e,a);
    if(source){a.targetId=source.id;a.targetPosition={...source.position};a.targetKind='source';a.activity=distance(a.position,source.position)<=28?'feeding':'moving';return;}
    if(a.species!=='rabbit'){
      const prey=nearest(e.animals,a,b=>b.species==='rabbit',rules.sight);
      if(prey){a.targetId=prey.id;a.targetPosition={...prey.position};a.activity='chasing';return;}
      // Only an extremely depleted predator without another local source risks contact.
      const victim=agents.find(h=>h.scene===a.scene&&h.lifecycle==='AWAKE'&&distance(a.position,h.position)<160);
      if(victim&&(a.energy??100)<15){a.targetId=victim.id;a.targetPosition={...victim.position};a.activity='chasing';return;}
    }
  }
  if((a.sleepPressure??0)>60||(a.fatigue??0)>70){beginSleep(a,{hours:Math.min(3,rules.sleepHours),at:e.elapsed});a.activity='sleeping';a.targetId=null;a.targetPosition=null;return;}
  if((a.stamina??100)<30){a.activity='resting';a.targetId=null;a.targetPosition=null;return;}
  if(!hungry&&Math.floor(hours(e.elapsed)/2)%3!==0){a.activity='resting';a.targetId=null;a.targetPosition=null;a.targetKind=null;return;}
  if(!a.targetPosition||distance(a.position,a.targetPosition)<15||a.targetKind!=='wander'){
    a.direction+=hash(Math.floor(e.elapsed),Number(a.id.split(':')[1]),e.seed)*2-1;
    const home=a.homePosition||a.position,range=a.species==='rabbit'?500:1800;
    a.targetPosition=distance(a.position,home)>range?{...home}:{x:clamp(a.position.x+Math.cos(a.direction)*140,-22000,22000),y:clamp(a.position.y+Math.sin(a.direction)*140,-22000,22000)};
  }
  a.activity='moving';a.targetId=null;a.targetKind='wander';
}
function reproduce(e,a){
  const rules=SPECIES[a.species],p=a.physiology;
  if(a.ageDays<rules.juvenileDays||e.animals.length>=R.maxAnimals||e.animals.filter(b=>b.species===a.species).length>=rules.maxPopulation||
    hours(e.elapsed)-a.lastBirthHours<rules.birthIntervalDays*24||(a.hydration??100)<70||(a.energy??100)<70||finite(p.availableEnergyKcal)+finite(p.storedEnergyKcal)<rules.birthKcal+rules.initialReserveKcal*.2)return;
  const mate=nearest(e.animals,a,b=>b.species===a.species&&b.ageDays>=rules.juvenileDays,220);
  if(!mate||a.activity==='chasing'||a.activity==='fleeing')return;
  // Reproductive condition also depends on the local habitat. A full stomach
  // alone cannot support another consumer in a depleted patch.
  if(a.species==='rabbit'){
    const local=e.plants.filter(v=>v.kind==='grass'&&distance(v.position,a.position)<rules.sight*1.2);
    const dailyProduction=local.reduce((sum,v)=>sum+R.grassGrowthGramsPerDay*.25*.54*v.moisture*R.grassKcalPerGram*Math.min(1,v.biomassGrams/(v.capacity*.5)),0);
    const expectedCost=BIOLOGY_PROFILES.rabbit.basalKcalPerDay+BIOLOGY_PROFILES.rabbit.walkingKcalPerHour*8;
    const capacity=Math.floor(dailyProduction/expectedCost);
    if(e.animals.filter(v=>v.species==='rabbit'&&distance(v.position,a.position)<rules.sight*1.3).length>=capacity)return;
  }else if(e.animals.filter(v=>v.species==='rabbit'&&distance(v.position,a.position)<rules.sight).length<4)return;
  const available=finite(p.availableEnergyKcal),debit=rules.birthKcal;
  p.availableEnergyKcal=Math.max(0,available-debit);p.storedEnergyKcal=Math.max(0,finite(p.storedEnergyKcal)-Math.max(0,debit-available));
  const reserve=debit*.25,structure=debit-reserve;
  animal(e,a.species,{x:a.position.x+35,y:a.position.y+20},e.elapsed,{juvenile:true,energyKcal:reserve,structureKcal:structure});
  a.lastBirthHours=hours(e.elapsed);e.births++;e.ledger.birthTransferredKcal+=debit;
}
function simulationStep(e,dt,environment,agents,callbacks){
  e.elapsed+=dt;growPlants(e,dt,environment);
  for(const a of [...e.animals]){
    if(!e.animals.includes(a))continue;
    a.ageDays+=hours(dt)/24;a.cooldownHours=Math.max(0,a.cooldownHours-hours(dt));
    decide(e,a,agents,callbacks);
    const prior=finite(a.physiology?.totals?.metabolizedKcal),discarded=finite(a.physiology?.totals?.discardedKcal);
    const condition=environmentConditions({...environment,elapsed:e.elapsed},a);
    // Fur changes cold exposure without removing weather, wetness or water costs.
    if(condition.feltTemperature<14)condition.feltTemperature+=Math.min(12,14-condition.feltTemperature);
    tickPhysiology(a,dt,condition,{activity:a.activity==='sleeping'?'sleeping':['moving','fleeing','chasing'].includes(a.activity)?a.activity==='moving'?'walking':'running':a.activity==='resting'?'resting':'awake'});
    e.ledger.discardedKcal+=Math.max(0,finite(a.physiology?.totals?.discardedKcal)-discarded);
    if(a.health<=0||a.physiology.health<=0){e.ledger.metabolizedKcal+=Math.max(0,finite(a.physiology?.totals?.metabolizedKcal)-prior);death(e,a);continue;}
    if(['moving','fleeing','chasing'].includes(a.activity)){
      const target=lookupEcologyObject(e,a.targetId),victim=a.activity==='chasing'?(target?.species?target:agents.find(h=>h.id===a.targetId)):null;
      const stopDistance=victim?SPECIES[a.species].radius+(victim.species?SPECIES[victim.species].radius:10):0;
      const moved=travel(a,a.targetPosition,dt,stopDistance);
      if(moved>0)exertPhysiology(a,dt*(moved/Math.max(1,SPECIES[a.species].speed*dt)),a.activity==='moving'?1:2.5);
    }
    e.ledger.metabolizedKcal+=Math.max(0,finite(a.physiology?.totals?.metabolizedKcal)-prior);
    const target=lookupEcologyObject(e,a.targetId);
    if(a.activity==='feeding'&&target&&a.cooldownHours===0&&distance(a.position,target.position)<30)consumeForAnimal(e,a,target,SPECIES[a.species].biteGrams);
    if(a.activity==='chasing'&&e.elapsed-a.lastAttackAt>=1.5){
      const victim=target?.species?target:agents.find(h=>h.id===a.targetId&&h.scene===a.scene&&h.lifecycle==='AWAKE');
      if(victim&&distance(a.position,victim.position)<SPECIES[a.species].radius+12){
        a.lastAttackAt=e.elapsed;
        if(victim.species){victim.physiology.health=Math.max(0,victim.physiology.health-SPECIES[a.species].huntDamage);victim.health=victim.physiology.health;wakePhysiology(victim,{kind:'contact',strength:1});if(victim.health<=0)death(e,victim);}
        else{const dx=victim.position.x-a.position.x,dy=victim.position.y-a.position.y,norm=Math.hypot(dx,dy);
          const event={damage:Math.min(R.maxHumanAttackDamage,SPECIES[a.species].huntDamage*.25),reason:'animal-contact',sourceId:a.id,stimulus:'contact',direction:norm?{x:dx/norm,y:dy/norm}:{x:-Math.cos(a.direction),y:-Math.sin(a.direction)}};
          callbacks.wake?.(victim,{kind:'contact',intensity:1,strength:1,sourceId:a.id});callbacks.harm?.(victim,event);}
      }
    }
    reproduce(e,a);
  }
  for(const m of [...e.materials]){
    m.ageHours+=hours(dt);m.spoiled=m.ageHours>=MATERIALS[m.materialType].spoilDays*24;
    if(m.spoiled){const f=Math.min(1,hours(dt)/(R.materialDecayDays*24)),mass=m.massGrams*f,energy=m.energyKcal*f;m.massGrams-=mass;m.energyKcal-=energy;m.waterMl*=1-f;addDetritus(e,mass,energy);}
    if(m.massGrams<.1){addDetritus(e,m.massGrams,m.energyKcal);removeMaterial(e,m);}
  }
  const decay=Math.min(e.detritus.energyKcal,e.detritus.energyKcal*hours(dt)/(24*10));
  const decayedMass=e.detritus.massGrams*hours(dt)/(24*10);e.detritus.massGrams=Math.max(0,e.detritus.massGrams-decayedMass);
  e.detritus.energyKcal-=decay;e.ledger.decomposedKcal+=decay;e.detritus.nutrients=Math.min(500000,e.detritus.nutrients+decayedMass*.004);
}
/** Called exactly once by the runtime. Bodies, motion and resources share this clock. */
export function tickEcology(e,dt,environment={},agents=[],callbacks={}){
  if(!e||!Number.isFinite(dt)||dt<=0)return;
  e.pending+=Math.min(dt,CONFIG.dayRealSeconds*7);
  while(e.pending>=R.stepSeconds){e.pending-=R.stepSeconds;simulationStep(e,R.stepSeconds,environment,agents,callbacks);}
}
/** Bounded data-only disk restoration; no arbitrary species, scripts or nutrition. */
export function validateEcology(raw,{seed=CONFIG.seed,elapsed=0}={}){
  if(!raw||raw.version!==R.version)return createEcology(seed,elapsed);
  const out={version:R.version,seed:Number.isInteger(raw.seed)?raw.seed>>>0:seed,elapsed:clamp(raw.elapsed,0,CONFIG.dayRealSeconds*100000),pending:clamp(raw.pending,0,R.stepSeconds),nextId:1,
    plants:[],animals:[],materials:[],detritus:{massGrams:clamp(raw.detritus?.massGrams,0,R.maxDetritus),nutrients:clamp(raw.detritus?.nutrients,0,500000),energyKcal:clamp(raw.detritus?.energyKcal,0,1e9)},ledger:emptyLedger(),births:clamp(Math.floor(raw.births),0,1e7),deaths:clamp(Math.floor(raw.deaths),0,1e7)};
  const seen=new Set(),acceptId=id=>typeof id==='string'&&idPattern.test(id)&&!seen.has(id),position=(o,radius=10)=>safePoint(o?.position?.x,o?.position?.y,radius);
  const add=(list,o)=>{seen.add(o.id);out.nextId=Math.max(out.nextId,Number(o.id.split(':')[1])+1);list.push(o);};
  for(const p of (Array.isArray(raw.plants)?raw.plants:[]).slice(0,R.maxPlants)){
    if(!acceptId(p?.id)||!['grass','apple_tree','bramble'].includes(p.kind))continue;
    const cap=p.kind==='grass'?R.grassCapacityGrams:p.kind==='apple_tree'?10:28;
    add(out.plants,{id:p.id,kind:p.kind,scene:'valley',position:position(p),capacity:cap,quantity:Math.floor(clamp(p.quantity,0,p.kind==='grass'?0:cap)),biomassGrams:clamp(p.biomassGrams,0,p.kind==='grass'?cap:0),moisture:clamp(p.moisture,0,1),stage:['green','dry','bare','flowering','growing','ripe'].includes(p.stage)?p.stage:'bare',growth:clamp(p.growth,0,100),seasonIndex:clamp(Math.floor(p.seasonIndex),0,100000),fallHours:clamp(p.fallHours,0,R.fruitFallDays*24),ageDays:clamp(p.ageDays,0,100000)});
  }
  for(const a of (Array.isArray(raw.animals)?raw.animals:[]).slice(0,R.maxAnimals)){
    if(!acceptId(a?.id)||!speciesNames.includes(a.species))continue;
    const species=a.species,profile=SPECIES[species];
    add(out.animals,{id:a.id,species,scene:'valley',position:position(a,profile.radius),physiology:validatePhysiology(a.physiology,{profile:species,elapsed:out.elapsed}),health:clamp(a.health,0,100),energy:clamp(a.energy,0,100),hydration:clamp(a.hydration,0,100),nourishment:clamp(a.nourishment,0,100),stamina:clamp(a.stamina,0,100),fatigue:clamp(a.fatigue,0,100),sleepPressure:clamp(a.sleepPressure,0,100),thermal:{hot:clamp(a.thermal?.hot,0,100),cold:clamp(a.thermal?.cold,0,100),wetness:clamp(a.thermal?.wetness,0,100)},bodyMode:['awake','resting','sleeping','dozing'].includes(a.bodyMode)?a.bodyMode:'awake',activity:activities.includes(a.activity)?a.activity:'idle',ageDays:clamp(a.ageDays,0,10000),structureKcal:clamp(a.structureKcal,0,profile.structureKcal),lastBirthHours:clamp(a.lastBirthHours,-2000,hours(out.elapsed)),targetId:idPattern.test(a.targetId)?a.targetId:['aster','mira'].includes(a.targetId)?a.targetId:null,targetKind:['water','source','flee','wander'].includes(a.targetKind)?a.targetKind:null,homePosition:a.homePosition&&Number.isFinite(a.homePosition.x)&&Number.isFinite(a.homePosition.y)?safePoint(a.homePosition.x,a.homePosition.y,profile.radius):position(a,profile.radius),targetPosition:a.targetPosition&&Number.isFinite(a.targetPosition.x)&&Number.isFinite(a.targetPosition.y)?{x:clamp(a.targetPosition.x,-22000,22000),y:clamp(a.targetPosition.y,-22000,22000)}:null,lastAttackAt:clamp(a.lastAttackAt,-100,out.elapsed),cooldownHours:clamp(a.cooldownHours,0,1),bornAt:clamp(a.bornAt,0,out.elapsed),direction:clamp(a.direction,-100000,100000),actionHours:0});
  }
  for(const m of (Array.isArray(raw.materials)?raw.materials:[]).slice(0,R.maxMaterials)){
    if(!acceptId(m?.id)||!materialNames.includes(m.materialType)||!['material','carcass'].includes(m.kind))continue;
    const def=MATERIALS[m.materialType],cap=m.kind==='carcass'?30000:def.massGrams;
    const mass=clamp(m.massGrams,0,cap),maxEnergy=m.kind==='carcass'?mass*1.5:def.energyKcal*mass/def.massGrams;
    const scene=CAVES.some(c=>c.id===m.scene)?m.scene:'valley';
    const point=scene==='valley'?position(m):canStandCave(m.position?.x,m.position?.y)?{...m.position}:{...CAVE_SPAWN};
    add(out.materials,{id:m.id,kind:m.kind,materialType:m.materialType,scene,position:point,heldBy:m.kind==='material'&&['aster','mira'].includes(m.heldBy)?m.heldBy:null,massGrams:mass,energyKcal:clamp(m.energyKcal,0,maxEnergy),waterMl:clamp(m.waterMl,0,mass),createdAt:clamp(m.createdAt,0,out.elapsed),ageHours:clamp(m.ageHours,0,100000),spoiled:!!m.spoiled,digestHours:def.digestHours,toxicity:def.toxicity||0});
  }
  for(const k of Object.keys(out.ledger))out.ledger[k]=clamp(raw.ledger?.[k],0,1e12);
  out.nextId=Math.max(out.nextId,Math.floor(clamp(raw.nextId,1,1e9)));return out;
}
