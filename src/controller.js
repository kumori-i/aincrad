import { namingProposal, beginNamingProposal, acceptNamingProposal, objectName } from './category-names.js';
import { forwardNpcRunTravel } from './npc-effort-funding.js';
import { FOOD_SHARING_ACTIONS } from './food-sharing-config.js';
import { CONFIG, NPC_RULES } from './config.js';
import { distance, clamp } from './world.js';
import { tilePoint, rememberedCells, rememberedEdges } from './perception.js';
import { knownRoute } from './navigation.js';
import { observeNpc, requestNpcAction, tickNpc, cancelNpcAction } from './npc.js';
import { policyContext, actionCategory, recordEvent, learnedValue, learnOutcome } from './npc-memory.js';

import { bodySignals, sensedEnvironment } from './interoception.js';
import { signalUrgencies, cognitiveObservation, updateCognition, localPlan, adoptPlan, progressPlan, cancelPlan, cognitiveAction, explorationFrontier, searchReturn, estimatedWalkingSpeed } from './cognition.js';
import { discoveryDecision,discoveryObservation,processDiscoveryFeedback,contactEscape } from './discovery.js';
import { isSleeping } from './biology.js';
import { ozarkPersistentWorldAgent } from './ozark-agent-world.js';
import { setDiscoveryCandidateCapture, takeDiscoveryCandidateSnapshot, disposeDiscoveryCandidateCapture, captureDiscoveryCandidates } from './discovery-candidates.js';

function random(npc){npc.rng=(Math.imul(npc.rng,1664525)+1013904223)>>>0;return npc.rng/4294967296;}
const namingAwake=n=>n.lifecycle==='AWAKE'&&!isSleeping(n)&&!['rest','sleep','nap'].includes(n.active?.request?.type);
const thermalLevel=n=>Math.max(n.thermal?.hot||0,n.thermal?.cold||0);
function decisionCondition(npc){return JSON.stringify({scene:npc.scene,lifecycle:npc.lifecycle,body:bodySignals(npc)});}
/** The controller reacts to felt bands; exact stores remain the physical engine’s concern. */
export function needPriorities(npc){return signalUrgencies(npc);}
const goalFor=action=>action?.sourceId||['drink','fill_flask'].includes(action?.type)?'water':action?.foodId||['eat','gather_food'].includes(action?.type)?'food':action?.shelterId||action?.type==='enter_shelter'?'thermal':['rest','sleep'].includes(action?.type)?'rest':'explore';
function knownItems(npc,table){return npc.scene==='valley'?Object.values(npc.memory[table]||{}).filter(s=>(s.available!==false||table==='foods'&&npc.elapsed-s.observedAt>90)&&(table==='shelters'||(s.retryAfter||0)<=npc.elapsed)):[];}
function routeEstimate(npc,item){
  const d=distance(npc.position,item);if(d<=NPC_RULES.collectionRange)return 0;
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),anchor=npc.navigationAnchor&&cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
  const approaches=Object.values(cells).filter(c=>c.walkable&&distance(c,item)<=NPC_RULES.tileSize*2).sort((a,b)=>distance(a,npc.position)+distance(a,item)-distance(b,npc.position)-distance(b,item));
  for(const point of approaches){
    const edge=[point.key,`${Math.round(item.x/NPC_RULES.tileSize)},${Math.round(item.y/NPC_RULES.tileSize)}`].sort().join('>');if((edges[edge]?.retryAfter||0)>npc.elapsed)continue;
    const route=knownRoute(cells,npc.position,point,30,edges,npc.elapsed,anchor);if(!route)continue;
    let previous=npc.position,length=0;for(const node of route){length+=distance(previous,node);previous=node;}length+=distance(previous,item);const speed=estimatedWalkingSpeed(npc);if(length<=(NPC_RULES.maxActionSeconds-.75)*speed)return length/speed;
  }return null;
}
function stagedApproach(npc,item){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),before=distance(npc.position,item);
  const candidates=Object.values(cells).filter(c=>c.walkable&&distance(c,npc.position)>80&&distance(c,npc.position)<370&&distance(c,item)<before-40).sort((a,b)=>distance(a,item)-distance(b,item));
  for(const point of candidates){const route=knownRoute(cells,npc.position,point,30,edges,npc.elapsed,npc.navigationAnchor);if(route)return {point,seconds:before/estimatedWalkingSpeed(npc)};}return null;
}
export function skillCandidates(npc){
  if(npc.mode==='discovery')return [];
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
function experienceSummary(event){
  const details=event.details||{},result=details.result||{},action=details.action;
  return {id:event.id,at:event.at,type:event.type,...(action?{action:Object.fromEntries(['type','sourceId','foodId','shelterId','target','seconds','targetId','topic','noteId'].filter(k=>action[k]!==undefined).map(k=>[k,action[k]]))}:{}),...(result.code?{result:Object.fromEntries(['ok','code','independent','foodId','shelterId','resourceId','novelCells','distance','durationSeconds'].filter(k=>result[k]!==undefined).map(k=>[k,result[k]]))}:{}),...(details.verified?{verified:String(details.verified).slice(0,240)}:{}),...(details.verifiedCause?{verifiedCause:details.verifiedCause}:{})};
}
export function decisionObservation(npc,social=null){
  if(npc.mode==='discovery'){
    const d=discoveryObservation(npc),expose=table=>Object.values(npc.memory[table]||{}).slice(-12).map(s=>({id:s.id,name:s.name,x:s.x,y:s.y,scene:s.scene,available:s.available!==false,observedAt:s.observedAt}));
    const objectNames=d.observations.flatMap(object=>{const label=objectName(npc,object.id);return label?[{objectId:object.id,...label}]:[];});
    return {mode:'discovery',objectNames,identity:{id:npc.id,name:npc.name},objective:'Describe experienced sensations and grounded uncertainties. Human replies are optional. Words do not establish physical effects. Attributed procedures shared by a nearby peer may guide ordinary physical trials; they are not personal proof.',condition:{scene:npc.scene,lifecycle:npc.lifecycle,position:{...npc.position},body:bodySignals(npc),senses:sensedEnvironment(npc),inventory:{objects:(npc.inventory.items||[]).map(id=>npc.discovery.observations[id]).filter(Boolean),capacity:npc.inventory.capacity,flask:npc.flask.water<=.00001?'empty':npc.flask.water>=.999?'full':'some'}},observedAt:npc.elapsed,knownSources:expose('sources'),knownShelters:expose('shelters'),knownExit:npc.scene==='valley'?null:(npc.memory.caveExits?.[npc.scene]||null),knownTiles:Object.values(rememberedCells(npc)).filter(c=>distance(c,npc.position)<NPC_RULES.visionRadius+80).slice(-48).map(c=>({x:c.x,y:c.y,walkable:c.walkable,terrain:c.terrain,observedAt:c.observedAt})),...(ozarkPersistentWorldAgent(npc)?{terrainActions:{swim:'Attempt toward one currently seen tile within 160 pixels; physical current and bodily effort apply.',climb:'Attempt toward one currently seen tile within 160 pixels; physical grade, slip risk and bodily effort apply.'},recentTerrain:npc.memory.experience.filter(e=>e.type==='action'&&['move','swim','climb'].includes(e.details.action?.type)).slice(-6).map(e=>({at:e.at,action:e.details.action?.type,target:e.details.action?.target,result:e.details.result?.code,movement:e.details.result?.movement,blockedTarget:e.details.result?.blockedTarget}))}:{}),innerLife:cognitiveObservation(npc),discovery:d,social:social?.observe?.(npc)||{peers:[],journal:[],notes:[],pendingQuestion:null}};
  }
  const cells=Object.values(rememberedCells(npc)).filter(c=>distance(c,npc.position)<=NPC_RULES.visionRadius+80).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,48);
  const expose=table=>Object.values(npc.memory[table]||{}).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,12).map(s=>({id:s.id,name:s.name,x:s.x,y:s.y,scene:s.scene,available:s.available!==false,observedAt:s.observedAt,...(table==='foods'?{stock:s.stock,capacity:s.capacity}:{}),...(table==='shelters'&&Number.isFinite(s.experiencedTemperature)?{shelterExperience:s.experiencedTemperature>NPC_RULES.hotComfortMax?'hot':s.experiencedTemperature<NPC_RULES.coldComfortMin?'cold':'temperate',experiencedAt:s.experiencedAt}:{}),distance:npc.scene==='valley'?Math.round(distance(s,npc.position)):null,knownRouteSeconds:npc.scene==='valley'?routeEstimate(npc,s):null}));
  const flask=npc.flask.water<=.00001?'empty':npc.flask.water>=.999?'full':'some';
  return {
    identity:{id:npc.id,name:npc.name},objective:'Care for your body, prepare for uncertain trips, investigate locally observed mysteries and build relationships. Human journal replies are optional; continue living while a question is unanswered.',
    knownExit:npc.scene==='valley'?null:(npc.memory.caveExits?.[npc.scene]||null),
    condition:{scene:npc.scene,lifecycle:npc.lifecycle,position:{...npc.position},body:bodySignals(npc),senses:sensedEnvironment(npc),inventory:{apples:npc.inventory?.apples.length||0,capacity:npc.inventory?.capacity||3,flask}},
    observedAt:npc.elapsed,knownSources:expose('sources'),knownFoods:expose('foods'),knownShelters:expose('shelters'),
    knownTiles:cells.map(c=>({x:c.x,y:c.y,walkable:c.walkable,terrain:c.terrain,observedAt:c.observedAt})),
    recentExperience:npc.learning?npc.memory.experience.slice(-6).map(experienceSummary):[],lessons:npc.learning?npc.memory.lessons.slice(-3).map(l=>({at:l.at,verified:String(l.verified||'').replace(/-?\d+(?:\.\d+)?\s*%?/g,'a bodily change'),hypothesis:String(l.hypothesis||'').replace(/-?\d+(?:\.\d+)?\s*%?/g,'an amount')})):[],
    skills:npc.learning?npc.memory.skills.filter(s=>s.status!=='retired').map(s=>({id:s.id,need:s.need,status:s.status,recognition:s.recognition,preconditions:{resourceKnown:true,inRange:s.preconditions?.inRange===true},steps:s.steps,successes:s.successes,failures:s.failures,supportingExperience:s.supportingExperience.slice(-9)})):[],
    procedureCandidates:skillCandidates(npc).slice(0,12).map(c=>({...c.decision,need:c.need,travelSeconds:c.travelSeconds})),
    actionStatus:npc.active?{type:npc.active.request.type,goal:goalFor(npc.active.request),remaining:Math.max(0,npc.active.expiresAt-npc.elapsed)}:null,
    innerLife:cognitiveObservation(npc),social:social?.observe?.(npc)||{peers:[],journal:[],notes:[],pendingQuestion:null},
    actions:{observe:{},move:{target:'Observed traversable tile {x,y}, or sourceId / foodId / shelterId from known resources; bounded to 12 seconds.'},inspect:{sourceId:'known water, foodId: known food, shelterId: known shelter'},fill_flask:{sourceId:'known source; collection range 80'},drink:{},gather_food:{foodId:'known finite-stock apple patch; collection range 80'},eat:{},enter_shelter:{shelterId:'known nearby cave entrance'},exit_shelter:{},wait:{seconds:'0.25 to 5'},rest:{seconds:'0.25 to 12'},sleep:{seconds:'0.25 to 12'},say:{targetId:'locally observed peer',text:'grounded speech'},ask_human:{text:'a grounded question; an answer is optional',topic:'world uncertainty'},journal_reply:{text:'reply to a human journal message',replyTo:'optional message id'},write_note:{title:'field note title',text:'grounded observations or labeled hypotheses',beliefIds:'own evidence IDs'},read_note:{noteId:'locally observed note'}},
    procedureUse:'A skillId with a matching known resource selects an optional evidence-backed routine. Or return a plan with goal, need, three to six bounded action steps, completion and interrupt descriptions. Intentions are not completed outcomes.',
  };
}
/** A bounded factored value learner with supplied physiology and action affordances, not a language model. */
export class LocalLearnerProvider {
  constructor(){this.kind='local-learner';this.label='Offline experiential learner';}
  decide(npc){
    if(npc.mode==='discovery')return discoveryDecision(npc);
    const priorities=needPriorities(npc),choices=[],body=bodySignals(npc),cognition=updateCognition(npc);
    if(npc.scene==='valley'&&cognition.shelterState?.departureUntil>npc.elapsed&&!body.thermal.startsWith('dangerously')&&!['overheated','shivering'].includes(body.thermal))priorities.thermal=Math.min(priorities.thermal,1.2);
    if(npc.inventory?.apples.length&&['ravenous','faint with hunger'].includes(body.hunger))return {action:{type:'eat'},need:'food',reason:'My hunger is urgent and I already carry food; I can take relief before travelling.',provider:this.kind};
    if(npc.flask.water>0&&['parched','desperate thirst'].includes(body.thirst))return {action:{type:'drink'},need:'water',reason:'My thirst is urgent and I already carry water; I can drink before travelling.',provider:this.kind};
    const returning=searchReturn(npc);if(returning)return {action:returning,need:'safety',reason:'This search has reached its return budget. I am returning toward remembered supplies before investigating another direction.',provider:this.kind};
    if(priorities.food>=2.4||priorities.water>=2.4||priorities.thermal>=4||body.pain==='severe')priorities.rest=0;
    const maximum=Math.max(...Object.values(priorities));
    if(priorities.rest>=2&&Math.max(priorities.food,priorities.water,priorities.thermal)<4)return {action:{type:['sleepy','struggling to stay awake'].includes(body.sleepiness)?'sleep':'rest',seconds:10},need:'rest',reason:'My breathing, tiredness or sleepiness asks for a safe pause.',provider:this.kind};
    const add=(action,need,base=0,seconds=0)=>{const value=learnedValue(npc,action),urgency=need?priorities[need]:0;choices.push({action,need,score:base+urgency*1.8-Math.min(4,seconds*.08)+clamp(value.value,-3,5)*.45+random(npc)*.18,value});};
    const failures=npc.learning?npc.memory.experience.filter(e=>e.type==='action'&&!e.details.result?.ok):[];
    if(npc.flask.water>.00001&&body.thirst!=='quenched')add({type:'drink'},'water',1.3);
    else if(npc.flask.water<=.00001&&!failures.some(e=>e.details.result?.code==='EMPTY_FLASK')&&maximum<2)add({type:'drink'},null,.1);
    if(npc.inventory?.apples.length&&['hungry','ravenous','faint with hunger'].includes(body.hunger))add({type:'eat'},'food',1.5);
    if(!npc.inventory?.apples.length&&!failures.some(e=>e.details.result?.code==='NO_FOOD')&&maximum<2)add({type:'eat'},null,.1);
    if(npc.scene==='valley'){
      for(const [table,parameter,need,interaction,allowed] of [['sources','sourceId','water','fill_flask',npc.flask.water<=.00001&&body.thirst!=='quenched'],['foods','foodId','food','gather_food',(npc.inventory?.apples.length||0)<(npc.inventory?.capacity||3)&&body.hunger!=='content'],['shelters','shelterId','thermal','enter_shelter',thermalLevel(npc)>15||(npc.sensation?.feltTemperature??18)>(NPC_RULES.hotComfortMax??26)||(npc.sensation?.feltTemperature??18)<(NPC_RULES.coldComfortMin??14)]]){
        if(!allowed)continue;
        const sorted=knownItems(npc,table).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position));
        for(const item of sorted.slice(0,5)){const seconds=routeEstimate(npc,item),stage=seconds===null?stagedApproach(npc,item):null;if(seconds===null&&!stage)continue;const inRange=distance(item,npc.position)<=NPC_RULES.collectionRange;const action=stage?{type:'move',target:{x:stage.point.x,y:stage.point.y}}:{type:inRange?(need==='food'&&item.available===false?'inspect':interaction):'move',[parameter]:item.id};
          add(action,need,inRange?(need==='food'?2:.6):.3,seconds??stage.seconds);if(need==='food'&&npc.inventory?.apples.length)choices.at(-1).score-=priorities.food*1.3+.5*npc.inventory.apples.length;}
      }
    }else{
      const exposure=cognition.shelterState||{},outside=exposure.lastOutside,senses=sensedEnvironment(npc),recentExposure=outside&&['hot','cold'].includes(outside.warmth)&&outside.timeOfDay===senses.timeOfDay&&outside.weather===senses.weather;
      const supplyTrip=(!npc.inventory?.apples.length&&priorities.food>=2.4)||(npc.flask.water<=.00001&&priorities.water>=2.4),minimumStay=npc.elapsed-(exposure.enteredAt??npc.elapsed)<15;
      const recovering=body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal);
      const stay=recovering||!supplyTrip&&(minimumStay||recentExposure||priorities.thermal>1.5);
      const imminentSupply=(!npc.inventory?.apples.length&&body.hunger==='faint with hunger')||(npc.flask.water<=.00001&&body.thirst==='desperate thirst');
      if(stay)add({type:'wait',seconds:5},'thermal',2);
      if(!stay||imminentSupply){const exit=npc.memory.caveExits?.[npc.scene],goal=priorities.food>priorities.water?'food':'water';if(exit){if(distance(npc.position,exit)<100)add({type:'exit_shelter'},goal,imminentSupply?2.8:.8);else{const route=knownRoute(rememberedCells(npc),npc.position,exit,30,rememberedEdges(npc),npc.elapsed,npc.navigationAnchor);if(route)add({type:'move',target:{x:exit.x,y:exit.y}},goal,imminentSupply?2.8:.8,distance(npc.position,exit)/CONFIG.walkSpeed);}}}
    }
    // Procedures compete on the same priority scale, rather than pre-empting a model or food.
    for(const candidate of skillCandidates(npc)){
      const first=candidate.skill.steps[0],action={type:first.type,[candidate.parameter]:candidate.resourceId};
      const value=learnedValue(npc,action),confidence=Math.min(1.8,.7+candidate.skill.successes*.12+(candidate.skill.status==='validated'?.5:0));
      choices.push({...candidate.decision,need:candidate.need,score:confidence+priorities[candidate.need]*1.8-Math.min(4,candidate.travelSeconds*.08)+clamp(value.value,-3,5)*.45+random(npc)*.12,value,skill:candidate.skill});
    }
    const dominant=Object.entries(priorities).sort((a,b)=>b[1]-a[1])[0],unmet=dominant[1]>1.5&&!choices.some(c=>c.need===dominant[0]);
    const frontier=npc.scene==='valley'||Math.max(priorities.food,priorities.water,priorities.thermal)<1.5?explorationFrontier(npc):null;
    if(frontier){const safe=Math.max(0,1-maximum/5);add({type:'move',target:{x:frontier.target.x,y:frontier.target.y}},null,.6+Math.min(1.1,frontier.unknown*.035)*safe);
      // If no useful resource is known, exploration is a necessary search even under distress.
      if(unmet){choices.at(-1).score+=maximum*.9;choices.at(-1).need=dominant[0];}else if(!choices.some(c=>c.need))choices.at(-1).score+=maximum*.3;
    }
    add({type:'observe'},null,-.4-maximum*.1);add({type:'wait',seconds:1},null,npc.scene!=='valley'?-.2:-.8-maximum*.1);
    const ranked=choices.sort((a,b)=>b.score-a.score),selected=maximum<1.5&&random(npc)<.035?ranked[Math.floor(random(npc)*ranked.length)]:ranked[0];
    const label=selected.skill?`Evidence-backed ${selected.need} procedure “${selected.skill.name}”`:`${actionCategory(selected.action)} bounded experiment`;
    return {action:selected.action,need:selected.need,...(selected.skillId?{skillId:selected.skillId,...Object.fromEntries(['sourceId','foodId','shelterId'].filter(k=>selected[k]).map(k=>[k,selected[k]]))}:{}),reason:`${label}; my body feels ${bodySignals(npc).hunger}, ${bodySignals(npc).thirst}, and ${bodySignals(npc).thermal}. Remembered outcomes guide this choice.`,provider:this.kind};
  }
}
export class DesktopModelProvider {
  constructor(bridge,label='Configured local model',npcId='aster'){this.npcId=npcId;this.bridge=bridge;this.kind='local-model';this.label=label;}
  decide(npc,context={}){this.npcId=npc.id;return this.bridge.decide(decisionObservation(npc,context.social));}
  proposeName(request){this.npcId=request.agentId;return this.bridge.proposeName(request);}
  cancel(){Promise.resolve(this.bridge.cancel(this.npcId)).catch(()=>{});}
}
export class NpcController {
  constructor(npc,{provider=new LocalLearnerProvider(),environment={},social=null,discoveryFoodLearning=true,deferInitialObservation=false}={}){this.discoveryFoodLearning=discoveryFoodLearning!==false;this.social=social;this.npc=npc;this.provider=provider;this.fallback=new LocalLearnerProvider();this.environment=environment;this.pending=null;this.namingPending=null;this.namingLastAttemptAt=-Infinity;this.namingStatus={state:'idle'};this.readyDecision=null;this.generation=0;this.epoch=npc.epoch;this.senseAt=-1;this.failures=0;this.cooldownUntil=0;this.disposed=false;if(!deferInitialObservation){observeNpc(npc,environment);updateCognition(npc);}}
  setProvider(provider){this.cancel();this.provider=provider;this.failures=0;this.cooldownUntil=0;this.npc.nextDecisionAt=this.npc.elapsed;}
  cancel(){this.generation++;this.pending=null;if(this.namingPending)this.namingStatus={state:'cancelled',at:this.npc.elapsed};this.namingPending=null;this.readyDecision=null;this.provider.cancel?.();}
  setDiscoveryCandidateCapture(enabled){setDiscoveryCandidateCapture(this,enabled);}
  takeDiscoveryCandidateSnapshot(){return takeDiscoveryCandidateSnapshot(this);}
  dispose(){disposeDiscoveryCandidateCapture(this);this.disposed=true;this.cancel();}
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
    const n=this.npc;if(!decision||typeof decision!=='object'){recordEvent(n,'provider',{code:'INVALID_MODEL_DECISION',gameplayFailure:false});this.perform({type:'observe'});return;}
    if(n.mode==='discovery'&&(decision.skillId||decision.plan||decision.provider==='local-model'&&!['ask_human','journal_reply'].includes(decision.action?.type))){recordEvent(n,'provider',{code:'DISCOVERY_MODEL_PHYSICAL_REJECTED',gameplayFailure:false});return;}
    n.decision=String(decision.reason||'A bounded action was selected.').slice(0,600);recordEvent(n,'decision',{provider:decision.provider||this.provider.kind,summary:n.decision});
    if(decision.skillId){const skill=n.memory.skills.find(s=>s.id===decision.skillId),resourceId=decision.sourceId||decision.foodId||decision.shelterId;if(this.startSkill(skill,resourceId))return;}
    if(decision.plan){if(!adoptPlan(n,decision.plan)){recordEvent(n,'provider',{code:'INVALID_MODEL_PLAN',gameplayFailure:false});this.perform({type:'observe'});return;}const action=progressPlan(n);if(action)this.perform(action);return;}
    this.perform(decision.action);if(n.active&&['food','water','thermal','rest'].includes(decision.need))n.active.goal=decision.need;
  }
  perform(raw){
    const n=this.npc,action=cognitiveAction(n,raw);if(!action)return requestNpcAction(n,{type:'observe',duration:-1},this.environment);
    if([...FOOD_SHARING_ACTIONS,'say','ask_human','journal_reply','write_note','read_note'].includes(action.type)){const result=this.social?.action?.(n,{...action,offline:raw.model!==true&&(this.provider.kind==='local-learner'||raw.offline===true),...(raw.model===true?{model:true}:{})})||{ok:false,code:'SOCIAL_UNAVAILABLE'};learnOutcome(n,action,result,policyContext(n),{...n.position});n.nextDecisionAt=n.elapsed+.65;return result;}
    forwardNpcRunTravel(n,raw,action);
    return requestNpcAction(n,action,this.environment);
  }
  decideOffline({survivalOnly=false}={}){
    const n=this.npc,priorities=needPriorities(n),safe=Math.max(...Object.values(priorities))<3.5;
    if(safe&&!survivalOnly){
      const dialogue=this.social?.maybeDialogue?.(n);
      if(dialogue){this.applyDecision({action:{...dialogue,offline:true},provider:'local-learner',reason:'Offline evidence-based dialogue: a grounded question, discovery or nearby relationship deserves attention.'});return;}
      const planned=localPlan(n);
      if(planned&&adoptPlan(n,planned,{supplied:true})){n.decision=planned.goal;recordEvent(n,'decision',{provider:'local-learner',kind:'persistent plan',summary:n.decision});const action=progressPlan(n);if(action)this.perform(action);return;}
    }
    const provider=this.provider.kind==='local-learner'?this.provider:this.fallback;this.applyDecision({...provider.decide(n),provider:'local-learner'});
  }
  decide(){
    const n=this.npc;
    // Both local and model providers choose among the same needs; no unconditional water-skill override.
    if(this.provider.kind==='local-learner'){this.decideOffline();return;}
    if(!n.modelBudget)n.modelBudget={since:n.elapsed,calls:0};if(n.elapsed-n.modelBudget.since>=3600)n.modelBudget={since:n.elapsed,calls:0};
    if(n.modelBudget.calls>=NPC_RULES.maxModelCallsPerHour||n.elapsed<this.cooldownUntil){n.decision='Local model budget/backoff active; the offline experiential learner is continuing.';this.decideOffline();return;}
    const generation=this.generation,epoch=n.epoch,condition=decisionCondition(n);n.modelBudget.calls++;n.stats.modelCalls++;this.pending={at:n.elapsed,condition};let call;
    try{call=this.provider.decide(n,{social:this.social});}catch(error){call=Promise.reject(error);}
    Promise.resolve(call).then(decision=>{if(this.disposed)return;if(generation!==this.generation||epoch!==n.epoch||n.lifecycle!=='AWAKE'||n.active||decisionCondition(n)!==condition){n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});return;}this.pending=null;this.failures=0;this.readyDecision={decision,generation,epoch,condition};}).catch(error=>{if(this.disposed||generation!==this.generation)return;this.pending=null;n.stats.modelFailures++;this.failures++;this.cooldownUntil=n.elapsed+(this.failures>=2?30:5);recordEvent(n,'provider',{code:'MODEL_SERVICE_FAILURE',message:String(error.message||error).slice(0,400),gameplayFailure:false});n.decision='Model service unavailable. The offline experiential learner will continue after backoff.';}).finally(()=>{if(generation===this.generation)this.pending=null;});
  }
  reassess(){
    const n=this.npc,priorities=needPriorities(n),goal=n.skillRun?.need||n.active?.goal||goalFor(n.active?.request),dominant=Object.entries(priorities).sort((a,b)=>b[1]-a[1])[0];
    if(this.pending&&this.pending.condition!==decisionCondition(n)){recordEvent(n,'provider',{code:'CONDITION_CHANGED',gameplayFailure:false});this.cancel();n.nextDecisionAt=n.elapsed;}
    if(n.elapsed-(this.reassessAt??-1)<.5)return;this.reassessAt=n.elapsed;
    if((n.active||n.skillRun)&&dominant[1]>4&&dominant[0]!==goal&&dominant[1]>(priorities[goal]||0)+3){
      const alternative=this.fallback.decide(n),alternativeGoal=alternative.need||(alternative.skillId?n.memory.skills.find(s=>s.id===alternative.skillId)?.need:goalFor(alternative.action));
      if(alternativeGoal!==dominant[0])return;
      cancelNpcAction(n,'PRIORITY_CHANGED');cancelPlan(n,`My ${dominant[0]} sensations became more urgent.`);if(n.skillRun){recordEvent(n,'skill',{skillId:n.skillRun.id,outcome:'PRIORITY_CHANGED',urgentNeed:dominant[0]});n.skillRun=null;}this.cancel();n.nextDecisionAt=n.elapsed;n.decision=`Interrupted ${goal} activity because ${dominant[0]} became more urgent.`;
    }
  }
  tick(dt){
    if(this.npc.mode==='discovery'){this.tickDiscovery(dt);return;}
    if(this.disposed)return;const n=this.npc;tickNpc(n,dt,this.environment);if(n.epoch!==this.epoch){this.cancel();this.epoch=n.epoch;}
    if(n.elapsed-this.senseAt>=1){observeNpc(n,this.environment);updateCognition(n);this.senseAt=n.elapsed;}
    if(n.lifecycle!=='AWAKE'){cancelPlan(n,'Consciousness or recovery interrupted the intention.');return;}this.reassess();if(n.active)return;
    if(this.pending){if(n.elapsed>=n.nextDecisionAt&&(Math.max(...Object.values(needPriorities(n)))>=4||n.elapsed-this.pending.at>3&&Math.max(...Object.values(needPriorities(n)))>=1.5)){this.cancel();this.decideOffline({survivalOnly:true});}return;}
    if(this.readyDecision){const ready=this.readyDecision;this.readyDecision=null;if(ready.generation===this.generation&&ready.epoch===n.epoch&&ready.condition===decisionCondition(n))this.applyDecision(ready.decision);else{n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});}return;}
    if(n.skillRun){this.progressSkill();return;}if(n.elapsed>=n.nextDecisionAt){if(n.cognition?.plan?.status==='active'&&Math.max(...Object.values(needPriorities(n)))>=4)cancelPlan(n,'My bodily sensations call for immediate care.');const previousPlan=n.cognition?.plan?.status,planned=progressPlan(n);if(planned){this.perform(planned);return;}if(previousPlan==='active'&&n.cognition?.plan?.status!=='active'){n.nextDecisionAt=n.elapsed+2;return;}this.decide();}
  }
  // Naming is an optional inert side channel. Bodily life and the physical
  // decision loop never wait for it, and no proposal is a runnable action.
  maybeName(){
    const n=this.npc,provider=this.provider;
    if(this.disposed||n.mode!=='discovery'||n.learning!==true||!namingAwake(n)||provider.kind!=='local-model'||
      typeof provider.proposeName!=='function'||this.pending||this.namingPending||n.elapsed-this.namingLastAttemptAt<60)return;
    const request=namingProposal(n);
    if(!request||!beginNamingProposal(n,request))return;
    this.namingLastAttemptAt=n.elapsed;
    const pending={request,generation:this.generation,epoch:n.epoch,provider,npc:n};
    this.namingPending=pending;this.namingStatus={state:'pending',at:n.elapsed};n.stats.modelCalls++;
    let call;try{call=provider.proposeName(request);}catch(error){call=Promise.reject(error);}
    const current=()=>!this.disposed&&this.namingPending===pending&&this.npc===n&&this.provider===provider&&
      this.generation===pending.generation&&n.epoch===pending.epoch&&n.learning===true&&namingAwake(n)&&
      n.elapsed>=request.observedAt&&n.elapsed-request.observedAt<=60;
    pending.current=current;
    Promise.resolve(call).then(result=>{
      if(!current())return;
      // The callback cannot mint a fresh visual receipt. Wait for ordinary
      // perception on the next simulation sense step before applying a word.
      pending.result=result;pending.received=true;
    }).catch(error=>{
      if(!current())return;
      this.namingStatus={state:'unavailable',at:n.elapsed};
      n.stats.modelFailures++;recordEvent(n,'provider',{code:'NAMING_MODEL_UNAVAILABLE',message:String(error.message||error).slice(0,200),gameplayFailure:false});
    }).finally(()=>{if(this.namingPending===pending&&!pending.received){this.namingPending=null;if(this.namingStatus.state==='pending')this.namingStatus={state:'discarded',at:n.elapsed};}});
  }
  finishNaming(){
    const pending=this.namingPending;
    if(!pending?.received)return;
    const current=pending.current();this.namingPending=null;
    if(!current){this.namingStatus={state:'discarded',at:this.npc.elapsed};return;}
    const accepted=acceptNamingProposal(this.npc,pending.request,pending.result);
    this.namingStatus={state:accepted?'accepted':'not-adopted',at:this.npc.elapsed};
    if(!accepted)recordEvent(this.npc,'provider',{code:'NAMING_PROPOSAL_NOT_ADOPTED',gameplayFailure:false});
  }
  tickDiscovery(dt){
    if(this.disposed)return;const n=this.npc;tickNpc(n,dt,this.environment);if(n.epoch!==this.epoch){this.cancel();this.epoch=n.epoch;n.discovery.run=null;}
    if(this.namingPending&&(!namingAwake(n)||!n.learning||n.elapsed<this.namingPending.request.observedAt||n.elapsed-this.namingPending.request.observedAt>60))this.cancel();
    if(isSleeping(n)||n.lifecycle!=='AWAKE')return;
    processDiscoveryFeedback(n,{foodLearning:this.discoveryFoodLearning,recordEffect:effect=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});
    if(n.elapsed-this.senseAt>=1){observeNpc(n,this.environment);updateCognition(n);this.social?.observe?.(n);this.senseAt=n.elapsed;this.finishNaming();this.maybeName();}
    const contact=contactEscape(n);if(contact&&n.active&&n.active.goal!=='escape-contact'&&n.active.startedAt<n.memory.experience.find(e=>e.id===contact.eventId)?.at){cancelNpcAction(n,'CONTACT_ESCAPE');n.discovery.run=null;n.decision='Pain from experienced contact interrupted my activity.';this.perform(contact.action);if(n.active)n.active.goal='escape-contact';return;}
    // Dialogue inference runs alongside bodily life; it cannot select an experiment.
    if(this.readyDecision){const ready=this.readyDecision;this.readyDecision=null;const action=ready.decision?.action;if(ready.generation===this.generation&&ready.epoch===n.epoch&&['ask_human','journal_reply'].includes(action?.type))this.perform({...action,model:true});else recordEvent(n,'provider',{code:'DISCOVERY_MODEL_PHYSICAL_REJECTED',gameplayFailure:false});}
    if(n.active||n.elapsed<n.nextDecisionAt)return;
    // A volunteered handover briefly keeps the donor's hands available. Body,
    // contact and water safety still run; consent and this pause are not saved.
    if(this.social?.foodSharing?.holding(n))return;
    const exchange=this.social?.foodSharing?.choose(n);
    if(exchange){this.perform({...exchange,offline:true});return;}
    if(n.elapsed-n.discovery.lastDialogueAt>=12){
      const dialogue=this.social?.maybeDialogue?.(n);
      if(dialogue){
        n.discovery.lastDialogueAt=n.elapsed;
        if(this.provider.kind==='local-model'&&['journal_reply','ask_human'].includes(dialogue.type)&&!this.pending&&!this.namingPending&&n.elapsed>=this.cooldownUntil){
          const generation=this.generation,epoch=n.epoch;n.stats.modelCalls++;this.pending={at:n.elapsed};
          Promise.resolve().then(()=>this.provider.decide(n,{social:this.social})).then(decision=>{if(!this.disposed&&generation===this.generation&&epoch===n.epoch)this.readyDecision={decision,generation,epoch};}).catch(error=>{if(generation===this.generation){n.stats.modelFailures++;this.cooldownUntil=n.elapsed+30;recordEvent(n,'provider',{code:'MODEL_SERVICE_FAILURE',message:String(error.message||error).slice(0,200)});}}).finally(()=>{if(generation===this.generation)this.pending=null;});
        }else {this.perform({...dialogue,offline:true});return;}
      }
    }
    captureDiscoveryCandidates(this,n);
    const decision=discoveryDecision(n,{foodLearning:this.discoveryFoodLearning});n.decision=decision.reason;recordEvent(n,'decision',{provider:'discovery-learner',summary:decision.reason});this.perform(decision.action);if(contact&&n.active&&decision.need==='safety')n.active.goal='escape-contact';
  }
}
