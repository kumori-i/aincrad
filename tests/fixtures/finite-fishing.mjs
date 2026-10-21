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

let screenedMovingEncounter=null;
/** Bounded paid screening, shared with the desktop verifier's exposure rule:
 * warm120 seconds, then offer each initial moving identity once at a real dry
 * bank. Only a genuinely completed paid catch selects a positive test window.
 * Replay returns BEFORE that catch, so each consumer must prove its own result.
 * This controlled encounter selection is not autonomous travel/interception. */
export function movingFishingFixture(){
  if(!screenedMovingEncounter){
    const scout=fishingFixture();scout.tick(120);
    const initialIds=[...scout.e.aquatic.initialIds],attempts=[];
    for(const [index,id] of initialIds.entries()){
      const fish=scout.e.aquatic.fish.find(f=>f.id===id);if(!fish)continue;
      const bank=bankFor(scout.geometry,fish.position);if(!bank)continue;
      scout.actor.position={...bank};scout.state.player={...bank};
      const seconds=scout.state.elapsed,before={...fish.position};
      const row=scout.action('catch',id);
      attempts.push({id,seconds,admitted:row.admission.ok,ok:row.result?.ok===true,code:row.result?.code});
      if(row.admission.ok&&row.result?.ok&&row.result.materialId===id&&distance(before,fish.position)>0){
        screenedMovingEncounter={index,seconds,id,attempts};break;
      }
    }
    if(!screenedMovingEncounter)throw new Error(`No paid moving-target success in bounded initial-ID screen: ${JSON.stringify(attempts)}`);
  }
  const selected=screenedMovingEncounter,fixture=fishingFixture({index:selected.index});
  fixture.tick(selected.seconds);
  const bank=bankFor(fixture.geometry,fixture.fish.position);
  if(!bank)throw new Error('Screened moving encounter no longer has a valid dry bank');
  fixture.bank={...bank};fixture.actor.position={...bank};fixture.state.player={...bank};
  fixture.encounter=structuredClone(selected);
  return fixture;
}
