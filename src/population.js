import { NpcController } from './controller.js';
import { tickEnvironment } from './environment.js';
import { SocialCoordinator } from './social.js';

/** Owns the two characters and the single shared simulation clock. */
export class PopulationRuntime {
  constructor(state,{providerFactory}={}) {
    this.state=state;
    this.providerFactory=providerFactory;
    this.controllers=new Map();
    this.observedAt=new Map();
    this.turn=0;
    this.disposed=false;
    this.social=new SocialCoordinator({getAgents:()=>this.state.agents,getCommunity:()=>this.state.community,getEnvironment:()=>this.state.environment});
    for(const npc of state.agents){
      this.controllers.set(npc.id,new NpcController(npc,{provider:providerFactory?.(npc),environment:state.environment,social:this.social}));
      this.social.observe(npc);
      this.observedAt.set(npc.id,npc.elapsed);
    }
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
  }
  cancel(id){
    if(id){this.controller(id)?.cancel();return;}
    for(const controller of this.controllers.values())controller.cancel();
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;
    for(const controller of this.controllers.values())controller.dispose();
    this.social.dispose?.();
  }
}
