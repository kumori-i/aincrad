/** Prospective, observer-only protocol. No simulation, learner or actuator imports. */
export const ORDINARY_REFERENCE_PROTOCOL=Object.freeze({
  id:'ordinary-reference-acquisition-v1',geometryIdentity:'sha256:8f029100a4af44c415d9d5079d002e1bc34ca45d6a58803494385bc030b8ddc3',worldSeed:74193,communicationSeed:211,
  sourceCommit:'0d6c5a4eeeda33108405ce5ac7dd86af3b90dee0',
  sourceTree:'9954ebcc14f1789021489f28158e21ea9ef03c08',
  runtimeFingerprint:'9c96950360a457000269093ff6fd58f6ef9b5d4b11cfb59fc94cbcd48b8b7d60',
  fixedStep:1/60,speed:1,targetSeconds:1200,pollWallMs:1000,summarySeconds:10,
  wallLimitMs:30*60*1000,structuredBytes:32*1024*1024,mediaBytes:16*1024*1024,
  terminalReserveBytes:256*1024,overshootSeconds:2,stopGraceMs:5000,
  activationRef:'experiments/reference-acquisition-v1-once',
  workflow:'Ordinary reference acquisition — approved once',platform:'linux',architecture:'x64',
});

/** Serialized into the ordinary renderer. Only the documented normal pause is
 * permitted, once the first observed threshold is reached. Never advances time. */
export function readOrdinaryClock(stopAt=null){
  const q=window.__ozarkWorld,s=q.snapshot(),observedWallMs=Date.now();
  const threshold=Number.isFinite(stopAt)&&s.started&&!s.paused&&s.elapsed>=stopAt;
  if(threshold)q.pause();
  const after=threshold?q.snapshot():s;
  return {elapsed:s.elapsed,observedWallMs,started:s.started,paused:after.paused,
    blocked:s.blocked,speed:Number(document.getElementById('simulation-speed').value),
    fixtureOwned:q.referenceFixtureState()!==null,threshold,
    pausedElapsed:threshold?after.elapsed:null};
}

/** This projection executes in the renderer, so large private pixel ledgers and
 * complete world copies never cross IPC. Values are observation, not inputs. */
export async function projectOrdinaryReference(){
  const q=window.__ozarkWorld,w=q.fullSnapshot(),r=q.communicationSnapshot();
  const {CONFIG}=await import('./src/config.js');
  const numeric=(o,keys)=>Object.fromEntries(keys.map(k=>[k,Number.isFinite(o?.[k])?o[k]:null]));
  const bodyKeys=['health','condition','availableEnergyKcal','storedEnergyKcal','waterDeficitMl','stamina','fatigue','sleepPressure','hoursSinceMeal','starvationHours','satietyHours'];
  const metricKeys=['opportunities','exchanges','completed','observed','correct','censored','pending','updates','anchorsAllocated','matchedChoices','exploratoryChoices','correctionAttempts','evidenceAdditions','supportUpdates','conflicts','correctionAbstentions'];
  if(!r)throw new Error('Reference observer unavailable');
  return {elapsed:w.elapsed,wallMs:Date.now(),version:w.version,geometryIdentity:w.geometryIdentity,
    worldSeed:w.environment.seed,communicationSeed:r.seed,phase:r.phase,fixedStep:CONFIG.fixedStep,
    referenceElapsed:r.elapsed,clocks:{environment:w.environment.elapsed,ecology:w.environment.ecology.elapsed,pending:w.environment.ecology.pending},
    metrics:numeric(r,metricKeys),gates:{...r.gates},
    agents:w.agents.map(n=>({id:n.id,scene:n.scene,position:{...n.position},elapsed:n.elapsed,
      epoch:n.epoch,lifecycle:n.lifecycle,bodyMode:n.bodyMode,rng:n.rng,
      referenceIdentity:r.learners.find(l=>l.agentId===n.id)?.identity??null,
      projectedBody:numeric(n,['health','hydration','nourishment','energy','stamina']),
      physiology:numeric(n.physiology,bodyKeys),totals:{...n.physiology.totals},
      sleep:{state:n.physiology.sleep.state,hours:n.physiology.sleep.hours},
      stats:numeric(n.stats,['collapses','rescues','independentMeals','independentDrinks']),
      active:n.active?{type:n.active.type??n.active.request?.type??null}:null,
      memory:{...(r.learners.find(l=>l.agentId===n.id)?.counts||{})},
      earned:{effects:n.discovery.effects.length,techniques:n.discovery.techniques.length}})),
    player:{position:{...w.player},physiology:numeric(w.playerBody,bodyKeys)},
    events:(r.observationEvents||[]).map(e=>Object.fromEntries(
      ['id','emittedAt','endedAt','senderId','receiverId','status','reason','choiceMode','choiceReason','correction','referenceCorrect','observedSeconds','selectedActionId','indicationActionId']
        .filter(k=>e[k]!==undefined).map(k=>[k,e[k]])))};
}

export function validateClock(sample,{started=true}={}){
  if(!sample||!Number.isFinite(sample.elapsed)||sample.elapsed<0||sample.blocked||sample.fixtureOwned||sample.speed!==1||sample.started!==started)
    throw new Error('Ordinary default clock/profile invariant failed');
}
export function validateProjection(s){
  const p=ORDINARY_REFERENCE_PROTOCOL;
  if(!s||s.worldSeed!==p.worldSeed||s.communicationSeed!==p.communicationSeed||s.phase!=='private-visual-association'||s.fixedStep!==p.fixedStep||s.version!==12||s.geometryIdentity!==p.geometryIdentity)
    throw new Error('Frozen ordinary world identity differs');
  if(!Number.isFinite(s.elapsed)||s.elapsed<0||s.referenceElapsed!==s.elapsed||!Array.isArray(s.agents)||s.agents.length!==2||!Array.isArray(s.events))throw new Error('Invalid observer projection');
  if(Object.values(s.metrics).some(v=>!Number.isFinite(v)||v<0)||Object.values(s.gates).some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid reference counters');
  if(Math.abs(s.clocks.environment-s.elapsed)>1e-6||Math.abs(s.clocks.ecology+s.clocks.pending-s.elapsed)>1e-6||s.agents.some(n=>Math.abs(n.elapsed-s.elapsed)>1e-6))throw new Error('Ordinary clocks diverged');
}

/** Bounded by the retained 256-event source ledger; missing entries are evidence
 * gaps, never guessed terminal outcomes. No pixels or private feature copies. */
export function createOrdinaryReferenceTracker(){
  let previousElapsed=-Infinity,maxId=0,lastSummary=-Infinity,retiredThrough=0;
  const retained=new Map(),coverage={missingIds:0,missingTerminal:0,observedEvents:0},
    outcomes={matched:{observed:0,correct:0,incorrect:0,unknownCorrectness:0,censored:0},exploratory:{observed:0,correct:0,incorrect:0,unknownCorrectness:0,censored:0},unknownMode:{observed:0,correct:0,incorrect:0,unknownCorrectness:0,censored:0}};
  function ingest(s,{terminal=false}={}){
    validateProjection(s);if(s.elapsed<previousElapsed)throw new Error('Observed time regressed');previousElapsed=s.elapsed;
    const sorted=s.events.slice().sort((a,b)=>a.id-b.id),ids=new Set(),changes=[],gaps=[];
    if(sorted.length>256)throw new Error('Reference ledger exceeded supplied capacity');
    for(const e of sorted){
      if(!Number.isInteger(e.id)||e.id<=0||ids.has(e.id))throw new Error('Invalid or duplicate event identity');ids.add(e.id);
      if(e.id>maxId){if(e.id>maxId+1){gaps.push({from:maxId+1,to:e.id-1});coverage.missingIds+=e.id-maxId-1;}maxId=e.id;coverage.observedEvents++;}
      let old=retained.get(e.id);
      if(e.id<=retiredThrough)throw new Error('Retired ledger identity reappeared');
      if(old?.counted&&JSON.stringify(old.event)!==JSON.stringify(e))throw new Error('Terminal ledger event changed');
      if(!old||JSON.stringify(old.event)!==JSON.stringify(e))changes.push({...e});
      const terminalEvent=e.status==='observed'||e.status==='censored';
      if(terminalEvent&&!old?.counted){
        const row=outcomes[e.choiceMode==='association-match'?'matched':e.choiceMode==='uniform-exploration'?'exploratory':'unknownMode'];
        if(e.status==='censored')row.censored++;
        else{row.observed++;if(e.referenceCorrect===true)row.correct++;else if(e.referenceCorrect===false)row.incorrect++;else row.unknownCorrectness++;}
      }
      retained.set(e.id,{event:{...e},counted:old?.counted||terminalEvent});
    }
    if(!sorted.length&&maxId)throw new Error('Previously populated ledger disappeared');
    const minimum=sorted[0]?.id;
    if(minimum!==undefined)for(const [id,row]of retained)if(id<minimum){if(!row.counted)coverage.missingTerminal++;retained.delete(id);retiredThrough=Math.max(retiredThrough,id);}
    const due=terminal||lastSummary===-Infinity||s.elapsed-lastSummary>=ORDINARY_REFERENCE_PROTOCOL.summarySeconds-1e-8;
    if(due)lastSummary=s.elapsed;
    return {due,changes,gaps,coverage:{...coverage},outcomes:structuredClone(outcomes),pendingObserved:[...retained.values()].filter(r=>!r.counted).length};
  }
  return {ingest};
}

/** The host is the sole writer and budget owner. A rejected record is never
 * partially written, and reserved termination bytes cannot be spent on samples. */
export function createOrdinaryOutputBudget(limits=ORDINARY_REFERENCE_PROTOCOL){
  const used={structured:0,media:0},dropped={structured:0,media:0};let firstBound=null;const causes=[];
  const stop=(reason,wallMs)=>{if(!causes.some(c=>c.reason===reason)&&causes.length<16)causes.push({reason,wallMs});return firstBound??=(Object.freeze({reason,wallMs}));};
  function reserve(kind,bytes,{terminal=false,wallMs=0}={}){
    if(!['structured','media'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<0)throw new TypeError('Invalid output reservation');
    const cap=kind==='media'?limits.mediaBytes:limits.structuredBytes-(terminal?0:limits.terminalReserveBytes);
    if(used[kind]+bytes>cap){dropped[kind]+=bytes;stop(kind+'-cap',wallMs);return false;}
    used[kind]+=bytes;return true;
  }
  return {reserve,stop,snapshot:()=>({used:{...used},dropped:{...dropped},firstBound,causes:causes.map(c=>({...c}))})};
}

/** Final evidence must fit the pre-reserved block even if a malformed child sent
 * a large terminal projection. Omissions are explicit; the first cause survives. */
export function boundedOrdinaryTerminal(record,maximumBytes=192*1024){
  let out=record;
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes){
    const {projection,tracking,...rest}=out.terminal||{};
    out={...out,complete:false,terminal:{...rest,projectionOmitted:true,trackingOmitted:true,elapsed:projection?.elapsed??null},terminalTruncated:true};
  }
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes)out={type:'result',complete:false,terminalTruncated:true,pausedConfirmed:out.pausedConfirmed,budget:out.budget,outcome:out.outcome,threshold:out.threshold};
  if(Buffer.byteLength(JSON.stringify(out)+'\n')>maximumBytes)throw new Error('Minimal terminal evidence exceeds reserved bound');
  return out;
}
