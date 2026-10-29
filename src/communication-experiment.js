// Isolated protocol harness. The main world attaches learning to its own actors.
import { createOzarkState } from './ozark-save.js';
import { bindOzarkWorldAgent } from './ozark-agent-world.js';
import { PopulationRuntime } from './population.js';
import { attachCommunicationLearning } from './communication-attachment.js';

export function createCommunicationExperiment({geometry,seed=211,enabled=true,pixelSensor}) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Expected a uint32 seed');
  const state=createOzarkState(geometry);
  for(const [i,n]of state.agents.entries()){
    n.seed=n.rng=(seed^(i?0x9e3779b9:0x15a4e35))>>>0;
    bindOzarkWorldAgent(n,geometry,state);
  }
  const learning=attachCommunicationLearning({state,seed,enabled,pixelSensor});
  const runtime=new PopulationRuntime(state,{communicationMode:'legacy',cardinal:false,experimentalDiscovery:learning.hooks});
  let disposed=false;
  return {
    state,runtime,
    tick(dt){
      if(disposed||!Number.isFinite(dt)||dt<=0||state.elapsed>=1800)return;
      const step=Math.min(dt,.25,1800-state.elapsed);
      learning.beforeTick();state.elapsed+=step;runtime.tick(step);learning.afterTick();
      if(state.elapsed>=1800)learning.censorPending();
    },
    snapshot(){return {...learning.snapshot(),limitReached:state.elapsed>=1800};},
    dispose(){if(disposed)return;learning.dispose();runtime.dispose();disposed=true;},
  };
}
