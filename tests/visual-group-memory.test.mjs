import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestVisualSamples, validVisualSamples, visualGroups, VISUAL_SAMPLE_LIMIT, visualSampleCurrent } from '../src/visual-group-memory.js';
const cues = { shape:'rounded', color:'grey', texture:'rough' };
const npc = (id='aster') => ({ id, mode:'discovery', lifecycle:'AWAKE', scene:'valley', elapsed:0, position:{x:0,y:0}, discovery:{} });
const object = (id=1, appearance=cues) => ({ id:`object:${id}`, scene:'valley', position:{x:0,y:0}, appearance });
const sample = (n, at, objects=[object(1),object(2)]) => { n.elapsed=at; ingestVisualSamples(n,objects); };

test('provided cue rule needs two individuals with two distinct-time samples each', () => {
  const n=npc(); sample(n,0); assert.deepEqual(visualGroups(n),[]);
  sample(n,0); assert.deepEqual(n.discovery.visualSamples.records.map(r=>r.times),[[0],[0]]);
  sample(n,1); const groups=visualGroups(n); assert.equal(groups.length,1);
  assert.deepEqual(groups[0],{cues,members:[{objectId:'object:1',scene:'valley',times:[0,1]},{objectId:'object:2',scene:'valley',times:[0,1]}]});
  assert.ok(validVisualSamples(n.discovery.visualSamples,n));
  groups[0].members[0].times[0]=900; groups[0].cues.color='pink';
  assert.equal(n.discovery.visualSamples.records[0].times[0],0);
  assert.equal(n.discovery.visualSamples.records[0].cues.color,'grey');
});

test('single repeated individual and duplicate held/visible rows cannot make group', () => {
  const n=npc(); for(let at=0;at<20;at++)sample(n,at,[object(),object()]);
  assert.deepEqual(n.discovery.visualSamples.records[0].times,[18,19]);
  assert.deepEqual(visualGroups(n),[]);
  sample(n,20,[object(2)]); assert.deepEqual(visualGroups(n),[]);
});

test('changed, missing, and conflicting duplicate cues retire previous support; absence does not', () => {
  const n=npc(); sample(n,0); sample(n,1); sample(n,2,[]); assert.equal(visualGroups(n).length,1);
  sample(n,3,[object(1,{...cues,color:'white'})]); assert.deepEqual(visualGroups(n),[]);
  assert.deepEqual(n.discovery.visualSamples.records[0].times,[3]);
  sample(n,4,[object(1)]); assert.deepEqual(n.discovery.visualSamples.records[0].times,[4]);
  sample(n,5,[object(1)]); assert.equal(visualGroups(n).length,1);
  sample(n,6,[object(1,{shape:'rounded'})]); assert.equal(n.discovery.visualSamples.records.length,1);
  sample(n,7,[object(2),object(2,{...cues,color:'white'})]); assert.equal(n.discovery.visualSamples.records.length,0);
});

test('sleep, collapsed, non-discovery and wrong-scene ingress cannot contribute', () => {
  for(const change of [n=>n.active={request:{type:'sleep'}},n=>n.lifecycle='COLLAPSED',n=>n.mode='legacy',n=>n.scene='cave']) {
    const n=npc(); change(n); sample(n,0); assert.equal(n.discovery.visualSamples,undefined);
  }
  const n=npc(); sample(n,0,[{...object(),scene:'cave'}]); assert.equal(n.discovery.visualSamples,undefined);
});

test('actor ownership, no memory copying, and identity replacement', () => {
  const a=npc(),b=npc('mira'); sample(a,0); sample(a,1);
  assert.deepEqual(visualGroups(b),[]); assert.equal(b.discovery.visualSamples,undefined);
  b.elapsed=1; b.discovery.visualSamples=structuredClone(a.discovery.visualSamples);
  assert.equal(validVisualSamples(b.discovery.visualSamples,b),false); assert.deepEqual(visualGroups(b),[]);
  const n=npc(); sample(n,0); sample(n,1,[object(3),object(4)]); assert.deepEqual(visualGroups(n),[]);
});

test('bounded deterministic retention and time compaction do not pin old histories', () => {
  const a=npc(),b=npc(); const objects=Array.from({length:40},(_,i)=>object(i+1));
  sample(a,0,objects); sample(b,0,[...objects].reverse());
  assert.deepEqual(a.discovery.visualSamples,b.discovery.visualSamples);
  assert.equal(a.discovery.visualSamples.records.length,VISUAL_SAMPLE_LIMIT);
  const retired=a.discovery.visualSamples.records[0].objectId;
  sample(a,1,objects.filter(o=>o.id!==retired)); sample(a,2,[object(100)]);
  assert.equal(a.discovery.visualSamples.records.some(r=>r.objectId===retired),false);
  sample(a,3,[object(100)]); sample(a,4,[object(100)]);
  assert.deepEqual(a.discovery.visualSamples.records.find(r=>r.objectId==='object:100').times,[3,4]);
  assert.ok(validVisualSamples(a.discovery.visualSamples,a));
});

test('strict optional evidence validation rejects malformed, duplicate, overcap and foreign fields', () => {
  const n=npc(); sample(n,0); sample(n,1); const good=n.discovery.visualSamples;
  for(const corrupt of [
    x=>x.extra=true, x=>x.ownerId='mira', x=>x.version=2,
    x=>x.records[0].extra=true, x=>x.records[0].objectId='object:0',
    x=>x.records[0].scene='cave', x=>x.records[0].cues.extra='hidden',
    x=>x.records[0].cues.shape='', x=>x.records[0].times=[0,2],
    x=>x.records[0].times=[1,1], x=>x.records[0].times=[1,0],
    x=>x.records[0].times=[], x=>x.records[0].times=[0,.5,1],
    x=>x.records.push(structuredClone(x.records[0])),
    x=>x.records=Array.from({length:33},(_,i)=>({...structuredClone(x.records[0]),objectId:`object:${i+1}`})),
  ]) { const bad=structuredClone(good); corrupt(bad); assert.equal(validVisualSamples(bad,n),false); }
  const restored=structuredClone(n); const before=JSON.stringify(restored);
  assert.equal(visualGroups(restored).length,1); assert.equal(JSON.stringify(restored),before,'reading restored evidence never senses');
  n.discovery.visualSamples={version:99}; const invalid=structuredClone(n.discovery.visualSamples);
  sample(n,2); assert.deepEqual(n.discovery.visualSamples,invalid,'invalid data is not silently repaired');
});

test('runtime current sample is ordinary, awake, visible, exact-time and never restored', () => {
  const n=npc(); sample(n,0); sample(n,1); assert.equal(visualSampleCurrent(n,'object:1'),true);
  assert.equal(visualSampleCurrent(structuredClone(n),'object:1'),false);
  n.elapsed=2; assert.equal(visualSampleCurrent(n,'object:1'),false);
  sample(n,2); n.position.x=10000; assert.equal(visualSampleCurrent(n,'object:1'),false);
  n.position.x=0; sample(n,2,[]); assert.equal(visualSampleCurrent(n,'object:1'),false);
  assert.equal(visualGroups(n).length,1,'empty view does not disprove remembered similarity');
  sample(n,3,[{...object(1),position:{x:10000,y:0},appearance:{}}]);
  assert.equal(visualGroups(n).length,1,'nonvisual missing cues cannot erase retained support');
  sample(n,4); n.active={request:{type:'sleep'}}; assert.equal(visualSampleCurrent(n,'object:1'),false);
});
