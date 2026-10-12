import { CONFIG, NPC_RULES, NPC_PRESETS } from './config.js';
import { createNpc } from './npc-state.js';
import { clamp, canStandOutside, distance } from './world.js';
import { waterSource, withinWorld } from './resources.js';
import { tileKey, tilePoint } from './perception.js';

const EVENT_TYPES=new Set(['observation','action','decision','collapse','rescue','recovery','provider','lesson','debug','skill']);
const OPS=new Set(['observe','move','inspect','fill_flask','drink','wait']);
const finite=(v,otherwise=0,max=1e10)=>Number.isFinite(v)?clamp(v,0,max):otherwise;
const str=(v,max=600)=>typeof v==='string'?v.slice(0,max):'';
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
    const protectedIds=new Set(npc.memory.skills.flatMap(s=>s.supportingExperience));
    const removable=npc.memory.experience.findIndex(e=>!protectedIds.has(e.id));
    npc.memory.experience.splice(removable<0?0:removable,1);
  }
  return event;
}
export function rememberObservation(npc,observation){
  if(!npc.learning){npc.memory.cells={};npc.memory.sources={};npc.memory.blockedEdges={};}
  let newCells=0;const newSources=[];
  for(const cell of observation.cells){
    const old=npc.memory.cells[cell.key];if(!old)newCells++;
    npc.memory.cells[cell.key]={...cell,visits:old?.visits||0};
  }
  const key=tileKey(npc.position);if(npc.memory.cells[key])npc.memory.cells[key].visits++;
  for(const source of observation.sources){
    if(!npc.memory.sources[source.id])newSources.push(source.id);
    const previous=npc.memory.sources[source.id];
    npc.memory.sources[source.id]={...source,observedAt:npc.elapsed,confidence:'observed',retryAfter:previous?.available===source.available?(previous.retryAfter||0):0};
  }
  const all=Object.values(npc.memory.cells);
  if(all.length>NPC_RULES.maxCells){
    all.sort((a,b)=>b.observedAt-a.observedAt);
    npc.memory.cells=Object.fromEntries(all.slice(0,NPC_RULES.maxCells).map(c=>[c.key,c]));
  }
  const sources=Object.values(npc.memory.sources);
  if(sources.length>NPC_RULES.maxSources){sources.sort((a,b)=>b.observedAt-a.observedAt);npc.memory.sources=Object.fromEntries(sources.slice(0,NPC_RULES.maxSources).map(s=>[s.id,s]));}
  if(newSources.length||npc.memory.experience.length===0)recordEvent(npc,'observation',{position:npc.position,newCells,newSources,hydration:npc.hydration});
  return {newCells,newSources};
}
export function policyContext(npc){
  const hydration=npc.hydration<20?'critical':npc.hydration<75?'thirsty':'comfortable';
  const sources=Object.values(npc.memory.sources).filter(s=>s.available);
  const water=sources.some(s=>distance(s,npc.position)<=NPC_RULES.collectionRange)?'near':sources.length?'known':'unknown';
  return `${hydration}|${npc.flask.water>0?'water':'empty'}|${water}`;
}
export function actionCategory(action){return action.type==='move'?(action.sourceId?'move_source':'move_explore'):action.type;}
export function updateValue(npc,context,category,reward){
  if(!npc.learning)return;
  const key=`${context}::${category}`,v=npc.memory.values[key]||{attempts:0,value:0};
  v.attempts++;v.value=clamp(v.value+0.35*(reward-v.value),-12,12);npc.memory.values[key]=v;
}
function candidateFromDrink(npc,event){
  const fill=npc.memory.experience.find(e=>e.id===npc.flask.fillEventId&&e.type==='action'&&e.details.result?.ok&&e.details.action?.type==='fill_flask');
  if(!fill)return;
  const sourceId=fill.details.action.sourceId;
  const earlier=npc.memory.experience.filter(e=>e.type==='action'&&e.id<fill.id&&e.details.result?.ok&&e.details.action?.type==='move'&&e.details.action.sourceId===sourceId).at(-1);
  const hasApproach=earlier&&fill.at-earlier.at<90;
  const signature=hasApproach?'approach-fill-drink':'fill-drink';
  let skill=npc.memory.skills.find(s=>s.signature===signature);
  const steps=[...(hasApproach?[{type:'move',sourceId:'$sourceId'}]:[]),{type:'fill_flask',sourceId:'$sourceId'},{type:'drink'}];
  const start=hasApproach?earlier.details.startPosition:fill.details.startPosition;
  const evidence=[...(hasApproach?[earlier.id]:[]),fill.id,event.id];
  if(!skill){
    if(npc.memory.skills.length>=NPC_RULES.maxSkills)return;
    skill={id:`water-${signature}`,name:hasApproach?'Approach, collect, drink':'Collect and drink',signature,status:'candidate',parameters:['sourceId'],preconditions:{sourceKnown:true,flaskEmpty:true,hydrationBelow:75,inRange:!hasApproach},steps,successCheck:'ordinary hydration gain after independently collected water',failureConditions:['ROUTE_BLOCKED','OUT_OF_REACH','SOURCE_UNAVAILABLE','COLLAPSED','EMPTY_FLASK'],supportingExperience:[],validation:[],successes:0,failures:0};
    npc.memory.skills.push(skill);
  }
  skill.successes++;
  skill.supportingExperience=[...new Set([...skill.supportingExperience,...evidence])].slice(-36);
  const changed=skill.validation.some(v=>v.sourceId!==sourceId||distance(v.startPosition,start)>NPC_RULES.tileSize);
  skill.validation.push({at:npc.elapsed,sourceId,startPosition:{...start},eventId:event.id,outcome:'success'});
  skill.validation=skill.validation.slice(-16);
  if(skill.successes>=2&&changed)skill.status='validated';
  updateValue(npc,fill.details.context,'fill_flask',3);
  if(hasApproach)updateValue(npc,earlier.details.context,'move_source',2);
  recordEvent(npc,'skill',{skillId:skill.id,status:skill.status,supportingExperience:evidence,transferEvidence:changed});
}
export function learnOutcome(npc,action,result,context,startPosition){
  const previous=npc.memory.experience.filter(e=>e.type==='action').at(-1);
  if(!result.ok){npc.stats.invalidActions++;if(previous?.details.result?.code===result.code&&previous?.details.action?.type===action.type)npc.stats.repeatedInvalid++;}
  const event=recordEvent(npc,'action',{action,result,context,startPosition,position:npc.position,hydration:npc.hydration,flask:npc.flask.water});
  npc.lastResult={eventId:event.id,at:npc.elapsed,...result,action:action.type};
  npc.memory.trace=[...npc.memory.trace,event.id].slice(-12);
  let reward=result.ok?-0.03:-2;
  if(result.waterCollected>0){reward=Math.min(.7,result.waterCollected*.7);npc.flask.fillEventId=event.id;}
  if(result.independent){reward=8;}
  if(result.code==='COLLAPSED')reward=-8;
  if(result.novelCells&&npc.memory.explorationCredit<4){const novelty=Math.min(.25,result.novelCells*.01,4-npc.memory.explorationCredit);reward+=novelty;npc.memory.explorationCredit+=novelty;}
  reward-=Math.max(0,result.hydrationLost||0)*.02;
  updateValue(npc,context,actionCategory(action),reward);
  if(npc.learning&&result.independent)candidateFromDrink(npc,event);
  if(!result.ok&&action.sourceId&&npc.memory.sources[action.sourceId]){
    const source=npc.memory.sources[action.sourceId];
    if(result.code==='SOURCE_UNAVAILABLE')source.available=false;
    source.retryAfter=npc.elapsed+(result.code==='ROUTE_BLOCKED'?30:result.code==='OUT_OF_REACH'?3:8);
  }
  return event;
}
export function recoveryLesson(npc){
  const text='Verified: hydration reached zero and consciousness was lost. Rescue water restored some hydration; it was not an independent water-gathering success.';
  const hypothesis='Hypothesis: reusing actions with successful water outcomes may reduce another collapse.';
  npc.memory.lessons.push({at:npc.elapsed,verified:text,hypothesis});npc.memory.lessons=npc.memory.lessons.slice(-8);
  recordEvent(npc,'lesson',{verified:text,hypothesis});
  if(npc.learning){
    const last=npc.memory.experience.filter(e=>e.type==='action').at(-1);
    if(last)updateValue(npc,last.details.context,actionCategory(last.details.action),-5);
  }
}

/** Saves are bounded allowlisted data; executable source and unknown fields are discarded. */
export function validateNpc(raw,{restoring=true}={}){
  const n=createNpc({preset:raw?.preset,learning:raw?.learning!==false,seed:raw?.seed});
  if(!raw||raw.version!==1||raw.id!=='aster')return n;
  if(withinWorld(raw.position)&&canStandOutside(raw.position.x,raw.position.y))n.position={x:raw.position.x,y:raw.position.y};
  n.elapsed=finite(raw.elapsed);n.hydration=finite(raw.hydration,85,100);
  for(const k of ['epoch','collapseId','rescuedCollapseId','rng'])n[k]=Math.floor(finite(raw[k],n[k],k==='rng'?4294967295:1e9));
  if(['AWAKE','COLLAPSED','RECOVERING'].includes(raw.lifecycle))n.lifecycle=raw.lifecycle;
  n.lifecycleAt=Math.min(n.elapsed,finite(raw.lifecycleAt));n.nextDecisionAt=Math.min(n.elapsed+60,finite(raw.nextDecisionAt));
  n.decision=str(raw.decision);n.rescuePresentation=raw.rescuePresentation==='quiet'?'quiet':'divine';
  if(raw.flask){n.flask.water=finite(raw.flask.water,0,1);n.flask.provenance=raw.flask.provenance==='collected'?'collected':null;for(const k of ['fillEventId','creditedFillId'])n.flask[k]=Number.isInteger(raw.flask[k])&&raw.flask[k]>0?raw.flask[k]:null;}
  for(const k of Object.keys(n.stats)){if(k==='lastRescuer')n.stats[k]=raw.stats?.[k]==='divine'?'divine':null;else if(k==='firstWaterAt')n.stats[k]=raw.stats?.[k]===null?null:finite(raw.stats?.[k],null);else n.stats[k]=Math.floor(finite(raw.stats?.[k]));}
  const m=raw.memory||{};
  n.memory.nextId=Math.max(1,Math.floor(finite(m.nextId,1)));
  n.memory.experience=(Array.isArray(m.experience)?m.experience:[]).filter(e=>Number.isInteger(e?.id)&&e.id>0&&EVENT_TYPES.has(e.type)).slice(-NPC_RULES.maxExperience).map(e=>({id:e.id,at:finite(e.at),type:e.type,details:compact(e.details)||{}}));
  const ids=new Set(n.memory.experience.map(e=>e.id));n.memory.nextId=Math.max(n.memory.nextId,1+Math.max(0,...ids));
  for(const [key,c] of Object.entries(m.cells||{}).slice(-NPC_RULES.maxCells)){
    if(!/^-?\d{1,3},-?\d{1,3}$/.test(key)||!withinWorld(c)||typeof c.walkable!=='boolean')continue;
    const [x,y]=key.split(',').map(Number);if(c.x!==x*NPC_RULES.tileSize||c.y!==y*NPC_RULES.tileSize)continue;
    n.memory.cells[key]={key,x:c.x,y:c.y,walkable:c.walkable,terrain:str(c.terrain,20),observedAt:finite(c.observedAt),visits:finite(c.visits)};
  }
  for(const [key,edge] of Object.entries(m.blockedEdges||{}).slice(-512)){
    if(/^-?\d{1,3},-?\d{1,3}>-?\d{1,3},-?\d{1,3}$/.test(key))n.memory.blockedEdges[key]={observedAt:finite(edge.observedAt),retryAfter:Math.min(n.elapsed+60,finite(edge.retryAfter))};
  }
  for(const [id,s] of Object.entries(m.sources||{}).slice(-NPC_RULES.maxSources)){
    const physical=waterSource(id);if(!physical||!withinWorld(s)||distance(physical,s)>1)continue;
    n.memory.sources[id]={id,name:physical.name,x:s.x,y:s.y,available:s.available!==false,observedAt:finite(s.observedAt),confidence:'observed',retryAfter:finite(s.retryAfter)};
  }
  for(const [key,v] of Object.entries(m.values||{}).slice(0,192)){
    if(!/^(critical|thirsty|comfortable)\|(empty|water)\|(near|known|unknown)::(observe|inspect|move_explore|move_source|fill_flask|drink|wait)$/.test(key))continue;
    n.memory.values[key]={attempts:finite(v.attempts),value:Number.isFinite(v.value)?clamp(v.value,-12,12):0};
  }
  n.memory.lessons=(Array.isArray(m.lessons)?m.lessons:[]).slice(-8).map(l=>({at:finite(l.at),verified:str(l.verified),hypothesis:str(l.hypothesis)}));
  n.memory.explorationCredit=finite(m.explorationCredit,0,4);n.memory.trace=(Array.isArray(m.trace)?m.trace:[]).filter(id=>ids.has(id)).slice(-12);
  for(const skill of (Array.isArray(m.skills)?m.skills:[]).slice(0,NPC_RULES.maxSkills)){
    if(!/^water-(approach-fill-drink|fill-drink)$/.test(skill?.id)||!Array.isArray(skill.steps)||skill.steps.length<2||skill.steps.length>8)continue;
    if(skill.steps.some(step=>!OPS.has(step?.type)||!['move','fill_flask','drink'].includes(step.type)||(['move','fill_flask'].includes(step.type)&&step.sourceId!=='$sourceId')))continue;
    const supporting=(skill.supportingExperience||[]).filter(id=>ids.has(id)).slice(-36);if(supporting.length<2)continue;
    n.memory.skills.push({id:skill.id,name:str(skill.name,80),signature:str(skill.signature,50),status:['candidate','validated','retired'].includes(skill.status)?skill.status:'candidate',parameters:['sourceId'],preconditions:{sourceKnown:true,flaskEmpty:true,hydrationBelow:75,inRange:!skill.steps.some(s=>s.type==='move')},steps:skill.steps.map(step=>step.type==='drink'?{type:'drink'}:{type:step.type,sourceId:'$sourceId'}),successCheck:'ordinary hydration gain after independently collected water',failureConditions:['ROUTE_BLOCKED','OUT_OF_REACH','SOURCE_UNAVAILABLE','COLLAPSED','EMPTY_FLASK'],supportingExperience:supporting,validation:(skill.validation||[]).filter(v=>ids.has(v.eventId)&&withinWorld(v.startPosition)).slice(-16).map(v=>({at:finite(v.at),sourceId:str(v.sourceId,70),startPosition:{x:v.startPosition.x,y:v.startPosition.y},eventId:v.eventId,outcome:v.outcome==='success'?'success':'failure'})),successes:finite(skill.successes),failures:finite(skill.failures)});
  }
  // On restart an unfinished procedure is cancelled, with a recorded outcome rather than silently replayed.
  if(!restoring&&(raw.active||raw.skillRun))n.interrupted=true;
  if(restoring&&(raw.active||raw.skillRun||raw.interrupted)){recordEvent(n,'action',{action:{type:OPS.has(raw.active?.request?.type)?raw.active.request.type:'wait'},result:{ok:false,code:'RESTART_INTERRUPTED'},context:policyContext(n),startPosition:n.position});n.decision='An interrupted action was cancelled on restart; my experience is retained.';}
  if(typeof raw.navigationAnchor==='string'&&n.memory.cells[raw.navigationAnchor]?.walkable&&distance(tilePoint(raw.navigationAnchor),n.position)<160)n.navigationAnchor=raw.navigationAnchor;
  n.modelBudget={since:Math.min(n.elapsed,finite(raw.modelBudget?.since)),calls:finite(raw.modelBudget?.calls,0,60)};
  n.lastResult=raw.lastResult?compact(raw.lastResult):null;
  for(const k of ['rescueUntil','drinkUntil'])n.presentation[k]=Math.min(n.elapsed+12,finite(raw.presentation?.[k]));
  return n;
}
