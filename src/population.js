import { NpcController } from './controller.js';
import { tickEnvironment } from './environment.js';
import { SocialCoordinator } from './social.js';
import { tickEcology, senseEcology } from './ecology.js';
import { tickOzarkEcology } from './ozark-ecology.js';
import { OZARK_WORLD_PROFILE, createOzarkWorldGeometry } from './ozark-world-geometry.js';
import { harmPhysiology, wakePhysiology, isSleeping } from './biology.js';
import { recordEvent } from './npc-memory.js';
import { bodySignals } from './interoception.js';
import { actorLineOfSight } from './perception.js';
import { CardinalRuntime } from './cardinal.js';
import { createCardinalExperiment } from './cardinal-experiments.js';
import { applyWorldRules, getWorldRules } from './world-rules.js';
import { BUILD_SOURCE_FINGERPRINT } from './build-info.js';

/** Owns the two characters and the single shared simulation clock. */
export class PopulationRuntime {
  constructor(state,{providerFactory,cardinal=true,experimentFactory,discoveryFoodLearning=true}={}) {
    this.state=state;
    this.providerFactory=providerFactory;
    this.controllers=new Map();
    this.observedAt=new Map();
    this.turn=0;
    this.disposed=false;
    this.social=new SocialCoordinator({getAgents:()=>this.state.agents,getCommunity:()=>this.state.community,getEnvironment:()=>this.state.environment});
    const deferInitialObservation=state.geometryIdentity===OZARK_WORLD_PROFILE.identity;
    for(const npc of state.agents){
      this.controllers.set(npc.id,new NpcController(npc,{provider:providerFactory?.(npc),environment:state.environment,social:this.social,discoveryFoodLearning,deferInitialObservation}));
      if(!deferInitialObservation)this.social.observe(npc);
      this.observedAt.set(npc.id,npc.elapsed);
    }
    // Shadow worlds reuse exactly the ordinary simulation but never start
    // supervisors, model clients or another generation of experiments.
    this.cardinal=cardinal&&state.geometryIdentity!==OZARK_WORLD_PROFILE.identity&&state.cardinal?new CardinalRuntime(state,{
      experimentFactory:experimentFactory||(({state:snapshot,proposal,seeds,horizonSeconds})=>createCardinalExperiment(snapshot,proposal,{
        seeds,horizonSeconds,sourceFingerprint:BUILD_SOURCE_FINGERPRINT,
        runtimeFactory:(shadow,options)=>new PopulationRuntime(shadow,{...options,discoveryFoodLearning,cardinal:false}),
      })),
      getRules:getWorldRules,
      applyRules:applyWorldRules,
    }):null;
  }
  getAgent(id='aster'){return this.state.agents.find(npc=>npc.id===id)||null;}
  controller(id='aster'){return this.controllers.get(id)||null;}
  setProviderFactory(factory){
    if(this.disposed)return;
    this.providerFactory=factory;
    for(const npc of this.state.agents){
      // Passing undefined restores the controller's local provider default.
      const provider=factory?.(npc);
      if(provider)this.controller(npc.id).setProvider(provider);
      else this.controller(npc.id).setProvider(this.controller(npc.id).fallback);
    }
  }
  tick(dt){
    if(this.disposed||!Number.isFinite(dt)||dt<=0)return;
    const step=Math.min(dt,.25);
    tickEnvironment(this.state.environment,step);
    const agents=this.state.agents;
    if(this.state.simulationMode==='discovery'&&this.state.environment.ecology){
      const callbacks={
        harm:(npc,injury)=>{
          if(!agents.includes(npc)||npc.mode!=='discovery')return;
          const result=harmPhysiology(npc,injury?.damage,{reason:injury?.reason,sourceId:injury?.sourceId,stimulus:injury?.stimulus});
          if(result.ok){
            if(npc.stats)npc.stats.injuries=(npc.stats.injuries||0)+result.damage;
            const current=npc.lifecycle==='AWAKE'&&!isSleeping(npc)?senseEcology(this.state.environment.ecology,npc.position,npc.scene,80).find(object=>object.id===injury.sourceId&&actorLineOfSight(npc,npc.position,object.position)):null;
            const source=current||npc.discovery?.observations?.[injury.sourceId];
            const direction=injury.direction&&Number.isFinite(injury.direction.x)&&Number.isFinite(injury.direction.y)?injury.direction:null;
            recordEvent(npc,'condition',{code:'CONTACT_INJURY',scene:npc.scene,...(source?{objectId:source.id,sourceId:source.id,sourcePosition:{...source.position},scene:source.scene}:{}),...(direction?{direction:{x:Math.max(-1,Math.min(1,direction.x)),y:Math.max(-1,Math.min(1,direction.y))}}:{}),body:bodySignals(npc),provenance:'experienced contact'});
          }
        },
        wake:(npc,stimulus)=>{
          if(agents.includes(npc)&&npc.mode==='discovery')wakePhysiology(npc,stimulus);
        },
      };
      if(this.state.geometryIdentity===OZARK_WORLD_PROFILE.identity)
        tickOzarkEcology(this.state.environment.ecology,step,this.state.environment,agents,callbacks,createOzarkWorldGeometry());
      else tickEcology(this.state.environment.ecology,step,this.state.environment,agents,callbacks);
    }
    const start=this.turn++%agents.length;
    for(let offset=0;offset<agents.length;offset++){
      const npc=agents[(start+offset)%agents.length];
      this.controller(npc.id)?.tick(step);
      if(npc.elapsed-(this.observedAt.get(npc.id)??-Infinity)>=1){
        this.social.observe(npc);
        this.observedAt.set(npc.id,npc.elapsed);
      }
    }
    this.social.tick(step);
    this.cardinal?.tick(step);
  }
  /** Expensive copied-world trials run outside the fixed simulation step. The
   * application calls this only while its explicit simulation clock is running. */
  workCardinal(budget=8){
    if(this.disposed||!this.cardinal)return null;
    return this.cardinal.work(budget);
  }
  setCardinalMode(mode){return !this.disposed&&this.cardinal?.setMode(mode);}
  cancelCardinal(){return this.cardinal?.cancel();}
  cancel(id){
    if(id){this.controller(id)?.cancel();return;}
    for(const controller of this.controllers.values())controller.cancel();
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    for(const controller of this.controllers.values())controller.dispose();
    this.social.dispose?.();
    this.cardinal?.dispose();
  }
}
