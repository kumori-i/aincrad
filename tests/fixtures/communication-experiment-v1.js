// An isolated, ephemeral bridge to the real survival runtime. No save API,
// pretrained weights, target-match reward, or model-service client is used.
import { createOzarkState } from '../../src/ozark-save.js';
import { bindOzarkWorldAgent } from '../../src/ozark-agent-world.js';
import { PopulationRuntime } from '../../src/population.js';
import { CommunicationLearner } from '../../src/communication-learning.js';
import { canonicalCommunicationEffect, createCommunicationCredit, pollCommunicationCredit } from '../../src/communication-credit.js';
import { actorLineOfSight } from '../../src/perception.js';
import { bodySignals } from '../../src/interoception.js';
import { isSleeping } from '../../src/biology.js';

const MOTORS=['inspect_object','grasp','release','pull','sample','strike','catch'];
function stream(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
function ordinal(value,values){const i=values.indexOf(value);return i<0?0:2*i/(values.length-1)-1;}
function body(n){const s=bodySignals(n);return [ordinal(s.hunger,['content','peckish','hungry','ravenous','faint with hunger']),ordinal(s.thirst,['quenched','dry mouth','thirsty','parched','desperate thirst']),ordinal(s.energy,['steady','waning','low','depleted']),ordinal(s.pain,['none','aching','hurting','severe'])];}
function sensation(e){return [e.hunger==='easing'?1:0,e.thirst==='easing'?1:0,e.energy==='easing'?1:0,ordinal(e.pain,['none','aching','hurting','severe'])];}

export function createCommunicationExperiment({geometry,seed=211,enabled=true,pixelSensor}) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Expected a uint32 seed');
  if(!pixelSensor || typeof pixelSensor.capture!=='function')throw new TypeError('A live pixel sensor is required');
  const state=createOzarkState(geometry), records=new Map(), pending=new Map(), offers=new Map();
  const order=stream(seed^0x935ab21), history=[], ledger=[], metrics={exchanges:0,updates:0,positive:0,negative:0,expired:0,censored:0,attributed:0,failedUpdates:0,ledgerDropped:0};
  let disposed=false,latest=null,finalDiagnostic=null;
  for(const [i,n]of state.agents.entries()){
    n.seed=n.rng=(seed^(i?0x9e3779b9:0x15a4e35))>>>0;
    bindOzarkWorldAgent(n,geometry,state);
    records.set(n.id,{model:new CommunicationLearner((seed^(i?0x693a31:0x4c78a2))>>>0),crops:new Map(),samples:new Map(),seenSamples:new Set(),source:null,lastCapture:-Infinity,lastOpportunity:-Infinity,outbound:false,counts:{samples:0,social:0},eventCursor:0});
  }
  for(const r of records.values())r.initialDiagnostics=r.model.diagnostics();
  function logOutcome(offer,result,credit=null){
    ledger.push({senderId:offer.senderId,receiverId:offer.receiverId,action:{type:offer.action.type,targetId:offer.action.targetId},tokens:offer.emitted.tokens.slice(),startedAt:credit?.at??null,endedAt:state.agents.find(n=>n.id===offer.receiverId)?.elapsed??null,deadline:credit?.deadline??null,selectedActionId:credit?.selected?.actionId??null,...result,ingestion:result.ingestion?{...result.ingestion}:null});
    if(ledger.length>256){ledger.shift();metrics.ledgerDropped++;}
  }
  function capture(n,force=false){
    const r=records.get(n.id);
    if(!force && n.elapsed-r.lastCapture<1)return;
    r.lastCapture=n.elapsed;
    const current=pixelSensor.capture(n,state);
    for(const [id,crop]of current)r.crops.set(id,crop);
    for(const[id,crop]of r.crops)if(n.elapsed-crop.at>6||crop.epoch!==n.epoch)r.crops.delete(id);
    while(r.crops.size>128)r.crops.delete(r.crops.keys().next().value);
    return current;
  }
  function discard(offer){offer.sender.model.discard(offer.emitted.trace);offer.receiver.model.discard(offer.chosen.trace);offer.sender.outbound=false;}
  const bridge={
    choose(n,choices){
      const r=records.get(n.id);
      if(disposed||pending.has(n.id)||offers.has(n.id)||n.elapsed-r.lastOpportunity<12)return null;
      const peer=state.agents.find(p=>p!==n&&p.lifecycle==='AWAKE'&&!isSleeping(p)&&p.scene===n.scene&&Math.hypot(p.position.x-n.position.x,p.position.y-n.position.y)<=250&&actorLineOfSight(n,n.position,p.position));
      const sender=peer&&records.get(peer.id), source=sender?.source;
      if(!source||sender.outbound||peer.elapsed-source.effect.at>300||!canonicalCommunicationEffect(peer,source.effect)||source.epoch!==peer.epoch)return null;
      const current=capture(n,true);
      const eligible=choices.map((choice,index)=>({choice,index,crop:current.get(choice.action?.targetId)})).filter(x=>MOTORS.includes(x.choice.action.type)&&x.crop&&x.crop.epoch===n.epoch&&n.elapsed-x.crop.at<=1.1);
      if(eligible.length<2)return null;
      for(let i=eligible.length-1;i>0;i--){const j=Math.floor(order()*(i+1));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
      const selected=eligible.slice(0,8), candidates=selected.map(x=>({pixels:x.crop.features,motor:MOTORS.indexOf(x.choice.action.type)}));
      const emitted=sender.model.emit(source.crop.features,body(peer),sensation(source.effect));
      const message=enabled?emitted.messageIndex:null, ownBody=body(n),chosen=r.model.choose(candidates,ownBody,message),entry=selected[chosen.index];
      const offer={sender,receiver:r,senderActor:peer,senderEpoch:peer.epoch,senderDiscovery:peer.discovery,senderPhysiology:peer.physiology,senderId:peer.id,receiverId:n.id,emitted,chosen,action:entry.choice.action,eventFloor:n.memory.nextId};
      offers.set(n.id,offer);sender.outbound=true;r.lastOpportunity=n.elapsed;metrics.exchanges++;
      history.push({receiverId:n.id,candidates,body:ownBody,message:emitted.messageIndex});if(history.length>32)history.shift();
      latest={senderId:peer.id,receiverId:n.id,tokens:emitted.tokens.slice(),status:'selected',reward:null,senderPixels:source.crop.pixels.slice(),receiverPixels:entry.crop.pixels.slice(),action:entry.choice.action.type};
      offer.display=latest;
      return entry.index;
    },
    performed(n,action,result,active){
      const offer=offers.get(n.id);if(!offer)return;
      offers.delete(n.id);
      const credit=action===offer.action&&createCommunicationCredit(n,action,active,offer.eventFloor);
      if(!credit){discard(offer);metrics.censored++;offer.display.status='interrupted';logOutcome(offer,{status:'interrupted',reward:null});return;}
      pending.set(n.id,{offer,credit});offer.display.status='awaiting own physical outcome';
    },
  };
  const runtime=new PopulationRuntime(state,{cardinal:false,experimentalDiscovery:bridge});
  function settle(id,item,stop=false){
    const sender=item.offer.senderActor;
    const interrupted=sender.epoch!==item.offer.senderEpoch||sender.discovery!==item.offer.senderDiscovery||sender.physiology!==item.offer.senderPhysiology||sender.lifecycle!=='AWAKE';
    const result=pollCommunicationCredit(item.credit,{stop:stop||interrupted});if(!result)return;
    pending.delete(id);const o=item.offer;
    o.display.status=result.status;o.display.reward=result.reward;logOutcome(o,result,item.credit);
    if(result.reward===null){discard(o);metrics.censored++;return;}
    const senderLearned=o.sender.model.learnSender(o.emitted.trace,result.reward),receiverLearned=o.receiver.model.learnReceiver(o.chosen.trace,result.reward);o.sender.outbound=false;
    if(!senderLearned||!receiverLearned){metrics.failedUpdates++;return;}
    metrics.updates++;if(result.reward>0)metrics.positive++;if(result.reward<0)metrics.negative++;metrics[result.status==='attributed'?'attributed':'expired']++;
  }
  function observe(n){
    const r=records.get(n.id);
    for(const e of n.discovery.experiments){
      if(e.primitive!=='sample'||!e.ok||!e.ingestionId||r.seenSamples.has(e.actionId))continue;
      r.seenSamples.add(e.actionId);r.counts.samples++;
      const crop=r.crops.get(e.targetId);
      if(crop&&crop.epoch===n.epoch&&crop.at<=e.at&&e.at-crop.at<=6)r.samples.set(e.actionId,{crop,epoch:n.epoch});
    }
    for(const e of n.discovery.effects){
      const sample=r.samples.get(e.actionId);
      if(sample&&sample.epoch===n.epoch&&canonicalCommunicationEffect(n,e)&&(!r.source||e.at>r.source.effect.at))r.source={...sample,effect:e};
    }
    // These counts are diagnostics only; conventional social learning remains
    // unchanged in both arms and is not conflated with the new token channel.
    for(const e of n.memory.experience)if(e.id>r.eventCursor){if(e.type==='action'&&['say','ask_human','journal_reply','write_note','read_note','offer_food','accept_food'].includes(e.details?.action?.type))r.counts.social++;r.eventCursor=Math.max(r.eventCursor,e.id);}
    while(r.samples.size>64)r.samples.delete(r.samples.keys().next().value);
    if(r.seenSamples.size>256)r.seenSamples=new Set(n.discovery.experiments.filter(e=>e.primitive==='sample').map(e=>e.actionId));
  }
  function diagnostic(){
    if(finalDiagnostic)return {...finalDiagnostic};
    if(!enabled)return {observations:history.length,meanTotalVariation:0,argmaxChanged:0,interpretation:'Constant-message receive boundary erases shuffled content; no claim of learned meaning'};
    let totalVariation=0,argmaxChanged=0;
    for(let i=0;i<history.length;i++){
      const h=history[i],model=records.get(h.receiverId).model,other=history[(i+1)%history.length].message;
      const a=model.receiverProbabilities(h.candidates,h.body,h.message),b=model.receiverProbabilities(h.candidates,h.body,other);
      totalVariation+=a.reduce((sum,p,j)=>sum+Math.abs(p-b[j]),0)/2;
      if(a.indexOf(Math.max(...a))!==b.indexOf(Math.max(...b)))argmaxChanged++;
    }
    return {observations:history.length,meanTotalVariation:history.length?totalVariation/history.length:0,argmaxChanged,interpretation:'Frozen shuffled-message policy sensitivity, possibly present at initialization; not survival benefit'};
  }
  return {
    state,runtime,
    tick(dt){
      if(disposed||!Number.isFinite(dt)||dt<=0||state.elapsed>=1800)return;
      const step=Math.min(dt,.25,1800-state.elapsed);
      for(const n of state.agents)capture(n);
      state.elapsed+=step;runtime.tick(step);
      for(const n of state.agents)observe(n);
      for(const[id,item]of pending)settle(id,item);
      if(state.elapsed>=1800)for(const[id,item]of pending)settle(id,item,true);
    },
    snapshot(){return {seed,enabled,elapsed:state.elapsed,ledger:structuredClone(ledger),learners:state.agents.map(n=>({id:n.id,initial:structuredClone(records.get(n.id).initialDiagnostics),current:records.get(n.id).model.diagnostics()})),...metrics,pending:pending.size,latest:latest?{...latest,tokens:latest.tokens.slice(),senderPixels:latest.senderPixels.slice(),receiverPixels:latest.receiverPixels.slice()}:null,agents:state.agents.map(n=>({id:n.id,name:n.name,hunger:n.nourishment,thirst:n.hydration,energy:n.energy,collapses:n.stats.collapses,meals:n.stats.independentMeals,drinks:n.stats.independentDrinks,samples:records.get(n.id).counts.samples,conventionalSocialEvents:records.get(n.id).counts.social})),diagnostic:diagnostic(),limitReached:state.elapsed>=1800};},
    dispose(){if(disposed)return;for(const[id,item]of pending)settle(id,item,true);for(const offer of offers.values()){discard(offer);metrics.censored++;logOutcome(offer,{status:'interrupted',reward:null});}offers.clear();finalDiagnostic=diagnostic();runtime.dispose();for(const r of records.values()){r.model.dispose();r.crops.clear();r.samples.clear();}pixelSensor.dispose?.();disposed=true;},
  };
}
