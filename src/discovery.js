import { CONFIG,NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { createDiscoveryMemory,cleanSensoryObject,objectId } from './discovery-state.js';
import { bodySignals,sensedEnvironment } from './interoception.js';
import { distance } from './world.js';
import { rememberedCells,rememberedEdges,lineOfSight } from './perception.js';
import { createKnownRouteIndex } from './navigation.js';
import { BIOLOGY_RULES } from './biology-config.js';
import { recordEvent, withProofTransaction } from './npc-events.js';
import { LEGACY_PHYSICAL_PROVENANCE, retainHeldObservations } from './proof-retention.js';

const memory=n=>n.discovery||=(createDiscoveryMemory());
const random=n=>{n.rng=(Math.imul(n.rng,1664525)+1013904223)>>>0;return n.rng/4294967296;};
export function rememberDiscoveryObservation(npc,objects=[]){
  const d=memory(npc);if(!d.search.home)d.search.home={...npc.position};
  for(const raw of objects){const object=cleanSensoryObject({...raw,observedAt:npc.elapsed});if(object)d.observations[object.id]=object;}
  d.observations=retainHeldObservations(npc,d.observations);
  withProofTransaction(npc,()=>{});
}
export function recordDiscoveryOutcome(npc,action,result,event){
  return withProofTransaction(npc,()=>recordDiscoveryOutcomeLinked(npc,action,result,event));
}
function recordDiscoveryOutcomeLinked(npc,action,result,event){
  if(!DISCOVERY_RULES.primitives.includes(action?.type))return;
  const d=memory(npc),experiment={id:d.nextId++,at:npc.elapsed,primitive:action.type,targetId:action.targetId,ok:result.ok===true,code:String(result.code||'NO_CHANGE').slice(0,60),durationSeconds:Math.max(0,result.durationSeconds||0),actionId:event.id,...(objectId(result.materialId)?{materialId:result.materialId}:{}),...(result.ingestionId?{ingestionId:String(result.ingestionId).slice(0,80)}:{})};
  const key=`${action.targetId}|${action.type}`,trials=d.trials||=( {}),trial=trials[key]||=( {attempts:0,successes:0,failures:0,seconds:0,lastAt:0,lastCode:''});trial.attempts++;trial[experiment.ok?'successes':'failures']++;if(experiment.ok)trial.seconds+=experiment.durationSeconds;trial.lastAt=npc.elapsed;trial.lastCode=experiment.code;trial.lastOk=experiment.ok;
  if(Object.keys(trials).length>768){const protectedObjects=new Set(d.techniques.map(t=>t.sourceId));const candidates=Object.entries(trials).filter(([key])=>!protectedObjects.has(key.split('|')[0])).sort((a,b)=>a[1].lastAt-b[1].lastAt);delete trials[candidates[0]?.[0]||Object.keys(trials)[0]];}
  d.experiments.push(experiment); // The enclosing action transaction links before shared compaction.
  const practice=d.practice[action.type]||=( {successes:0,failures:0,seconds:0});
  // A rejected command is not practice. Successful inspection cannot improve pulling.
  if(experiment.ok&&experiment.durationSeconds>0){practice.successes++;practice.seconds+=experiment.durationSeconds;}else practice.failures++;
  d.lastAttemptAt=npc.elapsed;
  if(d.run?.awaiting){if(d.run.expectedType===action.type&&d.run.expectedId===action.targetId){d.run.awaiting=false;if(!result.ok){const t=d.techniques.find(t=>t.id===d.run.techniqueId);if(t&&result.code!=='TOO_FULL')t.failures++;d.run=null;}else{if(result.materialId||action.type==='grasp')d.run.materialId=result.materialId||action.targetId;d.run.cursor++;}}}
  for(const report of d.reports.filter(r=>r.sourceId==='human'&&r.status==='unverified')){
    const expected=report.proposed[report.cursor];if(expected?.type===action.type&&expected.targetId===action.targetId){report.evidence.push(experiment.id);report.cursor++;if(result.materialId)for(const step of report.proposed.slice(report.cursor))if(['sample','release'].includes(step.type)&&step.targetId===action.targetId)step.targetId=result.materialId;if(!result.ok){report.status='contradicted';report.cursor=report.proposed.length;}}
  }
  return experiment;
}
function sampleAcquisition(d,sample){
  return d.experiments.filter(e=>e.ok&&e.materialId===sample.targetId&&e.id<sample.id).at(-1)||d.experiments.filter(e=>e.ok&&e.primitive==='grasp'&&e.targetId===sample.targetId&&e.id<sample.id).at(-1);
}
const processingFeedback=new WeakSet();
function seenFeedback(d,key){d.seenFeedback.push(key);d.seenFeedback=d.seenFeedback.slice(-128);}
function conditionMatches(proof,effect){
  const f=proof?.details?.feedback;
  return proof?.type==='condition'&&Number.isFinite(proof.at)&&proof.at>=effect.at&&proof.details.code==='DISCOVERY_EFFECT'&&f?.id===effect.id&&f.ingestionId===effect.ingestionId&&f.actionId===effect.actionId&&f.effect===effect.effect&&f.objectId===effect.objectId&&f.source==='experienced'&&f.at===effect.at;
}
export function processDiscoveryFeedback(npc,{recordEffect=null,foodLearning=true}={}){
  if(processingFeedback.has(npc))return;
  const d=memory(npc);processingFeedback.add(npc);
  try{for(const event of [...(npc.physiology?.feedback||[])]){
    const key=event.id;if(d.seenFeedback.includes(key))continue;
    // Migration preserves this portion for digestion only. Even a later
    // matching-looking experiment cannot turn its feedback into knowledge.
    if(event.provenance===LEGACY_PHYSICAL_PROVENANCE){seenFeedback(d,key);continue;}
    const sample=d.experiments.find(e=>e.primitive==='sample'&&e.ok&&e.targetId===event.objectId&&e.actionId===event.actionId&&e.ingestionId===event.ingestionId&&event.provenance==='sampled'&&event.at>=e.at);
    if(!sample||sample.ingestionId&&d.effects.some(e=>e.ingestionId===sample.ingestionId&&e.effect===event.effect)){seenFeedback(d,key);continue;}
    withProofTransaction(npc,()=>{
      const effect={id:String(key),at:event.at,objectId:event.objectId,actionId:sample.actionId,ingestionId:sample.ingestionId||'',effect:event.effect,hunger:event.hunger,thirst:event.thirst,energy:event.energy,pain:event.pain,source:'experienced'};
      const proof=recordEffect?recordEffect(effect):recordEvent(npc,'condition',{code:'DISCOVERY_EFFECT',feedback:effect});
      // Accept only an original receipt actually recorded in this actor. The
      // outer timestamp is genuine recognition time; embedded at is emission.
      if(npc.discovery!==d||!Number.isInteger(proof?.id)||!npc.memory.experience.some(x=>x.id===proof.id&&conditionMatches(x,effect)))throw new Error('DISCOVERY_EFFECT_PROOF');
      effect.proofEventId=proof.id;
      d.effects.push(effect);d.effects=d.effects.slice(-DISCOVERY_RULES.maxEffects);
      seenFeedback(d,key);
      if(d.samplesPending[event.objectId]!==undefined&&d.samplesPending[event.objectId]<=sample.at)delete d.samplesPending[event.objectId];
    if(event.effect==='discomfort'){
      const acquired=sampleAcquisition(d,sample);
      for(const t of d.techniques.filter(t=>t.evidence.includes(sample.id)||acquired&&t.sourceId===acquired.targetId&&t.steps[0].type===acquired.primitive)){
        t.confidence='revised';t.evidence=[...new Set([...t.evidence,...(acquired?[acquired.id]:[]),sample.id])].slice(-16);
      }
      for(const r of d.reports.filter(r=>r.evidence.includes(sample.id)))r.status='contradicted';return;
    }
    if(event.effect!=='sustained'||!foodLearning)return;
    const grasp=sampleAcquisition(d,sample);if(!grasp)return;
    const sourceId=grasp.targetId,evidence=[grasp.id,sample.id],steps=[{type:grasp.primitive,targetId:'$source'},{type:'sample',targetId:'$material'}];
    let technique=d.techniques.find(t=>t.sourceId===sourceId&&t.steps[0].type===grasp.primitive);
    if(!technique){technique={id:`technique:${npc.id}:${d.nextId++}`,sourceId,steps,evidence,at:npc.elapsed,effect:'sustained',confidence:'tentative',successes:0,failures:0};d.techniques.push(technique);d.foodDiscoveries++;if(npc.cognition){npc.cognition.knowledgeGained++;npc.cognition.lastKnowledgeAt=npc.elapsed;}}
    technique.successes++;technique.evidence=[...new Set([...technique.evidence,...evidence])].slice(-16);if(technique.confidence!=='revised')technique.confidence=technique.successes>=2?'supported':'tentative';d.techniques=d.techniques.slice(-DISCOVERY_RULES.maxTechniques);
    npc.stats.independentMeals++;npc.stats.firstFoodAt??=npc.elapsed;
    for(const r of d.reports.filter(r=>r.evidence.includes(sample.id)))r.status='supported';
    });
  }}finally{processingFeedback.delete(npc);}
}
/** Explicit human testimony proposes operations; words alone prove no affordance. */
function recordDiscoveryReportLinked(npc,content,{sourceId='human',channel='journal',messageId='',at=npc.elapsed}={}){
  if(npc.mode!=='discovery'||!['human','aster','mira'].includes(sourceId)||typeof content!=='string')return null;
  const d=memory(npc),text=content.slice(0,600);if(d.reports.some(r=>r.messageId===messageId&&r.sourceId===sourceId&&messageId))return null;
  const report={id:`report:${npc.id}:${d.nextId++}`,text,sourceId,channel:String(channel).slice(0,20),messageId:String(messageId||'').slice(0,80),at,status:'unverified',proposed:[],cursor:0,evidence:[]};
  // Parse only explicitly named body verbs and an already locally observed ID.
  // No dictionary linking apple/tree/animal words to food or engine species exists.
  if(sourceId==='human'){
    const lower=text.toLowerCase(),referenced=text.match(/object:\d{1,9}/)?.[0];
    const descriptions=Object.values(d.observations).map(o=>({o,words:Object.values(o.appearance||{}).join(' ').toLowerCase()}));
    const explicitFeatures=['red','purple','green','round','fibrous','prickly','rough','sweet','furry','soft','trunk','blades','clusters'].filter(word=>new RegExp(`\\b${word}\\b`).test(lower));
    const matchesByFeature=explicitFeatures.length?descriptions.filter(x=>explicitFeatures.every(word=>x.words.includes(word))).sort((a,b)=>distance(a.o.position,npc.position)-distance(b.o.position,npc.position)):[];
    const priorQuestion=(npc.social?.heard||[]).filter(m=>m.senderId===npc.id&&m.kind==='question'&&/object:\d+/.test(m.text||'')).at(-1)?.text?.match(/object:\d+/)?.[0];
    const id=referenced||(matchesByFeature.length===1?matchesByFeature[0].o.id:null)||(!explicitFeatures.length&&priorQuestion&&d.observations[priorQuestion]?priorQuestion:null);
    if(id&&d.observations[id]){
      const verbs=[...lower.matchAll(/\b(inspect(?:_object)?|look\s+at|grasp|pick\s+up|pick|pluck|take|release|drop|pull|sample|taste|bite|eat|strike|hit)\b/g)];
      const mappings={'look at':'inspect_object','pick up':'grasp',pick:'pull',pluck:'pull',take:'grasp',drop:'release',taste:'sample',bite:'sample',eat:'sample',hit:'strike'};
      report.proposed=verbs.slice(0,6).map(m=>({type:m[1].startsWith('inspect')?'inspect_object':mappings[m[1]]||m[1],targetId:id}));
    }
  }
  d.reports.push(report);d.reports=d.reports.slice(-DISCOVERY_RULES.maxReports);return report;
}
export function recordDiscoveryReport(npc,content,options={}){
  return withProofTransaction(npc,()=>recordDiscoveryReportLinked(npc,content,options));
}
export const recordTechniqueReport=recordDiscoveryReport;
export function recordDiscoveryClaim(npc,claim,options={}){
  if(!claim||!objectId(claim.objectId))return null;
  const report=recordDiscoveryReport(npc,`A reported sampling effect for ${claim.objectId}: ${String(claim.effect||'uncertain').slice(0,80)}.`,options);
  if(report)report.objectId=claim.objectId;return report;
}
export function discoveryObservation(npc){
  const d=memory(npc);return {observations:Object.values(d.observations).slice(-40),experiments:d.experiments.slice(-24),effects:d.effects.slice(-24),techniques:d.techniques.slice(-16).map(t=>({...t,proficiency:(d.practice[t.steps[0].type]?.successes||0)>=25?'efficient':(d.practice[t.steps[0].type]?.successes||0)>=7?'practiced':'novice'})),reports:d.reports.slice(-16)};
}
function routeTarget(npc,point){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc);
  const b=bodySignals(npc),slowed=['winded','exhausted'].includes(b.stamina)||b.fatigue==='exhausted'||b.energy==='depleted'||b.sleepiness==='groggy';
  const speed=Math.min(CONFIG.walkSpeed*(slowed?BIOLOGY_RULES.exhaustionWalkMultiplier:1),1/(npc.cognition?.travel?.secondsPerUnit||1/CONFIG.walkSpeed));
  const routes=createKnownRouteIndex(cells,npc.position,edges,npc.elapsed,npc.navigationAnchor);
  // Invalid endpoints cannot consume the nearest-24 budget ahead of a usable
  // care route. Admission uses the same observed search and exact path costs.
  const choices=Object.values(cells).filter(c=>c.walkable&&distance(c,npc.position)>45&&distance(c,npc.position)<900).sort((a,b)=>distance(a,point)-distance(b,point));
  let admitted=0;
  for(const c of choices){if(admitted>=24)break;const route=routes.metrics(c,30);if(!route||!(route.returnedLength<speed*(NPC_RULES.maxActionSeconds-1)))continue;admitted++;if(distance(c,point)>=distance(npc.position,point)-20)continue;return {type:'move',target:{x:c.x,y:c.y}};}
  return null;
}
// All consumption paths use the same observed constraints. A swallowing refusal
// describes the body, not this material, so another object must not evade it.
function recentlyFailed(npc,type,id){
  const d=memory(npc),trial=d.trials?.[`${id}|${type}`],recent=d.experiments.filter(e=>e.targetId===id&&e.primitive===type).at(-1);
  // Detailed evidence can rotate out while aggregate observed results remain.
  // An older retained failure must not override a later success (or unknown
  // legacy result). No result-code dictionary supplies unexperienced knowledge.
  if(trial&&trial.lastAt>=(recent?.at??-1)){
    if(typeof trial.lastOk==='boolean')return !trial.lastOk&&npc.elapsed-trial.lastAt<60;
    if(trial.lastAt>(recent?.at??-1))return false;
  }
  return Boolean(recent&&!recent.ok&&npc.elapsed-recent.at<60);
}
function samplingBlocked(npc,body=bodySignals(npc)){
  const d=memory(npc);
  return ['full','overfull'].includes(body.digestion)||Object.entries(d.trials||{}).some(([key,t])=>key.endsWith('|sample')&&t.lastOk===false&&t.lastCode==='TOO_FULL'&&npc.elapsed-t.lastAt<60)||d.experiments.some(e=>e.primitive==='sample'&&!e.ok&&e.code==='TOO_FULL'&&npc.elapsed-e.at<60);
}
function supportedHeldMaterial(npc,id){
  const d=memory(npc);if(!npc.inventory.items.includes(id))return false;
  // Reuse is earned for this physical item, not inferred from its source or
  // appearance. Two feedback messages from one portion are only one trial.
  const portions=new Set(d.effects.filter(effect=>effect.objectId===id&&effect.effect==='sustained'&&effect.ingestionId&&d.experiments.some(sample=>sample.primitive==='sample'&&sample.ok&&sample.targetId===id&&sample.ingestionId===effect.ingestionId&&sample.actionId===effect.actionId&&effect.at>=sample.at)).map(effect=>effect.ingestionId));
  return portions.size>=2;
}
function sampleEligible(npc,id,body=bodySignals(npc),foodLearning=true){
  const d=memory(npc);
  if(samplingBlocked(npc,body)||d.effects.some(e=>e.objectId===id&&e.effect==='discomfort'))return false;
  // Keep every pending identity for delayed feedback/protection, even when
  // repeated positive experience supports another physical bite before it arrives.
  if(d.samplesPending[id]!==undefined&&npc.elapsed-d.samplesPending[id]<DISCOVERY_RULES.feedbackWaitSeconds&&!(foodLearning&&supportedHeldMaterial(npc,id)))return false;
  return !recentlyFailed(npc,'sample',id);
}
function unfinishedHeldTrial(npc,body){
  const d=memory(npc);
  for(const id of npc.inventory.items){
    if(!sampleEligible(npc,id,body))continue;
    const acquired=sampleAcquisition(d,{targetId:id,id:Infinity});
    if(!acquired||d.experiments.some(e=>e.id>acquired.id&&e.primitive==='sample'&&e.targetId===id&&e.ok))continue;
    const technique=d.techniques.find(t=>t.sourceId===acquired.targetId&&t.steps[0]?.type===acquired.primitive&&t.confidence!=='revised'&&t.failures<=t.successes+2&&t.steps[1]?.type==='sample');
    if(!technique)continue;
    // Restore only an actual acquired, still-held next step, including after a
    // save clears the transient run. This new item has no presumed benefit or
    // safety: its first portion retains ordinary pending and adverse gates.
    d.run={techniqueId:technique.id,cursor:1,materialId:id,awaiting:false,startedAt:npc.elapsed};
    return learnedStep(npc);
  }
  return null;
}
function deferRestRetry(npc,body){
  const event=npc.memory.experience.filter(e=>e.type==='action'&&['rest','sleep'].includes(e.details.action?.type)).at(-1);
  if(!event||event.details.result?.ok||!['UNSAFE_TO_REST','REST_INTERRUPTED'].includes(event.details.result?.code)||event.at>npc.elapsed||npc.elapsed-event.at>=60)return false;
  const previous=event.details.result.body||{};
  // Only an improvement in a safety-related sensation reopens an early test.
  // Activity, fatigue, circadian sleepiness and transient relief are not evidence
  // that the cause of a rejected rest has changed.
  const scales={energy:['steady','waning','low','depleted'],thirst:['quenched','dry mouth','thirsty','parched','desperate thirst'],pain:['none','aching','hurting','severe'],overall:['settled','uncomfortable','distressed','urgent']};
  for(const [key,scale] of Object.entries(scales)){const before=scale.indexOf(previous[key]),now=scale.indexOf(body[key]);if(before>0&&now>=0&&now<before)return false;}
  const thermal=value=>['dangerously hot','dangerously cold'].includes(value)?2:['overheated','shivering'].includes(value)?1:0;
  if(thermal(body.thermal)<thermal(previous.thermal))return false;
  if(thermal(previous.thermal)&&typeof event.details.scene==='string'&&event.details.scene!==npc.scene)return false;
  return true;
}
function learnedStep(npc){
  const d=memory(npc),run=d.run;if(!run)return null;
  const technique=d.techniques.find(t=>t.id===run.techniqueId);if(!technique||technique.confidence==='revised'||npc.elapsed-run.startedAt>90){d.run=null;return null;}
  if(run.awaiting)return null;if(run.cursor>=technique.steps.length){d.run=null;return null;}
  const step=technique.steps[run.cursor],id=step.targetId==='$source'?technique.sourceId:run.materialId;
  if(!id){d.run=null;return null;}if(recentlyFailed(npc,step.type,id)||step.type==='sample'&&!sampleEligible(npc,id))return null;const object=d.observations[id];
  if(!npc.inventory.items.includes(id)&&object&&distance(npc.position,object.position)>DISCOVERY_RULES.reach){const move=routeTarget(npc,object.position);if(move)return move;d.run=null;return null;}
  run.awaiting=true;run.expectedType=step.type;run.expectedId=id;return {type:step.type,targetId:id};
}
/** Pain from actual observed contact supports avoidance; appearance alone predicts no threat. */
export function contactEscape(npc){
  const event=npc.memory.experience.filter(e=>e.type==='condition'&&e.details?.code==='CONTACT_INJURY'&&e.details.provenance==='experienced contact'&&e.details.scene===npc.scene&&npc.elapsed-e.at<60).at(-1);if(!event)return null;
  const id=event.details.sourceId,observed=memory(npc).observations[id],source=observed&&npc.elapsed-observed.observedAt<2?observed.position:npc.elapsed-event.at<1?event.details.sourcePosition:null;if(!source)return null;
  if(distance(npc.position,source)>450)return null;
  const choices=Object.values(rememberedCells(npc)).filter(c=>c.walkable&&distance(c,npc.position)>60&&distance(c,npc.position)<500&&distance(c,source)>distance(npc.position,source)+60).sort((a,b)=>(distance(b,source)-distance(b,npc.position)*.3)-(distance(a,source)-distance(a,npc.position)*.3));
  for(const target of choices.slice(0,12)){const action=routeTarget(npc,target);if(action&&distance(action.target,source)>distance(npc.position,source)+40)return {action,eventId:event.id,sourceId:id};}
  return null;
}
/** A generic novelty/outcome learner. It never looks up an object's species or nutrients. */
export function discoveryDecision(npc,{foodLearning=true}={}){
  processDiscoveryFeedback(npc,{foodLearning});const d=memory(npc),body=bodySignals(npc),senses=sensedEnvironment(npc);
  const restDeferred=deferRestRetry(npc,body),depletedAfterRefusal=restDeferred&&body.energy==='depleted';
  // Evaluation can ablate positive food associations without erasing perception,
  // navigation, practice, novelty, failures, or experienced discomfort.
  if(!foodLearning)d.run=null;
  const wrap=(action,reason,need='understanding')=>({action,reason,need,provider:'discovery-learner'});
  const escape=contactEscape(npc);if(escape)return wrap(escape.action,'A contact I actually experienced hurt; I can move away through terrain I observed.','safety');
  const thirsty=['thirsty','parched','desperate thirst'].includes(body.thirst);
  if(thirsty&&npc.flask.water>0)return wrap({type:'drink'},'My thirst is asking for remembered water relief.','water');
  if(thirsty&&npc.scene==='valley'){
    const source=Object.values(npc.memory.sources).filter(s=>s.available!==false&&(s.retryAfter||0)<=npc.elapsed).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];
    if(source){if(distance(source,npc.position)<=NPC_RULES.collectionRange)return wrap({type:'fill_flask',sourceId:source.id},'I can reach the water I actually observed.','water');const move=routeTarget(npc,source);if(move)return wrap(move,'I am approaching remembered water.','water');}
  }
  const dangerous=body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal);
  if(dangerous&&npc.scene==='valley'){
    const refuge=Object.values(npc.memory.shelters).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];if(refuge){if(distance(refuge,npc.position)<=100)return wrap({type:'enter_shelter',shelterId:refuge.id},'Exposure hurts; the observed opening may provide cover.','thermal');const move=routeTarget(npc,refuge);if(move)return wrap(move,'I am moving toward an observed opening.','thermal');}
  }
  if(npc.scene!=='valley'&&(!dangerous||body.thirst==='desperate thirst'||body.hunger==='faint with hunger')&&(thirsty||['hungry','ravenous','faint with hunger'].includes(body.hunger))){const exit=npc.memory.caveExits?.[npc.scene];if(exit){if(distance(npc.position,exit)<100)return wrap({type:'exit_shelter'},'My body needs something outside this refuge.','survival');const move=routeTarget(npc,exit);if(move)return wrap(move,'I remember this route toward the opening.','survival');}}
  if(foodLearning&&(['ravenous','faint with hunger'].includes(body.hunger)||depletedAfterRefusal)&&!samplingBlocked(npc,body)){
    if(depletedAfterRefusal){const unfinished=unfinishedHeldTrial(npc,body);if(unfinished)return wrap(unfinished,'I still hold the result of an operation sequence I previously tested; I can cautiously finish its first sampling trial before acquiring more.','food');}
    const carried=npc.inventory.items.find(id=>d.effects.some(e=>e.objectId===id&&e.effect==='sustained')&&sampleEligible(npc,id,body,foodLearning));
    if(carried)return wrap({type:'sample',targetId:carried},depletedAfterRefusal?'Rest was refused while I felt depleted; a previous portion of this held material brought relief, so I can test another.':'My hunger is urgent, and a previous portion of this held material brought relief; I can test another before resting.','food');
    const reason=depletedAfterRefusal?'Rest was refused while I felt depleted; I can try an observed route and operation sequence that previously brought bodily relief.':'My hunger is urgent; I can test a nearby operation sequence that previously brought relief before resting.';
    if(d.run){const action=learnedStep(npc);if(action)return wrap(action,reason,'food');}
    if(!d.run&&npc.inventory.items.length<DISCOVERY_RULES.capacity){
      const candidates=d.techniques.filter(t=>t.confidence!=='revised'&&t.failures<=t.successes+2&&!recentlyFailed(npc,t.steps[0].type,t.sourceId)&&d.observations[t.sourceId]?.scene===npc.scene&&(depletedAfterRefusal||distance(npc.position,d.observations[t.sourceId].position)<=DISCOVERY_RULES.reach));
      if(depletedAfterRefusal)candidates.sort((a,b)=>distance(npc.position,d.observations[a.sourceId].position)-distance(npc.position,d.observations[b.sourceId].position));
      for(const technique of candidates){
        d.run={techniqueId:technique.id,cursor:0,materialId:null,awaiting:false,startedAt:npc.elapsed};
        const action=learnedStep(npc);if(action)return wrap(action,reason,'food');
        // An observed source without a usable observed route must not conceal a
        // later viable source. Retain genuinely pending sequences, however.
        if(d.run)break;
      }
    }
  }
  if(!restDeferred&&['sleepy','struggling to stay awake'].includes(body.sleepiness)&&!dangerous&&body.thirst!=='desperate thirst')return wrap({type:'sleep',seconds:CONFIG.dayRealSeconds/3},'I can hardly remain awake; a longer sleep may restore alertness.','rest');
  if(!restDeferred&&(['winded','exhausted'].includes(body.stamina)||['weary','exhausted'].includes(body.fatigue)))return wrap({type:'rest',seconds:CONFIG.dayRealSeconds/48},'My muscles and breathing ask for a vulnerable rest.','rest');
  if(depletedAfterRefusal&&!dangerous&&body.thirst!=='desperate thirst')return wrap({type:'wait',seconds:5},'Rest was interrupted or refused while I felt depleted; without an available learned relief action, I can keep still briefly and reassess my sensations.','rest');
  if(d.run){const action=learnedStep(npc);if(action)return wrap(action,'I am repeating an operation sequence supported by my own bodily feedback.','food');}
  const hungry=foodLearning&&body.hunger!=='content'&&!samplingBlocked(npc,body);
  const knownHeld=npc.inventory.items.find(id=>d.effects.some(e=>e.objectId===id&&e.effect==='sustained')&&sampleEligible(npc,id,body,foodLearning));
  if(hungry&&knownHeld)return wrap({type:'sample',targetId:knownHeld},'An earlier portion of this held object brought bodily relief; I can test another portion.','food');
  if(hungry&&npc.inventory.items.length<DISCOVERY_RULES.capacity){const technique=d.techniques.filter(t=>t.confidence!=='revised'&&t.failures<=t.successes+2&&!recentlyFailed(npc,t.steps[0].type,t.sourceId)&&d.observations[t.sourceId]?.scene===npc.scene&&!d.experiments.some(e=>e.materialId&&e.targetId===t.sourceId&&d.samplesPending[e.materialId]!==undefined&&npc.elapsed-d.samplesPending[e.materialId]<DISCOVERY_RULES.feedbackWaitSeconds)).sort((a,b)=>a.failures-b.failures||distance(d.observations[a.sourceId].position,npc.position)-distance(d.observations[b.sourceId].position,npc.position))[0];if(technique){d.run={techniqueId:technique.id,cursor:0,materialId:null,awaiting:false,startedAt:npc.elapsed};const action=learnedStep(npc);if(action)return wrap(action,'Past sampling of this object was followed by sustained bodily relief; I can test whether it happens again.','food');}}
  const report=d.reports.find(r=>r.sourceId==='human'&&r.status==='unverified'&&r.cursor<r.proposed.length);if(report){const step=report.proposed[report.cursor],object=d.observations[step.targetId];if((object?.scene===npc.scene||npc.inventory.items.includes(object?.id))&&(step.type!=='sample'||sampleEligible(npc,step.targetId,body,foodLearning))){if(distance(object.position,npc.position)<=DISCOVERY_RULES.reach||npc.inventory.items.includes(object.id))return wrap(step,'I can physically test a human suggestion; its result remains uncertain.');const move=routeTarget(npc,object.position);if(move)return wrap(move,'I am approaching an object mentioned in an unverified human suggestion.');}}
  const objects=Object.values(d.observations).filter(o=>(o.scene===npc.scene||npc.inventory.items.includes(o.id))&&npc.elapsed-o.observedAt<8&&(npc.inventory.items.includes(o.id)||lineOfSight(npc.position,o.position,npc.scene)));
  const choices=[];
  for(const object of objects){
    const held=npc.inventory.items.includes(object.id),near=held||distance(npc.position,object.position)<=DISCOVERY_RULES.reach;
    if(!near)continue;
    for(const type of DISCOVERY_RULES.primitives){
      if(['release','sample'].includes(type)&&!held)continue;
      if(['grasp','pull'].includes(type)&&(held||npc.inventory.items.length>=DISCOVERY_RULES.capacity))continue;
      const trial=d.trials?.[`${object.id}|${type}`]||{attempts:0,failures:0,lastAt:0,lastCode:''},failures=trial.failures;
      if(recentlyFailed(npc,type,object.id))continue;
      if(type==='sample'&&!sampleEligible(npc,object.id,body,foodLearning))continue;
      const novelty=8/(1+trial.attempts);
      choices.push({action:{type,targetId:object.id},score:novelty-failures*3+(type==='inspect_object'&&!trial.attempts?1:0)+random(npc)*(trial.attempts?.2:2)});
    }
  }
  // Movement competes with object trials. Repeatedly striking/inspecting a familiar
  // patch cannot block an unfamiliar nearby object or a remembered frontier forever.
  const targets=objects.filter(o=>distance(o.position,npc.position)>DISCOVERY_RULES.reach).map(o=>({o,score:5/(1+Object.entries(d.trials||{}).filter(([key])=>key.startsWith(`${o.id}|`)).reduce((sum,[,t])=>sum+t.attempts,0))-distance(o.position,npc.position)/1500+random(npc)})).sort((a,b)=>b.score-a.score);
  for(const target of targets.slice(0,4)){const move=routeTarget(npc,target.o.position);if(move)choices.push({action:move,score:target.score,reason:'I can approach an unfamiliar object within my observed map.'});}
  if(npc.scene==='valley'){
    // Exploration stays local to observed terrain and bounded actions, not the first observation's coordinates.
    const cells=Object.values(rememberedCells(npc)),candidate=cells.filter(c=>c.walkable&&distance(c,npc.position)>150&&distance(c,npc.position)<900).map(c=>({c,score:(c.visits||0)*-3+random(npc)*8})).sort((a,b)=>b.score-a.score);
    for(const {c} of candidate.slice(0,8)){const move=routeTarget(npc,c);if(move){choices.push({action:move,score:2.5/(1+(c.visits||0))+random(npc),reason:'I can investigate another locally observed patch of terrain.'});break;}}
  }
  if(choices.length){const selected=choices.sort((a,b)=>b.score-a.score)[0];return wrap(selected.action,selected.reason||'An unfamiliar object and an untested body operation offer an experiment; I do not yet know the consequence.');}
  return wrap({type:'wait',seconds:5},'I am allowing time for changes and sensations before another bounded experiment.');
}
