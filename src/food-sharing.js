import { ozarkAgentWorld } from './ozark-agent-world.js';
import { contactEscape } from './discovery.js';
import { bodySignals } from './interoception.js';
import { isSleeping } from './biology.js';
import { actorLineOfSight } from './perception.js';
import { DISCOVERY_RULES } from './discovery-config.js';
import { describeEcologyObject, lookupEcologyObject } from './ecology.js';
import { validateDiscoveryMemory } from './discovery-state.js';
import { requestNpcSharedGrasp } from './npc.js';

import { FOOD_SHARING_ACTIONS } from './food-sharing-config.js';
export { FOOD_SHARING_ACTIONS };
const hungry = npc => ['hungry','ravenous','faint with hunger'].includes(bodySignals(npc).hunger);
const awake = npc => npc?.mode==='discovery'&&npc.lifecycle==='AWAKE'&&!isSleeping(npc)&&!['rest','sleep'].includes(npc.active?.request?.type);
const range = (a,b) => a.scene===b.scene&&Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)<=DISCOVERY_RULES.reach&&actorLineOfSight(a,a.position,b.position)&&actorLineOfSight(b,b.position,a.position);

/** Runtime consent, never saved authority. Only local attributed requests and
 * one disclosed offered identity are visible, never another person's inventory. */
export class FoodSharing {
  #requests=new Map();
  #offers=new Map();
  #lastRequest=new Map();
  #nextId=1;
  constructor(social){this.social=social;this.environment=social.getEnvironment?.();}
  dispose(){this.#requests.clear();this.#offers.clear();this.environment=null;}
  now(){return this.environment?.elapsed??0;}
  peer(npc,id){return this.social.agents().find(peer=>peer!==npc&&peer.id===id);}
  prune(){
    for(const map of [this.#requests,this.#offers])for(const [id,row] of map)
      if(this.now()<row.at||this.now()-row.at>=60||row.holdUntil!==undefined&&this.now()>=row.holdUntil||row.active&&row.recipient.active!==row.active)map.delete(id);
  }
  local(a,b){return this.social.getEnvironment?.()===this.environment&&this.social.agents().includes(a)&&this.social.agents().includes(b)&&awake(a)&&awake(b)&&range(a,b);}
  safeAttention(npc){
    const body=bodySignals(npc),ground=ozarkAgentWorld(npc)?.observe(npc.position)?.ground;
    return awake(npc)&&body.overall!=='urgent'&&!['parched','desperate thirst'].includes(body.thirst)&&
      body.sleepiness!=='struggling to stay awake'&&!['shallow-water','deep-water','deep-pond'].includes(ground)&&!contactEscape(npc);
  }
  holding(npc){
    this.prune();const offer=this.#offers.get(npc.id);
    if(!offer)return false;
    const item=lookupEcologyObject(this.environment.ecology,offer.objectId);
    if(!item||item.heldBy!==npc.id||!npc.inventory.items.includes(offer.objectId)||!this.safeAttention(npc)||!this.local(npc,offer.recipient)){
      this.#offers.delete(npc.id);return false;
    }
    return true;
  }
  observe(npc){
    this.prune();
    return {
      requests:[...this.#requests.values()].filter(row=>row.recipient===npc&&this.local(npc,row.sender)).map(row=>({id:row.id,senderId:row.sender.id,text:row.text})),
      offers:[...this.#offers.values()].filter(row=>row.recipient===npc&&!row.accepted&&this.local(npc,row.sender)).map(row=>({id:row.id,senderId:row.sender.id,objectId:row.objectId,text:row.text,appearance:describeEcologyObject(this.environment.ecology,row.objectId,{actorId:row.sender.id})?.appearance})),
    };
  }
  speak(npc,peer,text){return this.social.say(npc,{targetId:peer.id,text,offline:true});}
  consentSpeech(npc,peer,text){
    // Acceptance/refusal is bounded by an existing one-shot offer. Safety and
    // revocation cannot be delayed by the ordinary unsolicited-speech cooldown.
    const message=this.social.append({senderId:npc.id,recipientId:peer.id,channel:'peer',text},this.now());
    this.social.receive(npc,message);this.social.receive(peer,message);
    return {ok:true,message};
  }
  action(npc,action){
    this.prune();
    if(!this.environment||!awake(npc)||!this.social.agents().includes(npc))return {ok:false,code:'SHARING_UNAVAILABLE'};
    if(action.type==='request_food'){
      const peer=this.peer(npc,action.targetId);
      if(!peer||!this.local(npc,peer))return {ok:false,code:'PEER_OUT_OF_REACH'};
      if(!hungry(npc))return {ok:false,code:'NO_FOOD_NEED'};
      if(this.now()-(this.#lastRequest.get(npc.id)??-Infinity)<120)return {ok:false,code:'REQUEST_COOLDOWN'};
      const text=`I feel ${bodySignals(npc).hunger}. Do you have something you would choose to share? I do not know whether it will help me.`;
      const spoken=this.speak(npc,peer,text);if(!spoken.ok)return spoken;
      const id=`food-request:${this.#nextId++}`;
      this.#requests.set(npc.id,{id,sender:npc,recipient:peer,at:this.now(),text});this.#lastRequest.set(npc.id,this.now());
      return {ok:true,code:'FOOD_REQUESTED',requestId:id,message:spoken.message};
    }
    if(action.type==='offer_food'){
      const peer=this.peer(npc,action.targetId),item=lookupEcologyObject(this.environment.ecology,action.objectId);
      if(!peer||!this.local(npc,peer))return {ok:false,code:'PEER_OUT_OF_REACH'};
      if(npc.active)return {ok:false,code:'ACTION_BUSY'};
      if(!item||!['material','fish_specimen'].includes(item.kind)||item.heldBy!==npc.id||!npc.inventory.items.includes(item.id))return {ok:false,code:'NOT_HELD'};
      const appearance=describeEcologyObject(this.environment.ecology,item.id,{actorId:npc.id})?.appearance;
      const text=`I can offer what I am holding: ${appearance?.shape||'this material'}. You may take it or decline; I cannot promise what you will feel.`;
      const spoken=this.speak(npc,peer,text);if(!spoken.ok)return spoken;
      const id=`food-offer:${this.#nextId++}`;
      this.#offers.set(npc.id,{id,sender:npc,recipient:peer,objectId:item.id,at:this.now(),holdUntil:this.now()+15,text,accepted:false,active:null});
      this.#requests.delete(peer.id);
      return {ok:true,code:'FOOD_OFFERED',offerId:id,message:spoken.message};
    }
    const offer=[...this.#offers.values()].find(row=>row.id===action.offerId);
    if(action.type==='decline_food'){
      const request=[...this.#requests.values()].find(row=>row.id===action.requestId&&row.recipient===npc);
      const row=offer&&(offer.sender===npc||offer.recipient===npc)?offer:request;
      if(!row)return {ok:false,code:'UNKNOWN_FOOD_EXCHANGE'};
      const peer=row.sender===npc?row.recipient:row.sender;
      if(!this.local(npc,peer))return {ok:false,code:'PEER_OUT_OF_REACH'};
      const spoken=this.consentSpeech(npc,peer,offer?.sender===npc?'I am withdrawing my offer.':request?'I cannot share anything right now.':'I choose not to take that.');
      if(!spoken.ok)return spoken;
      if(offer)this.#offers.delete(offer.sender.id);else this.#requests.delete(request.sender.id);
      return {ok:true,code:'FOOD_DECLINED',message:spoken.message};
    }
    if(action.type!=='accept_food'||!offer||offer.recipient!==npc||offer.accepted)return {ok:false,code:'UNKNOWN_FOOD_OFFER'};
    if(!this.local(npc,offer.sender)||offer.sender.active)return {ok:false,code:'PEER_UNAVAILABLE'};
    // The receiver chooses an attempt, not eating. Consent remains revocable
    // throughout measured work and cannot survive restart/copy/cancellation.
    const consent=()=>this.#offers.get(offer.sender.id)===offer&&this.now()>=offer.at&&this.now()-offer.at<60&&
      this.now()<offer.holdUntil&&this.local(npc,offer.sender)&&this.safeAttention(npc)&&this.safeAttention(offer.sender)&&!offer.sender.active&&(!offer.active||npc.active===offer.active);
    const result=requestNpcSharedGrasp(npc,offer.sender,offer.objectId,this.environment,consent);
    if(result.code==='ACTION_STARTED'){offer.accepted=true;offer.active=npc.active;this.consentSpeech(npc,offer.sender,'I choose to take what you offered. I will have to try it myself to know its effects.');}
    return result;
  }
  choose(npc){
    if(!this.environment||!awake(npc)||npc.active||!this.safeAttention(npc))return null;
    const observed=this.observe(npc);
    const offer=observed.offers[0];
    if(offer)return {type:hungry(npc)&&npc.inventory.items.length<DISCOVERY_RULES.capacity&&!npc.discovery.effects.some(e=>e.objectId===offer.objectId&&e.effect==='discomfort')?'accept_food':'decline_food',offerId:offer.id};
    const request=observed.requests[0];
    if(request){
      // Exact personal effects only. No source/species generalization or access
      // to recipient stores. A donor with its own hunger can decline.
      const proof=validateDiscoveryMemory(npc.discovery,npc);
      const id=!hungry(npc)&&npc.inventory.items.find(id=>proof.effects.some(e=>e.objectId===id&&e.effect==='sustained')&&!proof.effects.some(e=>e.objectId===id&&e.effect==='discomfort'));
      return id?{type:'offer_food',targetId:request.senderId,objectId:id}:{type:'decline_food',requestId:request.id};
    }
    if(hungry(npc)&&!npc.inventory.items.length&&this.now()-(this.#lastRequest.get(npc.id)??-Infinity)>=120){
      const peer=this.social.nearby(npc).find(peer=>this.local(npc,peer));
      if(peer)return {type:'request_food',targetId:peer.id};
    }
    return null;
  }
}
