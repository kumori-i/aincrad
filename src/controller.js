import { CONFIG, NPC_RULES } from './config.js';
import { distance, clamp } from './world.js';
import { tilePoint, rememberedCells, rememberedEdges } from './perception.js';
import { knownRoute } from './navigation.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from './npc.js';
import { policyContext, actionCategory, recordEvent, learnedValue } from './npc-memory.js';

function random(npc){npc.rng=(Math.imul(npc.rng,1664525)+1013904223)>>>0;return npc.rng/4294967296;}
const thermalLevel=n=>Math.max(n.thermal?.hot||0,n.thermal?.cold||0);
function decisionCondition(npc){const thermal=thermalLevel(npc),exposure=thermal>=(NPC_RULES.criticalThermal??80)?'critical':thermal>=(NPC_RULES.thermalWarning??40)?'warning':'comfortable',health=(npc.health??100)<20?'critical':(npc.health??100)<80?'injured':'healthy',felt=npc.sensation?.feltTemperature??18,climate=felt>(NPC_RULES.hotComfortMax??26)?'hot':felt<(NPC_RULES.coldComfortMin??14)?'cold':'comfortable';return `${policyContext(npc)}|${exposure}|${health}|${climate}`;}
/** Supplied physiology defines costs. Observed locations and effective procedures are learned. */
export function needPriorities(npc){
  const reserve=(v,warning,critical)=>{const shortage=(100-v)/100;return shortage*shortage*5+(v<warning?(warning-v)/warning*9:0)+(v<critical?(critical-v)/Math.max(1,critical)*10:0);};
  const hot=thermalLevel(npc),felt=npc.sensation?.feltTemperature??18,exposure=npc.scene==='valley'?Math.max(0,felt-(NPC_RULES.hotComfortMax??26),(NPC_RULES.coldComfortMin??14)-felt):0;
  return {water:reserve(npc.hydration,NPC_RULES.thirstWarning,NPC_RULES.criticalHydration),food:reserve(npc.nourishment??100,NPC_RULES.hungerWarning||45,NPC_RULES.criticalNourishment||20)*1.25,thermal:hot*hot/1000+(hot>(NPC_RULES.thermalWarning??40)?(hot-(NPC_RULES.thermalWarning??40))/Math.max(1,(NPC_RULES.criticalThermal??80)-(NPC_RULES.thermalWarning??40))*6.667:0)+(hot>(NPC_RULES.criticalThermal??80)?(hot-(NPC_RULES.criticalThermal??80))/Math.max(1,100-(NPC_RULES.criticalThermal??80))*10:0)+Math.min(3,exposure/5)};
}
const goalFor=action=>action?.sourceId||['drink','fill_flask'].includes(action?.type)?'water':action?.foodId||['eat','gather_food'].includes(action?.type)?'food':action?.shelterId||action?.type==='enter_shelter'?'thermal':'explore';
function knownItems(npc,table){return npc.scene==='valley'?Object.values(npc.memory[table]||{}).filter(s=>s.available!==false&&(s.retryAfter||0)<=npc.elapsed):[];}
function routeEstimate(npc,item){
  const d=distance(npc.position,item);if(d<=NPC_RULES.collectionRange)return 0;
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),anchor=npc.navigationAnchor&&cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
  const approaches=Object.values(cells).filter(c=>c.walkable&&distance(c,item)<=NPC_RULES.tileSize*2).sort((a,b)=>distance(a,npc.position)+distance(a,item)-distance(b,npc.position)-distance(b,item));
  for(const point of approaches){
    const edge=[point.key,`${Math.round(item.x/NPC_RULES.tileSize)},${Math.round(item.y/NPC_RULES.tileSize)}`].sort().join('>');if((edges[edge]?.retryAfter||0)>npc.elapsed)continue;
    const route=knownRoute(cells,npc.position,point,30,edges,npc.elapsed,anchor);if(!route)continue;
    let previous=npc.position,length=0;for(const node of route){length+=distance(previous,node);previous=node;}length+=distance(previous,item);if(length<=NPC_RULES.maxActionSeconds*CONFIG.walkSpeed)return length/CONFIG.walkSpeed;
  }return null;
}
function stagedApproach(npc,item){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),before=distance(npc.position,item);
  const candidates=Object.values(cells).filter(c=>c.walkable&&distance(c,npc.position)>80&&distance(c,npc.position)<370&&distance(c,item)<before-40).sort((a,b)=>distance(a,item)-distance(b,item));
  for(const point of candidates){const route=knownRoute(cells,npc.position,point,30,edges,npc.elapsed,npc.navigationAnchor);if(route)return {point,seconds:before/CONFIG.walkSpeed};}return null;
}
export function skillCandidates(npc){
  if(!npc.learning)return [];
  const candidates=[];
  for(const skill of npc.memory.skills.filter(s=>s.status!=='retired')){
    const need=skill.need||(skill.id.startsWith('food-')?'food':skill.id.startsWith('shelter-')?'thermal':'water');
    if(need==='water'&&(npc.flask.water>.00001||100-npc.hydration<NPC_RULES.meaningfulHydrationGain))continue;
    if(need==='food'&&(npc.inventory?.apples.length||100-(npc.nourishment??100)<(NPC_RULES.appleNourishment||45)))continue;
    if(need==='thermal'&&(npc.scene!=='valley'||thermalLevel(npc)<15&&(npc.sensation?.feltTemperature??18)<=(NPC_RULES.hotComfortMax??26)&&(npc.sensation?.feltTemperature??18)>=(NPC_RULES.coldComfortMin??14)))continue;
    const table=need==='water'?'sources':need==='food'?'foods':'shelters',parameter=need==='water'?'sourceId':need==='food'?'foodId':'shelterId';
    for(const item of knownItems(npc,table).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,6)){
      if(skill.preconditions.inRange&&distance(npc.position,item)>NPC_RULES.collectionRange)continue;
      const seconds=routeEstimate(npc,item);if(seconds===null)continue;
      candidates.push({skill,need,parameter,resourceId:item.id,travelSeconds:seconds,decision:{skillId:skill.id,[parameter]:item.id}});
    }
  }
  return candidates;
}
export function decisionObservation(npc){
  const priorities=needPriorities(npc),cells=Object.values(rememberedCells(npc)).filter(c=>distance(c,npc.position)<=NPC_RULES.visionRadius+80).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,48);
  const expose=table=>Object.values(npc.memory[table]||{}).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,12).map(s=>({...s,distance:npc.scene==='valley'?Math.round(distance(s,npc.position)):null,knownRouteSeconds:npc.scene==='valley'?routeEstimate(npc,s):null}));
  return {
    identity:{id:npc.id,name:npc.name},objective:'Maintain health and consciousness by balancing nourishment, hydration and exposure. Learn useful local routines from actual consequences.',
    knownExit:npc.scene==='valley'?null:(npc.memory.caveExits?.[npc.scene]||null),
    condition:{scene:npc.scene,hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,thermal:{...npc.thermal},feelings:{...npc.feelings},sensation:{...npc.sensation},flask:{water:npc.flask.water,capacity:npc.flask.capacity},inventory:{apples:npc.inventory?.apples.length||0,capacity:npc.inventory?.capacity||3},lifecycle:npc.lifecycle,position:{...npc.position}},
    physiologicalPriorities:priorities,observedAt:npc.elapsed,knownSources:expose('sources'),knownFoods:expose('foods'),knownShelters:expose('shelters'),
    knownTiles:cells.map(c=>({x:c.x,y:c.y,walkable:c.walkable,terrain:c.terrain,observedAt:c.observedAt})),
    recentExperience:npc.learning?npc.memory.experience.slice(-6):[],lessons:npc.learning?npc.memory.lessons.slice(-3):[],
    skills:npc.learning?npc.memory.skills.filter(s=>s.status!=='retired').map(s=>({id:s.id,need:s.need,status:s.status,recognition:s.recognition,preconditions:s.preconditions,steps:s.steps,successes:s.successes,failures:s.failures,supportingExperience:s.supportingExperience.slice(-9)})):[],
    procedureCandidates:skillCandidates(npc).slice(0,12).map(c=>({...c.decision,need:c.need,travelSeconds:c.travelSeconds})),
    actionStatus:npc.active?{type:npc.active.request.type,goal:goalFor(npc.active.request),remaining:Math.max(0,npc.active.expiresAt-npc.elapsed)}:null,
    actions:{observe:{},move:{target:'Observed traversable tile {x,y}, or sourceId / foodId / shelterId from known resources; bounded to 12 seconds.'},inspect:{sourceId:'known water, foodId: known food, shelterId: known shelter'},fill_flask:{sourceId:'known source; collection range 80'},drink:{},gather_food:{foodId:'known finite-stock apple patch; collection range 80'},eat:{},enter_shelter:{shelterId:'known nearby cave entrance'},exit_shelter:{},wait:{seconds:'0.25 to 5'}},
    procedureUse:'A returned skillId plus its sourceId, foodId or shelterId selects one of the listed evidence-backed candidates. It is optional and competes with current bodily needs.',
  };
}
/** A bounded factored value learner with supplied physiology and action affordances, not a language model. */
export class LocalLearnerProvider {
  constructor(){this.kind='local-learner';this.label='Offline experiential learner';}
  decide(npc){
    const priorities=needPriorities(npc),maximum=Math.max(...Object.values(priorities)),choices=[];
    const add=(action,need,base=0,seconds=0)=>{const value=learnedValue(npc,action),urgency=need?priorities[need]:0;choices.push({action,need,score:base+urgency*1.8-Math.min(4,seconds*.08)+clamp(value.value,-3,5)*.45+random(npc)*.18,value});};
    const failures=npc.learning?npc.memory.experience.filter(e=>e.type==='action'&&!e.details.result?.ok):[];
    if(npc.flask.water>.00001&&100-npc.hydration>=NPC_RULES.meaningfulHydrationGain)add({type:'drink'},'water',1.3);
    else if(npc.flask.water<=.00001&&!failures.some(e=>e.details.result?.code==='EMPTY_FLASK')&&maximum<2)add({type:'drink'},null,.1);
    if(npc.inventory?.apples.length&&(100-(npc.nourishment??100)>=(NPC_RULES.appleNourishment||45)||(npc.nourishment??100)<(NPC_RULES.hungerWarning||45)))add({type:'eat'},'food',1.5);
    if(!npc.inventory?.apples.length&&!failures.some(e=>e.details.result?.code==='NO_FOOD')&&maximum<2)add({type:'eat'},null,.1);
    if(npc.scene==='valley'){
      for(const [table,parameter,need,interaction,allowed] of [['sources','sourceId','water','fill_flask',npc.flask.water<=.00001&&npc.hydration<85],['foods','foodId','food','gather_food',(npc.inventory?.apples.length||0)<(npc.inventory?.capacity||3)&&(npc.nourishment??100)<85],['shelters','shelterId','thermal','enter_shelter',thermalLevel(npc)>15||(npc.sensation?.feltTemperature??18)>(NPC_RULES.hotComfortMax??26)||(npc.sensation?.feltTemperature??18)<(NPC_RULES.coldComfortMin??14)]]){
        if(!allowed)continue;
        const sorted=knownItems(npc,table).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position));
        for(const item of sorted.slice(0,5)){const seconds=routeEstimate(npc,item),stage=seconds===null?stagedApproach(npc,item):null;if(seconds===null&&!stage)continue;const inRange=distance(item,npc.position)<=NPC_RULES.collectionRange;const action=stage?{type:'move',target:{x:stage.point.x,y:stage.point.y}}:{type:inRange?interaction:'move',[parameter]:item.id};
          add(action,need,inRange?(need==='food'?2:.6):.3,seconds??stage.seconds);if(need==='food'&&npc.inventory?.apples.length)choices.at(-1).score-=priorities.food*1.3+.5*npc.inventory.apples.length;}
      }
    }else{
      const thermal=thermalLevel(npc),need=Math.max(priorities.food,priorities.water);
      if(thermal>10&&need<priorities.thermal+2)add({type:'wait',seconds:5},'thermal',1.5);
      if(thermal<25||need>priorities.thermal+2){const exit=npc.memory.caveExits?.[npc.scene],goal=priorities.food>priorities.water?'food':'water';if(exit){if(distance(npc.position,exit)<100)add({type:'exit_shelter'},goal,.8);else{const route=knownRoute(rememberedCells(npc),npc.position,exit,30,rememberedEdges(npc),npc.elapsed,npc.navigationAnchor);if(route)add({type:'move',target:{x:exit.x,y:exit.y}},goal,.8,distance(npc.position,exit)/CONFIG.walkSpeed);}}}
    }
    // Procedures compete on the same priority scale, rather than pre-empting a model or food.
    for(const candidate of skillCandidates(npc)){
      const first=candidate.skill.steps[0],action={type:first.type,[candidate.parameter]:candidate.resourceId};
      const value=learnedValue(npc,action),confidence=Math.min(1.8,.7+candidate.skill.successes*.12+(candidate.skill.status==='validated'?.5:0));
      choices.push({...candidate.decision,need:candidate.need,score:confidence+priorities[candidate.need]*1.8-Math.min(4,candidate.travelSeconds*.08)+clamp(value.value,-3,5)*.45+random(npc)*.12,value,skill:candidate.skill});
    }
    const dominant=Object.entries(priorities).sort((a,b)=>b[1]-a[1])[0],unmet=dominant[1]>1.5&&!choices.some(c=>c.need===dominant[0]);
    const cells=rememberedCells(npc),edges=rememberedEdges(npc),anchor=npc.navigationAnchor&&cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null,exploration=npc.memory.exploration;
    const frontiers=Object.values(cells).filter(c=>c.walkable&&distance(c,npc.position)>120&&distance(c,npc.position)<370).map(cell=>{
      let unknown=0;const step=NPC_RULES.tileSize;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(dx*dx+dy*dy<=16&&!cells[`${Math.round(cell.x/step)+dx},${Math.round(cell.y/step)+dy}`])unknown++;
      const d=distance(cell,npc.position),heading=exploration.heading,forward=heading?((cell.x-npc.position.x)*heading.x+(cell.y-npc.position.y)*heading.y)/d:0,repeat=exploration.recentTargets.includes(`${npc.scene}:${cell.key}`)||exploration.recentTargets.includes(cell.key);
      const expedition=npc.scene==='valley'&&exploration.origin?distance(cell,exploration.origin):0;
      return {cell,unknown,score:unknown*.055+forward*.18-expedition*(unmet?.0005:.0025)+(cell.terrain==='trail'?(unmet?1.3:.4):0)-(cell.visits||0)*.8-(repeat?2.5:0)+random(npc)*.2};
    }).sort((a,b)=>b.score-a.score);
    const frontier=frontiers.filter(c=>c.unknown>0).find(c=>knownRoute(cells,npc.position,c.cell,30,edges,npc.elapsed,anchor));
    if(frontier){const safe=Math.max(0,1-maximum/5);add({type:'move',target:{x:frontier.cell.x,y:frontier.cell.y}},null,.6+Math.min(1.1,frontier.unknown*.035)*safe);
      // If no useful resource is known, exploration is a necessary search even under distress.
      if(unmet){choices.at(-1).score+=maximum*.9;choices.at(-1).need=dominant[0];}else if(!choices.some(c=>c.need))choices.at(-1).score+=maximum*.3;
    }
    add({type:'observe'},null,-.4-maximum*.1);add({type:'wait',seconds:1},null,npc.scene!=='valley'?-.2:-.8-maximum*.1);
    const ranked=choices.sort((a,b)=>b.score-a.score),selected=maximum<1.5&&random(npc)<.035?ranked[Math.floor(random(npc)*ranked.length)]:ranked[0];
    const label=selected.skill?`Evidence-backed ${selected.need} procedure “${selected.skill.name}”`:`${actionCategory(selected.action)} bounded experiment`;
    return {action:selected.action,need:selected.need,...(selected.skillId?{skillId:selected.skillId,...Object.fromEntries(['sourceId','foodId','shelterId'].filter(k=>selected[k]).map(k=>[k,selected[k]]))}:{}),reason:`${label}; balancing food ${priorities.food.toFixed(1)}, water ${priorities.water.toFixed(1)}, exposure ${priorities.thermal.toFixed(1)} using remembered outcomes.`,provider:this.kind};
  }
}
export class DesktopModelProvider {
  constructor(bridge,label='Configured local model'){this.bridge=bridge;this.kind='local-model';this.label=label;}
  decide(npc){return this.bridge.decide(decisionObservation(npc));}
  cancel(){Promise.resolve(this.bridge.cancel()).catch(()=>{});}
}
export class NpcController {
  constructor(npc,{provider=new LocalLearnerProvider(),environment={}}={}){this.npc=npc;this.provider=provider;this.fallback=new LocalLearnerProvider();this.environment=environment;this.pending=null;this.readyDecision=null;this.generation=0;this.epoch=npc.epoch;this.senseAt=-1;this.failures=0;this.cooldownUntil=0;this.disposed=false;observeNpc(npc,environment);}
  setProvider(provider){this.cancel();this.provider=provider;this.failures=0;this.cooldownUntil=0;this.npc.nextDecisionAt=this.npc.elapsed;}
  cancel(){this.generation++;this.pending=null;this.readyDecision=null;this.provider.cancel?.();}
  dispose(){this.disposed=true;this.cancel();}
  selectSkill(){const c=skillCandidates(this.npc).sort((a,b)=>needPriorities(this.npc)[b.need]-needPriorities(this.npc)[a.need])[0];return c?{skill:c.skill,[c.parameter]:c.resourceId}:null;}
  startSkill(skill,resourceId){
    const n=this.npc,candidate=skillCandidates(n).find(c=>c.skill.id===skill?.id&&c.resourceId===resourceId);if(!candidate)return false;
    n.skillRun={id:skill.id,need:candidate.need,parameter:candidate.parameter,resourceId,sourceId:candidate.need==='water'?resourceId:undefined,cursor:0,awaiting:false,lastEventId:0,startedAt:n.elapsed,independentBefore:candidate.need==='food'?n.stats.independentMeals:candidate.need==='thermal'?n.memory.shelters[resourceId]?.relief||0:n.stats.independentDrinks};
    n.stats.skillUses++;n.decision=`Reusing ${skill.status} ${candidate.need} procedure “${skill.name}”, supported by events ${skill.supportingExperience.slice(-3).join(', ')}.`;recordEvent(n,'decision',{kind:'learned skill',skillId:skill.id,resourceId,supportingExperience:skill.supportingExperience.slice(-6)});return true;
  }
  progressSkill(){
    const n=this.npc,run=n.skillRun;if(!run)return;const skill=n.memory.skills.find(s=>s.id===run.id);
    if(!skill||n.elapsed-run.startedAt>NPC_RULES.maxSkillSeconds){n.skillRun=null;recordEvent(n,'skill',{skillId:run.id,outcome:'PROCEDURE_TIMEOUT'});return;}
    if(n.active)return;
    if(run.awaiting){if(!n.lastResult||n.lastResult.eventId<=run.lastEventId)return;if(!n.lastResult.ok){skill.failures++;if(skill.failures>=3&&skill.failures>skill.successes)skill.status='retired';recordEvent(n,'skill',{skillId:run.id,outcome:n.lastResult.code,eventId:n.lastResult.eventId});n.skillRun=null;return;}run.cursor++;run.awaiting=false;}
    if(run.cursor>=skill.steps.length){const after=run.need==='food'?n.stats.independentMeals:run.need==='thermal'?n.memory.shelters[run.resourceId]?.relief||0:n.stats.independentDrinks;recordEvent(n,'skill',{skillId:run.id,outcome:after>run.independentBefore?'INDEPENDENT_SUCCESS':'NO_INDEPENDENT_GAIN'});n.skillRun=null;return;}
    const step=skill.steps[run.cursor],request={type:step.type,...(step[run.parameter]?{[run.parameter]:run.resourceId}:{}),...(step.seconds?{seconds:step.seconds}:{})};run.lastEventId=n.lastResult?.eventId||0;run.awaiting=true;requestNpcAction(n,request,this.environment);
  }
  applyDecision(decision){
    const n=this.npc;if(!decision||typeof decision!=='object')throw new Error('Model returned no structured decision.');
    n.decision=String(decision.reason||'A bounded action was selected.').slice(0,600);recordEvent(n,'decision',{provider:this.provider.kind,summary:n.decision});
    if(decision.skillId){const skill=n.memory.skills.find(s=>s.id===decision.skillId),resourceId=decision.sourceId||decision.foodId||decision.shelterId;if(this.startSkill(skill,resourceId))return;}
    requestNpcAction(n,decision.action,this.environment);if(n.active&&['food','water','thermal'].includes(decision.need))n.active.goal=decision.need;
  }
  decide(){
    const n=this.npc;
    // Both local and model providers choose among the same needs; no unconditional water-skill override.
    if(this.provider.kind==='local-learner'){this.applyDecision(this.provider.decide(n));return;}
    if(!n.modelBudget)n.modelBudget={since:n.elapsed,calls:0};if(n.elapsed-n.modelBudget.since>=3600)n.modelBudget={since:n.elapsed,calls:0};
    if(n.modelBudget.calls>=NPC_RULES.maxModelCallsPerHour||n.elapsed<this.cooldownUntil){n.decision='Local model budget/backoff active; the offline experiential learner is continuing.';this.applyDecision(this.fallback.decide(n));return;}
    const generation=this.generation,epoch=n.epoch,condition=decisionCondition(n);n.modelBudget.calls++;n.stats.modelCalls++;this.pending={at:n.elapsed,condition};let call;
    try{call=this.provider.decide(n);}catch(error){call=Promise.reject(error);}
    Promise.resolve(call).then(decision=>{if(this.disposed)return;if(generation!==this.generation||epoch!==n.epoch||n.lifecycle!=='AWAKE'||n.active||decisionCondition(n)!==condition){n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});return;}this.pending=null;this.failures=0;this.readyDecision={decision,generation,epoch,condition};}).catch(error=>{if(this.disposed||generation!==this.generation)return;this.pending=null;n.stats.modelFailures++;this.failures++;this.cooldownUntil=n.elapsed+(this.failures>=2?30:5);recordEvent(n,'provider',{code:'MODEL_SERVICE_FAILURE',message:String(error.message||error).slice(0,400),gameplayFailure:false});n.decision='Model service unavailable. The offline experiential learner will continue after backoff.';}).finally(()=>{if(generation===this.generation)this.pending=null;});
  }
  reassess(){
    const n=this.npc,priorities=needPriorities(n),goal=n.skillRun?.need||n.active?.goal||goalFor(n.active?.request),dominant=Object.entries(priorities).sort((a,b)=>b[1]-a[1])[0];
    if(this.pending&&this.pending.condition!==decisionCondition(n)){recordEvent(n,'provider',{code:'CONDITION_CHANGED',gameplayFailure:false});this.cancel();n.nextDecisionAt=n.elapsed;}
    if(n.elapsed-(this.reassessAt??-1)<.5)return;this.reassessAt=n.elapsed;
    if((n.active||n.skillRun)&&dominant[1]>4&&dominant[0]!==goal&&dominant[1]>(priorities[goal]||0)+3){
      const alternative=this.fallback.decide(n),alternativeGoal=alternative.need||(alternative.skillId?n.memory.skills.find(s=>s.id===alternative.skillId)?.need:goalFor(alternative.action));
      if(alternativeGoal!==dominant[0])return;
      cancelNpcAction(n,'PRIORITY_CHANGED');if(n.skillRun){recordEvent(n,'skill',{skillId:n.skillRun.id,outcome:'PRIORITY_CHANGED',urgentNeed:dominant[0]});n.skillRun=null;}this.cancel();n.nextDecisionAt=n.elapsed;n.decision=`Interrupted ${goal} activity because ${dominant[0]} became more urgent.`;
    }
  }
  tick(dt){
    if(this.disposed)return;const n=this.npc;tickNpc(n,dt,this.environment);if(n.epoch!==this.epoch){this.cancel();this.epoch=n.epoch;}
    if(n.elapsed-this.senseAt>=1){observeNpc(n,this.environment);this.senseAt=n.elapsed;}
    if(n.lifecycle!=='AWAKE')return;this.reassess();if(n.active||this.pending)return;
    if(this.readyDecision){const ready=this.readyDecision;this.readyDecision=null;if(ready.generation===this.generation&&ready.epoch===n.epoch&&ready.condition===decisionCondition(n))this.applyDecision(ready.decision);else{n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});}return;}
    if(n.skillRun){this.progressSkill();return;}if(n.elapsed>=n.nextDecisionAt)this.decide();
  }
}
