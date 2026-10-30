/** Prospective observer contract for one ordinary main-world character run.
 * This module never starts, steps, trains, saves or activates a pilot. */
export const CHARACTER_ORDINARY_PILOT_PROTOCOL=Object.freeze({
  id:'ordinary-character-messages-v1',
  geometryIdentity:'sha256:8f029100a4af44c415d9d5079d002e1bc34ca45d6a58803494385bc030b8ddc3',
  worldSeed:74193,communicationSeed:211,phase:'private-character-message',
  fixedStep:1/60,speed:1,targetSeconds:1200,pollWallMs:1000,detailSeconds:10,
  wallLimitMs:30*60*1000,structuredBytes:32*1024*1024,
  terminalReserveBytes:256*1024,mediaBytes:16*1024*1024,
  maxIpcBytes:256*1024,maxEvents:256,maxCensorReasons:64,maxGateKeys:64,
  counter:2147483647,overshootSeconds:2,stopGraceMs:5000,
  activationRef:'experiments/character-ordinary-pilot-v1-once',
  workflow:'Ordinary character-message pilot — approved once',platform:'linux',architecture:'x64',
});

export const CHARACTER_PILOT_COUNT_KEYS=Object.freeze([
  'optionalChecks','feasibleOpportunities','emissions','paidInspectionStarts',
  'paidInspectionCompletions','paidInspectionOutcomeUnavailable',
  'paidReplyStarts','paidReplyCompletions','paidReplyOutcomeUnavailable',
  'canonicalDemonstrations','criticCorrect','validListenerDemonstrations',
  'ambiguousListenerLabels','rejectedListenerLabels','listenerReplayUses',
  'listenerOptimizerSteps','visualMatches','visualMismatches','senderUpdates',
  'originalCensors','responseCensors',
]);

/** Serialized into the renderer. The only mutation is one ordinary pause
 * at the first observed target; no test stepping or fixture ownership. */
export function readCharacterPilotClock(stopAt=1200){
  const q=window.__ozarkWorld,before=q.snapshot(),observedWallMs=Date.now();
  const threshold=Number.isFinite(stopAt)&&before.started&&!before.paused&&before.elapsed>=stopAt;
  if(threshold)q.pause();
  const after=threshold?q.snapshot():before;
  return {elapsed:before.elapsed,observedWallMs,started:before.started,
    paused:after.paused,blocked:before.blocked,
    speed:Number(document.getElementById('simulation-speed')?.value),
    fixtureOwned:q.referenceFixtureState()!==null,threshold,
    pausedElapsed:threshold?after.elapsed:null};
}

/** Serialized into the renderer. Read the full world only here and return no
 * private model, crop, replay example, object binding or authority handle. */
export function guardFreshCharacterPilot(expected){
  const fail=message=>{throw new Error('Fresh character pilot guard: '+message);};
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
  for(let index=0;index<2;index++){
    const id=ids[index],partner=ids[1-index],serial=index+1,
      actor=w.agents[index],measured=m.actors[index],legacy=reference.learners[index],
      savedLegacy=w.visualReference.learners[index],savedCharacter=w.characterMessages.learners[index],
      savedPartner=savedCharacter?.partners?.[0],bank=measured?.character?.partnerBanks?.[0];
    if(actor?.id!==id||actor.elapsed!==0||actor.epoch!==0||
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
  }
  if(!Array.isArray(m.survival)||m.survival.length!==2||
      m.survival.some(row=>row.recordsRetained!==0||
        Object.values(row.counters||{}).some(value=>value!==0)))
    fail('nonzero survival observer');
  return {ready:true,elapsed:0,worldSeed:expected.worldSeed,
    communicationSeed:expected.communicationSeed,
    individuals:ids.map((id,index)=>({id,serial:index+1,trained:false}))};
}

/** Serialized into the renderer. Explicit field selection is the IPC boundary.
 * Keep this function self-contained; generated native code uses its toString(). */
export async function projectCharacterPilot(){
  const q=window.__ozarkWorld,w=q.fullSnapshot(),m=q.communicationMeasurementSnapshot();
  const {CONFIG}=await import('./src/config.js');
  if(!m)throw new Error('Character pilot measurement unavailable');
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
      eventKeys.map(key=>[key,row[key]??null])))};
}

const P=CHARACTER_ORDINARY_PILOT_PROTOCOL;
const ratio=(numerator,denominator)=>({numerator,denominator,
  defined:denominator>0,rate:denominator>0?numerator/denominator:null});

export function validateCharacterPilotClock(sample,{started=true}={}){
  const P=CHARACTER_ORDINARY_PILOT_PROTOCOL;
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(object,key));
  const finite=(value,max=1e12)=>Number.isFinite(value)&&value>=0&&value<=max;
  if(!exact(sample,['elapsed','observedWallMs','started','paused','blocked',
      'speed','fixtureOwned','threshold','pausedElapsed'])||
      !finite(sample.elapsed)||!finite(sample.observedWallMs,8.64e15)||
      sample.started!==started||sample.blocked!==false||
      sample.speed!==P.speed||sample.fixtureOwned!==false||
      typeof sample.paused!=='boolean'||typeof sample.threshold!=='boolean'||
      !started&&(sample.paused||sample.threshold)||
      started&&!sample.paused&&sample.elapsed>=P.targetSeconds&&!sample.threshold||
      sample.threshold&&(sample.paused!==true||
        sample.elapsed<P.targetSeconds||!finite(sample.pausedElapsed)||
        sample.pausedElapsed<sample.elapsed)||
      !sample.threshold&&sample.pausedElapsed!==null)
    throw new Error('Ordinary character clock invariant failed');
  return sample;
}

export function validateCharacterPilotProjection(sample){
  const P=CHARACTER_ORDINARY_PILOT_PROTOCOL;
  const countKeys=[
    'optionalChecks','feasibleOpportunities','emissions','paidInspectionStarts',
    'paidInspectionCompletions','paidInspectionOutcomeUnavailable',
    'paidReplyStarts','paidReplyCompletions','paidReplyOutcomeUnavailable',
    'canonicalDemonstrations','criticCorrect','validListenerDemonstrations',
    'ambiguousListenerLabels','rejectedListenerLabels','listenerReplayUses',
    'listenerOptimizerSteps','visualMatches','visualMismatches','senderUpdates',
    'originalCensors','responseCensors',
  ];
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).length===keys.length&&keys.every(key=>Object.prototype.hasOwnProperty.call(object,key));
  const finite=(value,max=1e12)=>Number.isFinite(value)&&value>=0&&value<=max;
  const count=(value,max=P.counter)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
  const code=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);
  const optionalCode=value=>value===null||code(value);
  const optionalId=value=>value===null||Number.isSafeInteger(value)&&value>0;
  const optionalTime=value=>value===null||finite(value);
  const bodyKeys=['health','satietyHours','availableEnergyKcal','storedEnergyKcal',
    'waterDeficitMl','stamina','fatigue','sleepPressure','hoursSinceMeal','starvationHours'];
  const survivalKeys=['begun','finished','incomplete','superseded',
    'evictedRecords','droppedNotes','rejectedNotes'];
  const numericFields=(object,keys,nullable=false)=>exact(object,keys)&&
    keys.every(key=>nullable&&object[key]===null||finite(object[key]));
  const optionalShort=value=>value===null||
    typeof value==='string'&&value.length<=64&&value.length>0;
  const coordinate=value=>Number.isFinite(value)&&Math.abs(value)<=1e9;
  const gates=(object,maximum)=>object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).length<=maximum&&Object.entries(object).every(([key,value])=>
      /^[a-z][a-z0-9:_-]{0,63}$/.test(key)&&count(value,Number.MAX_SAFE_INTEGER));
  const keys=['elapsed','wallMs','version','geometryIdentity','worldSeed',
    'communicationSeed','phase','fixedStep','clocks','counts','reasons',
    'reasonOverflow','eventsRetained','eventsEvicted','eventsRetired','saturated',
    'admissionGates','admissionGateKeysOmitted','pending',
    'identityPendingReconciliation','actors','player','events'];
  if(!exact(sample,keys)||sample.version!==12||
      sample.geometryIdentity!==P.geometryIdentity||sample.worldSeed!==P.worldSeed||
      sample.communicationSeed!==P.communicationSeed||sample.phase!==P.phase||
      sample.fixedStep!==P.fixedStep||!finite(sample.elapsed)||
      !finite(sample.wallMs,8.64e15)||!exact(sample.clocks,['environment','ecology','pending'])||
      !finite(sample.clocks.environment)||!finite(sample.clocks.ecology)||
      !finite(sample.clocks.pending)||Math.abs(sample.clocks.environment-sample.elapsed)>1e-6||
      Math.abs(sample.clocks.ecology+sample.clocks.pending-sample.elapsed)>1e-6)
    throw new Error('Frozen character world or clock differs');
  if(!exact(sample.counts,countKeys)||
      countKeys.some(key=>!count(sample.counts[key]))||
      sample.counts.criticCorrect>sample.counts.canonicalDemonstrations||
      sample.counts.validListenerDemonstrations>sample.counts.canonicalDemonstrations||
      sample.counts.paidInspectionCompletions>sample.counts.paidInspectionStarts||
      sample.counts.paidReplyCompletions>sample.counts.paidReplyStarts||
      sample.counts.canonicalDemonstrations>sample.counts.paidInspectionCompletions||
      sample.counts.visualMatches+sample.counts.visualMismatches>
        sample.counts.paidReplyCompletions||
      sample.counts.senderUpdates>sample.counts.paidReplyCompletions||
      !count(sample.reasonOverflow)||!count(sample.eventsEvicted)||
      !count(sample.eventsRetired)||!count(sample.admissionGateKeysOmitted)||
      sample.saturated!==true&&sample.saturated!==false||
      typeof sample.identityPendingReconciliation!=='boolean'||
      (sample.identityPendingReconciliation?sample.pending!==null:!count(sample.pending)))
    throw new Error('Invalid character measurement counters');
  if(!Array.isArray(sample.reasons)||sample.reasons.length>P.maxCensorReasons||
      sample.reasons.some(row=>!exact(row,['kind','stage','reason','count'])||
        !['original','response'].includes(row.kind)||!code(row.stage)||
        !code(row.reason)||!count(row.count)))
    throw new Error('Invalid character censor reasons');
  if(!gates(sample.admissionGates,P.maxGateKeys))
    throw new Error('Invalid character admission gates');
  if(!Array.isArray(sample.events)||sample.events.length>P.maxEvents||
      !count(sample.eventsRetained,P.maxEvents)||
      (sample.identityPendingReconciliation?sample.events.length!==0:
        sample.eventsRetained!==sample.events.length)||
      sample.events.some(row=>!exact(row,['id','emittedAt','endedAt','senderId',
        'receiverId','message','action','choiceMode','status','reason',
        'correction','feedbackStatus','feedbackReason','referenceCorrect',
        'listenerReplayUses','listenerUpdate','senderUpdate','selectedActionId',
        'indicationActionId','responseActionId'])||
        !Number.isSafeInteger(row.id)||row.id<=0||
        !finite(row.emittedAt)||row.emittedAt>sample.elapsed+1e-6||
        !optionalTime(row.endedAt)||row.endedAt!==null&&
          (row.endedAt<row.emittedAt||row.endedAt>sample.elapsed+1e-6)||
        !['aster','mira'].includes(row.senderId)||
        !['aster','mira'].includes(row.receiverId)||row.senderId===row.receiverId||
        !/^[a-z]{1,6}$/.test(row.message)||!code(row.status)||
        !optionalCode(row.action)||!optionalCode(row.choiceMode)||
        !optionalCode(row.reason)||!optionalCode(row.correction)||
        !optionalCode(row.feedbackStatus)||!optionalCode(row.feedbackReason)||
        !optionalId(row.selectedActionId)||!optionalId(row.indicationActionId)||
        !optionalId(row.responseActionId)||
        row.listenerReplayUses!==null&&!count(row.listenerReplayUses,3)||
        row.referenceCorrect!==null&&typeof row.referenceCorrect!=='boolean'||
        row.listenerUpdate!==null&&typeof row.listenerUpdate!=='boolean'||
        row.senderUpdate!==null&&typeof row.senderUpdate!=='boolean'))
    throw new Error('Invalid retained character event');
  const identities=Array.isArray(sample.actors)?sample.actors.map(actor=>actor?.identity):[];
  if(!sample.identityPendingReconciliation&&
      (!identities.every(value=>count(value,0xffffffff)&&value>0)||
        identities[0]===identities[1]))
    throw new Error('Invalid individual lineage projection');
  function characterValid(actor,index){
    if(sample.identityPendingReconciliation)return actor.identity===null&&actor.character===null;
    const character=actor.character,bank=character?.partnerBanks?.[0];
    return exact(character,['senderUpdates','listenerUpdates',
      'uniqueDemonstrations','replayUses','partnerBanks'])&&
      ['senderUpdates','listenerUpdates','uniqueDemonstrations','replayUses']
        .every(key=>count(character[key]))&&
      Array.isArray(character.partnerBanks)&&character.partnerBanks.length===1&&
      exact(bank,['partnerId','partnerSerial','retainedExamples','trained'])&&
      bank.partnerId===['mira','aster'][index]&&
      bank.partnerSerial===identities[1-index]&&
      count(bank.retainedExamples,128)&&typeof bank.trained==='boolean';
  }
  if(!Array.isArray(sample.actors)||sample.actors.length!==2||
      sample.actors.some((actor,index)=>!exact(actor,['id','identity','epoch',
        'elapsed','scene','position','lifecycle','activeAction','body','totals',
        'stats','character','survival'])||
        actor.id!==['aster','mira'][index]||
        !count(actor.epoch,Number.MAX_SAFE_INTEGER)||
        Math.abs(actor.elapsed-sample.elapsed)>1e-6||
        !optionalShort(actor.scene)||!optionalShort(actor.lifecycle)||
        !optionalCode(actor.activeAction)||
        !exact(actor.position,['x','y'])||
        !coordinate(actor.position.x)||!coordinate(actor.position.y)||
        !numericFields(actor.body,bodyKeys)||
        !numericFields(actor.totals,['ingestedKcal','absorbedKcal','metabolizedKcal'])||
        !exact(actor.stats,['collapses','rescues','independentMeals','independentDrinks'])||
        Object.values(actor.stats).some(value=>!count(value))||
        !characterValid(actor,index)||
        !exact(actor.survival,['counters','recordsRetained','decisionActive','gateCounts'])||
        !exact(actor.survival.counters,survivalKeys)||
        survivalKeys.some(key=>!count(actor.survival.counters[key]))||
        !gates(actor.survival.gateCounts,64)||
        !count(actor.survival.recordsRetained,64)||
        typeof actor.survival.decisionActive!=='boolean'))
    throw new Error('Invalid character actor projection');
  if(!sample.player||!exact(sample.player,['position','body'])||
      !exact(sample.player.position,['x','y'])||
      !coordinate(sample.player.position.x)||
      !coordinate(sample.player.position.y)||
      !numericFields(sample.player.body,bodyKeys,true))
    throw new Error('Invalid player projection');
  return sample;
}

/** One anchored wall read per due slot, without catch-up bursts. Detail samples
 * are observed at current time, never backdated to skipped simulation windows. */
export function createCharacterPilotSchedule({startWallMs=0}={}){
  const P=CHARACTER_ORDINARY_PILOT_PROTOCOL;
  const finite=value=>Number.isFinite(value)&&value>=0&&value<=1e12;
  if(!finite(startWallMs))throw new RangeError('Invalid pilot schedule origin');
  let lastSlot=0,lastDetail=null,missedWallSlots=0,missedSimulationWindows=0;
  function poll(nowMs){
    if(!finite(nowMs)||nowMs<startWallMs)throw new RangeError('Invalid pilot wall time');
    const slot=Math.floor((nowMs-startWallMs)/P.pollWallMs);
    if(slot<=lastSlot)return {due:false,slot:lastSlot,missedWallSlots:0,
      waitMs:Math.max(0,startWallMs+(lastSlot+1)*P.pollWallMs-nowMs)};
    const missed=slot-lastSlot-1;lastSlot=slot;missedWallSlots+=missed;
    return {due:true,slot,missedWallSlots:missed,waitMs:0};
  }
  function detail(elapsed,{terminal=false}={}){
    if(!finite(elapsed)||lastDetail!==null&&elapsed<lastDetail)
      throw new RangeError('Invalid pilot simulation time');
    if(lastDetail!==null&&!terminal&&elapsed-lastDetail<P.detailSeconds-1e-8)
      return {due:false,missedSimulationWindows:0};
    const missed=lastDetail===null?0:
      Math.max(0,Math.floor((elapsed-lastDetail+1e-8)/P.detailSeconds)-1);
    lastDetail=elapsed;missedSimulationWindows+=missed;
    return {due:true,missedSimulationWindows:missed};
  }
  return {poll,detail,snapshot:()=>({lastSlot,lastDetail,missedWallSlots,missedSimulationWindows})};
}

/** Retained rows are diagnostic coverage; aggregate measurement counts remain
 * authoritative even after FIFO eviction or identity retirement. */
export function createCharacterPilotTracker(){
  let previousElapsed=-Infinity,maxId=0,previousCounts=null,evicted=0,retired=0;
  const retained=new Map(),coverage={missingIds:0,missingTerminal:0,
    missingTerminalOnIdentityGap:0,identityUnavailableProjections:0,
    observedEventRows:0,transitions:0};
  function ingest(sample,{terminal=false}={}){
    validateCharacterPilotProjection(sample);
    if(sample.elapsed<previousElapsed)throw new Error('Pilot time regressed');
    if(sample.eventsEvicted<evicted||sample.eventsRetired<retired)
      throw new Error('Pilot retention counters regressed');
    if(previousCounts&&CHARACTER_PILOT_COUNT_KEYS.some(key=>
      sample.counts[key]<previousCounts[key]))throw new Error('Pilot counts regressed');
    previousElapsed=sample.elapsed;previousCounts={...sample.counts};
    evicted=sample.eventsEvicted;retired=sample.eventsRetired;
    if(sample.identityPendingReconciliation){
      coverage.identityUnavailableProjections++;
      coverage.missingTerminalOnIdentityGap+=
        [...retained.values()].filter(row=>!row.closed).length;
    }
    const sorted=sample.events.slice().sort((a,b)=>a.id-b.id),seen=new Set(),
      changes=[],gaps=[];
    for(const event of sorted){
      if(seen.has(event.id))throw new Error('Duplicate retained event');seen.add(event.id);
      if(event.id>maxId){
        if(event.id>maxId+1){
          gaps.push({from:maxId+1,to:event.id-1});
          coverage.missingIds+=event.id-maxId-1;
        }
        maxId=event.id;coverage.observedEventRows++;
      }else if(!retained.has(event.id))throw new Error('Retired event reappeared');
      const old=retained.get(event.id),value=JSON.stringify(event);
      if(!old||old.value!==value){changes.push(event);coverage.transitions++;}
      const closed=event.status==='censored'||
        ['matched','mismatched','censored'].includes(event.feedbackStatus);
      retained.set(event.id,{value,closed:old?.closed||closed});
    }
    for(const [id,row] of retained)if(!seen.has(id)){
      if(!row.closed)coverage.missingTerminal++;
      retained.delete(id);
    }
    const numerator=sample.counts.criticCorrect,
      denominator=sample.counts.canonicalDemonstrations;
    return {terminal,changes,gaps,coverage:{...coverage,
      eventsEvicted:sample.eventsEvicted,eventsRetired:sample.eventsRetired,
      identityPendingReconciliation:sample.identityPendingReconciliation,
      identityHiddenRows:sample.identityPendingReconciliation?sample.eventsRetained:0,
      reasonOverflow:sample.reasonOverflow,
      admissionGateKeysOmitted:sample.admissionGateKeysOmitted},
    accuracy:{...ratio(numerator,denominator),criticIncorrect:denominator-numerator,
      censoredOriginal:sample.counts.originalCensors,
      unresolvedOrPending:Math.max(0,sample.counts.emissions-denominator-
        sample.counts.originalCensors),reference:0.5,
      referenceQualification:'Two candidate choices only; conditional on a canonical demonstration. One trajectory is descriptive, not a significance test.'},
    ratios:{emissionsPerOptionalCheck:ratio(sample.counts.emissions,sample.counts.optionalChecks),
      emissionsPerFeasibleOpportunity:ratio(sample.counts.emissions,sample.counts.feasibleOpportunities),
      inspectionsPerStart:ratio(sample.counts.paidInspectionCompletions,sample.counts.paidInspectionStarts),
      demonstrationsPerInspection:ratio(sample.counts.canonicalDemonstrations,sample.counts.paidInspectionCompletions),
      validLabelsPerDemonstration:ratio(sample.counts.validListenerDemonstrations,denominator),
      senderUpdatesPerReply:ratio(sample.counts.senderUpdates,sample.counts.paidReplyCompletions)},
    pendingObserved:sample.identityPendingReconciliation?null:
      [...retained.values()].filter(row=>!row.closed).length};
  }
  return {ingest};
}

/** The host is the only writer and charges whole UTF-8 records, including LF.
 * A failed reserve never partially admits its record. */
export function createCharacterPilotBudget(limits=P){
  const finite=value=>Number.isFinite(value)&&value>=0&&value<=1e12;
  if(!Number.isSafeInteger(limits.structuredBytes)||!Number.isSafeInteger(limits.mediaBytes)||
      !Number.isSafeInteger(limits.terminalReserveBytes)||
      limits.structuredBytes<=limits.terminalReserveBytes||
      limits.terminalReserveBytes<1||limits.mediaBytes<1)
    throw new RangeError('Invalid character pilot budgets');
  const used={structured:0,media:0},
    dropped={structuredRecords:0,structuredBytes:0,mediaChunks:0,mediaBytes:0};
  let firstBound=null;const additionalErrors=[];
  function stop(reason,wallMs){
    if(typeof reason!=='string'||reason.length<1||reason.length>64||!finite(wallMs))
      throw new TypeError('Invalid pilot stop cause');
    if(!firstBound)firstBound=Object.freeze({reason,wallMs});
    else if(reason!==firstBound.reason&&!additionalErrors.some(row=>row.reason===reason)&&
      additionalErrors.length<16)additionalErrors.push({reason,wallMs});
    return firstBound;
  }
  function reserve(kind,bytes,{terminal=false,wallMs=0}={}){
    if(!['structured','media'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<0)
      throw new TypeError('Invalid pilot byte reservation');
    const cap=kind==='media'?limits.mediaBytes:
      limits.structuredBytes-(terminal?0:limits.terminalReserveBytes);
    if(used[kind]+bytes>cap){
      if(kind==='structured'){dropped.structuredRecords++;dropped.structuredBytes+=bytes;}
      else{dropped.mediaChunks++;dropped.mediaBytes+=bytes;}
      stop(kind+'-cap',wallMs);return false;
    }
    used[kind]+=bytes;return true;
  }
  function record(value,{terminal=false,wallMs=0}={}){
    const json=JSON.stringify(value);
    if(typeof json!=='string')throw new TypeError('Invalid pilot JSON record');
    const line=json+'\n',bytes=Buffer.byteLength(line,'utf8');
    return {ok:reserve('structured',bytes,{terminal,wallMs}),
      line,bytes};
  }
  function snapshot(){return {used:{...used},dropped:{...dropped},
    firstCause:firstBound&&{...firstBound},firstBound:firstBound&&{...firstBound},
    additionalErrors:additionalErrors.map(row=>({...row})),
    causes:firstBound?[{...firstBound},...additionalErrors.map(row=>({...row}))]:[]};}
  return {reserve,record,stop,snapshot};
}

/** Terminal output retains the first failure even if a child sends an oversized
 * final projection. Its bound fits inside the reserved 256 KiB block. */
export function boundedCharacterPilotTerminal(value,maximumBytes=192*1024){
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<512||
      maximumBytes>P.terminalReserveBytes)
    throw new RangeError('Invalid pilot terminal bound');
  let out=value;
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes){
    const {projection,tracking,...rest}=out.terminal||{};
    out={...out,complete:false,terminal:{...rest,
      projectionOmitted:true,trackingOmitted:true,
      elapsed:projection?.elapsed??null},terminalTruncated:true};
  }
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes)
    out={type:'result',complete:false,terminalTruncated:true,
      firstStop:out.firstStop??out.budget?.firstBound??null,
      pausedConfirmed:out.pausedConfirmed??false,
      threshold:out.threshold??null,outcome:out.outcome??null,
      budget:out.budget??null};
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes)
    throw new Error('Minimal character pilot terminal record exceeded reserve');
  return out;
}
