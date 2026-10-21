/** Explicit local physical encounter fixture, not autonomous travel evidence.
 * No learned answers, anatomy/nutrition testimony, or pinned fish. */
import {createOzarkWorldGeometry} from '../../src/ozark-world-geometry.js';
import {createOzarkState} from '../../src/ozark-save.js';
import {bindOzarkWorldAgent} from '../../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc} from '../../src/npc.js';
import {tickEnvironment} from '../../src/environment.js';
import {tickOzarkEcology} from '../../src/ozark-ecology.js';
import {processDiscoveryFeedback} from '../../src/discovery.js';
import {CONFIG} from '../../src/config.js';
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function bankFor(geometry,position){
  const candidates=[];
  for(let r=15;r<=80;r+=2)for(let k=0;k<64;k++){
    const angle=k*Math.PI/32,point={x:position.x+Math.cos(angle)*r,y:position.y+Math.sin(angle)*r};
    if(geometry.classify(point.x,point.y,CONFIG.playerRadius).reason==='dry-ground'&&geometry.lineOfSight(point,position))return point;
  }
  return candidates.sort((a,b)=>distance(a,position)-distance(b,position))[0]||null;
}
export function fishingFixture({index=0,lineOfSightGate=null}={}){
  const nativeGeometry=createOzarkWorldGeometry(),geometry=lineOfSightGate?Object.freeze({...nativeGeometry,lineOfSight:(...args)=>lineOfSightGate()&&nativeGeometry.lineOfSight(...args)}):nativeGeometry,state=createOzarkState(geometry),e=state.environment.ecology;
  const fish=e.aquatic.fish[index%e.aquatic.fish.length],bank=bankFor(geometry,fish.position);
  if(!bank)throw new Error('No valid native bank for fixture');
  const actor=state.agents[0];actor.position={...bank};state.player={...bank};
  for(const a of state.agents)bindOzarkWorldAgent(a,geometry,state);
  observeNpc(actor,state.environment);
  const tick=(seconds)=>{for(let elapsed=0;elapsed<seconds-1e-9;elapsed+=CONFIG.fixedStep){const dt=Math.min(CONFIG.fixedStep,seconds-elapsed);tickEnvironment(state.environment,dt);tickOzarkEcology(e,dt,state.environment,state.agents);for(const a of state.agents){tickNpc(a,dt,state.environment);processDiscoveryFeedback(a);}state.elapsed=state.environment.elapsed;}};
  const action=(type,id=fish.id)=>{observeNpc(actor,state.environment);const before={elapsed:actor.elapsed,metabolizedKcal:actor.physiology.totals.metabolizedKcal,position:{...fish.position}},admission=requestNpcAction(actor,{type,targetId:id},state.environment);if(admission.ok)for(let i=0;i<1000&&actor.active;i++)tick(CONFIG.fixedStep);return{admission,result:actor.lastResult,before,after:{elapsed:actor.elapsed,metabolizedKcal:actor.physiology.totals.metabolizedKcal,position:{...fish.position}}};};
  return {geometry,state,e,actor,fish,bank,tick,action};
}
