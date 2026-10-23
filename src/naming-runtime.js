import { recoverySafe } from './movement-recovery.js';
import { NPC_RULES, SOCIAL_RULES } from './config.js';
import { isSleeping } from './biology.js';
import { bodySignals } from './interoception.js';
import { actorLineOfSight } from './perception.js';
import { senseEcology } from './ecology.js';
import { rememberDiscoveryObservation, contactEscape } from './discovery.js';
import { ozarkAgentWorld } from './ozark-agent-world.js';
import { validLexicon, recordGrounding, resolveName, confirmReference, markNameAnnounced, markReferenceRequested } from './naming-state.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const NAMING_POINT_RADIUS=12;
export const NAMING_EXCHANGE_SECONDS=120;
export const NAMING_FOLLOWUP_SECONDS=8, NAMING_TURN_SECONDS=1;
const awake=n=>n?.mode==='discovery'&&n.lifecycle==='AWAKE'&&!isSleeping(n)&&!['rest','sleep','nap'].includes(n.active?.request?.type);
/** Supplied pointing affordance: no object ID is passed to the receiver's
 * resolver. An empty or non-unique patch supplies no lexical association. */
export function resolvePoint(objects,point){
  const candidates=objects.filter(o=>distance(o.position,point)<=NAMING_POINT_RADIUS);
  return candidates.length===1?candidates[0]:null;
}
/** Internal structured local events only. Prose, model output, notes and
 * restored community messages cannot enter this transport. */
export class NamingRuntime {
  #pending=new Map();
  #opportunities=new Map();
  constructor(social){this.social=social;this.environment=social.getEnvironment?.();}
  dispose(){this.#pending.clear();this.#opportunities.clear();this.environment=null;}
  pendingCount(){return this.#pending.size;}
  opportunityCount(){return new Set(this.#opportunities.values()).size;}
  endOpportunity(row){
    this.#opportunities.delete(row.speaker.id);this.#opportunities.delete(row.listener.id);
    for(const [key,p] of this.#pending)if(p.opportunity===row)this.#pending.delete(key);
  }
  followupSafe(n){return this.safe(n)&&recoverySafe(n);}
  followupTarget(row){
    const a=this.visible(row.speaker),b=this.visible(row.listener);
    const object=a.find(o=>o.id===row.intendedId);
    return !!object&&resolvePoint(a,object.position)?.id===object.id&&
      resolveName(row.listener,row.token,row.speaker.id,b.map(o=>o.id))===object.id;
  }
  pruneOpportunities(){
    const now=this.environment?.elapsed;
    for(const row of new Set(this.#opportunities.values())){
      if(!Number.isFinite(now)||now<row.at||now-row.at>=NAMING_FOLLOWUP_SECONDS||
        !this.local(row.speaker,row.listener)||!this.followupSafe(row.speaker)||!this.followupSafe(row.listener)||
        !this.social.agents().includes(row.speaker)||!this.social.agents().includes(row.listener)||
        row.speaker.epoch!==row.epochs[0]||row.listener.epoch!==row.epochs[1]||
        this.social.foodSharing?.holding(row.speaker)||this.social.foodSharing?.holding(row.listener)||!this.followupTarget(row))this.endOpportunity(row);
    }
  }
  // One brief continuation of a genuinely grounded introduction. It cannot
  // hold a body, choose/cancel an action, renew itself or retry a consumed name.
  offerFollowup(speaker,listener,own,event){
    if(this.#opportunities.has(speaker.id)||this.#opportunities.has(listener.id))return;
    const row={speaker,listener,token:own.token,intendedId:own.objectId,at:event.at,lastTurn:event.at,
      epochs:[speaker.epoch,listener.epoch],turns:0};
    this.#opportunities.set(speaker.id,row);this.#opportunities.set(listener.id,row);
  }
  opportunityFor(context){
    const row=context&&this.#opportunities.get(context.speaker.id);
    return row&&row.speaker===context.speaker&&row.listener===context.listener&&
      row.token===context.token&&row.intendedId===context.intendedId?row:null;
  }

  safe(n){
    if(!awake(n))return false;
    const b=bodySignals(n),ground=ozarkAgentWorld(n)?.groundAt(n.position);
    return !['urgent','unconscious','recovering'].includes(b.overall)&&
      !['ravenous','faint with hunger'].includes(b.hunger)&&!['parched','desperate thirst'].includes(b.thirst)&&
      !['winded','exhausted'].includes(b.stamina)&&!['weary','exhausted'].includes(b.fatigue)&&
      b.energy!=='depleted'&&!['aching','hurting','severe'].includes(b.pain)&&
      !['sleepy','struggling to stay awake'].includes(b.sleepiness)&&
      !['shallow-water','deep-water','deep-pond'].includes(ground)&&!contactEscape(n);
  }
  local(a,b){return this.environment===this.social.getEnvironment?.()&&this.safe(a)&&this.safe(b)&&
    a.scene===b.scene&&distance(a.position,b.position)<=SOCIAL_RULES.peerRange&&
    actorLineOfSight(a,a.position,b.position)&&actorLineOfSight(b,b.position,a.position);}
  ready(n,context=null){
    const at=this.environment?.elapsed;if(!Number.isFinite(at)||n.elapsed!==at)return false;
    const row=this.opportunityFor(context);
    if(row)
      return row.turns<3&&at-Math.max(row.lastTurn,row.speaker.social.lastSpokeAt??-Infinity,row.listener.social.lastSpokeAt??-Infinity)>=NAMING_TURN_SECONDS;
    return n.social.lastSpokeAt===null||at-n.social.lastSpokeAt>=SOCIAL_RULES.speechCooldown;
  }
  visible(n){
    if(!awake(n)||!this.environment?.ecology)return[];
    // Event-time ordinary sensing, not remembered coordinates, including moving
    // referents. This cannot insert an unseen transmitted ID into observation.
    const objects=senseEcology(this.environment.ecology,n.position,n.scene,NPC_RULES.visionRadius)
      .filter(o=>actorLineOfSight(n,n.position,o.position));
    rememberDiscoveryObservation(n,objects);
    return objects;
  }
  emit(sender,receiver,text,opportunity=null){
    const at=this.environment.elapsed;
    const message=this.social.append({senderId:sender.id,recipientId:receiver.id,channel:'peer',text,offline:true},at);
    sender.social.lastSpokeAt=at;
    if(opportunity&&this.#opportunities.get(sender.id)===opportunity){opportunity.lastTurn=at;opportunity.turns++;}
    this.social.receive(sender,message);this.social.receive(receiver,message);
    sender.presentation.speakText=text;sender.presentation.speakUntil=sender.elapsed+4;
    return message;
  }
  evidence(message,speaker,listener,object){return {messageId:message.id,at:message.at,scene:speaker.scene,
    speakerPosition:{...speaker.position},listenerPosition:{...listener.position},objectPosition:{...object.position}};}
  tick(){
    if(!this.environment)return;
    const now=this.environment.elapsed;
    this.pruneOpportunities();
    for(const [key,p] of this.#pending){
      if(now-p.request.at>=NAMING_EXCHANGE_SECONDS||now<p.request.at||!this.local(p.speaker,p.listener)){
        this.#pending.delete(key);continue;
      }
      const {speaker,listener}=p;
      if(p.phase==='select'){
        if(now<=p.request.at||!this.ready(listener,p))continue;
        const seen=this.visible(listener);
        // Only retained listener association plus its own current candidates.
        // The intended ID and pointing geometry never enter this resolution.
        const selected=resolveName(listener,p.token,speaker.id,seen.map(o=>o.id));
        const object=seen.find(o=>o.id===selected);
        if(!object){this.#pending.delete(key);if(p.opportunity)this.endOpportunity(p.opportunity);continue;}
        const message=this.emit(listener,speaker,`Do you mean this individual by ${p.token}?`,p.opportunity);
        p.selection=this.evidence(message,speaker,listener,object);p.selectedId=selected;
        const indicated=resolvePoint(this.visible(speaker),object.position);
        if(!indicated){this.#pending.delete(key);if(p.opportunity)this.endOpportunity(p.opportunity);return;}
        p.speakerResolvedId=indicated.id;p.phase='confirm';
        return;
      }
      if(now<=p.selection.at||!this.ready(speaker,p))continue;
      const a=this.visible(speaker),b=this.visible(listener),object=a.find(o=>o.id===p.selectedId);
      this.#pending.delete(key);
      if(!object||!b.some(o=>o.id===p.selectedId)||p.selectedId!==p.intendedId||p.speakerResolvedId!==p.intendedId)continue;
      const binding=listener.lexicon?.heard.find(r=>r.speakerId===speaker.id&&r.token===p.token&&r.objectId===p.selectedId);
      if(!binding)continue;
      // Validate the proposed evidence before uttering a success claim. The
      // synchronous append below is the next event; no asynchronous replay.
      const proposed=this.evidence({id:`message:${this.social.community().nextId}`,at:now},speaker,listener,object);
      if(!confirmReference(listener,binding,{request:p.request,selection:p.selection,confirmation:proposed}))continue;
      this.emit(speaker,listener,`Yes. That is the individual I call ${p.token}.`,p.opportunity);
      if(p.opportunity)this.endOpportunity(p.opportunity);
      return;
    }
    for(const speaker of this.social.agents()){
      if(!speaker.lexicon?.own.length||!validLexicon(speaker.lexicon,speaker)||!this.safe(speaker)||this.#pending.has(speaker.id))continue;
      // Keep ordinary cooldown checks ahead of expensive referent sensing.
      // Only this speaker's bounded continuation can bypass that early gate.
      if(!this.ready(speaker)&&this.#opportunities.get(speaker.id)?.speaker!==speaker)continue;
      for(const listener of this.social.nearby(speaker)){
        if(!this.local(speaker,listener)||listener.elapsed!==now)continue;
        const visible=this.visible(speaker);
        for(const own of speaker.lexicon.own){
          const context={speaker,listener,token:own.token,intendedId:own.objectId};

          const object=visible.find(o=>o.id===own.objectId);if(!object)continue;
          if(!own.announcedTo.some(e=>e.peerId===listener.id)){
            if(!this.ready(speaker))continue;
            const receiverObjects=this.visible(listener);
            const message=this.emit(speaker,listener,`I call this individual ${own.token}.`);
            const event=this.evidence(message,speaker,listener,object);
            if(!markNameAnnounced(speaker,own,listener.id,event))return;
            const resolved=resolvePoint(receiverObjects,object.position);
            // Identity is checked only after independently resolving the gesture.
            if(resolved?.id===object.id&&recordGrounding(listener,speaker.id,own.token,resolved.id,event))this.offerFollowup(speaker,listener,own,event);
            return;
          }
          const announcement=own.announcedTo.find(e=>e.peerId===listener.id);
          if(own.checkedWith.some(e=>e.peerId===listener.id)||now<=announcement.event.at)continue;
          if(!this.ready(speaker,context))continue;
          const opportunity=this.opportunityFor(context);
          const message=this.emit(speaker,listener,`Which individual do I call ${own.token}?`,opportunity);
          const request=this.evidence(message,speaker,listener,object);
          if(!markReferenceRequested(speaker,own,listener.id,request))return;
          this.#pending.set(speaker.id,{speaker,listener,token:own.token,intendedId:own.objectId,request,phase:'select',opportunity});
          return;
        }
      }
    }
  }
}
