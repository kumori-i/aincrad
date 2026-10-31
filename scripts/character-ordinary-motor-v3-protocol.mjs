/** A distinct, once-only ordinary observation of the neutral paid motor action.
 * V1's clock, sampling cadence and evidence caps remain the physical contract.
 * This module only reads and validates observations; it cannot start the world. */
import {
  CHARACTER_ORDINARY_PILOT_PROTOCOL as V1,
  validateCharacterPilotProjection as validateV1Projection,
  createCharacterPilotTracker as createV1Tracker,
} from './character-ordinary-pilot-protocol.mjs';

export {CHARACTER_PILOT_COUNT_KEYS,readCharacterPilotClock,
  validateCharacterPilotClock,createCharacterPilotSchedule,
  createCharacterPilotBudget,boundedCharacterPilotTerminal}
  from './character-ordinary-pilot-protocol.mjs';

export const CHARACTER_ORDINARY_PILOT_PROTOCOL=Object.freeze({...V1,
  id:'ordinary-character-motor-observation-v3',
  activationRef:'experiments/character-motor-observation-v3-once',
  receiptRef:'experiments/character-motor-observation-v3-receipt',
  workflow:'Ordinary character-motor observation v3 — approved once',
});

/** Serialized into the renderer before normal start. This duplicates v1's
 * strict fresh-world checks because a serialized function has no imports, then
 * checks the new session-only observer state without exposing private rows. */
export function guardFreshCharacterMotorPilot(expected){
  const fail=message=>{throw new Error('Fresh character motor guard: '+message);};
  const q=window.__ozarkWorld;
  if(window.location?.href!=='aincrad://app/index.html?test=1'||!q||
      typeof q.communicationMeasurementSnapshot!=='function'||
      typeof q.communicationSnapshot!=='function'||
      typeof q.fullSnapshot!=='function')fail('wrong main-world test route');
  if(window.localStorage.length!==0||
      window.localStorage.getItem('aincrad.world.v2')!==null)fail('occupied disposable profile');
  const s=q.snapshot(),w=q.fullSnapshot(),m=q.communicationMeasurementSnapshot(),
    reference=q.communicationSnapshot();
  if(s.version!==12||s.blocked!==false||s.started!==false||s.paused!==false||
      s.elapsed!==0||w.elapsed!==0||q.referenceFixtureState()!==null||
      Number(document.getElementById('simulation-speed')?.value)!==1)
    fail('nonfresh or nonordinary clock');
  const features=s.features;
  if(!features||Reflect.ownKeys(features).length!==4||
      features.plantLifecycle!==1||features.finiteAquatic!==2||
      features.worldStructures!==1||features.characterMessages!==2)
    fail('current feature marker');
  if(w.geometryIdentity!==expected.geometryIdentity||w.environment?.seed!==expected.worldSeed||
      w.visualReference?.seed!==expected.communicationSeed||
      m?.seed!==expected.communicationSeed||reference?.seed!==expected.communicationSeed||
      m?.phase!==expected.phase||reference?.phase!==expected.phase||
      reference.enabled!==true||m.version!==1||
      m.limits?.eventRows!==expected.maxEvents||
      m.limits?.censorReasons!==expected.maxCensorReasons||
      m.limits?.counter!==expected.counter||
      m.limits?.admissionGates!==expected.maxGateKeys)
    fail('world or communication source');
  if(w.environment?.elapsed!==0||w.environment?.ecology?.elapsed!==0||
      w.environment?.ecology?.pending!==0||m.elapsed!==0||m.pending!==0||
      m.identityPendingReconciliation!==false||m.saturated!==false||
      m.eventsEvicted!==0||m.eventsRetired!==0||m.reasonOverflow!==0||
      m.admissionGateKeysOmitted!==0||m.events?.length!==0||
      m.reasons?.length!==0||Object.keys(m.admissionGates||{}).length!==0||
      !m.counts||Object.keys(m.counts).length!==21||
      Object.values(m.counts).some(value=>value!==0))
    fail('nonzero observer state');
  const ids=['aster','mira'],lineage=w.worldLineage;
  if(!Array.isArray(w.agents)||w.agents.length!==2||
      !Array.isArray(m.actors)||m.actors.length!==2||
      !Array.isArray(reference.learners)||reference.learners.length!==2||
      !Array.isArray(w.visualReference?.learners)||w.visualReference.learners.length!==2||
      !Array.isArray(w.characterMessages?.learners)||w.characterMessages.learners.length!==2||
      lineage?.nextSerial!==3||lineage.agents?.length!==2)fail('fresh individual count');
  const zeroScores=score=>score&&['model','prior','persistence'].every(key=>
    score[key]?.brier===0&&score[key]?.logLoss===0);
  for(let index=0;index<2;index++){
    const id=ids[index],partner=ids[1-index],serial=index+1,
      actor=w.agents[index],measured=m.actors[index],legacy=reference.learners[index],
      savedLegacy=w.visualReference.learners[index],savedCharacter=w.characterMessages.learners[index],
      savedPartner=savedCharacter?.partners?.[0],bank=measured?.character?.partnerBanks?.[0],
      hand=measured?.freeHandObserver,memory=measured?.gestureMemory,
      predictor=measured?.gesturePrediction;
    if(actor?.id!==id||actor.elapsed!==0||actor.epoch!==0||actor.active!==null||
        lineage.agents[index]?.agentId!==id||
        lineage.agents[index]?.serial!==serial||measured?.id!==id||
        measured.identity!==serial||legacy?.agentId!==id||legacy.identity!==serial||
        savedLegacy?.agentId!==id||savedLegacy.serial!==serial||
        savedLegacy.anchors?.length!==0||savedLegacy.partners?.length!==0||
        Object.values(legacy.counts||{}).some(value=>value!==0)||
        savedCharacter?.agentId!==id||savedCharacter.serial!==serial||
        savedCharacter.sender?.emissions!==0||savedCharacter.sender?.updates!==0||
        savedCharacter.sender?.revision!==0||savedCharacter.sender?.baseline!==0||
        savedCharacter.partners?.length!==1||savedPartner.agentId!==partner||
        savedPartner.serial!==3-serial||savedPartner.listener?.demonstrations!==0||
        savedPartner.listener?.optimizerSteps!==0||savedPartner.listener?.replayUses!==0||
        savedPartner.listener?.examples?.length!==0||
        measured.character.senderUpdates!==0||measured.character.listenerUpdates!==0||
        measured.character.uniqueDemonstrations!==0||measured.character.replayUses!==0||
        measured.character.partnerBanks?.length!==1||bank.partnerId!==partner||
        bank.partnerSerial!==3-serial||bank.retainedExamples!==0||bank.trained!==false)
      fail('trained, replaced or nonfresh individual');
    if(!hand||hand.decisionChecks!==0||hand.eligibleDecisions!==0||
        hand.selectedAttempts!==0||hand.visibleSamples!==0||
        hand.sampleCounts?.unknown!==0||hand.sampleCounts.absent!==0||
        hand.sampleCounts.pose!==0||hand.sessionResets!==0||
        hand.saturated!==false||!Number.isFinite(hand.nextEligibleAt)||
        hand.nextEligibleAt<120||hand.nextEligibleAt>120+1e-8||
        !memory||memory.retained!==0||memory.overflows!==0||
        memory.expirations!==0||memory.limits?.capacity!==768||
        memory.limits.ttlSeconds!==12||memory.sessionResets!==0||
        memory.saturated!==false||!predictor||predictor.pending!==false||
        predictor.forecasts!==0||predictor.validTargets!==0||
        predictor.updates!==0||predictor.censoredUnknown!==0||
        predictor.censoredGap!==0||predictor.targetPose!==0||
        predictor.targetAbsent!==0||predictor.onsets!==0||
        predictor.offsets!==0||predictor.stablePose!==0||
        predictor.stableAbsent!==0||!zeroScores(predictor.scores)||
        !zeroScores(predictor.scoresByTarget?.pose)||
        !zeroScores(predictor.scoresByTarget?.absent)||
        predictor.limits?.horizonTicks!==30||
        predictor.limits?.maximumUpdatesPerSecond!==2||
        predictor.limits?.replayCapacity!==0||
        predictor.sessionResets!==0||predictor.saturated!==false)
      fail('nonzero motor observer or predictor state');
  }
  if(!Array.isArray(m.survival)||m.survival.length!==2||
      m.survival.some(row=>row.recordsRetained!==0||
        Object.values(row.counters||{}).some(value=>value!==0)))
    fail('nonzero survival observer');
  return {ready:true,elapsed:0,worldSeed:expected.worldSeed,
    communicationSeed:expected.communicationSeed,
    individuals:ids.map((id,index)=>({id,serial:index+1,trained:false}))};
}

const stripMotor=sample=>Object.fromEntries(Object.entries(sample).filter(([key])=>key!=='motor'));
const SCORE_KEYS=['model','prior','persistence'];
const SCORE_FIELDS=['brier','logLoss'];
const PREDICTION_COUNTS=['forecasts','validTargets','updates','censoredUnknown',
  'censoredGap','targetPose','targetAbsent','onsets','offsets','stablePose','stableAbsent'];
const FREE_COUNTS=['decisionChecks','eligibleDecisions','selectedAttempts','visibleSamples'];
const MEMORY_COUNTS=['retained','overflows','expirations'];

/** Serialized into the renderer. Both snapshots are captured exactly once,
 * after the sole import, so the base fields and motor sidecar share one moment.
 * The explicit allowlist does not export private rows, weights or object IDs. */
export async function projectCharacterPilot(){
  const {CONFIG}=await import('./src/config.js');
  const q=window.__ozarkWorld,w=q.fullSnapshot(),m=q.communicationMeasurementSnapshot();
  if(!m)throw new Error('Character motor observation unavailable');
  const countKeys=[
    'optionalChecks','feasibleOpportunities','emissions','paidInspectionStarts',
    'paidInspectionCompletions','paidInspectionOutcomeUnavailable',
    'paidReplyStarts','paidReplyCompletions','paidReplyOutcomeUnavailable',
    'canonicalDemonstrations','criticCorrect','validListenerDemonstrations',
    'ambiguousListenerLabels','rejectedListenerLabels','listenerReplayUses',
    'listenerOptimizerSteps','visualMatches','visualMismatches','senderUpdates',
    'originalCensors','responseCensors',
  ];
  const numeric=(object,keys)=>Object.fromEntries(keys.map(key=>
    [key,Number.isFinite(object?.[key])?object[key]:null]));
  const count=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object?.[key]??null]));
  const actorBodyKeys=['health','satietyHours','availableEnergyKcal','storedEnergyKcal',
    'waterDeficitMl','stamina','fatigue','sleepPressure','hoursSinceMeal','starvationHours'];
  const survivalCountKeys=['begun','finished','incomplete','superseded',
    'evictedRecords','droppedNotes','rejectedNotes'];
  const eventKeys=['id','emittedAt','endedAt','senderId','receiverId','message',
    'action','choiceMode','status','reason','correction','feedbackStatus',
    'feedbackReason','referenceCorrect','listenerReplayUses','listenerUpdate',
    'senderUpdate','selectedActionId','indicationActionId','responseActionId'];
  const score=source=>Object.fromEntries(['model','prior','persistence'].map(key=>
    [key,{brier:source?.[key]?.brier??null,logLoss:source?.[key]?.logLoss??null}]));
  const motorActor=actor=>{
    const measured=m.actors?.find(row=>row.id===actor.id),
      free=measured?.freeHandObserver,memory=measured?.gestureMemory,
      prediction=measured?.gesturePrediction;
    return {id:actor.id,identity:measured?.identity??null,epoch:actor.epoch,
      freeHandObserver:free?{
        decisionChecks:free.decisionChecks??null,
        eligibleDecisions:free.eligibleDecisions??null,
        selectedAttempts:free.selectedAttempts??null,
        visibleSamples:free.visibleSamples??null,
        nextEligibleAt:free.nextEligibleAt??null,
        sampleCounts:count(free.sampleCounts,['unknown','absent','pose']),
        sessionResets:free.sessionResets??null,saturated:free.saturated??null}:null,
      gestureMemory:memory?{
        retained:memory.retained??null,overflows:memory.overflows??null,
        expirations:memory.expirations??null,
        limits:{capacity:memory.limits?.capacity??null,
          ttlSeconds:memory.limits?.ttlSeconds??null},
        sessionResets:memory.sessionResets??null,
        saturated:memory.saturated??null}:null,
      gesturePrediction:prediction?{
        pending:prediction.pending??null,
        forecasts:prediction.forecasts??null,
        validTargets:prediction.validTargets??null,
        updates:prediction.updates??null,
        censoredUnknown:prediction.censoredUnknown??null,
        censoredGap:prediction.censoredGap??null,
        targetPose:prediction.targetPose??null,
        targetAbsent:prediction.targetAbsent??null,
        onsets:prediction.onsets??null,offsets:prediction.offsets??null,
        stablePose:prediction.stablePose??null,
        stableAbsent:prediction.stableAbsent??null,
        scores:score(prediction.scores),
        scoresByTarget:{pose:score(prediction.scoresByTarget?.pose),
          absent:score(prediction.scoresByTarget?.absent)},
        limits:{horizonTicks:prediction.limits?.horizonTicks??null,
          maximumUpdatesPerSecond:prediction.limits?.maximumUpdatesPerSecond??null,
          replayCapacity:prediction.limits?.replayCapacity??null},
        sessionResets:prediction.sessionResets??null,
        saturated:prediction.saturated??null}:null};
  };
  return {elapsed:w.elapsed,wallMs:Date.now(),version:w.version,
    geometryIdentity:w.geometryIdentity,worldSeed:w.environment?.seed,
    communicationSeed:m.seed,phase:m.phase,fixedStep:CONFIG.fixedStep,
    clocks:{environment:w.environment?.elapsed,ecology:w.environment?.ecology?.elapsed,
      pending:w.environment?.ecology?.pending},
    counts:count(m.counts,countKeys),
    reasons:(m.reasons||[]).slice(0,64).map(row=>({
      kind:row.kind,stage:row.stage,reason:row.reason,count:row.count})),
    reasonOverflow:m.reasonOverflow,eventsRetained:m.eventsRetained,
    eventsEvicted:m.eventsEvicted,eventsRetired:m.eventsRetired,saturated:m.saturated,
    admissionGates:Object.fromEntries(Object.entries(m.admissionGates||{}).slice(0,64)),
    admissionGateKeysOmitted:m.admissionGateKeysOmitted,
    pending:m.pending,identityPendingReconciliation:m.identityPendingReconciliation,
    actors:(w.agents||[]).map(actor=>{
      const measured=m.actors?.find(row=>row.id===actor.id),
        survival=m.survival?.find(row=>row.agentId===actor.id),character=measured?.character;
      return {id:actor.id,identity:measured?.identity??null,epoch:actor.epoch,
        elapsed:actor.elapsed,scene:actor.scene,
        position:{x:actor.position?.x,y:actor.position?.y},
        lifecycle:actor.lifecycle,activeAction:actor.active?.request?.type??null,
        body:numeric(actor.physiology,actorBodyKeys),
        totals:numeric(actor.physiology?.totals,['ingestedKcal','absorbedKcal','metabolizedKcal']),
        stats:numeric(actor.stats,['collapses','rescues','independentMeals','independentDrinks']),
        character:character?{senderUpdates:character.senderUpdates,
          listenerUpdates:character?.listenerUpdates??null,
          uniqueDemonstrations:character?.uniqueDemonstrations??null,
          replayUses:character?.replayUses??null,
          partnerBanks:(character?.partnerBanks||[]).map(bank=>({
            partnerId:bank.partnerId,partnerSerial:bank.partnerSerial,
            retainedExamples:bank.retainedExamples,trained:bank.trained}))}:null,
        survival:{counters:count(survival?.counters,survivalCountKeys),
          recordsRetained:survival?.recordsRetained??null,
          decisionActive:survival?.decisionActive??null,
          gateCounts:Object.fromEntries(Object.entries(survival?.gateCounts||{}).slice(0,32))}};
    }),
    player:{position:{x:w.player?.x,y:w.player?.y},
      body:numeric(w.playerBody,actorBodyKeys)},
    events:(m.events||[]).slice(0,256).map(row=>Object.fromEntries(
      eventKeys.map(key=>[key,row[key]??null]))),
    motor:{version:1,actors:(w.agents||[]).map(motorActor)}};
}

/** Host validation first applies the exact frozen v1 base validator. */
export function validateCharacterPilotProjection(sample,validateBase=validateV1Projection){
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key));
  const count=value=>Number.isSafeInteger(value)&&value>=0;
  const finite=value=>Number.isFinite(value)&&value>=0&&value<=1e12;
  const max=Number.MAX_SAFE_INTEGER;
  const scoreKeys=['model','prior','persistence'],scoreFields=['brier','logLoss'];
  const predictionCounts=['forecasts','validTargets','updates','censoredUnknown',
    'censoredGap','targetPose','targetAbsent','onsets','offsets','stablePose','stableAbsent'];
  const freeCounts=['decisionChecks','eligibleDecisions','selectedAttempts','visibleSamples'];
  const memoryCounts=['retained','overflows','expirations'];
  if(!sample||typeof sample!=='object'||Array.isArray(sample)||
    !exact(sample.motor,['version','actors'])||sample.motor.version!==1||
    !Array.isArray(sample.motor.actors)||sample.motor.actors.length!==2)
    throw new Error('Invalid motor sidecar');
  const base=Object.fromEntries(Object.entries(sample).filter(([key])=>key!=='motor'));
  validateBase(base);
  const stale=sample.identityPendingReconciliation;
  for(let i=0;i<2;i++){
    const actor=sample.motor.actors[i],base=sample.actors[i];
    if(!exact(actor,['id','identity','epoch','freeHandObserver','gestureMemory',
      'gesturePrediction'])||actor.id!==base.id||actor.identity!==base.identity||
      actor.epoch!==base.epoch)throw new Error('Invalid motor actor lineage');
    if(stale){
      if(actor.freeHandObserver!==null||actor.gestureMemory!==null||
        actor.gesturePrediction!==null)throw new Error('Stale motor identity leaked');
      continue;
    }
    const free=actor.freeHandObserver,memory=actor.gestureMemory,
      predictor=actor.gesturePrediction;
    if(!exact(free,[...freeCounts,'nextEligibleAt','sampleCounts',
        'sessionResets','saturated'])||freeCounts.some(key=>!count(free[key]))||
      !exact(free.sampleCounts,['unknown','absent','pose'])||
      Object.values(free.sampleCounts).some(value=>!count(value))||
      !count(free.sessionResets)||typeof free.saturated!=='boolean'||
      !finite(free.nextEligibleAt)||
      free.eligibleDecisions>free.decisionChecks||
      free.selectedAttempts>free.eligibleDecisions||
      free.visibleSamples>free.sampleCounts.pose||
      !free.saturated&&[...freeCounts.map(key=>free[key]),
        ...Object.values(free.sampleCounts),free.sessionResets].some(value=>value===max))
      throw new Error('Invalid free-hand observer');
    if(!exact(memory,[...memoryCounts,'limits','sessionResets','saturated'])||
      memoryCounts.some(key=>!count(memory[key]))||
      !exact(memory.limits,['capacity','ttlSeconds'])||
      memory.limits.capacity!==768||memory.limits.ttlSeconds!==12||
      memory.retained>memory.limits.capacity||
      !count(memory.sessionResets)||typeof memory.saturated!=='boolean'||
      !memory.saturated&&[memory.overflows,memory.expirations,
        memory.sessionResets].some(value=>value===max))
      throw new Error('Invalid gesture-memory summary');
    if(!exact(predictor,['pending',...predictionCounts,'scores',
      'scoresByTarget','limits','sessionResets','saturated'])||
      typeof predictor.pending!=='boolean'||
      predictionCounts.some(key=>!count(predictor[key]))||
      predictor.validTargets!==predictor.updates||
      predictor.targetPose+predictor.targetAbsent!==predictor.validTargets||
      predictor.onsets+predictor.offsets+predictor.stablePose+
        predictor.stableAbsent!==predictor.validTargets||
      predictor.validTargets+predictor.censoredUnknown+predictor.censoredGap+
        Number(predictor.pending)!==predictor.forecasts||
      !exact(predictor.scores,scoreKeys)||
      !exact(predictor.scoresByTarget,['pose','absent'])||
      !exact(predictor.limits,['horizonTicks','maximumUpdatesPerSecond',
        'replayCapacity'])||predictor.limits.horizonTicks!==30||
      predictor.limits.maximumUpdatesPerSecond!==2||
      predictor.limits.replayCapacity!==0||
      !count(predictor.sessionResets)||typeof predictor.saturated!=='boolean'||
      !predictor.saturated&&[...predictionCounts.map(key=>predictor[key]),
        predictor.sessionResets].some(value=>value===max))
      throw new Error('Invalid gesture-predictor summary');
    for(const scores of [predictor.scores,predictor.scoresByTarget.pose,
      predictor.scoresByTarget.absent]){
      if(!exact(scores,scoreKeys)||scoreKeys.some(key=>
        !exact(scores[key],scoreFields)||
        scoreFields.some(field=>!finite(scores[key][field]))))
        throw new Error('Invalid gesture-predictor scores');
    }
    for(const name of scoreKeys)for(const field of scoreFields){
      const total=predictor.scores[name][field],byTarget=
        predictor.scoresByTarget.pose[name][field]+
        predictor.scoresByTarget.absent[name][field];
      if(Math.abs(total-byTarget)>1e-6*Math.max(1,total))
        throw new Error('Inconsistent gesture-predictor scores');
    }
  }
  return sample;
}

/** V1 retains event/censor denominators. V3 only adds bounded actor-local
 * measurement continuity, separating resets from ordinary counter regressions. */
export function createCharacterPilotTracker(){
  const v1=createV1Tracker(),previous=new Map();
  const coverage={identityChanges:0,epochChanges:0,
    sessionResets:{freeHandObserver:0,gestureMemory:0,gesturePrediction:0},
    identityUnavailableProjections:0};
  const coverageSnapshot=()=>({...coverage,sessionResets:{...coverage.sessionResets}});
  const aggregateKeys={freeHandObserver:[...FREE_COUNTS,'sampleCounts'],
    // Ring retention falls as old samples expire; only losses are cumulative.
    gestureMemory:['overflows','expirations'],
    gesturePrediction:[...PREDICTION_COUNTS,'scores','scoresByTarget']};
  const compare=(before,after,name)=>{
    const fields=aggregateKeys[name];
    for(const key of fields){
      if(key==='sampleCounts'){
        for(const label of ['unknown','absent','pose'])
          if(after[key][label]<before[key][label])throw new Error('Motor sample count regressed');
      }else if(key==='scores'){
        for(const label of SCORE_KEYS)for(const score of SCORE_FIELDS)
          if(after[key][label][score]+1e-8<before[key][label][score])
            throw new Error('Motor score regressed');
      }else if(key==='scoresByTarget'){
        for(const target of ['pose','absent'])for(const label of SCORE_KEYS)
          for(const score of SCORE_FIELDS)
            if(after[key][target][label][score]+1e-8<before[key][target][label][score])
              throw new Error('Motor class score regressed');
      }else if(after[key]<before[key])throw new Error('Motor count regressed');
    }
  };
  function ingest(sample,options={}){
    validateCharacterPilotProjection(sample);
    const base=v1.ingest(stripMotor(sample),options);
    if(sample.identityPendingReconciliation){
      coverage.identityUnavailableProjections++;
      return {...base,motor:{coverage:coverageSnapshot(),actors:[]}};
    }
    for(const actor of sample.motor.actors){
      const old=previous.get(actor.id);
      if(old){
        if(actor.identity!==old.identity){
          if(actor.identity<old.identity)throw new Error('Motor identity regressed');
          coverage.identityChanges++;
        }else{
          if(actor.epoch<old.epoch)throw new Error('Motor epoch regressed');
          if(actor.epoch>old.epoch){
            if(Object.keys(aggregateKeys).every(name=>
              actor[name].sessionResets===old[name].sessionResets))
              throw new Error('Motor epoch changed without local reset evidence');
            coverage.epochChanges++;
          }
          for(const name of Object.keys(aggregateKeys)){
            const before=old[name],after=actor[name];
            if(after.sessionResets<before.sessionResets)
              throw new Error('Motor session-reset count regressed');
            if(after.sessionResets>before.sessionResets){
              coverage.sessionResets[name]+=after.sessionResets-before.sessionResets;
            }else compare(before,after,name);
          }
        }
      }
      previous.set(actor.id,structuredClone(actor));
    }
    return {...base,motor:{coverage:coverageSnapshot(),actors:sample.motor.actors.map(actor=>({
      id:actor.id,identity:actor.identity,epoch:actor.epoch,
      eligibleDecisions:actor.freeHandObserver.eligibleDecisions,
      selectedAttempts:actor.freeHandObserver.selectedAttempts,
      visibleSamples:actor.freeHandObserver.visibleSamples,
      visibility:{...actor.freeHandObserver.sampleCounts},
      prediction:{forecasts:actor.gesturePrediction.forecasts,
        validTargets:actor.gesturePrediction.validTargets,
        updates:actor.gesturePrediction.updates,
        censoredUnknown:actor.gesturePrediction.censoredUnknown,
        censoredGap:actor.gesturePrediction.censoredGap,
        targetPose:actor.gesturePrediction.targetPose,
        targetAbsent:actor.gesturePrediction.targetAbsent},
      ratios:{selectionsPerEligible:ratio(actor.freeHandObserver.selectedAttempts,
          actor.freeHandObserver.eligibleDecisions),
        validTargetsPerForecast:ratio(actor.gesturePrediction.validTargets,
          actor.gesturePrediction.forecasts)}}))}};
  }
  return {ingest};
}

function ratio(numerator,denominator){return {numerator,denominator,
  defined:denominator>0,rate:denominator>0?numerator/denominator:null};}
