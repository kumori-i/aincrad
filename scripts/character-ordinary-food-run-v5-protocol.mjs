/** Prospective ordinary food-run lifecycle observation. V1-V4 remain frozen.
 * This source is inert: it reads only bounded main-world observer projections. */
import {
  CHARACTER_ORDINARY_PILOT_PROTOCOL as V4,
  validateCharacterPilotProjection as validateV4Projection,
  createCharacterPilotTracker as createV4Tracker,
} from './character-ordinary-motor-v4-protocol.mjs';

export {CHARACTER_PILOT_COUNT_KEYS,readCharacterPilotClock,
  validateCharacterPilotClock,createCharacterPilotSchedule,
  createCharacterPilotBudget,boundedCharacterPilotTerminal}
  from './character-ordinary-motor-v4-protocol.mjs';

export const CHARACTER_ORDINARY_PILOT_PROTOCOL=Object.freeze({...V4,
  id:'ordinary-character-food-run-lifecycle-v5',
  activationRef:'experiments/character-food-run-lifecycle-v5-once',
  receiptRef:'experiments/character-food-run-lifecycle-v5-receipt',
  workflow:'Ordinary character-food-run lifecycle v5 — approved once',
});

/** Serialized fresh guard. It embeds the frozen v4 fresh check so the renderer
 * receives one self-contained function and verifies the world/model start. */
export function guardFreshCharacterFoodRunPilot(expected){
  function guardFreshV4(expected){
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
    const zeroLifecycle=life=>life&&Reflect.ownKeys(life).length===9&&
      ['admitted','firstPaid','certifiedPaidSeconds','completed','unavailable',
        'ownPoseSamples','pending'].every(key=>life[key]===0)&&
      life.rejectedAfterSelection&&Reflect.ownKeys(life.rejectedAfterSelection).length===2&&
      ['ACTION_BUSY','PRIORITY_CHANGED'].every(key=>life.rejectedAfterSelection[key]===0)&&
      life.interrupted&&Reflect.ownKeys(life.interrupted).length===5&&
      ['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
        'REFERENCE_INTERRUPTED','OTHER'].every(key=>life.interrupted[key]===0);
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
          hand.sampleCounts.pose!==0||!zeroLifecycle(hand.lifecycle)||hand.sessionResets!==0||
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
  const base=guardFreshV4(expected),m=window.__ozarkWorld.communicationMeasurementSnapshot();
  const fail=reason=>{throw new Error('Fresh food-run guard: '+reason);};
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const stages=['travel','acquisition','sample'],reach=['observed','held','unknown'];
  const stageFields=['selected','normalized','substituted','normalizationRejected',
    'admitted','immediateRejected','instantCompleted','firstPaid',
    'certifiedPaidSeconds','completed','failed','interrupted','unavailable'];
  const rejections=['INVALID_REQUEST','UNOBSERVED_TARGET','NO_KNOWN_ROUTE',
    'OUT_OF_REACH','OBJECT_GONE','ACTION_BUSY','OTHER'];
  const interruptions=['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
    'REFERENCE_INTERRUPTED','OTHER'];
  const ends=['action-failed','expired','unavailable','complete','no-target',
    'availability-blocked','no-route','proof-retired','identity-loss',
    'contact-escape','ablation','other'];
  if(!Array.isArray(m?.foodRuns)||m.foodRuns.length!==2)fail('food actor count');
  const world=window.__ozarkWorld.fullSnapshot();
  for(let i=0;i<2;i++){
    const row=m.foodRuns[i];
    if(!exact(row,['agentId','version','limits','stages','runEnds','pending',
      'sessionResets','sessionLosses','saturated'])||
      row.agentId!==['aster','mira'][i]||row.version!==1||
      !exact(row.limits,['counter','paidSeconds'])||
      row.limits.counter!==2147483647||row.limits.paidSeconds!==1e9||
      !exact(row.stages,stages)||!exact(row.runEnds,ends)||
      !exact(row.pending,['selected','active'])||
      row.pending.selected!==0||row.pending.active!==0||
      row.sessionResets!==0||row.sessionLosses!==0||row.saturated!==false||
      Object.values(row.runEnds).some(value=>value!==0))fail('nonzero food-run state');
    for(const stage of stages){
      const value=row.stages[stage];
      if(!exact(value,[...stageFields,'reach','rejectionReasons',
        'interruptionReasons'])||!exact(value.reach,reach)||
        !exact(value.rejectionReasons,rejections)||
        !exact(value.interruptionReasons,interruptions)||
        [...stageFields.map(key=>value[key]),...Object.values(value.reach),
          ...Object.values(value.rejectionReasons),
          ...Object.values(value.interruptionReasons)].some(number=>number!==0))
        fail('nonzero food-run stage');
    }
    const body=world.agents[i]?.physiology;
    if(['ingestedKcal','absorbedKcal','metabolizedKcal','discardedKcal']
      .some(key=>body?.totals?.[key]!==0)||
      !Array.isArray(body?.stomach)||body.stomach.length!==0||
      ['energyKcal','waterMl','count'].some(key=>
        body?.outsideAssistance?.[key]!==0))fail('nonfresh food energy');
  }
  return base;
}

export async function projectCharacterPilot(){
  const {CONFIG}=await import('./src/config.js');
  const q=window.__ozarkWorld,w=q.fullSnapshot(),m=q.communicationMeasurementSnapshot();
  if(!m)throw new Error('Character food-run observation unavailable');
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
        lifecycle:{admitted:free.lifecycle?.admitted??null,
          firstPaid:free.lifecycle?.firstPaid??null,
          certifiedPaidSeconds:free.lifecycle?.certifiedPaidSeconds??null,
          completed:free.lifecycle?.completed??null,
          rejectedAfterSelection:count(free.lifecycle?.rejectedAfterSelection,
            ['ACTION_BUSY','PRIORITY_CHANGED']),
          interrupted:count(free.lifecycle?.interrupted,
            ['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
              'REFERENCE_INTERRUPTED','OTHER']),
          unavailable:free.lifecycle?.unavailable??null,
          ownPoseSamples:free.lifecycle?.ownPoseSamples??null,
          pending:free.lifecycle?.pending??null},
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
  const motorActors=(w.agents||[]).map(motorActor);
  const lifecycleKeysOmitted=m.identityPendingReconciliation?0:motorActors.reduce((n,row)=>{
    const life=row.freeHandObserver?.lifecycle;
    if(!life)return n+14;
    return n+['admitted','firstPaid','certifiedPaidSeconds','completed',
      'unavailable','ownPoseSamples','pending'].filter(key=>life[key]===null).length+
      ['ACTION_BUSY','PRIORITY_CHANGED'].filter(key=>
        life.rejectedAfterSelection[key]===null).length+
      ['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
        'REFERENCE_INTERRUPTED','OTHER'].filter(key=>life.interrupted[key]===null).length;
  },0);
  const foodStages=['travel','acquisition','sample'];
  const foodStageFields=['selected','normalized','substituted','normalizationRejected',
    'admitted','immediateRejected','instantCompleted','firstPaid',
    'certifiedPaidSeconds','completed','failed','interrupted','unavailable'];
  const foodReach=['observed','held','unknown'];
  const foodRejections=['INVALID_REQUEST','UNOBSERVED_TARGET','NO_KNOWN_ROUTE',
    'OUT_OF_REACH','OBJECT_GONE','ACTION_BUSY','OTHER'];
  const foodInterruptions=['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
    'REFERENCE_INTERRUPTED','OTHER'];
  const foodEnds=['action-failed','expired','unavailable','complete','no-target',
    'availability-blocked','no-route','proof-retired','identity-loss',
    'contact-escape','ablation','other'];
  const foodRows=Array.isArray(m.foodRuns)?m.foodRuns:[];
  const foodActor=actor=>{
    const measured=m.actors?.find(row=>row.id===actor.id),
      matches=foodRows.filter(row=>row?.agentId===actor.id),
      raw=matches.length===1?matches[0]:null,body=actor.physiology,
      stomach=body?.stomach;
    const pendingKcal=Array.isArray(stomach)&&stomach.every(row=>
      Number.isFinite(row?.remainingKcal)&&row.remainingKcal>=0)?
      stomach.reduce((sum,row)=>sum+row.remainingKcal,0):null;
    // No source/target identity, private route, portion row or learner input
    // crosses this allowlist. These counters are decisions/actions, not time.
    const foodRun=raw?{version:raw.version??null,
      limits:count(raw.limits,['counter','paidSeconds']),
      stages:Object.fromEntries(foodStages.map(stage=>{
        const row=raw.stages?.[stage];return [stage,{
          ...count(row,foodStageFields),reach:count(row?.reach,foodReach),
          rejectionReasons:count(row?.rejectionReasons,foodRejections),
          interruptionReasons:count(row?.interruptionReasons,foodInterruptions)}];
      })),
      runEnds:count(raw.runEnds,foodEnds),
      pending:count(raw.pending,['selected','active']),
      sessionResets:raw.sessionResets??null,
      sessionLosses:raw.sessionLosses??null,
      saturated:raw.saturated??null}:null;
    const energy={...numeric(body?.totals,['ingestedKcal','absorbedKcal',
      'discardedKcal','metabolizedKcal']),pendingKcal};
    return {id:actor.id,identity:measured?.identity??null,epoch:actor.epoch,
      foodRun:m.identityPendingReconciliation?null:foodRun,
      energy:m.identityPendingReconciliation?null:energy};
  };
  const foodActors=(w.agents||[]).map(foodActor);
  const nullFields=value=>value===null?1:value&&typeof value==='object'?
    Object.values(value).reduce((sum,item)=>sum+nullFields(item),0):0;
  const foodKeysOmitted=m.identityPendingReconciliation?0:
    (foodRows.length===foodActors.length?0:1)+foodActors.reduce((sum,row)=>
      sum+nullFields(row.foodRun)+nullFields(row.energy),0);
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
    motor:{version:2,lifecycleKeysOmitted,actors:motorActors},
    food:{version:1,foodKeysOmitted,
      identityUnavailableActors:m.identityPendingReconciliation?foodActors.length:0,
      actors:foodActors}};
}

const FOOD_STAGES=['travel','acquisition','sample'];
const FOOD_REACH=['observed','held','unknown'];
const FOOD_STAGE_FIELDS=['selected','normalized','substituted','normalizationRejected',
  'admitted','immediateRejected','instantCompleted','firstPaid',
  'certifiedPaidSeconds','completed','failed','interrupted','unavailable'];
const FOOD_REJECTIONS=['INVALID_REQUEST','UNOBSERVED_TARGET','NO_KNOWN_ROUTE',
  'OUT_OF_REACH','OBJECT_GONE','ACTION_BUSY','OTHER'];
const FOOD_INTERRUPTS=['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
  'REFERENCE_INTERRUPTED','OTHER'];
const FOOD_ENDS=['action-failed','expired','unavailable','complete','no-target',
  'availability-blocked','no-route','proof-retired','identity-loss',
  'contact-escape','ablation','other'];
const FOOD_ENERGY=['ingestedKcal','absorbedKcal','discardedKcal',
  'metabolizedKcal','pendingKcal'];
const FOOD_LIMIT=2147483647;
const stripFood=sample=>Object.fromEntries(Object.entries(sample).filter(([key])=>key!=='food'));

/** Strict host contract. No food-run handle, target or private body row is
 * accepted. The frozen v4 validator still owns every base field. */
export function validateCharacterPilotProjection(sample,validateBase=validateV4Projection){
  // This validator is also serialized into the bounded native observer.
  // Its only injected dependency is the frozen v4 validator alias.
  const FOOD_STAGES=['travel','acquisition','sample'];
  const FOOD_REACH=['observed','held','unknown'];
  const FOOD_STAGE_FIELDS=['selected','normalized','substituted',
    'normalizationRejected','admitted','immediateRejected','instantCompleted',
    'firstPaid','certifiedPaidSeconds','completed','failed','interrupted','unavailable'];
  const FOOD_REJECTIONS=['INVALID_REQUEST','UNOBSERVED_TARGET','NO_KNOWN_ROUTE',
    'OUT_OF_REACH','OBJECT_GONE','ACTION_BUSY','OTHER'];
  const FOOD_INTERRUPTS=['PRIORITY_CHANGED','ACTION_TIMEOUT','CONTACT_ESCAPE',
    'REFERENCE_INTERRUPTED','OTHER'];
  const FOOD_ENDS=['action-failed','expired','unavailable','complete','no-target',
    'availability-blocked','no-route','proof-retired','identity-loss',
    'contact-escape','ablation','other'];
  const FOOD_ENERGY=['ingestedKcal','absorbedKcal','discardedKcal',
    'metabolizedKcal','pendingKcal'];
  const FOOD_LIMIT=2147483647;
  const stripFood=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='food'));
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=FOOD_LIMIT;
  const energy=value=>Number.isFinite(value)&&value>=0&&value<=1e12;
  const sum=values=>values.reduce((total,value)=>total+value,0);
  if(!sample||typeof sample!=='object'||Array.isArray(sample)||
    !exact(sample.food,['version','foodKeysOmitted','identityUnavailableActors','actors'])||
    sample.food.version!==1||sample.food.foodKeysOmitted!==0||
    !integer(sample.food.identityUnavailableActors)||
    !Array.isArray(sample.food.actors)||sample.food.actors.length!==2)
    throw new Error('Invalid food-run sidecar');
  validateBase(stripFood(sample));
  const stale=sample.identityPendingReconciliation;
  if(sample.food.identityUnavailableActors!==(stale?2:0))
    throw new Error('Invalid food-run identity coverage');
  for(let index=0;index<2;index++){
    const actor=sample.food.actors[index],base=sample.actors[index];
    if(!exact(actor,['id','identity','epoch','foodRun','energy'])||
      actor.id!==base.id||actor.identity!==base.identity||actor.epoch!==base.epoch)
      throw new Error('Invalid food-run actor lineage');
    if(stale){
      if(actor.foodRun!==null||actor.energy!==null)
        throw new Error('Stale food-run identity leaked');
      continue;
    }
    const run=actor.foodRun,ledger=actor.energy;
    if(!exact(run,['version','limits','stages','runEnds','pending',
        'sessionResets','sessionLosses','saturated'])||run.version!==1||
      !exact(run.limits,['counter','paidSeconds'])||
      run.limits.counter!==FOOD_LIMIT||run.limits.paidSeconds!==1e9||
      !exact(run.stages,FOOD_STAGES)||!exact(run.runEnds,FOOD_ENDS)||
      !exact(run.pending,['selected','active'])||
      !integer(run.pending.selected)||!integer(run.pending.active)||
      run.pending.selected+run.pending.active>1||
      !integer(run.sessionResets)||!integer(run.sessionLosses)||
      typeof run.saturated!=='boolean'||
      FOOD_ENDS.some(key=>!integer(run.runEnds[key])))
      throw new Error('Invalid food-run summary');
    const counters=[run.pending.selected,run.pending.active,run.sessionResets,
      run.sessionLosses,...FOOD_ENDS.map(key=>run.runEnds[key])];
    for(const stage of FOOD_STAGES){
      const row=run.stages[stage];
      if(!exact(row,[...FOOD_STAGE_FIELDS,'reach','rejectionReasons',
          'interruptionReasons'])||!exact(row.reach,FOOD_REACH)||
        !exact(row.rejectionReasons,FOOD_REJECTIONS)||
        !exact(row.interruptionReasons,FOOD_INTERRUPTS)||
        FOOD_STAGE_FIELDS.filter(key=>key!=='certifiedPaidSeconds').some(key=>
          !integer(row[key]))||!energy(row.certifiedPaidSeconds)||
        row.certifiedPaidSeconds>run.limits.paidSeconds||
        FOOD_REACH.some(key=>!integer(row.reach[key]))||
        FOOD_REJECTIONS.some(key=>!integer(row.rejectionReasons[key]))||
        FOOD_INTERRUPTS.some(key=>!integer(row.interruptionReasons[key])))
        throw new Error('Invalid food-run stage');
      counters.push(...FOOD_STAGE_FIELDS.filter(key=>key!=='certifiedPaidSeconds')
        .map(key=>row[key]),...FOOD_REACH.map(key=>row.reach[key]),
        ...FOOD_REJECTIONS.map(key=>row.rejectionReasons[key]),
        ...FOOD_INTERRUPTS.map(key=>row.interruptionReasons[key]));
      if(!run.saturated&&(
        sum(FOOD_REACH.map(key=>row.reach[key]))!==row.selected||
        row.normalized>row.selected||row.admitted>row.normalized||
        row.admitted+row.immediateRejected+row.instantCompleted>row.normalized||
        row.firstPaid>row.admitted||row.completed+row.failed>row.admitted||
        row.interrupted>row.failed||
        sum(FOOD_REJECTIONS.map(key=>row.rejectionReasons[key]))!==row.immediateRejected||
        sum(FOOD_INTERRUPTS.map(key=>row.interruptionReasons[key]))!==row.interrupted||
        stage!=='travel'&&row.instantCompleted!==0))
        throw new Error('Inconsistent food-run stage');
    }
    if(!run.saturated&&counters.some(value=>value===FOOD_LIMIT))
      throw new Error('Undisclosed food-run saturation');
    if(!exact(ledger,FOOD_ENERGY)||FOOD_ENERGY.some(key=>!energy(ledger[key]))||
      ['ingestedKcal','absorbedKcal','metabolizedKcal'].some(key=>
        ledger[key]!==base.totals[key]))
      throw new Error('Invalid food energy ledger');
    const partition=ledger.absorbedKcal+ledger.discardedKcal+ledger.pendingKcal;
    if(Math.abs(ledger.ingestedKcal-partition)>
      1e-6*Math.max(1,ledger.ingestedKcal))
      throw new Error('Food energy partition differs from actual ingestion');
  }
  return sample;
}

const ratio=(numerator,denominator)=>({numerator,denominator,
  defined:denominator>0,rate:denominator>0?numerator/denominator:null});

/** V4 keeps the character/motor denominators. Food stages are counted per
 * selection/admission/action; their seconds and body kcal remain separate. */
export function createCharacterPilotTracker(){
  const v4=createV4Tracker(),previous=new Map();
  const coverage={foodKeysOmitted:0,identityUnavailableActors:0,
    identityChanges:0,epochChanges:0,sessionResets:0,sessionLosses:0,
    saturatedActorProjections:0,lastObservedPendingBeforeSessionLoss:0,
    energyReserveChecksSkippedForRescue:0};
  const copyCoverage=()=>({...coverage});
  const pending=actor=>actor.foodRun.pending.selected+actor.foodRun.pending.active;
  const compare=(before,after)=>{
    const old=before.foodRun,now=after.foodRun;
    if(now.sessionLosses<old.sessionLosses)throw new Error('Food session loss regressed');
    for(const reason of FOOD_ENDS)
      if(now.runEnds[reason]<old.runEnds[reason])throw new Error('Food run end regressed');
    for(const stage of FOOD_STAGES){
      const a=old.stages[stage],b=now.stages[stage];
      for(const key of FOOD_STAGE_FIELDS.filter(key=>key!=='certifiedPaidSeconds'))
        if(b[key]<a[key])throw new Error('Food stage count regressed');
      if(b.certifiedPaidSeconds+1e-8<a.certifiedPaidSeconds)
        throw new Error('Food paid seconds regressed');
      for(const key of FOOD_REACH)
        if(b.reach[key]<a.reach[key])throw new Error('Food reach count regressed');
      for(const key of FOOD_REJECTIONS)
        if(b.rejectionReasons[key]<a.rejectionReasons[key])
          throw new Error('Food rejection count regressed');
      for(const key of FOOD_INTERRUPTS)
        if(b.interruptionReasons[key]<a.interruptionReasons[key])
          throw new Error('Food interruption count regressed');
    }
    for(const key of FOOD_ENERGY.filter(key=>key!=='pendingKcal'))
      if(after.energy[key]+1e-8<before.energy[key])
        throw new Error('Food energy total regressed');
  };
  function ingest(sample,options={}){
    validateCharacterPilotProjection(sample);
    const next=sample.food.actors;
    if(!sample.identityPendingReconciliation){
      for(const actor of next){
        const old=previous.get(actor.id);
        if(!old)continue;
        if(actor.identity<old.identity||actor.identity===old.identity&&actor.epoch<old.epoch)
          throw new Error('Food actor lineage regressed');
        if(actor.identity!==old.identity)continue;
        if(actor.foodRun.sessionResets<old.foodRun.sessionResets)
          throw new Error('Food session reset regressed');
        if(actor.epoch>old.epoch&&
          actor.foodRun.sessionResets===old.foodRun.sessionResets)
          throw new Error('Food epoch changed without local reset evidence');
        if(actor.epoch===old.epoch&&
            actor.foodRun.sessionResets===old.foodRun.sessionResets)
          compare(old,actor);
      }
    }
    const base=v4.ingest(stripFood(sample),options);
    coverage.foodKeysOmitted+=sample.food.foodKeysOmitted;
    coverage.identityUnavailableActors+=sample.food.identityUnavailableActors;
    if(sample.identityPendingReconciliation)
      return {...base,food:{coverage:copyCoverage(),actors:[]}};
    for(let index=0;index<next.length;index++){
      const actor=next[index],old=previous.get(actor.id),
        baseActor=sample.actors[index],oldBase=old?.baseActor;
      if(actor.foodRun.saturated)coverage.saturatedActorProjections++;
      if(old){
        if(actor.identity!==old.identity){
          coverage.identityChanges++;
          if(pending(old))coverage.lastObservedPendingBeforeSessionLoss++;
        }else if(actor.epoch>old.epoch){
          if(actor.foodRun.sessionResets===old.foodRun.sessionResets)
            throw new Error('Food epoch changed without local reset evidence');
          coverage.epochChanges++;
          if(pending(old))coverage.lastObservedPendingBeforeSessionLoss++;
          coverage.sessionResets+=actor.foodRun.sessionResets-old.foodRun.sessionResets;
          coverage.sessionLosses+=Math.max(0,actor.foodRun.sessionLosses-old.foodRun.sessionLosses);
        }else if(actor.foodRun.sessionResets>old.foodRun.sessionResets){
          coverage.sessionResets+=actor.foodRun.sessionResets-old.foodRun.sessionResets;
          coverage.sessionLosses+=Math.max(0,actor.foodRun.sessionLosses-old.foodRun.sessionLosses);
          if(pending(old))coverage.lastObservedPendingBeforeSessionLoss++;
        }else{
          coverage.sessionLosses+=actor.foodRun.sessionLosses-old.foodRun.sessionLosses;
          // Rescue adds bodily energy outside ingestion/absorption totals.
          if(baseActor.stats.rescues>oldBase.stats.rescues)
            coverage.energyReserveChecksSkippedForRescue++;
          else{
            const oldReserve=oldBase.body.availableEnergyKcal+oldBase.body.storedEnergyKcal,
              reserve=baseActor.body.availableEnergyKcal+baseActor.body.storedEnergyKcal,
              expected=actor.energy.absorbedKcal-old.energy.absorbedKcal-
                (actor.energy.metabolizedKcal-old.energy.metabolizedKcal);
            if(Math.abs(reserve-oldReserve-expected)>1e-5*Math.max(1,Math.abs(expected)))
              throw new Error('Food energy reserve delta differs from metabolism');
          }
        }
      }
      previous.set(actor.id,{...structuredClone(actor),baseActor:structuredClone(baseActor)});
    }
    return {...base,food:{coverage:copyCoverage(),actors:next.map(actor=>({
      id:actor.id,identity:actor.identity,epoch:actor.epoch,
      stages:Object.fromEntries(FOOD_STAGES.map(stage=>{
        const row=actor.foodRun.stages[stage];return [stage,{
          selected:row.selected,admitted:row.admitted,firstPaid:row.firstPaid,
          certifiedPaidSeconds:row.certifiedPaidSeconds,completed:row.completed,
          failed:row.failed,interrupted:row.interrupted,unavailable:row.unavailable,
          instantCompleted:row.instantCompleted,
          ratios:{admissionsPerSelected:ratio(row.admitted,row.selected),
            firstPaidPerAdmitted:ratio(row.firstPaid,row.admitted),
            completionsPerAdmitted:ratio(row.completed,row.admitted)}}];
      })),runEnds:{...actor.foodRun.runEnds},
      sessionResets:actor.foodRun.sessionResets,
      sessionLosses:actor.foodRun.sessionLosses,
      saturated:actor.foodRun.saturated,
      energy:{...actor.energy}}))}};
  }
  return {ingest};
}
