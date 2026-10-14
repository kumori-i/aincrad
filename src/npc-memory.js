import { NPC_RULES, CAVES, CAVE_EXIT } from './config.js';
import { createNpc } from './npc-state.js';
import { clamp, canStand, distance } from './world.js';
import { waterSource, foodSource, shelterSource, withinWorld } from './resources.js';
import { tileKey, tilePoint } from './perception.js';
import { validateCognition } from './cognition.js';
import { validateSocialMemory } from './social.js';
import { rememberDiscoveryObservation,recordDiscoveryOutcome } from './discovery.js';
import { validateDiscoveryMemory,objectId } from './discovery-state.js';
import { validatePhysiology,projectPhysiology } from './biology.js';
import { DISCOVERY_RULES } from './discovery-config.js';

const EVENT_TYPES=new Set(['observation','action','decision','collapse','rescue','recovery','provider','lesson','debug','skill','condition','social','belief','plan']);
const OPS=new Set(['observe','move','inspect','fill_flask','drink','wait','gather_food','eat','enter_shelter','exit_shelter','rest','sleep','say','ask_human','journal_reply','write_note','read_note',...DISCOVERY_RULES.primitives]);
const CATEGORIES=new Set(['observe','inspect','move_explore','move_source','move_food','move_shelter','fill_flask','drink','wait','gather_food','eat','enter_shelter','exit_shelter','rest','sleep','say','ask_human','journal_reply','write_note','read_note',...DISCOVERY_RULES.primitives]);
const finite=(v,otherwise=0,max=1e10)=>Number.isFinite(v)?clamp(v,0,max):otherwise;
const str=(v,max=600)=>typeof v==='string'?v.slice(0,max):'';
const cellsFor=(npc,scene=npc.scene)=>scene==='valley'?npc.memory.cells:(npc.memory.caveCells[scene]||={});
function compact(value,depth=0){
  if(depth>5)return null;
  if(typeof value==='string')return value.slice(0,600);
  if(typeof value==='number')return Number.isFinite(value)?clamp(value,-1e12,1e12):null;
  if(typeof value==='boolean'||value===null)return value;
  if(Array.isArray(value))return value.slice(0,24).map(v=>compact(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','constructor','prototype'].includes(k)).slice(0,24).map(([k,v])=>[k.slice(0,60),compact(v,depth+1)]));
  return null;
}
export function recordEvent(npc,type,details={}){
  const event={id:npc.memory.nextId++,at:npc.elapsed,type,details:compact(details)};
  npc.memory.experience.push(event);
  if(npc.memory.experience.length>NPC_RULES.maxExperience){
    const protectedIds=new Set([...npc.memory.skills.flatMap(s=>s.supportingExperience),...(npc.inventory?.apples||[]).map(a=>a.eventId),...(npc.discovery?.experiments||[]).map(e=>e.actionId),...(npc.discovery?.effects||[]).map(e=>e.proofEventId),npc.flask.fillEventId,...Object.keys(npc.memory.shelters||{}).map(id=>npc.memory.experience.filter(e=>e.details.action?.type==='enter_shelter'&&e.details.action.shelterId===id&&e.details.result?.ok).at(-1)?.id)].filter(Number.isInteger));
    const removable=npc.memory.experience.findIndex(e=>!protectedIds.has(e.id));
    npc.memory.experience.splice(removable<0?0:removable,1);
  }
  return event;
}
export function rememberObservation(npc,observation){
  if(npc.mode==='discovery')rememberDiscoveryObservation(npc,observation.objects||[]);
  const m=npc.memory;m.foods||={};m.shelters||={};m.caveCells||={};m.caveEdges||={};m.caveExits||={};m.features||={};m.effects||={};
  if(!npc.learning){
    const origin=m.exploration.origin;
    m.cells={};m.sources={};m.foods={};m.shelters={};m.blockedEdges={};m.caveCells={};m.caveEdges={};m.caveExits={};m.exploration={origin,lastVisited:null,recentTargets:[],heading:null};
  }
  if(observation.exit&&npc.scene!=='valley')m.caveExits[npc.scene]={x:observation.exit.x,y:observation.exit.y,observedAt:npc.elapsed};
  if(!m.exploration.origin&&npc.scene==='valley')m.exploration.origin={...observation.position};
  const cells=cellsFor(npc),newSources=[],newFoods=[],newShelters=[];let newCells=0;
  for(const cell of observation.cells){const old=cells[cell.key];if(!old)newCells++;cells[cell.key]={...cell,visits:old?.visits||0};}
  const key=tileKey(npc.position),visitKey=`${npc.scene}:${key}`;
  if(cells[key]&&m.exploration.lastVisited!==visitKey){cells[key].visits++;m.exploration.lastVisited=visitKey;}
  if(npc.active?.request.type==='move')npc.active.novelCells=(npc.active.novelCells||0)+newCells;
  for(const [observed,name,newIds] of [[observation.sources||[],'sources',newSources],[observation.foods||[],'foods',newFoods],[observation.shelters||[],'shelters',newShelters]]){
    for(const item of observed){const old=m[name][item.id];if(!old)newIds.push(item.id);m[name][item.id]={...item,scene:'valley',observedAt:npc.elapsed,confidence:'observed',retryAfter:old?.available===item.available?(old?.retryAfter||0):0,...(name==='shelters'&&old?{relief:old.relief||0,reliefCredit:old.reliefCredit||0,creditedEntryId:old.creditedEntryId||null,...(Number.isFinite(old.experiencedTemperature)?{experiencedTemperature:old.experiencedTemperature,experiencedAt:old.experiencedAt}:{} )}: {})};}
    const bounded=Object.values(m[name]);if(bounded.length>NPC_RULES.maxSources){bounded.sort((a,b)=>b.observedAt-a.observedAt);m[name]=Object.fromEntries(bounded.slice(0,NPC_RULES.maxSources).map(s=>[s.id,s]));}
  }
  const all=Object.values(cells);if(all.length>NPC_RULES.maxCells){all.sort((a,b)=>b.observedAt-a.observedAt);const limited=Object.fromEntries(all.slice(0,NPC_RULES.maxCells).map(c=>[c.key,c]));if(npc.scene==='valley')m.cells=limited;else m.caveCells[npc.scene]=limited;}
  if(newSources.length||newFoods.length||newShelters.length||!m.experience.length)recordEvent(npc,'observation',{scene:npc.scene,position:npc.position,newCells,newSources,newFoods,newShelters,hydration:npc.hydration,nourishment:npc.nourishment});
  return {newCells,newSources,newFoods,newShelters};
}
const band=(value,warning,critical=20)=>value<critical?'critical':value<warning?'warning':value<75?'low':'comfortable';
export function bodyFeatures(npc){
  const m=npc.memory,thermal=Math.max(npc.thermal?.hot||0,npc.thermal?.cold||0);
  return {thirst:clamp((100-npc.hydration)/100,0,1),hunger:clamp((100-(npc.nourishment??100))/100,0,1),thermal:clamp(thermal/100,0,1),injured:clamp((100-(npc.health??100))/100,0,1),water:npc.flask.water>0?1:0,food:(npc.inventory?.apples.length||0)>0?1:0,sheltered:npc.scene!=='valley'?1:0,knownWater:Object.values(m.sources).some(s=>s.available)?1:0,knownFood:Object.values(m.foods||{}).some(s=>s.available)?1:0,knownShelter:Object.keys(m.shelters||{}).length?1:0};
}
export function policyContext(npc){
  const sources=Object.values(npc.memory.sources).filter(s=>s.available),water=npc.scene==='valley'&&sources.some(s=>distance(s,npc.position)<=NPC_RULES.collectionRange)?'near':sources.length?'known':'unknown';
  return `${band(npc.hydration,NPC_RULES.thirstWarning,NPC_RULES.criticalHydration)}|${npc.flask.water>0?'water':'empty'}|${water}|${band(npc.nourishment??100,NPC_RULES.hungerWarning||45,NPC_RULES.criticalNourishment||20)}|${npc.inventory?.apples.length?'food':'empty'}|${Math.max(npc.thermal?.hot||0,npc.thermal?.cold||0)>(NPC_RULES.thermalWarning??40)?'exposed':'comfortable'}|${npc.scene==='valley'?'outside':'sheltered'}`;
}
export function actionCategory(action){return action?.type==='move'?(action.sourceId?'move_source':action.foodId?'move_food':action.shelterId?'move_shelter':'move_explore'):action?.type;}
function boundedValues(npc){const entries=Object.entries(npc.memory.values);if(entries.length>384)npc.memory.values=Object.fromEntries(entries.slice(-384));}
function credit(npc,context,category,reward,alpha,attempt=false,features=bodyFeatures(npc)){
  if(!npc.learning||!CATEGORIES.has(category)||typeof context!=='string')return;
  const key=`${context}::${category}`,v=npc.memory.values[key]||{attempts:0,value:0};
  if(attempt)v.attempts++;v.value=clamp(v.value+alpha*(clamp(reward,-12,12)-v.value),-12,12);npc.memory.values[key]=v;boundedValues(npc);
  npc.memory.features||={};
  for(const [feature,amount] of Object.entries(features)){const k=`${category}:${feature}`,old=npc.memory.features[k]||0;npc.memory.features[k]=clamp(old+alpha*.25*amount*(reward-old),-8,8);}
}
export function updateValue(npc,context,category,reward){credit(npc,context,category,reward,.25,true);}
export function learnedValue(npc,action){
  if(!npc.learning)return {value:0,attempts:0};
  const category=actionCategory(action),current=npc.memory.values[`${policyContext(npc)}::${category}`];
  const features=bodyFeatures(npc),entries=Object.entries(features).filter(([,v])=>v>0),general=entries.reduce((sum,[name,v])=>sum+(npc.memory.features?.[`${category}:${name}`]||0)*v,0)/Math.max(1,entries.reduce((sum,[,v])=>sum+v,0));
  return {value:(current?.value||0)*.45+general*.55,attempts:current?.attempts||0};
}
/** Physiological consequences are integrated every simulation step, including travel and inference.
 * The recent action window is a supplied eligibility-trace mechanism, not invented reasoning. */
export function learningCostTick(npc,dt,intervalCost,{thermalRelief=0}={}){
  if(!npc.learning||npc.lifecycle!=='AWAKE'||!Number.isFinite(dt)||dt<=0)return;
  const cost=Math.max(0,Number.isFinite(intervalCost)?intervalCost:0),recent=npc.memory.experience.filter(e=>e.type==='action'&&e.at>=npc.elapsed-20&&e.details.action).slice(-6);
  const targets=[];
  if(npc.active)targets.push({context:npc.active.context||policyContext(npc),category:actionCategory(npc.active.request),weight:1});
  for(const event of recent){if(event.details.result?.provenance==='rescue'||event.details.result?.code==='PRIORITY_CHANGED')continue;targets.push({context:event.details.context,category:actionCategory(event.details.action),weight:Math.exp(-(npc.elapsed-event.at)/10)*.5});}
  const total=targets.reduce((sum,t)=>sum+t.weight,0)||1;
  for(const target of targets)credit(npc,target.context,target.category,-Math.min(12,cost/Math.max(dt,.001)),Math.min(.08,dt*.08)*target.weight/total);
  // Only actual accumulated thermal relief gives shelter credit. Threshold crossing alone does not.
  if(thermalRelief>0&&npc.scene!=='valley'){
    const shelter=npc.memory.shelters[npc.scene];
    const enter=npc.memory.experience.filter(e=>e.details.action?.type==='enter_shelter'&&e.details.action.shelterId===npc.scene&&e.details.result?.ok).at(-1),intervention=npc.memory.experience.filter(e=>e.type==='rescue'||e.type==='debug').at(-1);
    if(shelter&&enter&&(!intervention||enter.id>intervention.id)){shelter.relief=(shelter.relief||0)+thermalRelief;shelter.reliefCredit=(shelter.reliefCredit||0)+thermalRelief;
      credit(npc,policyContext(npc),'enter_shelter',Math.min(8,thermalRelief/Math.max(dt,.001)*2),Math.min(.08,dt*.08));
      if(shelter.reliefCredit>=15&&shelter.creditedEntryId!==enter.id){shelter.reliefCredit=0;shelter.creditedEntryId=enter.id;const event=recordEvent(npc,'condition',{code:'SHELTER_RELIEF',shelterId:shelter.id,thermalRelief:15,provenance:'ordinary exposure recovery'});candidateFromRelief(npc,event,shelter.id);}
    }
  }
}
function makeSkill(npc,{id,name,signature,need,parameter,steps,inRange=false},event,resourceId,start,evidence){
  let skill=npc.memory.skills.find(s=>s.id===id);
  if(!skill){if(npc.memory.skills.length>=NPC_RULES.maxSkills)return;skill={id,name,signature,need,recognition:'provided bounded recognition template',status:'candidate',parameters:[parameter],preconditions:{resourceKnown:true,inRange},steps,successCheck:`ordinary useful ${need} relief`,failureConditions:['ROUTE_BLOCKED','OUT_OF_REACH','RESOURCE_UNAVAILABLE','COLLAPSED'],supportingExperience:[],validation:[],successes:0,failures:0};npc.memory.skills.push(skill);}
  skill.successes++;skill.supportingExperience=[...new Set([...skill.supportingExperience,...evidence])].slice(-36);
  const changed=skill.validation.some(v=>v.resourceId!==resourceId||distance(v.startPosition,start)>NPC_RULES.tileSize);
  skill.validation.push({at:npc.elapsed,resourceId,sourceId:resourceId,startPosition:{...start},eventId:event.id,outcome:'success'});skill.validation=skill.validation.slice(-16);
  if(skill.successes>=2&&changed)skill.status='validated';
  recordEvent(npc,'skill',{skillId:skill.id,status:skill.status,supportingExperience:evidence,transferEvidence:changed,recognition:skill.recognition});return skill;
}
function precedingMove(npc,id,before){return npc.memory.experience.filter(e=>e.type==='action'&&e.id<before.id&&e.at>=before.at-90&&e.details.result?.ok&&e.details.action?.type==='move'&&[e.details.action.sourceId,e.details.action.foodId,e.details.action.shelterId].includes(id)).at(-1);}
function candidateFromDrink(npc,event){
  const fill=npc.memory.experience.find(e=>e.id===npc.flask.fillEventId&&e.details.action?.type==='fill_flask'&&e.details.result?.ok);if(!fill)return;
  const id=fill.details.action.sourceId,move=precedingMove(npc,id,fill),steps=[...(move?[{type:'move',sourceId:'$sourceId'}]:[]),{type:'fill_flask',sourceId:'$sourceId'},{type:'drink'}];
  makeSkill(npc,{id:`water-${move?'approach-fill-drink':'fill-drink'}`,signature:move?'approach-fill-drink':'fill-drink',name:move?'Approach, collect, drink':'Collect and drink',need:'water',parameter:'sourceId',steps,inRange:!move},event,id,move?.details.startPosition||fill.details.startPosition,[...(move?[move.id]:[]),fill.id,event.id]);
}
function candidateFromEat(npc,event){
  const id=event.details.result.foodId,eventId=event.details.result.gatherEventId||event.details.result.collectionEventId;
  const gather=npc.memory.experience.find(e=>e.id===eventId&&e.details.action?.type==='gather_food'&&e.details.result?.ok)||npc.memory.experience.filter(e=>e.id<event.id&&e.details.action?.foodId===id&&e.details.action?.type==='gather_food'&&e.details.result?.ok).at(-1);if(!gather)return;
  const move=precedingMove(npc,id,gather),steps=[...(move?[{type:'move',foodId:'$foodId'}]:[]),{type:'gather_food',foodId:'$foodId'},{type:'eat'}];
  makeSkill(npc,{id:`food-${move?'approach-gather-eat':'gather-eat'}`,signature:move?'approach-gather-eat':'gather-eat',name:move?'Approach, gather, eat':'Gather and eat',need:'food',parameter:'foodId',steps,inRange:!move},event,id,move?.details.startPosition||gather.details.startPosition,[...(move?[move.id]:[]),gather.id,event.id]);
}
function candidateFromRelief(npc,event,id){
  const enter=npc.memory.experience.filter(e=>e.type==='action'&&e.details.action?.type==='enter_shelter'&&e.details.action.shelterId===id&&e.details.result?.ok&&e.at>=npc.elapsed-180).at(-1);if(!enter)return;
  const move=precedingMove(npc,id,enter),steps=[...(move?[{type:'move',shelterId:'$shelterId'}]:[]),{type:'enter_shelter',shelterId:'$shelterId'},{type:'wait',seconds:5}];
  makeSkill(npc,{id:`shelter-${move?'approach-enter-rest':'enter-rest'}`,signature:move?'approach-enter-rest':'enter-rest',name:move?'Approach shelter and rest':'Enter shelter and rest',need:'thermal',parameter:'shelterId',steps,inRange:!move},event,id,move?.details.startPosition||enter.details.startPosition,[...(move?[move.id]:[]),enter.id,event.id]);
}
export function learnOutcome(npc,action,result,context,startPosition){
  const previous=npc.memory.experience.filter(e=>e.type==='action').at(-1);
  const timedProgress=result.code==='ACTION_TIMEOUT'&&(result.distance||0)>40;
  if(!result.ok&&result.code!=='PRIORITY_CHANGED'&&!timedProgress){npc.stats.invalidActions++;if(previous?.details.result?.code===result.code&&previous?.details.action?.type===action.type)npc.stats.repeatedInvalid++;}
  const event=recordEvent(npc,'action',{action,result,context,startPosition,scene:npc.scene,position:npc.position,hydration:npc.hydration,nourishment:npc.nourishment,thermal:npc.thermal,flask:npc.flask.water});
  if(npc.mode==='discovery')recordDiscoveryOutcome(npc,action,result,event);
  npc.lastResult={eventId:event.id,at:npc.elapsed,...result,action:action.type};npc.memory.trace=[...npc.memory.trace,event.id].slice(-12);
  let reward=result.ok?0:timedProgress?-.15:-2;
  if(action.type==='move'&&!action.sourceId&&!action.foodId&&!action.shelterId){
    if(result.code==='ROUTE_BLOCKED')reward=-.65;
    const travel=distance(startPosition,npc.position);if(travel>NPC_RULES.tileSize/2){const key=`${npc.scene}:${tileKey(npc.position)}`,exploration=npc.memory.exploration;exploration.recentTargets=[...exploration.recentTargets,key].slice(-12);exploration.heading={x:(npc.position.x-startPosition.x)/travel,y:(npc.position.y-startPosition.y)/travel};}
  }
  if(result.waterCollected>0){npc.flask.fillEventId=event.id;reward=0;}
  const waterGain=result.provenance==='collected'?(result.hydrationGain||0):0,foodGain=result.provenance==='collected'?(result.nourishmentGain||0):0;
  const meaningful=waterGain>=NPC_RULES.meaningfulHydrationGain||foodGain>=(NPC_RULES.meaningfulNourishmentGain||15);
  if(meaningful)reward=Math.min(8,Math.max(waterGain/NPC_RULES.drinkHydration,foodGain/(NPC_RULES.appleNourishment||45))*8);
  if(result.code==='COLLAPSED')reward=-10;
  if(['RESTED','SLEPT'].includes(result.code)&&result.ok)reward=Math.min(4,Math.max(result.energyRecovered||0,result.staminaRecovered||0,result.fatigueRelieved||0,result.sleepPressureRelieved||0)/12);
  if(['say','ask_human','journal_reply','write_note','read_note'].includes(action.type)&&result.ok)reward=0;
  // Novel observations only help when the whole body is safe. Motion itself earns no reward.
  if(result.novelCells&&npc.memory.explorationCredit<4){const f=bodyFeatures(npc),safe=Math.max(0,1-Math.max(f.thirst,f.hunger,f.thermal)*1.5),novelty=Math.min(.3,result.novelCells*.015,4-npc.memory.explorationCredit)*safe;reward+=novelty;npc.memory.explorationCredit+=novelty;}
  if(result.code==='PRIORITY_CHANGED')reward=0;
  if(!(['DRANK','ATE'].includes(result.code)&&!meaningful))updateValue(npc,context,actionCategory(action),reward);
  if(npc.learning&&meaningful){
    npc.memory.effects||={};const category=actionCategory(action),effect=npc.memory.effects[category]||{samples:0,hydration:0,nourishment:0};effect.samples++;effect.hydration+=(waterGain-effect.hydration)*.35;effect.nourishment+=(foodGain-effect.nourishment)*.35;npc.memory.effects[category]=effect;
    // Useful relief credits recent prerequisite actions, with lower strength farther back.
    const eligible=npc.memory.experience.filter(e=>e.type==='action'&&e.id<event.id&&e.at>=event.at-45&&e.details.result?.ok).slice(-8);
    for(const old of eligible){const type=old.details.action?.type;if(['move','fill_flask','gather_food'].includes(type))credit(npc,old.details.context,actionCategory(old.details.action),reward*Math.exp(-(event.at-old.at)/25)*.65,.15);}
    if(waterGain>=NPC_RULES.meaningfulHydrationGain&&result.independent)candidateFromDrink(npc,event);
    if(foodGain>=(NPC_RULES.meaningfulNourishmentGain||15)&&result.independent)candidateFromEat(npc,event);
  }
  for(const [field,table] of [['sourceId','sources'],['foodId','foods'],['shelterId','shelters']])if(!result.ok&&action[field]&&npc.memory[table]?.[action[field]]){const resource=npc.memory[table][action[field]];if(['SOURCE_UNAVAILABLE','FOOD_DEPLETED','RESOURCE_UNAVAILABLE'].includes(result.code))resource.available=false;resource.retryAfter=npc.elapsed+(timedProgress?0:['ROUTE_BLOCKED','NO_KNOWN_ROUTE'].includes(result.code)?30:result.code==='OUT_OF_REACH'?3:8);}
  return event;
}
export function recoveryLesson(npc){
  const cause=npc.collapseCause||'critical deprivation or exposure';
  const verified=`Verified: ${cause} caused consciousness to be lost. Rescue relief was not an independent food, water, or shelter success.`;
  const hypothesis='Hypothesis: acting before warning becomes critical may reduce harm; reuse procedures supported by ordinary relief.';
  npc.memory.lessons.push({at:npc.elapsed,verified,hypothesis});npc.memory.lessons=npc.memory.lessons.slice(-8);recordEvent(npc,'lesson',{verified,hypothesis});
  if(npc.learning)for(const event of npc.memory.experience.filter(e=>e.type==='action').slice(-8))if(!event.details.result?.hydrationGain&&!event.details.result?.nourishmentGain)credit(npc,event.details.context,actionCategory(event.details.action),-4,.15);
}

/** Saved data are bounded and allowlisted; recognition templates cannot execute arbitrary code. */
export function validateNpc(raw,{restoring=true}={}){
  const n=createNpc({id:raw?.id==='mira'?'mira':'aster',mode:raw?.version===4&&raw.mode==='discovery'?'discovery':'legacy',preset:raw?.preset,learning:raw?.learning!==false,seed:raw?.seed});
  if(!raw||![1,2,3,4].includes(raw.version)||!['aster','mira'].includes(raw.id))return n;
  const scenes=new Set(['valley',...CAVES.map(c=>c.id)]);n.scene=scenes.has(raw.scene)?raw.scene:'valley';
  if(Number.isFinite(raw.position?.x)&&Number.isFinite(raw.position?.y)&&canStand(raw.position.x,raw.position.y,n.scene))n.position={x:raw.position.x,y:raw.position.y};else n.scene='valley';
  n.elapsed=finite(raw.elapsed);n.hydration=finite(raw.hydration,n.hydration,100);n.nourishment=finite(raw.nourishment,n.nourishment,100);n.health=finite(raw.health,n.health,100);n.riskCost=finite(raw.riskCost);
  if(n.mode==='discovery')n.physiology=validatePhysiology(raw.physiology,{profile:'human',elapsed:n.elapsed});
  for(const field of ['energy','stamina','fatigue','sleepPressure'])n[field]=finite(raw[field],n[field],100);n.bodyMode=['awake','resting','sleeping'].includes(raw.bodyMode)?raw.bodyMode:'awake';
  n.thermal={hot:finite(raw.thermal?.hot,0,100),cold:finite(raw.thermal?.cold,0,100),wetness:finite(raw.thermal?.wetness,0,100)};
  for(const name of Object.keys(n.feelings||{}))n.feelings[name]=finite(raw.feelings?.[name],0,1);
  if(raw.sensation&&typeof raw.sensation==='object')for(const key of Object.keys(n.sensation||{})){if(typeof n.sensation[key]==='boolean')n.sensation[key]=raw.sensation[key]===true;else if(typeof n.sensation[key]==='number')n.sensation[key]=Number.isFinite(raw.sensation[key])?clamp(raw.sensation[key],-100,100):n.sensation[key];else n.sensation[key]=str(raw.sensation[key],50);}
  for(const k of ['epoch','collapseId','rescuedCollapseId','rng'])n[k]=Math.floor(finite(raw[k],n[k],k==='rng'?4294967295:1e9));
  if(['AWAKE','COLLAPSED','RECOVERING'].includes(raw.lifecycle))n.lifecycle=raw.lifecycle;
  n.collapseCause=typeof raw.collapseCause==='string'?str(raw.collapseCause,100):null;n.lifecycleAt=Math.min(n.elapsed,finite(raw.lifecycleAt));n.nextDecisionAt=Math.min(n.elapsed+60,finite(raw.nextDecisionAt));n.decision=str(raw.decision);n.rescuePresentation=raw.rescuePresentation==='quiet'?'quiet':'divine';
  if(raw.flask){n.flask.water=finite(raw.flask.water,0,1);n.flask.provenance=raw.flask.provenance==='collected'?'collected':null;for(const k of ['fillEventId','creditedFillId'])n.flask[k]=Number.isInteger(raw.flask[k])&&raw.flask[k]>0?raw.flask[k]:null;}
  for(const k of Object.keys(n.stats)){if(k==='lastRescuer')n.stats[k]=raw.stats?.[k]==='divine'?'divine':null;else if(['firstWaterAt','firstFoodAt'].includes(k))n.stats[k]=raw.stats?.[k]===null?null:finite(raw.stats?.[k],null);else n.stats[k]=finite(raw.stats?.[k]);}
  const m=raw.memory||{};n.memory.caveCells||={};n.memory.caveEdges||={};n.memory.caveExits||={};n.memory.foods||={};n.memory.shelters||={};n.memory.effects||={};n.memory.features||={};
  n.memory.nextId=Math.max(1,Math.floor(finite(m.nextId,1)));
  n.memory.experience=(Array.isArray(m.experience)?m.experience:[]).filter(e=>Number.isInteger(e?.id)&&e.id>0&&EVENT_TYPES.has(e.type)).slice(-NPC_RULES.maxExperience).map(e=>({id:e.id,at:finite(e.at),type:e.type,details:compact(e.details)||{}}));
  const ids=new Set(n.memory.experience.map(e=>e.id));if(!n.memory.experience.some(e=>e.id===n.flask.fillEventId&&e.details.action?.type==='fill_flask'&&e.details.result?.ok)){n.flask.fillEventId=null;n.flask.provenance=null;}n.memory.nextId=Math.max(n.memory.nextId,1+Math.max(0,...ids));
  if(n.mode==='discovery')n.discovery=validateDiscoveryMemory(raw.discovery,n);
  function restoreCells(input,scene){const out={};for(const [key,c] of Object.entries(input||{}).slice(-NPC_RULES.maxCells)){if(!/^-?\d{1,3},-?\d{1,3}$/.test(key)||typeof c.walkable!=='boolean'||!Number.isFinite(c.x)||!Number.isFinite(c.y))continue;const [x,y]=key.split(',').map(Number);if(c.x!==x*NPC_RULES.tileSize||c.y!==y*NPC_RULES.tileSize||!withinWorld(c))continue;out[key]={key,x:c.x,y:c.y,walkable:c.walkable,terrain:str(c.terrain,20),observedAt:finite(c.observedAt),visits:finite(c.visits)};}return out;}
  function restoreEdges(input){const out={};for(const [key,edge] of Object.entries(input||{}).slice(-512))if(/^-?\d{1,3},-?\d{1,3}>-?\d{1,3},-?\d{1,3}$/.test(key))out[key]={observedAt:finite(edge.observedAt),retryAfter:Math.min(n.elapsed+60,finite(edge.retryAfter))};return out;}
  n.memory.cells=restoreCells(m.cells,'valley');n.memory.blockedEdges=restoreEdges(m.blockedEdges);
  for(const scene of scenes)if(scene!=='valley'){if(m.caveCells?.[scene])n.memory.caveCells[scene]=restoreCells(m.caveCells[scene],scene);if(m.caveExits?.[scene]&&distance(m.caveExits[scene],CAVE_EXIT)<1)n.memory.caveExits[scene]={x:CAVE_EXIT.x,y:CAVE_EXIT.y,observedAt:finite(m.caveExits[scene].observedAt)};if(m.caveEdges?.[scene])n.memory.caveEdges[scene]=restoreEdges(m.caveEdges[scene]);}
  for(const [name,resolve] of n.mode==='discovery'?[['sources',waterSource],['shelters',shelterSource]]:[['sources',waterSource],['foods',foodSource],['shelters',shelterSource]])for(const [id,s] of Object.entries(m[name]||{}).slice(-NPC_RULES.maxSources)){
    const physical=resolve(id);if(!physical||!withinWorld(s)||distance(physical,s)>1)continue;
    n.memory[name][id]={id,name:physical.name,x:s.x,y:s.y,scene:'valley',available:s.available!==false,observedAt:finite(s.observedAt),confidence:'observed',retryAfter:finite(s.retryAfter)};
    if(name==='foods')Object.assign(n.memory[name][id],{stock:finite(s.stock,0,physical.capacity||100),capacity:physical.capacity});
    if(name==='shelters'){Object.assign(n.memory[name][id],{targetScene:physical.targetScene,relief:finite(s.relief,0,1e6),reliefCredit:finite(s.reliefCredit,0,100),creditedEntryId:ids.has(s.creditedEntryId)?s.creditedEntryId:null});if(Number.isFinite(s.experiencedTemperature)&&n.memory.experience.some(e=>e.details.action?.type==='enter_shelter'&&e.details.action.shelterId===id&&e.details.result?.ok))Object.assign(n.memory[name][id],{experiencedTemperature:clamp(s.experiencedTemperature,-100,100),experiencedAt:finite(s.experiencedAt)});}
  }
  n.inventory={capacity:NPC_RULES.foodCapacity||3,apples:(Array.isArray(raw.inventory?.apples)?raw.inventory.apples:[]).filter((a,index,all)=>all.findIndex(other=>other.eventId===a?.eventId)===index).filter(a=>foodSource(a?.foodId)&&Number.isFinite(a.collectedAt)&&Number.isInteger(a.eventId)&&n.memory.experience.some(e=>e.id===a.eventId&&e.details.action?.type==='gather_food'&&e.details.action.foodId===a.foodId&&e.details.result?.ok&&e.details.result.foodCollected===1)).slice(0,NPC_RULES.foodCapacity||3).map(a=>({foodId:a.foodId,collectedAt:finite(a.collectedAt),eventId:a.eventId}))};
  if(n.mode==='discovery')n.inventory={capacity:DISCOVERY_RULES.capacity,apples:[],items:[...new Set(Array.isArray(raw.inventory?.items)?raw.inventory.items:[])].filter(objectId).filter(id=>n.discovery.observations[id]&&n.discovery.experiments.some(e=>e.ok&&(e.materialId===id||e.targetId===id&&e.primitive==='grasp'))).slice(0,DISCOVERY_RULES.capacity)};
  for(const [key,v] of Object.entries(m.values||{}).slice(-384)){
    const parts=key.split('::');if(parts.length!==2||!CATEGORIES.has(parts[1])||!/^[-a-z|]{1,150}$/.test(parts[0]))continue;
    n.memory.values[key]={attempts:finite(v.attempts),value:Number.isFinite(v.value)?clamp(v.value,-12,12):0};
  }
  for(const [key,v] of Object.entries(m.features||{}).slice(-144)){const [category,feature]=key.split(':');if(CATEGORIES.has(category)&&['thirst','hunger','thermal','injured','water','food','sheltered','knownWater','knownFood','knownShelter'].includes(feature)&&Number.isFinite(v))n.memory.features[key]=clamp(v,-8,8);}
  for(const [category,e] of Object.entries(m.effects||{}))if(CATEGORIES.has(category))n.memory.effects[category]={samples:finite(e.samples),hydration:finite(e.hydration,0,100),nourishment:finite(e.nourishment,0,100)};
  n.memory.lessons=(Array.isArray(m.lessons)?m.lessons:[]).slice(-8).map(l=>({at:finite(l.at),verified:str(l.verified),hypothesis:str(l.hypothesis)}));
  const exploration=m.exploration||{};if(withinWorld(exploration.origin))n.memory.exploration.origin={x:exploration.origin.x,y:exploration.origin.y};
  const knownVisit=key=>{const parts=key.split(':');return parts.length===1?Boolean(n.memory.cells[key]):Boolean((parts[0]==='valley'?n.memory.cells:n.memory.caveCells[parts[0]])?.[parts.slice(1).join(':')]);};
  n.memory.exploration.lastVisited=typeof exploration.lastVisited==='string'&&knownVisit(exploration.lastVisited)?exploration.lastVisited:null;n.memory.exploration.recentTargets=(Array.isArray(exploration.recentTargets)?exploration.recentTargets:[]).filter(key=>typeof key==='string'&&knownVisit(key)).slice(-12);
  if(Number.isFinite(exploration.heading?.x)&&Number.isFinite(exploration.heading?.y)&&Math.hypot(exploration.heading.x,exploration.heading.y)<=1.01)n.memory.exploration.heading={x:exploration.heading.x,y:exploration.heading.y};
  n.memory.explorationCredit=finite(m.explorationCredit,0,4);n.memory.trace=(Array.isArray(m.trace)?m.trace:[]).filter(id=>ids.has(id)).slice(-12);
  const templates={'water-fill-drink':['fill_flask','drink'],'water-approach-fill-drink':['move','fill_flask','drink'],'food-gather-eat':['gather_food','eat'],'food-approach-gather-eat':['move','gather_food','eat'],'shelter-enter-rest':['enter_shelter','wait'],'shelter-approach-enter-rest':['move','enter_shelter','wait']};
  for(const skill of (Array.isArray(m.skills)?m.skills:[]).slice(0,NPC_RULES.maxSkills)){
    if(n.mode==='discovery'&&skill?.id?.startsWith('food-'))continue;
    const template=templates[skill?.id];if(!template||!Array.isArray(skill.steps)||skill.steps.length!==template.length||skill.steps.some((step,i)=>step?.type!==template[i]))continue;
    const need=skill.id.startsWith('water-')?'water':skill.id.startsWith('food-')?'food':'thermal',parameter=need==='water'?'sourceId':need==='food'?'foodId':'shelterId';
    if(skill.steps.some(step=>['move','fill_flask','gather_food','enter_shelter'].includes(step.type)&&step[parameter]!==`$${parameter}`))continue;
    const supporting=(skill.supportingExperience||[]).filter(id=>ids.has(id)).slice(-36);if(supporting.length<2)continue;
    n.memory.skills.push({id:skill.id,name:str(skill.name,80),signature:str(skill.signature,50),need,recognition:'provided bounded recognition template',status:['candidate','validated','retired'].includes(skill.status)?skill.status:'candidate',parameters:[parameter],preconditions:{resourceKnown:true,inRange:!template.includes('move')},steps:skill.steps.map(step=>['drink','eat'].includes(step.type)?{type:step.type}:step.type==='wait'?{type:'wait',seconds:5}:{type:step.type,[parameter]:`$${parameter}`}),successCheck:`ordinary useful ${need} relief`,failureConditions:['ROUTE_BLOCKED','OUT_OF_REACH','RESOURCE_UNAVAILABLE','COLLAPSED'],supportingExperience:supporting,validation:(skill.validation||[]).filter(v=>ids.has(v.eventId)&&withinWorld(v.startPosition)).slice(-16).map(v=>({at:finite(v.at),resourceId:str(v.resourceId||v.sourceId,70),sourceId:str(v.resourceId||v.sourceId,70),startPosition:{x:v.startPosition.x,y:v.startPosition.y},eventId:v.eventId,outcome:v.outcome==='success'?'success':'failure'})),successes:finite(skill.successes),failures:finite(skill.failures)});
  }
  if(!restoring&&(raw.active||raw.skillRun))n.interrupted=true;
  if(restoring&&(raw.active||raw.skillRun||raw.interrupted)){recordEvent(n,'action',{action:{type:OPS.has(raw.active?.request?.type)?raw.active.request.type:'wait'},result:{ok:false,code:'RESTART_INTERRUPTED'},context:policyContext(n),startPosition:n.position});n.decision='An interrupted action was cancelled on restart; my experience is retained.';}
  if(typeof raw.navigationAnchor==='string'&&cellsFor(n)[raw.navigationAnchor]?.walkable&&distance(tilePoint(raw.navigationAnchor),n.position)<160)n.navigationAnchor=raw.navigationAnchor;
  n.modelBudget={since:Math.min(n.elapsed,finite(raw.modelBudget?.since)),calls:finite(raw.modelBudget?.calls,0,60)};n.bodyFeedback={since:Math.min(n.elapsed,finite(raw.bodyFeedback?.since)),cost:finite(raw.bodyFeedback?.cost)};n.lastResult=raw.lastResult?compact(raw.lastResult):null;
  for(const k of Object.keys(n.presentation))n.presentation[k]=Math.min(n.elapsed+12,finite(raw.presentation?.[k]));
  n.cognition=validateCognition(raw.cognition,n);n.social=validateSocialMemory(raw.social,n);if(n.mode==='discovery')projectPhysiology(n);else n.bodyMode='awake';
  return n;
}
