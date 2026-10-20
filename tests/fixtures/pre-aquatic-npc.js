import { CONFIG, NPC_RULES, NPC_PRESETS, BODY_RULES, CAVES, CAVE_SPAWN, CAVE_EXIT } from './config.js';
import { canStand, moveActor, distance, clamp } from './world.js';
import { waterSource, foodSource, gatherFood, shelterSource } from './resources.js';
import { ozarkWaterSource } from './ozark-water-sources.js';
import { environmentConditions } from './environment.js';
import { bodySignals, sensedEnvironment, restUnsafe } from './interoception.js';
import { perceive, tileKey, tilePoint, actorLineOfSight, rememberedCells, rememberedEdges, scenePointValid } from './perception.js';
import { knownRoute } from './navigation.js';
import { recordEvent, rememberObservation, policyContext, learnOutcome, recoveryLesson, learningCostTick } from './npc-memory.js';
import { BIOLOGY_RULES, BIOLOGY_PROFILES, gameHours, simulationSeconds } from './biology-config.js';
import { beginSleep, tickPhysiology, ingestWater, exertPhysiology, harmPhysiology, wakePhysiology, isSleeping, relievePhysiology, projectPhysiology } from './biology.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { requestDiscoveryAction, tickDiscoveryAction, takeDiscoveryActionFeedback } from './discovery-actions.js';
import { ozarkAgentWorld, ozarkAgentSensation, ozarkPersistentWorldAgent } from './ozark-agent-world.js';

const allowedActions=new Set(['observe','move','swim','climb','inspect','fill_flask','drink','gather_food','eat','enter_shelter','exit_shelter','wait','rest','sleep']);
const movementActions=new Set(['move','swim','climb']);
const needSeverity=(reserve,warning,critical)=>{
  const mild=Math.pow((100-reserve)/100,2)*.08;
  if(reserve>warning)return mild;
  if(reserve>critical)return mild+.3+(warning-reserve)/(warning-critical)*.9;
  return mild+1.2+(critical-reserve)/Math.max(1,critical)*3;
};
export function bodyRisk(npc){
  if(npc.mode==='discovery'&&npc.physiology){const f=npc.physiology,p=BIOLOGY_PROFILES[f.profile],water=f.waterDeficitMl/(p.massKg*1000),thermal=Math.max(npc.thermal.hot,npc.thermal.cold);return Math.max(0,water-.01)*30+Math.max(0,f.hoursSinceMeal-5)/48+Math.max(0,35-npc.energy)/35+Math.max(0,thermal-40)/40+(100-f.health)/100;}
  const hunger=needSeverity(npc.nourishment,NPC_RULES.hungerWarning,NPC_RULES.criticalNourishment)*1.25;
  const thirst=needSeverity(npc.hydration,NPC_RULES.thirstWarning,NPC_RULES.criticalHydration);
  const thermal=Math.max(npc.thermal.hot,npc.thermal.cold),warning=NPC_RULES.thermalWarning??40,critical=NPC_RULES.criticalThermal??80;
  const exposure=thermal/100*.08+(thermal>=warning?.3+(thermal-warning)/(critical-warning)*.9:0)+(thermal>=critical?(thermal-critical)/20*3:0);
  return hunger+thirst+exposure+(100-npc.health)/100*.2;
}
export function updateFeelings(npc,relief=0){
  const f=npc.feelings,t=npc.thermal;
  f.hunger=clamp(1-npc.nourishment/100,0,1);f.thirst=clamp(1-npc.hydration/100,0,1);f.heat=t.hot/100;f.cold=t.cold/100;
  f.discomfort=clamp(Math.max(f.hunger*.85,f.thirst*.8,f.heat,f.cold,(npc.fatigue||0)/100*.7,(npc.sleepPressure||0)/100*.6,(100-(npc.stamina??100))/100*.55),0,1);
  f.distress=clamp(bodyRisk(npc)/6,0,1);f.comfort=1-f.discomfort;f.relief=clamp(Math.max(f.relief,relief),0,1);
}
export function observeNpc(npc,environment={}){
  if(npc.mode==='discovery'&&isSleeping(npc))return {at:npc.elapsed,scene:npc.scene,position:{...npc.position},lifecycle:npc.lifecycle,body:bodySignals(npc),environment:{...sensedEnvironment(npc),visibility:'eyes closed'},flask:{water:npc.flask.water,capacity:npc.flask.capacity},inventory:{items:[...npc.inventory.items],capacity:npc.inventory.capacity},cells:[],sources:[],foods:[],shelters:[],objects:[],sleepSenses:{contact:'none',sound:'indistinct'}};
  if(npc.lifecycle==='COLLAPSED')return {at:npc.elapsed,scene:npc.scene,position:{...npc.position},lifecycle:npc.lifecycle,body:bodySignals(npc),environment:sensedEnvironment(npc),flask:{water:npc.flask.water,capacity:npc.flask.capacity},inventory:{apples:npc.inventory.apples.length,capacity:npc.inventory.capacity},cells:[],sources:[],foods:[],shelters:[]};
  npc.sensation=ozarkAgentWorld(npc)?ozarkAgentSensation(npc,environment):environmentConditions(environment,{position:npc.position,scene:npc.scene,wetness:npc.thermal.wetness});
  const observation=perceive(npc,environment);rememberObservation(npc,observation);
  if(npc.scene!=='valley'&&npc.memory.shelters[npc.scene])Object.assign(npc.memory.shelters[npc.scene],{experiencedTemperature:npc.sensation.feltTemperature,experiencedAt:npc.elapsed});
  return observation;
}
function complete(npc,request,result,context=policyContext(npc),startPosition={...npc.position},startScene=npc.scene){
  const active=npc.active;
  const handling=takeDiscoveryActionFeedback(npc,active);
  if(handling)result.handling=handling;
  if(active?.startRisk!==undefined&&result.riskCost===undefined)result.riskCost=Math.max(0,npc.riskCost-active.startRisk);
  if(active&&result.durationSeconds===undefined)result.durationSeconds=Math.max(0,npc.elapsed-active.startedAt);
  if(active&&movementActions.has(active.request.type)&&ozarkAgentWorld(npc)){
    const expected=active.attemptedDistance||0,forward=active.forwardProgress||0;
    const ratio=expected>0?forward/expected:0;
    const progress=ratio<.15?'negligible':ratio<.8?'limited':'steady';
    const wetness=npc.thermal.wetness>active.startWetness+1e-9?'wetter':npc.thermal.wetness<active.startWetness-1e-9?'drying':'steady';
    const effort=npc.physiology.fatigue>active.startFatigue+1e-9||npc.physiology.stamina<active.startStamina-1e-9?'rising':'steady';
    const footing=ozarkAgentWorld(npc).classify(npc.position.x,npc.position.y,CONFIG.playerRadius).reason;
    result.movement={progress,resistance:progress==='negligible'?'strong':progress==='limited'?'resisted':'free',wetness,effort,footing};
    if(ozarkPersistentWorldAgent(npc))result.movement.traversal=active.swimSeconds>0?'swimming':active.climbSeconds>0?'climbing':active.passiveDriftSeconds>0&&forward<3?'adrift':active.waterSeconds>0?'wading':'walking';
  }
  if(active?.startScene)startScene=active.startScene;
  npc.active=null;npc.bodyMode='awake';const event=learnOutcome(npc,request,{...result,startScene,scene:npc.scene},context,startPosition);
  npc.nextDecisionAt=npc.elapsed+.65;return {eventId:event.id,...result};
}
function wetOzarkBody(npc,dt,waterSeconds){
  const wet=Math.max(0,Math.min(dt,waterSeconds));
  npc.thermal.wetness=clamp(npc.thermal.wetness+wet*18-(dt-wet)*2,0,100);
}
export function cancelNpcAction(npc,code='PRIORITY_CHANGED'){
  const active=npc.active;if(!active)return false;
  if(npc.mode==='discovery'&&active.request.type==='sleep')wakePhysiology(npc,'interrupted sleep');
  complete(npc,active.request,{ok:false,code,riskCost:Math.max(0,npc.riskCost-active.startRisk),distance:active.travelled||0},active.context,active.startPosition,active.startScene);return true;
}
function cleanRequest(raw,npc){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!allowedActions.has(raw.type))return null;
  const action={type:raw.type};
  const scene=npc.scene,mode=npc.mode;
  if(['move','swim','climb','inspect','fill_flask','gather_food','enter_shelter'].includes(raw.type)){
    const ids=['sourceId','foodId','shelterId'].filter(key=>raw[key]!==undefined);
    if(ids.length>1||movementActions.has(raw.type)&&raw.type!=='move'&&ids.length)return null;
    if(ids.length){const key=ids[0];if(typeof raw[key]!=='string'||raw[key].length>70||raw[key].length<1)return null;action[key]=raw[key];}
    else if(movementActions.has(raw.type)){
      const bounds=ozarkPersistentWorldAgent(npc)?ozarkAgentWorld(npc)?.bounds:null;
      const valid=bounds?Number.isFinite(raw.target?.x)&&Number.isFinite(raw.target?.y)&&
        raw.target.x>=bounds.minX&&raw.target.x<=bounds.maxX&&raw.target.y>=bounds.minY&&raw.target.y<=bounds.maxY:
        scenePointValid(raw.target,scene);
      if(!valid)return null;action.target={x:raw.target.x,y:raw.target.y};
    }
    else return null;
    if(raw.type==='fill_flask'&&!action.sourceId||raw.type==='gather_food'&&!action.foodId||raw.type==='enter_shelter'&&!action.shelterId)return null;
  }
  if(['wait','rest','sleep'].includes(raw.type)){const maximum=raw.type==='wait'?5:mode==='discovery'?simulationSeconds(raw.type==='sleep'?BIOLOGY_RULES.maximumSleepHours:BIOLOGY_RULES.maximumRestHours):NPC_RULES.maxActionSeconds;if(raw.seconds!==undefined&&(!Number.isFinite(raw.seconds)||raw.seconds<.25||raw.seconds>maximum))return null;action.seconds=raw.seconds??(raw.type==='wait'?1:mode==='discovery'?simulationSeconds(raw.type==='sleep'?BIOLOGY_RULES.nightSleepHours:.5):8);}
  if(raw.duration!==undefined&&(!Number.isFinite(raw.duration)||raw.duration<=0||raw.duration>NPC_RULES.maxActionSeconds))return null;
  if(raw.duration!==undefined)action.duration=raw.duration;
  return action;
}
function knownResource(npc,request){
  if(request.sourceId)return {kind:'water',known:npc.memory.sources[request.sourceId],id:request.sourceId};
  if(request.foodId)return {kind:'food',known:npc.memory.foods[request.foodId],id:request.foodId};
  if(request.shelterId)return {kind:'shelter',known:npc.memory.shelters[request.shelterId],id:request.shelterId};
  return null;
}
function physicalResource(resource,environment,npc){
  if(resource.kind==='water')return ozarkPersistentWorldAgent(npc)?
    ozarkWaterSource(resource.id,ozarkAgentWorld(npc),environment):
    waterSource(resource.id,environment);
  return resource.kind==='food'?foodSource(resource.id,environment):shelterSource(resource.id);
}
function observedResourceRoute(npc,known){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc);
  const anchor=npc.navigationAnchor&&cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
  // Observed physical interaction points are known dry nodes between coarse tiles.
  const approaches=Object.values(cells).filter(c=>c.walkable&&distance(c,known)<=NPC_RULES.tileSize*2);
  approaches.sort((a,b)=>distance(a,npc.position)+distance(a,known)-distance(b,npc.position)-distance(b,known));
  for(const point of approaches){
    const edge=[tileKey(point),tileKey(known)].sort().join('>');
    if((edges[edge]?.retryAfter||0)>npc.elapsed)continue;
    const path=knownRoute(cells,npc.position,point,30,edges,npc.elapsed,anchor);if(!path)continue;
    const length=path.reduce((sum,p,i)=>sum+distance(i?path[i-1]:npc.position,p),0)+distance(point,known);
    if(length>NPC_RULES.maxActionSeconds*CONFIG.walkSpeed)continue;
    return [...path,{x:known.x,y:known.y}];
  }
  return null;
}
export function requestNpcAction(npc,raw,environment={}){
  if(npc.lifecycle!=='AWAKE')return {ok:false,code:'UNCONSCIOUS'};
  if(npc.active)return {ok:false,code:'ACTION_BUSY'};
  if(npc.mode==='discovery'&&isSleeping(npc))return{ok:false,code:'ASLEEP'};
  if(npc.mode==='discovery'&&DISCOVERY_RULES.primitives.includes(raw?.type))return requestDiscoveryAction(npc,raw,environment,{complete});
  const request=cleanRequest(raw,npc),context=policyContext(npc),startPosition={...npc.position},startScene=npc.scene;
  if(!request)return complete(npc,{type:'observe'},{ok:false,code:'INVALID_REQUEST'},context,startPosition);
  if(['swim','climb'].includes(request.type)&&!ozarkPersistentWorldAgent(npc))return complete(npc,request,{ok:false,code:'UNSUPPORTED_TERRAIN_ACTION'},context,startPosition);
  if(ozarkAgentWorld(npc)&&['enter_shelter','exit_shelter'].includes(request.type))return complete(npc,request,{ok:false,code:'NO_OZARK_SHELTER'},context,startPosition);
  if(npc.mode==='discovery'&&(['gather_food','eat'].includes(request.type)||request.foodId))return complete(npc,request,{ok:false,code:'UNDISCOVERED_MACRO'},context,startPosition);
  if(['rest','sleep'].includes(request.type)&&restUnsafe(npc))return complete(npc,request,{ok:false,code:'UNSAFE_TO_REST',body:bodySignals(npc)},context,startPosition);
  const resource=knownResource(npc,request),known=resource?.known;
  if(resource&&ozarkAgentWorld(npc)&&resource.kind!=='water')return complete(npc,request,{ok:false,code:'NO_OZARK_SITE'},context,startPosition);
  if(resource&&!known)return complete(npc,request,{ok:false,code:resource.kind==='water'?'UNKNOWN_SOURCE':resource.kind==='food'?'UNKNOWN_FOOD':'UNKNOWN_SHELTER'},context,startPosition);
  if(resource&&npc.scene!=='valley')return complete(npc,request,{ok:false,code:'RESOURCE_IN_OTHER_SCENE'},context,startPosition);
  if(request.type==='observe'){
    const previous=Object.keys(rememberedCells(npc)).length;observeNpc(npc,environment);
    return complete(npc,request,{ok:true,code:'OBSERVED',novelCells:Math.max(0,Object.keys(rememberedCells(npc)).length-previous)},context,startPosition);
  }
  if(request.type==='inspect'){
    if(distance(npc.position,known)>NPC_RULES.visionRadius||!actorLineOfSight(npc,npc.position,known))return complete(npc,request,{ok:false,code:'OUT_OF_VIEW'},context,startPosition);
    const physical=physicalResource(resource,environment,npc);
    if(!physical)return complete(npc,request,{ok:false,code:'RESOURCE_UNAVAILABLE'},context,startPosition);
    const {shelteredTemperature,renewAt,...exterior}=physical;
    Object.assign(known,exterior,{observedAt:npc.elapsed});
    return complete(npc,request,{ok:true,code:'INSPECTED',resource:{id:physical.id,...(physical.available!==undefined?{available:physical.available}:{}),...(physical.stock!==undefined?{stock:physical.stock}:{})}},context,startPosition);
  }
  if(request.type==='fill_flask'||request.type==='gather_food'||request.type==='enter_shelter'){
    const range=request.type==='enter_shelter'?100:NPC_RULES.collectionRange;
    if(distance(npc.position,known)>range)return complete(npc,request,{ok:false,code:'OUT_OF_REACH'},context,startPosition);
    if(!actorLineOfSight(npc,npc.position,known))return complete(npc,request,{ok:false,code:'INTERACTION_BLOCKED'},context,startPosition);
    const physical=physicalResource(resource,environment,npc);
    if(!physical||physical.available===false)return complete(npc,request,{ok:false,code:resource.kind==='food'?'FOOD_DEPLETED':'SOURCE_UNAVAILABLE'},context,startPosition);
    if(request.type==='fill_flask'){
      if(npc.flask.water>=npc.flask.capacity-.00001)return complete(npc,request,{ok:false,code:'FLASK_FULL'},context,startPosition);
      const waterCollected=npc.flask.capacity-npc.flask.water;
      npc.flask.water=npc.flask.capacity;npc.flask.provenance='collected';if(waterCollected>=.25)npc.stats.collections++;
      return complete(npc,request,{ok:true,code:'COLLECTED',waterCollected,hydrationGain:0,provenance:'collection'},context,startPosition);
    }
    if(request.type==='gather_food'){
      if(npc.inventory.apples.length>=npc.inventory.capacity)return complete(npc,request,{ok:false,code:'INVENTORY_FULL'},context,startPosition);
      const outcome=gatherFood(request.foodId,environment,1);
      if(!outcome.ok||outcome.amount!==1)return complete(npc,request,{ok:false,code:outcome.code||'FOOD_DEPLETED'},context,startPosition);
      known.stock=outcome.remaining;known.available=outcome.remaining>0;known.observedAt=npc.elapsed;
      const apple={foodId:request.foodId,collectedAt:npc.elapsed,eventId:null};npc.inventory.apples.push(apple);npc.stats.gatherings++;
      const result=complete(npc,request,{ok:true,code:'GATHERED_FOOD',foodCollected:1,remaining:outcome.remaining,nourishmentGain:0,provenance:'collection'},context,startPosition);apple.eventId=result.eventId;return result;
    }
    npc.scene=physical.targetScene;npc.position={...CAVE_SPAWN};npc.navigationAnchor=null;npc.epoch++;
    const result=complete(npc,request,{ok:true,code:'ENTERED_SHELTER',shelterId:physical.id,startScene,scene:npc.scene,thermalRelief:0},context,startPosition,startScene);
    observeNpc(npc,environment);return result;
  }
  if(request.type==='exit_shelter'){
    if(npc.scene==='valley')return complete(npc,request,{ok:false,code:'NOT_IN_SHELTER'},context,startPosition);
    if(distance(npc.position,CAVE_EXIT)>=100)return complete(npc,request,{ok:false,code:'OUT_OF_REACH'},context,startPosition);
    if(!actorLineOfSight(npc,npc.position,CAVE_EXIT))return complete(npc,request,{ok:false,code:'INTERACTION_BLOCKED'},context,startPosition);
    const cave=CAVES.find(c=>c.id===npc.scene),position=cave&&{x:cave.x,y:cave.y+95};
    if(!position||!canStand(position.x,position.y,'valley'))return complete(npc,request,{ok:false,code:'EXIT_BLOCKED'},context,startPosition);
    npc.scene='valley';npc.position=position;npc.navigationAnchor=null;npc.epoch++;
    const result=complete(npc,request,{ok:true,code:'EXITED_SHELTER',startScene,scene:'valley'},context,startPosition,startScene);observeNpc(npc,environment);return result;
  }
  if(request.type==='drink'){
    if(npc.flask.water<=.00001)return complete(npc,request,{ok:false,code:'EMPTY_FLASK'},context,startPosition);
    if(npc.mode==='discovery'){
      const p=BIOLOGY_PROFILES[npc.physiology.profile],gut=npc.physiology.stomach.reduce((sum,v)=>sum+v.remainingMassGrams,0),room=Math.max(0,p.stomachCapacityGrams-gut),consumed=Math.min(npc.flask.water,.5,room/1000);
      if(consumed<=.001)return complete(npc,request,{ok:false,code:'TOO_FULL'},context,startPosition);
      const provenance=npc.flask.provenance,ingestion=ingestWater(npc,consumed*1000,{provenance,actionId:npc.memory.nextId,at:npc.elapsed});
      if(!ingestion.ok)return complete(npc,request,ingestion,context,startPosition);
      npc.flask.water=Math.max(0,npc.flask.water-consumed);const independent=provenance==='collected'&&npc.flask.fillEventId!==null&&npc.flask.fillEventId!==npc.flask.creditedFillId;
      if(independent){npc.stats.independentDrinks++;npc.flask.creditedFillId=npc.flask.fillEventId;npc.stats.firstWaterAt??=npc.elapsed;}
      // The immediate transfer changes fullness, not absorbed relief. Keep the
      // derived body display and original receipt consistent before any save.
      projectPhysiology(npc);
      npc.presentation.drinkUntil=npc.elapsed+2;return complete(npc,request,{ok:true,code:'DRANK',waterConsumed:consumed,hydrationGain:0,delayed:true,ingestionId:ingestion.ingestionId,provenance,independent},context,startPosition);
    }
    if(npc.hydration>=99.999)return complete(npc,request,{ok:false,code:'ALREADY_HYDRATED'},context,startPosition);
    const consumed=Math.min(npc.flask.water,(100-npc.hydration)/NPC_RULES.drinkHydration),gain=consumed*NPC_RULES.drinkHydration,provenance=npc.flask.provenance;
    const independent=provenance==='collected'&&npc.flask.fillEventId!==null&&npc.flask.fillEventId!==npc.flask.creditedFillId&&gain>=NPC_RULES.meaningfulHydrationGain;
    npc.flask.water=clamp(npc.flask.water-consumed,0,1);npc.hydration=clamp(npc.hydration+gain,0,100);
    if(independent){npc.stats.independentDrinks++;npc.flask.creditedFillId=npc.flask.fillEventId;if(npc.stats.firstWaterAt===null)npc.stats.firstWaterAt=npc.elapsed;}
    npc.presentation.drinkUntil=npc.elapsed+2;updateFeelings(npc,gain/100);
    return complete(npc,request,{ok:true,code:'DRANK',waterConsumed:consumed,hydrationGain:gain,provenance,independent},context,startPosition);
  }
  if(request.type==='eat'){
    if(!npc.inventory.apples.length)return complete(npc,request,{ok:false,code:'NO_FOOD'},context,startPosition);
    if(npc.nourishment>=99.999)return complete(npc,request,{ok:false,code:'ALREADY_NOURISHED'},context,startPosition);
    const apple=npc.inventory.apples.shift(),gain=Math.min(100-npc.nourishment,NPC_RULES.appleNourishment);
    npc.nourishment=clamp(npc.nourishment+gain,0,100);
    npc.energy=clamp((npc.energy??BODY_RULES.initialEnergy)+gain*BODY_RULES.mealEnergyPerNourishment,0,100);
    const independent=apple.eventId!==null&&gain>=NPC_RULES.meaningfulNourishmentGain;
    if(independent){npc.stats.independentMeals++;if(npc.stats.firstFoodAt===null)npc.stats.firstFoodAt=npc.elapsed;}
    npc.presentation.eatUntil=npc.elapsed+2;updateFeelings(npc,gain/100);
    return complete(npc,request,{ok:true,code:'ATE',nourishmentGain:gain,foodConsumed:1,foodId:apple.foodId,gatherEventId:apple.eventId,provenance:'collected',independent},context,startPosition);
  }
  if(movementActions.has(request.type)){
    const cells=rememberedCells(npc),edges=rememberedEdges(npc);let target=request.target,route=null;
    const anchor=npc.navigationAnchor&&cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
    if(request.type!=='move'){
      const cell=cells[tileKey(target)];
      if(!cell||target.x!==cell.x||target.y!==cell.y||distance(npc.position,target)>NPC_RULES.tileSize*2||
          !actorLineOfSight(npc,npc.position,target))return complete(npc,request,{ok:false,code:'UNOBSERVED_TARGET'},context,startPosition);
      route=[target];
    }else if(resource){route=observedResourceRoute(npc,known);target={x:known.x,y:known.y};if(!route)return complete(npc,request,{ok:false,code:'NO_KNOWN_ROUTE'},context,startPosition);}
    else {
      const cell=cells[tileKey(target)];if(!cell?.walkable||distance(target,cell)>NPC_RULES.tileSize*.71||ozarkAgentWorld(npc)&&(target.x!==cell.x||target.y!==cell.y))return complete(npc,request,{ok:false,code:'UNOBSERVED_TARGET'},context,startPosition);
      route=knownRoute(cells,npc.position,target,30,edges,npc.elapsed,anchor);if(!route)return complete(npc,request,{ok:false,code:'NO_KNOWN_ROUTE'},context,startPosition);
    }
    if(distance(npc.position,target)<6)return complete(npc,request,{ok:true,code:'ARRIVED',distance:0},context,startPosition);
    npc.active={request,context,startPosition,startScene,route,index:0,startedAt:npc.elapsed,expiresAt:npc.elapsed+(request.duration||NPC_RULES.maxActionSeconds),startHydration:npc.hydration,startNourishment:npc.nourishment,startRisk:npc.riskCost,blockedFor:0,travelled:0};
    if(ozarkAgentWorld(npc))Object.assign(npc.active,{startWetness:npc.thermal.wetness,startStamina:npc.physiology.stamina,startFatigue:npc.physiology.fatigue,forwardProgress:0,attemptedDistance:0,waterSeconds:0,swimSeconds:0,climbSeconds:0,fallRiskSeconds:0,passiveDriftSeconds:0});
  }else npc.active={request,context,startPosition,startScene,startedAt:npc.elapsed,expiresAt:npc.elapsed+request.seconds,startHydration:npc.hydration,startNourishment:npc.nourishment,startRisk:npc.riskCost,startEnergy:npc.energy,startStamina:npc.stamina,startFatigue:npc.fatigue,startSleepPressure:npc.sleepPressure};
  npc.bodyMode=request.type==='sleep'?'sleeping':request.type==='rest'?'resting':'awake';
  if(npc.mode==='discovery'&&request.type==='sleep')beginSleep(npc,{hours:gameHours(request.seconds)});
  return {ok:true,code:'STARTED'};
}
export function collapseNpc(npc,reason='dehydration'){
  if(npc.lifecycle!=='AWAKE')return false;
  const active=npc.active;
  if(active)complete(npc,active.request,{ok:false,code:'COLLAPSED',hydrationLost:Math.max(0,active.startHydration-npc.hydration)},active.context,active.startPosition,active.startScene);
  if(npc.skillRun){const skill=npc.memory.skills.find(s=>s.id===npc.skillRun.id);if(skill)skill.failures++;npc.skillRun=null;}
  npc.lifecycle='COLLAPSED';npc.bodyMode='awake';npc.health=0;npc.collapseCause=reason;npc.lifecycleAt=npc.elapsed;npc.epoch++;npc.collapseId++;npc.stats.collapses++;
  if(npc.mode==='discovery'&&npc.physiology){npc.physiology.health=0;npc.physiology.sleep.state='awake';npc.physiology.sleep.depth=0;npc.physiology.sleep.remainingHours=0;}
  recordEvent(npc,'collapse',{collapseId:npc.collapseId,position:npc.position,scene:npc.scene,verifiedCause:reason,hydration:npc.hydration,nourishment:npc.nourishment,thermal:npc.thermal,reason});
  npc.decision='I lost consciousness. My identity, observations and experience remain.';return true;
}
export function rescueNpc(npc,collapseId=npc.collapseId){
  if(npc.lifecycle!=='COLLAPSED'||collapseId!==npc.collapseId||npc.rescuedCollapseId>=collapseId)return {ok:false,code:'ALREADY_RESCUED'};
  const ozark=ozarkAgentWorld(npc);
  const stand=(x,y)=>ozark?ozark.classify(x,y,CONFIG.playerRadius).walkable:canStand(x,y,npc.scene);
  let safe=stand(npc.position.x,npc.position.y)?{...npc.position}:null;
  let recoveryTravel=0,physicalRecovery=ozarkPersistentWorldAgent(npc)&&!safe;
  let candidateChecks=0;
  for(let radius=12;!safe&&candidateChecks<24&&radius<=(physicalRecovery?500:120);radius+=12)for(let i=0;i<16;i++){
    const p={x:npc.position.x+Math.cos(i*Math.PI/8)*radius,y:npc.position.y+Math.sin(i*Math.PI/8)*radius};
    if(!stand(p.x,p.y))continue;
    if(!physicalRecovery){safe=p;break;}
    // External rescue may cross water, but its landing must be reachable
    // along the same swept physical motion as an awake swimmer. Nothing in
    // this rescue search enters the actor's observations or route memory.
    const probe={...npc.position};let travelled=0,stalled=0;
    for(let step=0;step<120&&distance(probe,p)>6;step++){
      const before=distance(probe,p);
      const motion=ozark.advance(probe,p.x-probe.x,p.y-probe.y,.25,false,'swim');
      travelled+=motion.distance;
      stalled=before-distance(probe,p)<.05?stalled+1:0;
      if(stalled>4)break;
    }
    if(distance(probe,p)<=6&&stand(probe.x,probe.y)){safe=probe;recoveryTravel=travelled;break;}
    if(++candidateChecks>=24)break;
  }
  if(!safe)return {ok:false,code:'NO_SAFE_RECOVERY_POSITION'};
  const before={hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,hot:npc.thermal.hot,cold:npc.thermal.cold};
  npc.position=safe;npc.health=NPC_RULES.rescueHealth??65;
  npc.hydration=Math.max(npc.hydration,NPC_PRESETS[npc.preset].rescueHydration);
  npc.nourishment=Math.max(npc.nourishment,NPC_RULES.rescueNourishment??70);
  npc.energy=Math.max(npc.energy??0,BODY_RULES.rescueEnergy);npc.stamina=Math.max(npc.stamina??0,BODY_RULES.rescueStamina);npc.fatigue=Math.min(npc.fatigue??0,BODY_RULES.rescueFatigueMaximum);npc.sleepPressure=Math.min(npc.sleepPressure??0,BODY_RULES.rescueSleepPressureMaximum);npc.bodyMode='awake';
  if(npc.mode==='discovery')relievePhysiology(npc);
  npc.thermal.hot=Math.min(npc.thermal.hot,20);npc.thermal.cold=Math.min(npc.thermal.cold,20);npc.thermal.wetness=Math.min(npc.thermal.wetness,30);updateFeelings(npc);
  npc.rescuedCollapseId=collapseId;npc.lifecycle='RECOVERING';npc.lifecycleAt=npc.elapsed;npc.epoch++;
  npc.stats.rescues++;npc.stats.lastRescuer='divine';npc.presentation.rescueUntil=npc.elapsed+8;
  recordEvent(npc,'rescue',{collapseId,cause:npc.collapseCause,hydrationGain:npc.hydration-before.hydration,nourishmentGain:npc.nourishment-before.nourishment,healthGain:npc.health-before.health,thermalRelief:before.hot+before.cold-npc.thermal.hot-npc.thermal.cold,provenance:'divine',position:npc.position,scene:npc.scene,...(physicalRecovery?{recoveryTravel,recoveryMode:'swept swim'}:{}),verified:'Partial bodily relief was received during recovery, without gathering supplies.',observedAttribution:npc.rescuePresentation==='quiet'?'The source of the intervention was not observed.':'A warmth and a benevolent presence; divine attribution is an interpretation, not a witnessed human action.'});
  recoveryLesson(npc);npc.decision=npc.rescuePresentation==='quiet'?'I recovered with partial relief. The source of the intervention was not observed.':'A benevolent presence gave partial bodily relief. This rescue did not count as independent survival.';
  return {ok:true,code:'RESCUED',provenance:'divine'};
}
function tickBodyStores(npc,dt){
  const mode=npc.active?.request.type,sleeping=mode==='sleep',resting=mode==='rest',walking=mode==='move';
  const recovery=npc.nourishment>BODY_RULES.nourishmentForEnergyRecovery?(sleeping?BODY_RULES.sleepEnergyRecoveryPerSecond:resting?BODY_RULES.restEnergyRecoveryPerSecond:walking?0:BODY_RULES.idleEnergyRecoveryPerSecond):0;
  npc.energy=clamp((npc.energy??BODY_RULES.initialEnergy)+(recovery-(sleeping?0:BODY_RULES.awakeEnergyPerSecond))*dt,0,100);
  npc.stamina=clamp((npc.stamina??BODY_RULES.initialStamina)+(sleeping?BODY_RULES.sleepStaminaRecoveryPerSecond:resting?BODY_RULES.restStaminaRecoveryPerSecond:walking?0:BODY_RULES.idleStaminaRecoveryPerSecond)*dt,0,100);
  npc.fatigue=clamp((npc.fatigue??BODY_RULES.initialFatigue)+(sleeping?-BODY_RULES.sleepFatigueRecoveryPerSecond:resting?-BODY_RULES.restFatigueRecoveryPerSecond:BODY_RULES.awakeFatiguePerSecond)*dt,0,100);
  npc.sleepPressure=clamp((npc.sleepPressure??BODY_RULES.initialSleepPressure)+(sleeping?-BODY_RULES.sleepPressureRecoveryPerSecond:BODY_RULES.awakeSleepPressurePerSecond)*dt,0,100);
}
function exertBody(npc,movingSeconds){
  npc.energy=Math.max(0,npc.energy-BODY_RULES.walkingEnergyPerSecond*movingSeconds);
  npc.stamina=Math.max(0,npc.stamina-BODY_RULES.walkingStaminaPerSecond*movingSeconds);
  npc.fatigue=Math.min(100,npc.fatigue+BODY_RULES.walkingFatiguePerSecond*movingSeconds);
}
export function tickNpc(npc,dt,environment={}){
  if(!Number.isFinite(dt)||dt<=0)return;
  if(npc.mode==='discovery')return tickDiscoveryNpc(npc,dt,environment);
  dt=Math.min(dt,.25);npc.elapsed+=dt;
  const rules=NPC_PRESETS[npc.preset];
  if(npc.lifecycle==='COLLAPSED'){if(npc.elapsed-npc.lifecycleAt>=rules.rescueDelay)rescueNpc(npc);return;}
  if(npc.lifecycle==='RECOVERING'){
    if(npc.elapsed-npc.lifecycleAt>=rules.recoverySeconds){npc.lifecycle='AWAKE';npc.lifecycleAt=npc.elapsed;npc.epoch++;npc.nextDecisionAt=npc.elapsed;recordEvent(npc,'recovery',{collapseId:npc.collapseId,hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,identity:npc.id});}
    return;
  }
  const previousRisk=bodyRisk(npc),previousSignals=bodySignals(npc);
  const previous={hydration:npc.hydration,nourishment:npc.nourishment,hot:npc.thermal.hot,cold:npc.thermal.cold,health:npc.health};
  npc.sensation=environmentConditions(environment,{position:npc.position,scene:npc.scene,wetness:npc.thermal.wetness});
  const sensation=npc.sensation,thermal=npc.thermal,felt=sensation.feltTemperature;
  if(sensation.raining&&!sensation.sheltered)thermal.wetness=clamp(thermal.wetness+(NPC_RULES.wettingPerSecond??.55)*dt,0,100);
  else thermal.wetness=Math.max(0,thermal.wetness-(NPC_RULES.dryingPerSecond??.35)*(sensation.sheltered?2:1)*dt);
  const hot=Math.max(0,felt-(NPC_RULES.hotComfortMax??28)),cold=Math.max(0,(NPC_RULES.coldComfortMin??10)-felt),recovery=NPC_RULES.thermalRecoveryPerSecond??2;
  thermal.hot=clamp(thermal.hot+(hot>0?hot*(NPC_RULES.hotStrainPerDegreeSecond??.33):-recovery)*dt,0,100);
  thermal.cold=clamp(thermal.cold+(cold>0?cold*(NPC_RULES.coldStrainPerDegreeSecond??.12):-recovery)*dt,0,100);
  const hydrationRate=(rules.hydrationDepletionPerSecond??rules.depletionPerSecond)*(1+hot*.06+thermal.hot/100*.2);
  npc.hydration=Math.max(0,npc.hydration-hydrationRate*dt);npc.nourishment=Math.max(0,npc.nourishment-rules.nourishmentDepletionPerSecond*dt);
  // Bodily safety wakes an agent; conversation or a long intention cannot disable this reflex.
  if(['rest','sleep'].includes(npc.active?.request.type)&&restUnsafe(npc)){
    const interrupted=npc.active;complete(npc,interrupted.request,{ok:false,code:'REST_INTERRUPTED',body:bodySignals(npc),riskCost:Math.max(0,npc.riskCost-interrupted.startRisk)},interrupted.context,interrupted.startPosition,interrupted.startScene);npc.nextDecisionAt=npc.elapsed;
  }
  tickBodyStores(npc,dt);
  const warning=NPC_RULES.thermalWarning??40,critical=NPC_RULES.criticalThermal??80;
  const conditions=[[previous.hydration,npc.hydration,NPC_RULES.thirstWarning,'THIRST_WARNING','down'],[previous.hydration,npc.hydration,NPC_RULES.criticalHydration,'CRITICAL_THIRST','down'],[previous.nourishment,npc.nourishment,NPC_RULES.hungerWarning,'HUNGER_WARNING','down'],[previous.nourishment,npc.nourishment,NPC_RULES.criticalNourishment,'CRITICAL_HUNGER','down'],[previous.hot,thermal.hot,warning,'HEAT_WARNING','up'],[previous.hot,thermal.hot,critical,'CRITICAL_HEAT','up'],[previous.cold,thermal.cold,warning,'COLD_WARNING','up'],[previous.cold,thermal.cold,critical,'CRITICAL_COLD','up']];
  for(const [before,after,threshold,code,direction]of conditions)if(direction==='down'?before>threshold&&after<=threshold:before<threshold&&after>=threshold){
    recordEvent(npc,'condition',{code,hydration:npc.hydration,nourishment:npc.nourishment,thermal:{...thermal},health:npc.health,verified:'Discomfort and risk increase before prolonged deprivation or exposure damages health.'});
    if(!npc.active)npc.decision=code.includes('CRITICAL')?'A bodily need is critical; continuing without relief risks injury.':'A bodily need is becoming uncomfortable. Relief can prevent injury.';
  }
  const inWarning=npc.hydration<=NPC_RULES.thirstWarning||npc.nourishment<=NPC_RULES.hungerWarning||Math.max(thermal.hot,thermal.cold)>=warning;
  const inCritical=npc.hydration<=NPC_RULES.criticalHydration||npc.nourishment<=NPC_RULES.criticalNourishment||Math.max(thermal.hot,thermal.cold)>=critical;
  if(inWarning)npc.stats.warningSeconds+=dt;if(inCritical)npc.stats.criticalSeconds+=dt;
  const risk=(previousRisk+bodyRisk(npc))*.5*dt,thermalRelief=Math.max(0,previous.hot+previous.cold-thermal.hot-thermal.cold);
  npc.riskCost+=risk;learningCostTick(npc,dt,risk,{thermalRelief});
  npc.bodyFeedback.cost+=risk;
  if(npc.elapsed-npc.bodyFeedback.since>=1){
    if(inWarning||thermalRelief>0)recordEvent(npc,'condition',{code:'BODY_FEEDBACK',intervalSeconds:npc.elapsed-npc.bodyFeedback.since,riskCost:npc.bodyFeedback.cost,hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,thermal:{...thermal},scene:npc.scene});
    npc.bodyFeedback={since:npc.elapsed,cost:0};
  }
  const damage=(npc.nourishment<=0?(NPC_RULES.starvationDamagePerSecond??1.2):0)+(npc.hydration<=0?(NPC_RULES.dehydrationDamagePerSecond??2):0)+Math.max(0,(Math.max(thermal.hot,thermal.cold)-critical)/(100-critical))*(NPC_RULES.thermalDamagePerSecond??1);
  if(damage>0){npc.health=Math.max(0,npc.health-damage*dt);npc.stats.injuries+=damage*dt;}
  else if(!inWarning)npc.health=Math.min(100,npc.health+(NPC_RULES.healthRecoveryPerSecond??.03)*dt);
  npc.feelings.relief=Math.max(0,npc.feelings.relief-dt*.15);updateFeelings(npc,thermalRelief/5);
  if(npc.health<=0){
    const cause=npc.hydration<=0&&npc.nourishment<=0?'combined starvation and dehydration':npc.nourishment<=0?'starvation':npc.hydration<=0?'dehydration':thermal.hot>=critical?'heat exposure':'cold exposure';collapseNpc(npc,cause);return;
  }
  const signals=bodySignals(npc);if(Object.keys(signals).some(key=>signals[key]!==previousSignals[key]))recordEvent(npc,'condition',{code:'BODY_SIGNAL',body:signals});
  const active=npc.active;if(!active)return;
  const losses={hydrationLost:Math.max(0,active.startHydration-npc.hydration),nourishmentLost:Math.max(0,active.startNourishment-npc.nourishment),riskCost:Math.max(0,npc.riskCost-active.startRisk)};
  if(active.request.type==='wait'){if(npc.elapsed>=active.expiresAt)complete(npc,active.request,{ok:true,code:'WAITED',...losses},active.context,active.startPosition,active.startScene);return;}
  if(['rest','sleep'].includes(active.request.type)){
    if(npc.elapsed>=active.expiresAt)complete(npc,active.request,{ok:true,code:active.request.type==='sleep'?'SLEPT':'RESTED',...losses,energyRecovered:Math.max(0,npc.energy-active.startEnergy),staminaRecovered:Math.max(0,npc.stamina-active.startStamina),fatigueRelieved:Math.max(0,active.startFatigue-npc.fatigue),sleepPressureRelieved:Math.max(0,active.startSleepPressure-npc.sleepPressure),body:bodySignals(npc)},active.context,active.startPosition,active.startScene);
    return;
  }
  const target=active.route[active.index];
  if(!target){complete(npc,active.request,{ok:true,code:'ARRIVED',distance:active.travelled,novelCells:active.novelCells||0,...losses},active.context,active.startPosition,active.startScene);return;}
  const dx=target.x-npc.position.x,dy=target.y-npc.position.y,d=Math.hypot(dx,dy);
  if(d<3){if(rememberedCells(npc)[tileKey(target)]?.walkable)npc.navigationAnchor=tileKey(target);active.index++;active.blockedFor=0;return;}
  const pace=npc.stamina<=BODY_RULES.lowStamina||npc.fatigue>=BODY_RULES.highFatigue||npc.energy<=BODY_RULES.lowEnergy?BODY_RULES.exhaustedWalkMultiplier:1;
  const moved=moveActor(npc.position,dx,dy,Math.min(dt*pace,d/CONFIG.walkSpeed),false,npc.scene);active.travelled+=moved;exertBody(npc,moved/CONFIG.walkSpeed);updateFeelings(npc);
  active.blockedFor=moved<.05?active.blockedFor+dt:0;
  if(active.blockedFor>1||npc.elapsed>active.expiresAt){
    const code=active.blockedFor>1?'ROUTE_BLOCKED':'ACTION_TIMEOUT';
    if(active.blockedFor>1){const from=active.index?active.route[active.index-1]:active.startPosition;npc.navigationAnchor=tileKey(from);const edge=[tileKey(from),tileKey(target)].sort().join('>'),edges=rememberedEdges(npc);edges[edge]={observedAt:npc.elapsed,retryAfter:npc.elapsed+60};const entries=Object.entries(edges);if(entries.length>512)delete edges[entries[0][0]];}
    complete(npc,active.request,{ok:false,code,distance:active.travelled,novelCells:active.novelCells||0,...losses},active.context,active.startPosition,active.startScene);
  }
}
export function changeNpcPreset(npc,preset){if(!NPC_PRESETS[preset])return false;npc.preset=preset;recordEvent(npc,'debug',{setting:'survival preset',value:preset,provenance:'debug',hydrationGain:0,nourishmentGain:0});return true;}
export function demonstrateCollapse(npc){if(npc.lifecycle!=='AWAKE')return false;recordEvent(npc,'debug',{setting:'health',value:0,provenance:'debug'});npc.health=0;return collapseNpc(npc,'explicit developer demonstration');}

/** Discovery uses the same movement/collision ledger and a slower biological clock. */
function tickDiscoveryNpc(npc,dt,environment){
  dt=Math.min(dt,.25);npc.elapsed+=dt;
  const ozark=ozarkAgentWorld(npc);
  if(ozark&&npc.lifecycle!=='AWAKE'){
    const drift=ozark.advance(npc.position,0,0,dt,false);
    wetOzarkBody(npc,dt,drift.waterSeconds);
  }
  if(npc.lifecycle==='COLLAPSED'){if(npc.elapsed-npc.lifecycleAt>=simulationSeconds(BIOLOGY_RULES.rescueDelayGameHours))rescueNpc(npc);return;}
  if(npc.lifecycle==='RECOVERING'){
    if(npc.elapsed-npc.lifecycleAt>=simulationSeconds(BIOLOGY_RULES.recoveryGameHours)){npc.lifecycle='AWAKE';npc.lifecycleAt=npc.elapsed;npc.epoch++;npc.nextDecisionAt=npc.elapsed;recordEvent(npc,'recovery',{collapseId:npc.collapseId,identity:npc.id,body:bodySignals(npc)});}
    return;
  }
  const previousSignals=bodySignals(npc),previousRisk=bodyRisk(npc);
  npc.sensation=ozark?ozarkAgentSensation(npc,environment):environmentConditions(environment,{position:npc.position,scene:npc.scene,wetness:npc.thermal.wetness});
  const result=tickPhysiology(npc,dt,npc.sensation,{activity:npc.active?.request.type==='rest'?'resting':'awake'});
  if(result.damage>0)npc.stats.injuries+=result.damage;
  const risk=(previousRisk+bodyRisk(npc))*.5*dt;npc.riskCost+=risk;npc.bodyFeedback.cost+=risk;learningCostTick(npc,dt,risk,{thermalRelief:0});updateFeelings(npc);
  const signals=bodySignals(npc);
  if(signals.overall==='urgent')npc.stats.criticalSeconds+=dt;
  if(signals.overall!=='settled')npc.stats.warningSeconds+=dt;
  if(Object.keys(signals).some(key=>signals[key]!==previousSignals[key]))recordEvent(npc,'condition',{code:'BODY_SIGNAL',body:signals});
  if(npc.elapsed-npc.bodyFeedback.since>=30){if(signals.overall!=='settled')recordEvent(npc,'condition',{code:'BODY_FEEDBACK',intervalSeconds:npc.elapsed-npc.bodyFeedback.since,riskCost:npc.bodyFeedback.cost,body:signals,scene:npc.scene});npc.bodyFeedback={since:npc.elapsed,cost:0};}
  if(npc.health<=0){const f=npc.physiology,p=BIOLOGY_PROFILES[f.profile];collapseNpc(npc,f.waterDeficitMl/(p.massKg*1000)>.05?'dehydration':f.availableEnergyKcal<=0?'prolonged deprivation':Math.max(npc.thermal.hot,npc.thermal.cold)>=80?'thermal exposure':'injury');return;}
  const active=npc.active;
  if(ozark&&!movementActions.has(active?.request.type)){
    // The river moves a body even when the actor has chosen no movement.
    const drift=ozark.advance(npc.position,0,0,dt,false);
    wetOzarkBody(npc,dt,drift.waterSeconds);
  }
  if(!active)return;
  const losses={riskCost:Math.max(0,npc.riskCost-(active.startRisk||0))};
  if(active.kind==='interaction'){tickDiscoveryAction(npc,dt,environment,{complete,exert:exertPhysiology});return;}
  if(active.request.type==='sleep'){
    if(!isSleeping(npc)){
      const finished=npc.physiology.sleep.wakeReason==='finished sleep';complete(npc,active.request,{ok:finished,code:finished?'SLEPT':'REST_INTERRUPTED',body:bodySignals(npc),wakeReason:npc.physiology.sleep.wakeReason,...losses},active.context,active.startPosition,active.startScene);npc.nextDecisionAt=npc.elapsed;
    }
    return;
  }
  if(active.request.type==='wait'||active.request.type==='rest'){
    if(active.request.type==='rest'&&restUnsafe(npc)){complete(npc,active.request,{ok:false,code:'REST_INTERRUPTED',body:signals,...losses},active.context,active.startPosition,active.startScene);npc.nextDecisionAt=npc.elapsed;}
    else if(npc.elapsed>=active.expiresAt)complete(npc,active.request,{ok:true,code:active.request.type==='rest'?'RESTED':'WAITED',body:signals,...losses},active.context,active.startPosition,active.startScene);
    return;
  }
  const target=active.route?.[active.index];
  if(!target){complete(npc,active.request,{ok:true,code:'ARRIVED',distance:active.travelled||0,novelCells:active.novelCells||0,...losses},active.context,active.startPosition,active.startScene);return;}
  const dx=target.x-npc.position.x,dy=target.y-npc.position.y,d=Math.hypot(dx,dy);
  if(d<3){if(rememberedCells(npc)[tileKey(target)]?.walkable)npc.navigationAnchor=tileKey(target);active.index++;active.blockedFor=0;return;}
  const exhausted=npc.stamina<15||npc.fatigue>75||npc.energy<15||npc.physiology.sleep.inertiaHours>0,pace=exhausted?BIOLOGY_RULES.exhaustionWalkMultiplier:1;
  let moved,forward;
  if(ozark){
    const before={...npc.position},duration=Math.min(dt*pace,d/CONFIG.walkSpeed);
    const mode=active.request.type==='move'?'walk':active.request.type;
    let motion=ozark.advance(npc.position,dx,dy,duration,false,mode);
    // A walking request made while already in deep water cannot propel the
    // actor, but it also cannot cancel the river's passive current.
    const passiveDrift=mode==='walk'&&motion.distance===0;
    if(passiveDrift)motion=ozark.advance(npc.position,0,0,duration,false,'walk');
    moved=motion.distance;
    // The result includes current drift; conservatively exclude all passive
    // drift from forward progress so a favorable current cannot hide a stall.
    forward=Math.max(0,((npc.position.x-before.x)*dx+(npc.position.y-before.y)*dy)/d-motion.driftDistance);
    active.forwardProgress+=forward;
    active.attemptedDistance+=CONFIG.walkSpeed*duration;
    active.waterSeconds+=(motion.waterSeconds||0);
    if(mode==='swim')active.swimSeconds+=(motion.swimSeconds||0);
    active.climbSeconds+=(motion.climbSeconds||0);
    active.fallRiskSeconds+=(motion.fallRiskSeconds||0);
    if(passiveDrift)active.passiveDriftSeconds+=(motion.waterSeconds||0);
    wetOzarkBody(npc,dt,motion.waterSeconds);
    // A resisted step still costs effort; passive current displacement is not
    // credited as purposeful progress or as extra work.
    const effort=ozarkPersistentWorldAgent(npc)?Math.max(1,(motion.effortSeconds||0)/Math.max(duration,1e-9)):
      1+.6*motion.waterSeconds/Math.max(duration,1e-9);
    exertPhysiology(npc,duration,effort);
  }else{
    moved=moveActor(npc.position,dx,dy,Math.min(dt*pace,d/CONFIG.walkSpeed),false,npc.scene);
    exertPhysiology(npc,moved/CONFIG.walkSpeed,1);
    forward=moved;
  }
  active.travelled+=moved;updateFeelings(npc);
  active.blockedFor=forward<.05?active.blockedFor+dt:0;
  if(ozarkPersistentWorldAgent(npc)&&active.request.type==='climb'&&active.fallRiskSeconds>=.5){
    const injury=harmPhysiology(npc,2,{stimulus:'contact'});
    npc.stats.injuries+=injury.damage||0;
    recordEvent(npc,'condition',{code:'CLIMB_SLIP',body:bodySignals(npc),position:{...npc.position},scene:npc.scene,provenance:'experienced footing'});
    complete(npc,active.request,{ok:false,code:'SLIPPED',distance:active.travelled,body:bodySignals(npc),...losses},active.context,active.startPosition,active.startScene);
    return;
  }
  if(active.blockedFor>1||npc.elapsed>active.expiresAt){
    const code=active.blockedFor>1?'ROUTE_BLOCKED':'ACTION_TIMEOUT';
    if(active.blockedFor>1){const from=active.index?active.route[active.index-1]:active.startPosition;npc.navigationAnchor=tileKey(from);const edge=[tileKey(from),tileKey(target)].sort().join('>'),edges=rememberedEdges(npc);edges[edge]={observedAt:npc.elapsed,retryAfter:npc.elapsed+60};const entries=Object.entries(edges);if(entries.length>512)delete edges[entries[0][0]];}
    complete(npc,active.request,{ok:false,code,distance:active.travelled,novelCells:active.novelCells||0,...(ozarkPersistentWorldAgent(npc)?{blockedTarget:{x:target.x,y:target.y}}:{}),...losses},active.context,active.startPosition,active.startScene);
  }
}
