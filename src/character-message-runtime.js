// Private runtime owner for the numeric character policy. The physical
// attachment supplies only copied own-view features and canonical outcomes.
// This module holds no world object, object binding, critic or action permit.
import {
  CHARACTER_CORE, createSenderParameters, createListenerParameters,
  copySenderParameters, copyListenerParameters, initialCharacterRandomState,
  sampleSender, sampleListener, classifyOwnDemonstration,
  samplePriorExampleIndices, trainSender, trainListenerBatch,
} from './character-message-core.js';

const C=CHARACTER_CORE;
const uint32=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const peerId=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);
const modelData=model=>Object.fromEntries(Object.entries(model).map(([name,values])=>[name,Array.from(values)]));
const copiedExample=example=>({message:example.message,
  candidates:example.candidates.map(features=>Array.from(features)),label:example.label});
const increment=value=>{
  if(!count(value)||value===Number.MAX_SAFE_INTEGER)throw new RangeError('Character learner counter exhausted');
  return value+1;
};
const addCount=(value,amount)=>{
  if(!count(value)||!count(amount)||value>Number.MAX_SAFE_INTEGER-amount)
    throw new RangeError('Character learner counter exhausted');
  return value+amount;
};

export function createCharacterMessageLearner({seed,ownerSerial,restored=null}={}){
  if(!uint32(seed)||!uint32(ownerSerial)||ownerSerial===0)
    throw new TypeError('Character learner needs a seed and continuing owner serial');
  const partnerSeed=(seed^ownerSerial)>>>0;
  const freshSender=()=>({model:createSenderParameters({seed,identity:ownerSerial}),
    baseline:0,revision:0,emissions:0,updates:0,
    randomState:initialCharacterRandomState({seed,identity:ownerSerial,purpose:'senderSample'})});
  const freshListener=serial=>({model:createListenerParameters({seed:partnerSeed,identity:serial}),
    demonstrations:0,replayUses:0,optimizerSteps:0,
    choiceState:initialCharacterRandomState({seed:partnerSeed,identity:serial,purpose:'listenerChoice'}),
    replayState:initialCharacterRandomState({seed:partnerSeed,identity:serial,purpose:'listenerReplay'}),examples:[]});
  const source=restored?.sender??freshSender();
  let sender={model:copySenderParameters(source.model),baseline:source.baseline,
    revision:source.revision,emissions:source.emissions,updates:source.updates,
    randomState:source.randomState};
  if(!Number.isFinite(sender.baseline)||sender.baseline < -1||sender.baseline > 1||
      ![sender.revision,sender.emissions,sender.updates].every(count)||
      sender.revision!==sender.updates||sender.updates>sender.emissions||!uint32(sender.randomState))
    throw new TypeError('Invalid character sender restoration');
  const unbound=new Map();
  for(const row of restored?.partners??[]){
    if(!peerId(row.agentId)||!uint32(row.serial)||row.serial===0||
        unbound.has(`${row.agentId}:${row.serial}`))throw new TypeError('Invalid character partner restoration');
    const value=row.listener;
    const listener={model:copyListenerParameters(value.model),demonstrations:value.demonstrations,
      replayUses:value.replayUses,optimizerSteps:value.optimizerSteps,
      choiceState:value.choiceState,replayState:value.replayState,
      examples:value.examples.map(copiedExample)};
    if(![listener.demonstrations,listener.replayUses,listener.optimizerSteps].every(count)||
        listener.optimizerSteps!==listener.demonstrations||
        listener.replayUses>3*listener.demonstrations||
        !uint32(listener.choiceState)||!uint32(listener.replayState)||
        listener.examples.length>C.replayCapacity||listener.examples.length>listener.demonstrations)
      throw new TypeError('Invalid character listener restoration');
    unbound.set(`${row.agentId}:${row.serial}`,listener);
  }
  let pending=null,disposed=false;
  const partners=new Map();
  function requireLive(){if(disposed)throw new Error('Character learner disposed');}
  function reconcilePartners(current){
    requireLive();
    if(!Array.isArray(current)||current.length>1)throw new TypeError('Expected the current private partner');
    const next=new Map();
    for(const row of current){
      if(!row||typeof row.token!=='object'||row.token===null||!peerId(row.agentId)||
          !uint32(row.serial)||row.serial===0||next.has(row.token))
        throw new TypeError('Invalid current character partner');
      const key=`${row.agentId}:${row.serial}`;
      const prior=partners.get(row.token);
      if(prior&&(prior.agentId!==row.agentId||prior.serial!==row.serial))
        throw new TypeError('Character partner token rebound');
      const listener=prior?.listener??unbound.get(key)??freshListener(row.serial);
      unbound.delete(key);
      next.set(row.token,{agentId:row.agentId,serial:row.serial,listener});
    }
    if(unbound.size)throw new TypeError('Restored character partner is not current');
    if(pending&&!next.has(pending.partnerToken))pending=null;
    partners.clear();for(const [token,row]of next)partners.set(token,row);
  }
  function sampleMessage(partnerToken,ownFeatures){
    requireLive();
    if(pending||!partners.has(partnerToken))return null;
    const sampled=sampleSender(sender.model,ownFeatures,sender.randomState);
    const emissions=increment(sender.emissions);
    const handle=Object.freeze({});
    pending={handle,partnerToken,revision:sender.revision,trajectory:sampled.trajectory};
    sender.randomState=sampled.randomState;sender.emissions=emissions;
    return {message:sampled.message,handle};
  }
  function choose(partnerToken,message,ownCandidates){
    requireLive();
    const row=partners.get(partnerToken);
    if(!row)return null;
    const bank=row.listener,trained=bank.demonstrations>0;
    const sampled=sampleListener(bank.model,message,ownCandidates,bank.choiceState,{hasDemonstration:trained});
    bank.choiceState=sampled.randomState;
    return {index:sampled.choice,mode:trained?'model-sample':'uniform-untrained',
      probabilities:sampled.probabilities.slice()};
  }
  function learnDemonstration(partnerToken,message,originalOwnCandidates,finalOwnFeatures){
    requireLive();
    const row=partners.get(partnerToken);
    if(!row)return {updated:false,label:null,reason:'stale-partner'};
    const label=classifyOwnDemonstration(originalOwnCandidates,finalOwnFeatures);
    if(label===null)return {updated:false,label:null,reason:'ambiguous-own-view'};
    const bank=row.listener;
    const example=copiedExample({message,candidates:originalOwnCandidates,label});
    const replay=samplePriorExampleIndices(bank.examples.length,bank.replayState);
    const batch=[example,...replay.indices.map(index=>bank.examples[index])];
    const result=trainListenerBatch(bank.model,batch);
    // Only a fully computed finite update commits RNG, replay and counters.
    const demonstrations=increment(bank.demonstrations),
      optimizerSteps=increment(bank.optimizerSteps),
      replayUses=addCount(bank.replayUses,replay.indices.length);
    const examples=bank.examples.concat([example]);
    if(examples.length>C.replayCapacity)examples.shift();
    bank.model=result.model;bank.demonstrations=demonstrations;
    bank.optimizerSteps=optimizerSteps;bank.replayUses=replayUses;
    bank.replayState=replay.randomState;bank.examples=examples;
    return {updated:true,label,reason:'own-view-demonstration',
      replayUsed:replay.indices.length,lossBefore:result.lossBefore,lossAfter:result.lossAfter};
  }
  function settleMessage(handle,partnerToken,signal){
    requireLive();
    if(!pending||pending.handle!==handle)return {updated:false,reason:'unknown-handle'};
    const record=pending;pending=null; // A canonical attempt consumes authority even on rejection.
    if(record.partnerToken!==partnerToken||!partners.has(partnerToken)||
        record.revision!==sender.revision||!['match','mismatch'].includes(signal))
      return {updated:false,reason:'stale-or-censored'};
    try{
      const result=trainSender(sender.model,record.trajectory,
        {reward:signal==='match'?1:-1,baseline:sender.baseline});
      const revision=increment(sender.revision),updates=increment(sender.updates);
      sender.model=result.model;sender.baseline=result.baseline;
      sender.revision=revision;sender.updates=updates;
      return {updated:true,reason:'sender-local-response',advantage:result.advantage,
        logProbabilityBefore:result.logProbabilityBefore,
        logProbabilityAfter:result.logProbabilityAfter};
    }catch{return {updated:false,reason:'numeric-update-rejected'};}
  }
  function cancelMessage(handle){
    if(disposed||!pending||pending.handle!==handle)return false;
    pending=null;return true;
  }
  function cancelPending(){pending=null;}
  function snapshot(){
    const rows=[...partners.values()];
    const banks=rows.map(row=>({partnerId:row.agentId,partnerSerial:row.serial,
      retainedExamples:row.listener.examples.length,trained:row.listener.demonstrations>0}));
    return {senderUpdates:sender.updates,
    listenerUpdates:rows.reduce((total,row)=>total+row.listener.optimizerSteps,0),
    uniqueDemonstrations:rows.reduce((total,row)=>total+row.listener.demonstrations,0),
    replayUses:rows.reduce((total,row)=>total+row.listener.replayUses,0),
    partnerBanks:banks};
  }
  function exportPersistence(){
    // Retired save gates compare this pure projection after disposal. Pending
    // authority has been erased, while completed durable learning stays put.
    if(unbound.size)throw new TypeError('Unbound character partner at export');
    return {sender:{model:modelData(sender.model),baseline:sender.baseline,
      revision:sender.revision,emissions:sender.emissions,updates:sender.updates,
      randomState:sender.randomState},
    partners:[...partners.values()].map(row=>({agentId:row.agentId,serial:row.serial,
      listener:{model:modelData(row.listener.model),demonstrations:row.listener.demonstrations,
        replayUses:row.listener.replayUses,optimizerSteps:row.listener.optimizerSteps,
        choiceState:row.listener.choiceState,replayState:row.listener.replayState,
        examples:row.listener.examples.map(copiedExample)}}))};
  }
  function dispose(){pending=null;disposed=true;}
  return Object.freeze({reconcilePartners,sampleMessage,choose,learnDemonstration,
    settleMessage,cancelMessage,cancelPending,snapshot,exportPersistence,dispose});
}
