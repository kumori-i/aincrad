import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,writeOzarkSave,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {observeNpc,requestNpcAction,tickNpc} from '../src/npc.js';
import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {projectPhysiology} from '../src/biology.js';
import {discoveryDecision} from '../src/discovery.js';
import {normalizeActorChangeMemory} from './fixtures/change-memory-namespace.mjs';
import {canonicalTerminalSave} from './revisit-research-save.mjs';
import {attach,drain,samplePose,sampleBody,sampleSequence,bodyProjection,BODY_NUMERIC_FIELDS} from '../src/revisit-research-observer.js';
import {connectedSequenceStatus} from '../src/connected-sequence.js';
const g=createOzarkWorldGeometry();
const on=process.argv[2]==='on';let tick=0;
function corridor(){
 const state=createOzarkState(g,{communicationSeed:97531}),n=state.agents[0],e=state.environment;let start=null,end=null;
 outer:for(let y=400;y<=1440;y+=80)for(let x=80;x<=960;x+=80){const a={x,y},b={x:x+480,y};if(g.lineOfSight(a,b)&&Array.from({length:49},(_,i)=>g.canOccupy(x+i*10,y,10)).every(Boolean)){start=a;end=b;break outer;}}
 assert.ok(start);const source={...e.ecology.plants.find(p=>p.kind==='grass'),position:start};e.ecology.plants=[source];e.ecology.animals=[];e.ecology.materials=[];
 state.agents.forEach(a=>bindOzarkWorldAgent(a,g,state));if(on)attach(n,{world:state});
 const advance=seconds=>{for(let t=0;t<seconds;t+=.25){state.elapsed+=.25;e.elapsed=e.ecology.elapsed=state.elapsed;for(const a of state.agents)tickNpc(a,.25,e);if(on){samplePose(n,tick);if(tick%60===0)sampleBody(n,tick);sampleSequence(n,tick++,connectedSequenceStatus(n));}}};
 advance(10);Object.assign(n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(n);n.position={...start};observeNpc(n,e);
 const finish=r=>{assert.equal(requestNpcAction(n,r,e).ok,true);while(n.active)advance(.25);return n.lastResult;};
 assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');assert.equal(finish({type:'release',targetId:n.inventory.items[0]}).ok,true);
 n.position={x:start.x+240,y:start.y};observeNpc(n,e);n.position={...end};observeNpc(n,e);advance(21);
 return {state,n,e,source,advance,finish};
}

const fresh=createOzarkState(g,{communicationSeed:97531});
const save=canonicalTerminalSave({writeOzarkSave,OZARK_SAVE_KEY,state:fresh,geometry:g});
assert.equal(save.ok,true);const disk=JSON.parse(save.bytes);
assert.equal(disk.elapsed,fresh.elapsed);assert.equal('npc' in disk,false);assert.deepEqual(disk.worldLineage,fresh.worldLineage);
for(const [i,n] of fresh.agents.entries()){
 const m=disk.agents[i];assert.deepEqual(m.position,n.position);
 for(const k of ['id','elapsed','epoch','scene','lifecycle','rng'])assert.equal(m[k],n[k]);
 for(const k of BODY_NUMERIC_FIELDS)assert.equal(bodyProjection(m)[k],bodyProjection(n)[k]);
}
const f=corridor(),d=discoveryDecision(f.n,{foodLearning:false});
assert.ok(requestNpcAction(f.n,d.action,f.e).ok);
for(let t=0;t<48&&f.n.active;t++)f.advance(.25);
const copy=structuredClone(f.n); normalizeActorChangeMemory(copy,f.state);
console.log(JSON.stringify({actor:copy,ecology:f.e.ecology,decision:d,zeroTickSave:true,sequence:connectedSequenceStatus(f.n),evidence:on?drain(f.n):null}));
