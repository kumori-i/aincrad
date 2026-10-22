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
  constructor(social){this.social=social;this.environment=social.getEnvironment?.();}
  dispose(){this.#pending.clear();this.environment=null;}
  pendingCount(){return this.#pending.size;}
  safe(n){
    if(!awake(n))return false;
    const b=bodySignals(n),ground=ozarkAgentWorld(n)?.observe(n.position)?.ground;
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
  ready(n){const at=this.environment?.elapsed;return Number.isFinite(at)&&n.elapsed===at&&
    (n.social.lastSpokeAt===null||at-n.social.lastSpokeAt>=SOCIAL_RULES.speechCooldown);}
  visible(n){
    if(!awake(n)||!this.environment?.ecology)return[];
    // Event-time ordinary sensing, not remembered coordinates, including moving
    // referents. This cannot insert an unseen transmitted ID into observation.
    const objects=senseEcology(this.environment.ecology,n.position,n.scene,NPC_RULES.visionRadius)
      .filter(o=>actorLineOfSight(n,n.position,o.position));
    rememberDiscoveryObservation(n,objects);
    return objects;
  }
  emit(sender,receiver,text){
    const at=this.environment.elapsed;
    const message=this.social.append({senderId:sender.id,recipientId:receiver.id,channel:'peer',text,offline:true},at);
    sender.social.lastSpokeAt=at;
    this.social.receive(sender,message);this.social.receive(receiver,message);
    sender.presentation.speakText=text;sender.presentation.speakUntil=sender.elapsed+4;
    return message;
  }
  evidence(message,speaker,listener,object){return {messageId:message.id,at:message.at,scene:speaker.scene,
    speakerPosition:{...speaker.position},listenerPosition:{...listener.position},objectPosition:{...object.position}};}
  tick(){
    if(!this.environment)return;
    const now=this.environment.elapsed;
    for(const [key,p] of this.#pending){
      if(now-p.request.at>=NAMING_EXCHANGE_SECONDS||now<p.request.at||!this.local(p.speaker,p.listener)){
        this.#pending.delete(key);continue;
      }
      const {speaker,listener}=p;
      if(p.phase==='select'){
        if(now<=p.request.at||!this.ready(listener))continue;
        const seen=this.visible(listener);
        // Only retained listener association plus its own current candidates.
        // The intended ID and pointing geometry never enter this resolution.
        const selected=resolveName(listener,p.token,speaker.id,seen.map(o=>o.id));
        const object=seen.find(o=>o.id===selected);
        if(!object){this.#pending.delete(key);continue;}
        const message=this.emit(listener,speaker,`Do you mean this individual by ${p.token}?`);
        p.selection=this.evidence(message,speaker,listener,object);p.selectedId=selected;
        const indicated=resolvePoint(this.visible(speaker),object.position);
        if(!indicated){this.#pending.delete(key);return;}
        p.speakerResolvedId=indicated.id;p.phase='confirm';
        return;
      }
      if(now<=p.selection.at||!this.ready(speaker))continue;
      const a=this.visible(speaker),b=this.visible(listener),object=a.find(o=>o.id===p.selectedId);
      this.#pending.delete(key);
      if(!object||!b.some(o=>o.id===p.selectedId)||p.selectedId!==p.intendedId||p.speakerResolvedId!==p.intendedId)continue;
      const binding=listener.lexicon?.heard.find(r=>r.speakerId===speaker.id&&r.token===p.token&&r.objectId===p.selectedId);
      if(!binding)continue;
      // Validate the proposed evidence before uttering a success claim. The
      // synchronous append below is the next event; no asynchronous replay.
      const proposed=this.evidence({id:`message:${this.social.community().nextId}`,at:now},speaker,listener,object);
      if(!confirmReference(listener,binding,{request:p.request,selection:p.selection,confirmation:proposed}))continue;
      this.emit(speaker,listener,`Yes. That is the individual I call ${p.token}.`);
      return;
    }
    for(const speaker of this.social.agents()){
      if(!speaker.lexicon?.own.length||!validLexicon(speaker.lexicon,speaker)||!this.safe(speaker)||!this.ready(speaker)||this.#pending.has(speaker.id))continue;
      for(const listener of this.social.nearby(speaker)){
        if(!this.local(speaker,listener)||listener.elapsed!==now)continue;
        const visible=this.visible(speaker);
        for(const own of speaker.lexicon.own){
          const object=visible.find(o=>o.id===own.objectId);if(!object)continue;
          if(!own.announcedTo.some(e=>e.peerId===listener.id)){
            const receiverObjects=this.visible(listener);
            const message=this.emit(speaker,listener,`I call this individual ${own.token}.`);
            const event=this.evidence(message,speaker,listener,object);
            if(!markNameAnnounced(speaker,own,listener.id,event))return;
            const resolved=resolvePoint(receiverObjects,object.position);
            // Identity is checked only after independently resolving the gesture.
            if(resolved?.id===object.id)recordGrounding(listener,speaker.id,own.token,resolved.id,event);
            return;
          }
          const announcement=own.announcedTo.find(e=>e.peerId===listener.id);
          if(own.checkedWith.some(e=>e.peerId===listener.id)||now<=announcement.event.at)continue;
          const message=this.emit(speaker,listener,`Which individual do I call ${own.token}?`);
          const request=this.evidence(message,speaker,listener,object);
          if(!markReferenceRequested(speaker,own,listener.id,request))return;
          this.#pending.set(speaker.id,{speaker,listener,token:own.token,intendedId:own.objectId,request,phase:'select'});
          return;
        }
      }
    }
  }
}
