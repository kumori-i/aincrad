const historicalClone=value=>legacyFixture(globalThis.structuredClone(value));
import { legacyFixture } from './fixtures/legacy-communication.mjs';
// These tests preserve the explicit historical English/naming channel.
// Test-only disabled observer, not a product flag or replacement controller.
import { register } from 'node:module';
if(process.argv.includes('--disabled')) {
  const loader = `
    import { Buffer } from 'node:buffer';
    export async function load(url, context, nextLoad) {
      const loaded = await nextLoad(url, context);
      if (url.endsWith('/src/visual-group-memory.js')) {
        const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
        if (!source.includes('export function ingestVisualSamples(')) throw new Error('Observer disable hook no longer matches exact entry');
        return {...loaded, source:source.replace('export function ingestVisualSamples(', 'function disabledIngestVisualSamples(') + '\\nexport function ingestVisualSamples() {}\\n'};
      }
      return loaded;
    }
  `;
  register('data:text/javascript,' + encodeURIComponent(loader), import.meta.url);
}
const {createOzarkWorldGeometry}=await import('../src/ozark-world-geometry.js');
const {createOzarkState}=await import('../src/ozark-save.js');
const {bindOzarkWorldAgent}=await import('../src/ozark-agent-world.js');
const {PopulationRuntime}=await import('../src/population.js');
const {visualGroups}=await import('../src/visual-group-memory.js');
const g=createOzarkWorldGeometry(),state=createOzarkState(g,{communicationSeed:211});
for(const n of state.agents)bindOzarkWorldAgent(n,g,state);
const runtime=new PopulationRuntime(state,{communicationMode:'legacy',cardinal:false});
const started=performance.now();
for(let i=0;i<40;i++)runtime.tick(.25);
const wallMilliseconds=performance.now()-started;
const groupCounts=state.agents.map(n=>({actorId:n.id,groups:visualGroups(n).length,individuals:n.discovery.visualSamples?.records.length||0,samples:(n.discovery.visualSamples?.records||[]).reduce((sum,r)=>sum+r.times.length,0)}));
runtime.dispose();
const world=historicalClone(state),sampleCount=world.agents.reduce((sum,n)=>sum+(n.discovery.visualSamples?.records.length||0),0);
for(const n of world.agents)delete n.discovery.visualSamples;
if(world.npc)delete world.npc.discovery.visualSamples;
console.log(JSON.stringify({sampleCount,world,diagnostic:{simulatedSeconds:10,wallMilliseconds,groupCounts}}));
