import { receivedMaterialCaution } from './food-warning.js';
import { markNpcRunTravel } from './npc-effort-funding.js';
import { experiencedFoodSourceCaution } from './food-source-caution.js';
import { witnessedMaterialCompletion } from './discovery-completion.js';
import { ingestVisualSamples } from './visual-group-memory.js';
import { recoveryChoice } from './movement-recovery.js';
import { parseHumanHint } from './human-hints.js';
import { recordHandlingOutcome, handlingExperiment, handlingInquiries, HANDLING_QUESTION } from './handling-inquiry.js';
import { observationalInquiries, observationalExperiment, priorAdverseSource } from './observational-learning.js';
import { linkInquiryOutcome } from './observational-inquiry-state.js';
import { cleanPeerTeaching, isPeerTeaching, teachingExpired, cleanAppearanceCues, appearanceCuesMatch, PEER_TRANSFER_SIGHT_SECONDS } from './peer-teaching.js';
import { admitMethodTrial } from './method-transfer-state.js';
import { CONFIG,NPC_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { createDiscoveryMemory,cleanSensoryObject,objectId } from './discovery-state.js';
import { bodySignals,sensedEnvironment } from './interoception.js';
import { distance } from './world.js';
import { rememberedCells,rememberedEdges,actorLineOfSight } from './perception.js';
import { createKnownRouteIndex } from './navigation.js';
import { BIOLOGY_RULES } from './biology-config.js';
import { recordEvent, withProofTransaction } from './npc-events.js';
import { LEGACY_PHYSICAL_PROVENANCE, LEGACY_UNKNOWN_PHYSICAL_PROVENANCE, retainHeldObservations } from './proof-retention.js';
import { ozarkAgentWorld, ozarkPersistentWorldAgent, ozarkFiniteAquaticAgent } from './ozark-agent-world.js';
import { explorationFrontier } from './cognition.js';

const memory=n=>n.discovery||=(createDiscoveryMemory());
const random=n=>{n.rng=(Math.imul(n.rng,1664525)+1013904223)>>>0;return n.rng/4294967296;};
// A saved visual record has no individual sensory receipt. Only this runtime's
// perception or completed inspection can reopen a failed physical target.
const firsthandSightings=new WeakMap();
const availabilityScans=new WeakMap();
export function rememberDirectDiscoveryObject(npc,raw){
  const object=cleanSensoryObject({...raw,observedAt:npc.elapsed});if(!object)return;
  memory(npc).observations[object.id]=object;
  let sightings=firsthandSightings.get(npc);if(!sightings){sightings=new Map();firsthandSightings.set(npc,sightings);}
  sightings.set(object.id,{at:object.observedAt,scene:object.scene,count:object.count,position:{...object.position}});
}
// Only an actual observation in this runtime can supply a fixed interception aim.
// Saves, testimony and externally supplied coordinates cannot recreate it.
export function recentDiscoveryAim(npc,id){
  const sight=firsthandSightings.get(npc)?.get(id),object=npc.discovery?.observations?.[id];
  if(!sight||!object||sight.scene!==npc.scene||object.scene!==sight.scene||
    !Number.isFinite(sight.at)||sight.at>npc.elapsed||npc.elapsed-sight.at>DISCOVERY_RULES.catchObservationMaxAge||
    object.observedAt!==sight.at||object.position.x!==sight.position.x||object.position.y!==sight.position.y)return null;
  return {...sight.position};
}
/** Only a live local sensory receipt supplies a transferable descriptor. */
export function freshMethodAppearance(npc,id){
  const sight=firsthandSightings.get(npc)?.get(id),o=memory(npc).observations[id];
  if(!sight||!o||sight.at!==o.observedAt||sight.scene!==npc.scene||o.scene!==npc.scene||
    sight.at>npc.elapsed||npc.elapsed-sight.at>=PEER_TRANSFER_SIGHT_SECONDS||
    sight.position.x!==o.position.x||sight.position.y!==o.position.y||
    distance(npc.position,o.position)>NPC_RULES.visionRadius||!actorLineOfSight(npc,npc.position,o.position))return null;
  const cues=cleanAppearanceCues(Object.fromEntries(['shape','color','texture'].map(k=>[k,o.appearance?.[k]])));
  return cues?{version:1,cues,observedAt:o.observedAt}:null;
}
function localMethodSource(npc,id){
  const o=memory(npc).observations[id];
  return !!freshMethodAppearance(npc,id)&&distance(npc.position,o.position)<=DISCOVERY_RULES.reach;
}
export function discoveryPrimitives(npc){
  return ozarkFiniteAquaticAgent(npc)?DISCOVERY_RULES.allPrimitives:DISCOVERY_RULES.primitives;
}
export function rememberDiscoveryObservation(npc,objects=[],{visualSample=false}={}){
  // Only ordinary personal perception contributes time-separated visual samples.
  // Naming/speech refreshes and action-result descriptions never enter this ledger.
  if(visualSample)ingestVisualSamples(npc,objects);
  const d=memory(npc);if(!d.search.home)d.search.home={...npc.position};
  for(const raw of objects)rememberDirectDiscoveryObject(npc,raw);
  d.observations=retainHeldObservations(npc,d.observations);
  const sightings=firsthandSightings.get(npc);if(sightings)for(const id of sightings.keys())if(!d.observations[id])sightings.delete(id);
  withProofTransaction(npc,()=>{});
}
export function recordDiscoveryOutcome(npc,action,result,event){
  return withProofTransaction(npc,()=>recordDiscoveryOutcomeLinked(npc,action,result,event));
}
function recordDiscoveryOutcomeLinked(npc,action,result,event){
  if(!DISCOVERY_RULES.allPrimitives.includes(action?.type))return;
  const d=memory(npc),experiment={id:d.nextId++,at:npc.elapsed,primitive:action.type,targetId:action.targetId,ok:result.ok===true,code:String(result.code||'NO_CHANGE').slice(0,60),durationSeconds:Math.max(0,result.durationSeconds||0),actionId:event.id,...(objectId(result.materialId)?{materialId:result.materialId}:{}),...(Object.hasOwn(result,'resultObjectId')?{resultObjectId:result.resultObjectId}:{}),...(result.finishedMaterial===true?{finishedMaterial:true}:{}),...(result.ingestionId?{ingestionId:String(result.ingestionId).slice(0,80)}:{})};
  const key=`${action.targetId}|${action.type}`,trials=d.trials||=( {}),trial=trials[key]||=( {attempts:0,successes:0,failures:0,seconds:0,lastAt:0,lastCode:''});trial.attempts++;trial[experiment.ok?'successes':'failures']++;if(experiment.ok)trial.seconds+=experiment.durationSeconds;trial.lastAt=npc.elapsed;trial.lastCode=experiment.code;trial.lastOk=experiment.ok;
  if(Object.keys(trials).length>768){const protectedObjects=new Set(d.techniques.map(t=>t.sourceId));const candidates=Object.entries(trials).filter(([key])=>!protectedObjects.has(key.split('|')[0])).sort((a,b)=>a[1].lastAt-b[1].lastAt);delete trials[candidates[0]?.[0]||Object.keys(trials)[0]];}
  d.experiments.push(experiment); linkInquiryOutcome(d,experiment); recordHandlingOutcome(npc,experiment,{appearance:id=>freshMethodAppearance(npc,id)}); // The enclosing action transaction links before shared compaction.
  // Naming is an optional asynchronous model proposal over ordinary sensory
  // evidence, not a seeded syllable side effect of a completed action.
  const practice=d.practice[action.type]||=( {successes:0,failures:0,seconds:0});
  // A rejected command is not practice. Successful inspection cannot improve pulling.
  if(experiment.ok&&experiment.durationSeconds>0){practice.successes++;practice.seconds+=experiment.durationSeconds;}else practice.failures++;
  d.lastAttemptAt=npc.elapsed;
  if(d.run?.awaiting){if(d.run.expectedType===action.type&&d.run.expectedId===action.targetId){d.run.awaiting=false;if(!result.ok){const t=d.techniques.find(t=>t.id===d.run.techniqueId);if(t&&!['TOO_FULL','OBJECT_GONE','nothing_detached'].includes(result.code))t.failures++;d.run=null;}else{if(result.materialId||action.type==='grasp')d.run.materialId=result.materialId||action.targetId;d.run.cursor++;}}}
  for(const report of d.reports.filter(r=>r.status==='unverified'&&(r.sourceId==='human'||isPeerTeaching(r)&&r.teaching.state==='ready'&&!teachingExpired(r,npc.elapsed)))){
    const expected=report.proposed[report.cursor];if(expected?.type===action.type&&expected.targetId===action.targetId){report.evidence.push(experiment.id);report.cursor++;if(result.materialId)for(const step of report.proposed.slice(report.cursor))if(['sample','release'].includes(step.type)&&step.targetId===action.targetId)step.targetId=result.materialId;if(!result.ok){if(isPeerTeaching(report)){report.teaching.state='unavailable';report.teaching.lastCode=experiment.code;}else report.status='contradicted';report.cursor=report.proposed.length;}else if(isPeerTeaching(report)&&action.type==='sample')report.teaching.state='waiting';}
  }
  return experiment;
}
function sampleAcquisition(d,sample){
  return d.experiments.filter(e=>e.ok&&e.id<sample.id&&(e.primitive==='pull'&&e.materialId===sample.targetId||e.primitive==='grasp'&&e.targetId===sample.targetId)).at(-1);
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
    if(event.provenance===LEGACY_PHYSICAL_PROVENANCE||
       event.provenance===LEGACY_UNKNOWN_PHYSICAL_PROVENANCE){seenFeedback(d,key);continue;}
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
      for(const r of d.reports.filter(r=>r.evidence.includes(sample.id))){r.status='contradicted';if(isPeerTeaching(r))r.teaching.state='complete';}return;
    }
    if(event.effect!=='sustained'){for(const r of d.reports.filter(r=>r.teaching?.transfer&&r.evidence.includes(sample.id)))r.teaching.state='complete';return;}
    if(!foodLearning)return;
    const grasp=sampleAcquisition(d,sample);if(!grasp)return;
    const sourceId=grasp.targetId,evidence=[grasp.id,sample.id],steps=[{type:grasp.primitive,targetId:'$source'},{type:'sample',targetId:'$material'}];
    let technique=d.techniques.find(t=>t.sourceId===sourceId&&t.steps[0].type===grasp.primitive);
    if(!technique){technique={id:`technique:${npc.id}:${d.nextId++}`,sourceId,steps,evidence,at:npc.elapsed,effect:'sustained',confidence:'tentative',successes:0,failures:0};d.techniques.push(technique);d.foodDiscoveries++;if(npc.cognition){npc.cognition.knowledgeGained++;npc.cognition.lastKnowledgeAt=npc.elapsed;}}
    technique.successes++;technique.evidence=[...new Set([...technique.evidence,...evidence])].slice(-16);if(technique.confidence!=='revised')technique.confidence=technique.successes>=2?'supported':'tentative';d.techniques=d.techniques.slice(-DISCOVERY_RULES.maxTechniques);
    npc.stats.independentMeals++;npc.stats.firstFoodAt??=npc.elapsed;
    for(const r of d.reports.filter(r=>r.evidence.includes(sample.id))){r.status='supported';if(isPeerTeaching(r))r.teaching.state='complete';}
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
    const question=(npc.social?.heard||[]).filter(m=>m.senderId===npc.id&&m.kind==='question').at(-1);
    const ids=question?.text?.match(/object:\d{1,9}\b/g)||[];
    const priorQuestion=new Set(ids).size===1?ids[0]:null;
    Object.assign(report,parseHumanHint(content,d.observations,discoveryPrimitives(npc),priorQuestion));
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
/** Called after genuine local speech. This stores reported instructions, not skill proof. */
export function recordPeerTechnique(npc,content,teaching,options={}){
  const clean=cleanPeerTeaching(teaching);if(!clean||!['aster','mira'].includes(options.sourceId)||options.sourceId===npc.id||options.channel!=='peer')return null;
  return withProofTransaction(npc,()=>{
    const report=recordDiscoveryReportLinked(npc,content,options);if(!report)return null;
    report.teaching=clean;
    const d=memory(npc);
    if(clean.transfer && !localMethodSource(npc,clean.sourceObjectId)){
      // Speech carries no receiver target. Bind once from the receiver's own
      // current sensory records, before checking action availability or benefit.
      delete clean.transfer.targetObjectId;
      const admitted=admitMethodTrial(d,options.sourceId,clean.sourceObjectId,clean.acquisition);
      const matches=Object.values(d.observations).filter(o=>o.id!==clean.sourceObjectId&&
        localMethodSource(npc,o.id)&&appearanceCuesMatch(o.appearance,clean.transfer.cues));
      if(admitted&&matches.length===1){
        clean.transfer.targetObjectId=matches[0].id;
        report.proposed=[{type:clean.acquisition,targetId:matches[0].id},{type:'sample',targetId:matches[0].id}];
      }else{clean.state='unavailable';clean.lastCode='LOCAL_METHOD_UNAVAILABLE';
        // A saturated ledger cannot retain a new executable transfer identity.
        if(!admitted&&!d.methodTrials?.some(t=>t.senderId===options.sourceId&&t.sourceObjectId===clean.sourceObjectId&&t.acquisition===clean.acquisition))delete clean.transfer;
      }
    }else{
      delete clean.transfer;
      if(d.observations[clean.sourceObjectId])report.proposed=[{type:clean.acquisition,targetId:clean.sourceObjectId},{type:'sample',targetId:clean.sourceObjectId}];
      else{clean.state='unavailable';clean.lastCode='SOURCE_NOT_RECOGNIZED';}
    }
    return report;
  });
}
export function discoveryObservation(npc){
  const d=memory(npc);return {handlingInquiries:handlingInquiries(npc),inquiries:observationalInquiries(npc),observations:Object.values(d.observations).slice(-40),experiments:d.experiments.slice(-24),effects:d.effects.slice(-24),techniques:d.techniques.slice(-16).map(t=>({...t,proficiency:(d.practice[t.steps[0].type]?.successes||0)>=25?'efficient':(d.practice[t.steps[0].type]?.successes||0)>=7?'practiced':'novice'})),reports:d.reports.slice(-16)};
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
// A terrain attempt begins with a sighting or a failed bodily step. Geometry
// remains the arbiter only when the action runs; this policy never probes a
// distant tile for hidden depth, grade, current, or a certified crossing.
function terrainTraversalDecision(npc){
  if(!ozarkPersistentWorldAgent(npc))return null;
  const geometry=ozarkAgentWorld(npc),cells=rememberedCells(npc);
  const nearby=Object.values(cells).filter(cell=>
    cell.scene===npc.scene&&distance(npc.position,cell)>8&&
    distance(npc.position,cell)<=NPC_RULES.tileSize*2&&
    actorLineOfSight(npc,npc.position,cell));
  const events=npc.memory.experience.filter(event=>event.type==='action'&&
    event.at<=npc.elapsed&&npc.elapsed-event.at<90);
  const attempted=(type,cell,since=0)=>events.some(event=>
    event.at>=since&&event.details.action?.type===type&&
    event.details.action?.target?.x===cell.x&&
    event.details.action?.target?.y===cell.y);
  const felt=geometry.observe(npc.position).ground;
  if(felt==='deep-water'||felt==='deep-pond'){
    const strain=bodySignals(npc),exhausted=['winded','exhausted'].includes(strain.stamina)||
      strain.energy==='depleted'||strain.pain==='severe';
    const lastMotion=[...events].reverse().find(event=>
      ['move','swim'].includes(event.details.action?.type)&&
      distance(event.details.startPosition||npc.position,event.details.position||npc.position)>20);
    if(lastMotion&&!exhausted){
      const from=lastMotion.details.startPosition,to=lastMotion.details.position;
      const heading={x:to.x-from.x,y:to.y-from.y};
      const length=Math.hypot(heading.x,heading.y);
      const onward=nearby.filter(cell=>{
        const dx=cell.x-npc.position.x,dy=cell.y-npc.position.y;
        return (dx*heading.x+dy*heading.y)/Math.max(1,Math.hypot(dx,dy)*length)>.72&&
          !attempted('swim',cell,npc.elapsed-20);
      }).sort((a,b)=>
        ((b.x-npc.position.x)*heading.x+(b.y-npc.position.y)*heading.y)-
        ((a.x-npc.position.x)*heading.x+(a.y-npc.position.y)*heading.y))[0];
      if(onward)return {action:{type:'swim',target:{x:onward.x,y:onward.y}},reason:'My last bodily movement carried me this way through water; another visible patch continues that heading.',need:'safety'};
    }
    const visibleDry=Object.values(cells).filter(cell=>cell.scene===npc.scene&&
      ['dry-ground','visible-divide'].includes(cell.terrain)&&distance(npc.position,cell)<=NPC_RULES.visionRadius&&
      actorLineOfSight(npc,npc.position,cell)).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position));
    const shore=visibleDry[0];
    if(shore){
      const toward=nearby.filter(cell=>distance(cell,shore)<distance(npc.position,shore)-12&&
        !attempted('swim',cell,npc.elapsed-20)).sort((a,b)=>distance(a,shore)-distance(b,shore))[0];
      if(toward)return {action:{type:'swim',target:{x:toward.x,y:toward.y}},reason:'I feel deep water under me and can see a nearer patch toward the bank.',need:'safety'};
    }
  }
  const blocked=[...events].reverse().find(event=>event.details.action?.type==='move'&&
    event.details.result?.code==='ROUTE_BLOCKED'&&event.details.result?.blockedTarget);
  if(blocked){
    const target=blocked.details.result.blockedTarget,cell=nearby.find(c=>c.x===target.x&&c.y===target.y);
    if(cell&&['surface-water','internal-pond','visible-divide'].includes(cell.terrain)){
      const type=['surface-water','internal-pond'].includes(cell.terrain)?'swim':'climb';
      if(!attempted(type,cell,blocked.at))return {action:{type,target:{x:cell.x,y:cell.y}},reason:type==='swim'?
        'My walking step met resistance at visible water; I can try moving through it with a swim.':
        'My walking step met firm resistance; I can try the observed slope with a climb.',need:'understanding'};
    }
  }
  if(npc.learning&&['shallow-water','deep-water','deep-pond'].includes(felt)){
    const experiencedSwim=events.some(event=>event.details.action?.type==='swim'&&
      event.details.result?.ok&&event.details.result?.movement?.traversal==='swimming');
    if(experiencedSwim){
      const next=nearby.filter(cell=>['surface-water','internal-pond'].includes(cell.terrain)&&
        !attempted('swim',cell,npc.elapsed-45)).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];
      if(next)return {action:{type:'swim',target:{x:next.x,y:next.y}},reason:'A previous swim actually moved me through water; I can try another visible water patch.',need:'understanding'};
    }
  }
  // A first water or visible divide attempt is curiosity, not a promised
  // crossing or an inherited skill. Admission and swept collision decide it.
  const hasTerrainResult=events.some(event=>['swim','climb'].includes(event.details.action?.type));
  const untried=hasTerrainResult?null:nearby.filter(cell=>
    ['surface-water','internal-pond','visible-divide'].includes(cell.terrain)&&
    !attempted(cell.terrain==='visible-divide'?'climb':'swim',cell,npc.elapsed-90))
    .sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];
  if(untried){
    const type=untried.terrain==='visible-divide'?'climb':'swim';
    return {action:{type,target:{x:untried.x,y:untried.y}},reason:type==='swim'?
      'I can see nearby water and cautiously test moving through it.':
      'I can see a nearby divide and cautiously test climbing it.',need:'understanding'};
  }
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
    if(typeof trial.lastOk==='boolean')return !trial.lastOk&&(['OBJECT_GONE','nothing_detached'].includes(trial.lastCode)?availabilityBlocked(npc,type,id):npc.elapsed-trial.lastAt<60);
    if(trial.lastAt>(recent?.at??-1))return false;
  }
  return Boolean(recent&&!recent.ok&&(['OBJECT_GONE','nothing_detached'].includes(recent.code)?availabilityBlocked(npc,type,id):npc.elapsed-recent.at<60));
}
function availabilityBlocked(npc,type,id){
  const d=memory(npc),sight=firsthandSightings.get(npc)?.get(id),object=d.observations[id];
  // A visibly bare object has no exposed parts to pull. This is perception, not nutrition.
  if(type==='pull'&&ozarkFiniteAquaticAgent(npc)&&object?.count===0)return true;
  const cache=availabilityScans.get(npc);let failure=cache?.get(id);
  if(!failure){
    let gone=-1,depleted=-1;
    const consider=(at,code,primitive,ok)=>{
      // An old aggregate with no matched result is uncertainty, not proof of a
      // failure. Pausing autonomous retries until another sight is conservative;
      // it does not turn that code into a learned outcome or alter validation.
      if(ok===true||!Number.isFinite(at)||at>npc.elapsed)return;
      if(code==='OBJECT_GONE')gone=Math.max(gone,at);
      if(code==='nothing_detached'&&primitive==='pull')depleted=Math.max(depleted,at);
    };
    for(const primitive of DISCOVERY_RULES.allPrimitives){
      const trial=d.trials?.[`${id}|${primitive}`];
      if(trial)consider(trial.lastAt,trial.lastCode,primitive,trial.lastOk);
    }
    for(const experiment of d.experiments)if(experiment.targetId===id)consider(experiment.at,experiment.code,experiment.primitive,experiment.ok);
    failure={gone,depleted};cache?.set(id,failure);
  }
  const {gone,depleted}=failure;
  if(gone<0&&(type!=='pull'||depleted<0))return false;
  const directlySeen=object&&sight&&sight.scene===npc.scene&&object.scene===sight.scene&&
    object.observedAt===sight.at&&object.count===sight.count&&
    object.position.x===sight.position.x&&object.position.y===sight.position.y&&
    Number.isFinite(sight.at)&&sight.at<=npc.elapsed;
  if(!directlySeen)return true;
  return sight.at<=gone||type==='pull'&&depleted>=0&&(sight.at<=depleted||!(sight.count>0));
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
// Only the prior-piece acquisition delay is relaxed. Each next piece still
// earns its own sampling outcomes, and every pending digestion remains intact.
function finishedSourceMaterial(npc,acquired,technique){
  const d=memory(npc),id=acquired.materialId;
  if(acquired.ok!==true||acquired.targetId!==technique.sourceId||technique.confidence!=='supported'||acquired.primitive!==technique.steps[0]?.type||
    npc.inventory.items.includes(id)||priorAdverseSource(d,technique.sourceId)||
    d.effects.some(e=>e.objectId===id&&(e.effect==='discomfort'||['aching','hurting'].includes(e.pain))))return false;
  const actionMatches=e=>npc.memory.experience.some(r=>r.id===e.actionId&&r.type==='action'&&r.at===e.at&&
    r.details.action?.type===e.primitive&&r.details.action.targetId===e.targetId&&
    r.details.result?.ok===e.ok&&r.details.result.code===e.code&&
    (r.details.result.materialId||undefined)===(e.materialId||undefined)&&
    (r.details.result.ingestionId||undefined)===(e.ingestionId||undefined));
  if(!actionMatches(acquired))return false;
  const finish=d.experiments.find(e=>e.targetId===id&&e.finishedMaterial===true&&
    e.id>acquired.id&&e.at>=acquired.at&&e.at===d.samplesPending[id]&&witnessedMaterialCompletion(npc,e));
  if(!finish||sampleAcquisition(d,finish)!==acquired||d.experiments.some(e=>e.targetId===id&&e.id>finish.id&&['sample','grasp','release','catch'].includes(e.primitive)))return false;
  const portions=new Set(d.effects.filter(effect=>effect.objectId===id&&effect.effect==='sustained'&&
    effect.source==='experienced'&&conditionMatches(npc.memory.experience.find(r=>r.id===effect.proofEventId),effect)&&
    d.experiments.some(sample=>sample.primitive==='sample'&&sample.ok&&sample.targetId===id&&
      sample.id>acquired.id&&sample.id<=finish.id&&sample.at>=acquired.at&&sample.ingestionId===effect.ingestionId&&
      sample.actionId===effect.actionId&&effect.at>=sample.at&&actionMatches(sample))).map(e=>e.ingestionId));
  return portions.size>=2;
}
function sampleEligible(npc,id,body=bodySignals(npc),foodLearning=true){
  const d=memory(npc);
  if(experiencedFoodSourceCaution(npc,id))return false; // Own exact-source caution also protects generic/ablated sampling.
  if(availabilityBlocked(npc,'sample',id)||samplingBlocked(npc,body)||d.effects.some(e=>e.objectId===id&&(e.effect==='discomfort'||['aching','hurting'].includes(e.pain)))||receivedMaterialCaution(npc,id))return false;
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
  if(!id){d.run=null;return null;}
  if(availabilityBlocked(npc,step.type,id)){d.run=null;return null;}
  if(recentlyFailed(npc,step.type,id)||step.type==='sample'&&!sampleEligible(npc,id))return null;const object=d.observations[id];
  if(!npc.inventory.items.includes(id)&&object&&distance(npc.position,object.position)>DISCOVERY_RULES.reach){const move=routeTarget(npc,object.position);if(move)return markNpcRunTravel(npc,move);d.run=null;return null;}
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
export function discoveryDecision(npc,{foodLearning=true,handlingCuriosity=true}={}){
  processDiscoveryFeedback(npc,{foodLearning});availabilityScans.set(npc,new Map());const d=memory(npc),body=bodySignals(npc),senses=sensedEnvironment(npc);
  const restDeferred=deferRestRetry(npc,body),depletedAfterRefusal=restDeferred&&body.energy==='depleted';
  const trialHunger=['hungry','ravenous','faint with hunger'].includes(body.hunger);
  // Evaluation can ablate positive food associations without erasing perception,
  // navigation, practice, novelty, failures, or experienced discomfort.
  if(!foodLearning)d.run=null;
  const wrap=(action,reason,need='understanding')=>{
    const retreat=recoveryChoice(npc,action,need);
    return {action:retreat||action,reason:retreat?'My attempted walk did not make progress. I can cautiously retrace a short part of my own recent path before choosing another route.':reason,need,provider:'discovery-learner'};
  };
  const escape=contactEscape(npc);if(escape)return wrap(escape.action,'A contact I actually experienced hurt; I can move away through terrain I observed.','safety');
  const thirsty=['thirsty','parched','desperate thirst'].includes(body.thirst)||
    ozarkPersistentWorldAgent(npc)&&body.thirst==='dry mouth';
  if(thirsty&&npc.flask.water>0)return wrap({type:'drink'},'My thirst is asking for remembered water relief.','water');
  if(thirsty&&npc.scene==='valley'){
    const sources=Object.values(npc.memory.sources).filter(s=>s.available!==false&&(s.retryAfter||0)<=npc.elapsed).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position));
    for(const source of ozarkPersistentWorldAgent(npc)?sources:sources.slice(0,1)){
      if(distance(source,npc.position)<=NPC_RULES.collectionRange)return wrap({type:'fill_flask',sourceId:source.id},'I can reach the water I actually observed.','water');
      const move=routeTarget(npc,source);if(move){
        // Do not let a remembered-water walk bypass an existing local safety action.
        const safety=terrainTraversalDecision(npc);
        if(safety?.need==='safety')return wrap(safety.action,safety.reason,'safety');
        return wrap(move,'I am approaching remembered water.','water');
      }
    }
  }
  const dangerous=body.thermal.startsWith('dangerously')||['overheated','shivering'].includes(body.thermal);
  if(dangerous&&npc.scene==='valley'){
    const refuge=Object.values(npc.memory.shelters).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];if(refuge){if(distance(refuge,npc.position)<=100)return wrap({type:'enter_shelter',shelterId:refuge.id},'Exposure hurts; the observed opening may provide cover.','thermal');const move=routeTarget(npc,refuge);if(move)return wrap(move,'I am moving toward an observed opening.','thermal');}
  }
  if(npc.scene!=='valley'&&(!dangerous||body.thirst==='desperate thirst'||body.hunger==='faint with hunger')&&(thirsty||['hungry','ravenous','faint with hunger'].includes(body.hunger))){const exit=npc.memory.caveExits?.[npc.scene];if(exit){if(distance(npc.position,exit)<100)return wrap({type:'exit_shelter'},'My body needs something outside this refuge.','survival');const move=routeTarget(npc,exit);if(move)return wrap(move,'I remember this route toward the opening.','survival');}}
  const waterEscape=terrainTraversalDecision(npc);
  if(waterEscape?.need==='safety')return wrap(waterEscape.action,waterEscape.reason,'safety');
  if(foodLearning&&(['ravenous','faint with hunger'].includes(body.hunger)||depletedAfterRefusal)&&!samplingBlocked(npc,body)){
    if(depletedAfterRefusal){const unfinished=unfinishedHeldTrial(npc,body);if(unfinished)return wrap(unfinished,'I still hold the result of an operation sequence I previously tested; I can cautiously finish its first sampling trial before acquiring more.','food');}
    const carried=npc.inventory.items.find(id=>d.effects.some(e=>e.objectId===id&&e.effect==='sustained')&&sampleEligible(npc,id,body,foodLearning));
    if(carried)return wrap({type:'sample',targetId:carried},depletedAfterRefusal?'Rest was refused while I felt depleted; a previous portion of this held material brought relief, so I can test another.':'My hunger is urgent, and a previous portion of this held material brought relief; I can test another before resting.','food');
    if(trialHunger&&!d.run){const unfinished=unfinishedHeldTrial(npc,body);if(unfinished)return wrap(unfinished,'I already hold the result of a learned operation sequence; I can cautiously test its first portion before acquiring more.','food');}
    const reason=depletedAfterRefusal?'Rest was refused while I felt depleted; I can try an observed route and operation sequence that previously brought bodily relief.':'My hunger is urgent; I can test a nearby operation sequence that previously brought relief before resting.';
    if(d.run){const action=learnedStep(npc);if(action)return wrap(action,reason,'food');}
    if(!d.run&&npc.inventory.items.length<DISCOVERY_RULES.capacity){
      const candidates=d.techniques.filter(t=>t.confidence!=='revised'&&t.failures<=t.successes+2&&!recentlyFailed(npc,t.steps[0].type,t.sourceId)&&!availabilityBlocked(npc,t.steps[0].type,t.sourceId)&&d.observations[t.sourceId]?.scene===npc.scene&&(depletedAfterRefusal||distance(npc.position,d.observations[t.sourceId].position)<=DISCOVERY_RULES.reach));
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
  // Appetite is not fuel: a content stomach can coexist with waning energy.
  // Necessary sleep/rest and immediate safety have already been considered.
  const energyFoodNeed=['waning','low','depleted'].includes(body.energy);
  const hungry=foodLearning&&(body.hunger!=='content'||energyFoodNeed)&&!samplingBlocked(npc,body);
  const knownHeld=npc.inventory.items.find(id=>d.effects.some(e=>e.objectId===id&&e.effect==='sustained')&&sampleEligible(npc,id,body,foodLearning));
  if(hungry&&knownHeld)return wrap({type:'sample',targetId:knownHeld},energyFoodNeed?'My energy feels diminished; an earlier portion of this held object brought relief, so I can test another portion.':'An earlier portion of this held object brought bodily relief; I can test another portion.','food');
  if(hungry&&(trialHunger||energyFoodNeed)&&!d.run){const unfinished=unfinishedHeldTrial(npc,body);if(unfinished)return wrap(unfinished,'I already hold the result of a learned operation sequence; I can cautiously test its first portion before acquiring more.','food');}
  if(hungry&&!d.run&&npc.inventory.items.length<DISCOVERY_RULES.capacity){
    const candidates=d.techniques.filter(t=>t.confidence!=='revised'&&t.failures<=t.successes+2&&!recentlyFailed(npc,t.steps[0].type,t.sourceId)&&!availabilityBlocked(npc,t.steps[0].type,t.sourceId)&&d.observations[t.sourceId]?.scene===npc.scene&&!d.experiments.some(e=>e.materialId&&e.targetId===t.sourceId&&d.samplesPending[e.materialId]!==undefined&&npc.elapsed-d.samplesPending[e.materialId]<DISCOVERY_RULES.feedbackWaitSeconds&&!finishedSourceMaterial(npc,e,t))).sort((a,b)=>a.failures-b.failures||distance(d.observations[a.sourceId].position,npc.position)-distance(d.observations[b.sourceId].position,npc.position));
    for(const technique of candidates){
      d.run={techniqueId:technique.id,cursor:0,materialId:null,awaiting:false,startedAt:npc.elapsed};
      const action=learnedStep(npc);
      if(action)return wrap(action,'Past sampling of this object was followed by sustained bodily relief; I can test whether it happens again.','food');
      // A source without an observed route must not conceal another earned source.
      if(d.run)break;
    }
  }
  // Once immediate bodily care has been considered, a dry mouth without an
  // accessible remembered source motivates a bounded firsthand survey.
  // Unverified reports cannot point it toward a claimed water location.
  if(ozarkPersistentWorldAgent(npc)&&npc.scene==='valley'&&npc.flask.water<=0&&
     body.thirst!=='quenched'&&(!['ravenous','faint with hunger'].includes(body.hunger)||
       ['parched','desperate thirst'].includes(body.thirst))){
    const frontier=explorationFrontier(npc,{reportedHints:false});
    if(frontier)return wrap({type:'move',target:frontier.target},
      'My mouth is dry; I can search another edge of ground I have actually seen.','water');
  }
  const traversal=waterEscape||terrainTraversalDecision(npc);
  if(traversal&&(!ozarkFiniteAquaticAgent(npc)||traversal.need!=='understanding'))return wrap(traversal.action,traversal.reason,traversal.need);
  for(const report of d.reports.filter(r=>r.status==='unverified'&&r.cursor<r.proposed.length&&(r.sourceId==='human'||isPeerTeaching(r)&&r.teaching.state==='ready'&&!teachingExpired(r,npc.elapsed)))){
    const step=report.proposed[report.cursor],object=d.observations[step.targetId],held=npc.inventory.items.includes(object?.id),peer=isPeerTeaching(report);
    if(peer&&report.teaching.transfer){
      const source=report.teaching.transfer.targetObjectId;
      if(priorAdverseSource(d,source)||priorAdverseSource(d,report.teaching.sourceObjectId)||
        ['full','overfull'].includes(body.digestion)||['winded','exhausted'].includes(body.stamina)||body.energy==='depleted'||['aching','hurting','severe'].includes(body.pain))continue;
      // No remote approach, target substitution or stale save-derived binding.
      if(report.cursor===0&&(!localMethodSource(npc,source)||!appearanceCuesMatch(d.observations[source]?.appearance,report.teaching.transfer.cues)))continue;
    }
    if(peer&&(['pull','grasp'].includes(step.type)&&npc.inventory.items.length>=DISCOVERY_RULES.capacity||d.effects.some(e=>e.objectId===step.targetId&&e.effect==='discomfort')||d.techniques.some(t=>t.sourceId===(report.teaching.transfer?.targetObjectId||report.teaching.sourceObjectId)&&t.confidence==='revised')))continue;
    if(discoveryPrimitives(npc).includes(step.type)&&!availabilityBlocked(npc,step.type,step.targetId)&&(object?.scene===npc.scene||held)&&(step.type!=='sample'||held&&sampleEligible(npc,step.targetId,body,foodLearning))){
      const author=peer?report.sourceId:'a human';
      if(distance(object.position,npc.position)<=DISCOVERY_RULES.reach||held)return wrap(step,peer&&report.teaching.transfer?`I can cautiously try ${author}'s reported method on this similar-looking local source; appearance is not proof of safety or benefit.`:`I can try the procedure taught by ${author}; its benefit is reported, not my own experience.`);
      const move=routeTarget(npc,object.position);if(move)return wrap(move,`I can approach a source I recognize to try ${author}'s reported procedure.`);
    }
  }
  const inquiry=observationalExperiment(npc,{body,currentlySeen:id=>{const o=d.observations[id],s=firsthandSightings.get(npc)?.get(id);return !!s&&s.at===o?.observedAt&&s.scene===npc.scene;},eligible:id=>sampleEligible(npc,id,body,foodLearning),blocked:(type,id)=>recentlyFailed(npc,type,id)||availabilityBlocked(npc,type,id)});
  if(inquiry)return wrap(inquiry,'I saw another body consume from this exact source. A small paid experiment may test its effect on me; the observed act is not proof of benefit.');
  const handling=handlingCuriosity&&handlingExperiment(npc,{body,appearance:id=>freshMethodAppearance(npc,id),local:id=>localMethodSource(npc,id),blocked:(type,id)=>recentlyFailed(npc,type,id)||availabilityBlocked(npc,type,id)});
  if(handling)return wrap(handling,HANDLING_QUESTION);
  const objects=Object.values(d.observations).filter(o=>(o.scene===npc.scene||npc.inventory.items.includes(o.id))&&o.observedAt<=npc.elapsed&&npc.elapsed-o.observedAt<8&&(npc.inventory.items.includes(o.id)||actorLineOfSight(npc,npc.position,o.position)));
  const choices=[];
  for(const object of objects){
    const held=npc.inventory.items.includes(object.id),near=held||distance(npc.position,object.position)<=DISCOVERY_RULES.reach;
    if(!near)continue;
    for(const type of discoveryPrimitives(npc)){
      if(['release','sample'].includes(type)&&!held)continue;
      if(['grasp','catch'].includes(type)&&held)continue;
      if(type==='pull'&&held&&!ozarkFiniteAquaticAgent(npc))continue;
      if(['grasp','pull','catch'].includes(type)&&npc.inventory.items.length>=DISCOVERY_RULES.capacity)continue;
      if(type==='catch'&&!recentDiscoveryAim(npc,object.id))continue;
      const trial=d.trials?.[`${object.id}|${type}`]||{attempts:0,failures:0,lastAt:0,lastCode:''},failures=trial.failures;
      if(recentlyFailed(npc,type,object.id)||availabilityBlocked(npc,type,object.id))continue;
      if(type==='sample'&&!sampleEligible(npc,object.id,body,foodLearning))continue;
      const novelty=8/(1+trial.attempts);
      choices.push({action:{type,targetId:object.id},score:novelty-failures*3+(type==='inspect_object'&&!trial.attempts?1:0)+random(npc)*(trial.attempts?.2:2)});
    }
  }
  // Only optional terrain curiosity yields to generic nearby body operations
  // in the new feature. Safety escapes and bodily care already returned above;
  // no target kind, food benefit or catch-specific score participates here.
  if(traversal&&!choices.length)return wrap(traversal.action,traversal.reason,traversal.need);
  // Movement competes with object trials. Repeatedly striking/inspecting a familiar
  // patch cannot block an unfamiliar nearby object or a remembered frontier forever.
  const targets=objects.filter(o=>distance(o.position,npc.position)>DISCOVERY_RULES.reach&&!availabilityBlocked(npc,'inspect_object',o.id)).map(o=>({o,score:5/(1+Object.entries(d.trials||{}).filter(([key])=>key.startsWith(`${o.id}|`)).reduce((sum,[,t])=>sum+t.attempts,0))-distance(o.position,npc.position)/1500+random(npc)})).sort((a,b)=>b.score-a.score);
  for(const target of targets.slice(0,4)){const move=routeTarget(npc,target.o.position);if(move)choices.push({action:move,score:target.score,reason:'I can approach an unfamiliar object within my observed map.'});}
  if(npc.scene==='valley'){
    // Exploration stays local to observed terrain and bounded actions, not the first observation's coordinates.
    const cells=Object.values(rememberedCells(npc)),candidate=cells.filter(c=>c.walkable&&distance(c,npc.position)>150&&distance(c,npc.position)<900).map(c=>({c,score:(c.visits||0)*-3+random(npc)*8})).sort((a,b)=>b.score-a.score);
    for(const {c} of candidate.slice(0,8)){const move=routeTarget(npc,c);if(move){choices.push({action:move,score:2.5/(1+(c.visits||0))+random(npc),reason:'I can investigate another locally observed patch of terrain.'});break;}}
  }
  if(choices.length){const selected=choices.sort((a,b)=>b.score-a.score)[0];return wrap(selected.action,selected.reason||'An unfamiliar object and an untested body operation offer an experiment; I do not yet know the consequence.');}
  return wrap({type:'wait',seconds:5},'I am allowing time for changes and sensations before another bounded experiment.');
}
