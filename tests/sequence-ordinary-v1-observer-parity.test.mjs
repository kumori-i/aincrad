// Authored actuator controls only. These are NOT ordinary cohort executions.
import test from 'node:test';import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';import {createOzarkState} from '../src/ozark-save.js';import {bindOzarkWorldAgent} from '../src/ozark-agent-world.js';
import {observeNpc,requestNpcAction,tickNpc,demonstrateCollapse} from '../src/npc.js';import {BIOLOGY_RULES,simulationSeconds} from '../src/biology-config.js';
import {projectPhysiology} from '../src/biology.js';import {bodySignals} from '../src/interoception.js';import {processDiscoveryFeedback} from '../src/discovery.js';
import {connectedSequenceStatus,preferConnectedSequence,issueConnectedSequence} from '../src/connected-sequence.js';import {createSequenceScopeCollector} from '../scripts/sequence-ordinary-v1-collector.mjs';
const geometry=createOzarkWorldGeometry();
function run(read){
 const state=createOzarkState(geometry,{communicationSeed:99001}),n=state.agents[0],e=state.environment;for(const a of state.agents)bindOzarkWorldAgent(a,geometry,state);
 const source=e.ecology.plants.find(p=>p.kind==='grass');source.position={x:400,y:720};n.position={...source.position};
 const comfortable=()=>{Object.assign(n.physiology,{availableEnergyKcal:1300,satietyHours:3,waterDeficitMl:0,stamina:90,fatigue:10,sleepPressure:10});projectPhysiology(n);observeNpc(n,e);};comfortable();
 const scope=read?createSequenceScopeCollector(state,{steps:2000,fixedStep:.25,describe:bodySignals}):null;let tick=0;const transitions=[];
 const capture=()=>{if(read){for(const a of state.agents){const before=structuredClone(a),status=connectedSequenceStatus(a);assert.deepEqual(connectedSequenceStatus(a),status);assert.deepEqual(a,before);}transitions.push(...scope.capture(state,tick));}};
 const advance=()=>{state.elapsed+=.25;e.elapsed=e.ecology.elapsed=state.elapsed;for(const a of state.agents)tickNpc(a,.25,e);processDiscoveryFeedback(n,{foodLearning:false});tick++;capture();};
 const finish=request=>{const result=requestNpcAction(n,request,e);for(let i=0;i<200&&n.active;i++)advance();assert.equal(n.active,null);return result.ok?n.lastResult:result;};
 for(let i=0;i<2;i++){assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');finish({type:'release',targetId:n.inventory.items.at(-1)});comfortable();}
 assert.equal(finish({type:'pull',targetId:source.id}).code,'piece_detached');const q=connectedSequenceStatus(n).question,c={action:{type:q.type,targetId:q.outputId},score:0};assert.equal(preferConnectedSequence(n,[c]),c);assert.equal(issueConnectedSequence(n,c.action),true);
 assert.equal(finish(c.action).code,'object_released');assert.equal(connectedSequenceStatus(n).question.phase,'completed');
 assert.equal(demonstrateCollapse(n),true);for(let i=0;i<Math.ceil((simulationSeconds(BIOLOGY_RULES.rescueDelayGameHours+BIOLOGY_RULES.recoveryGameHours)+1)/.25);i++)advance();assert.equal(n.lifecycle,'AWAKE');assert.equal(connectedSequenceStatus(n),null,'old private authority does not cross collapse/recovery');
 if(read){assert.ok(transitions.some(x=>x.lifecycle==='COLLAPSED'));assert.ok(transitions.some(x=>x.priorLifecycle==='RECOVERING'&&x.lifecycle==='AWAKE'));}
 return {agents:state.agents,environment:e,admissionAfter:connectedSequenceStatus(n)};
}
test('status and per-tick epoch observation preserve paid private authority, collapse/recovery, actors and RNG',()=>{
 assert.deepEqual(run(false),run(true));
});
