import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { BIOLOGY_RULES } from '../src/biology-config.js';
import { distance } from '../src/world.js';
import { tileKey, tilePoint, rememberedCells, rememberedEdges } from '../src/perception.js';
import { bodySignals } from '../src/interoception.js';
import { createNpc } from '../src/npc-state.js';
import { knownRoute, createKnownRouteIndex } from '../src/navigation.js';
import { knownRoute as originalKnownRoute } from './fixtures/known-route-original.mjs';
import { knownRoute as eagerKnownRoute, createKnownRouteIndex as createEagerIndex } from './fixtures/known-route-eager.mjs';

// Frozen verbatim from the preserved eager candidate, apart from three imports.
// This digest is the archived source digest, before import normalization.
const eagerNavigationSha256='9f595f2d864e352ef1626e2a2e810b8a13a0a6e56260179ed22ce33a08acf16e';
// Exact private selection function from archived eager discovery.js (whole-file
// SHA256 d405fd93f0ff2b90c59c5a603e6c867f2eb36293c688a2c8c1d597bbc9781b3f).
// Keep this frozen independently of the production selection implementation.
const eagerRouteTargetSource=`function routeTarget(npc,point){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc);
  const b=bodySignals(npc),slowed=['winded','exhausted'].includes(b.stamina)||b.fatigue==='exhausted'||b.energy==='depleted'||b.sleepiness==='groggy';
  const speed=Math.min(CONFIG.walkSpeed*(slowed?BIOLOGY_RULES.exhaustionWalkMultiplier:1),1/(npc.cognition?.travel?.secondsPerUnit||1/CONFIG.walkSpeed));
  const routes=createKnownRouteIndex(cells,npc.position,edges,npc.elapsed,npc.navigationAnchor);
  // Invalid endpoints cannot consume the nearest-24 budget ahead of a usable
  // care route. Admission uses the same observed search and exact path costs.
  const choices=Object.values(cells).filter(c=>{if(!c.walkable||distance(c,npc.position)<=45||distance(c,npc.position)>=900)return false;const route=routes.metrics(c,30);return route&&route.returnedLength<speed*(NPC_RULES.maxActionSeconds-1);}).sort((a,b)=>distance(a,point)-distance(b,point));
  for(const c of choices.slice(0,24)){if(distance(c,point)>=distance(npc.position,point)-20)continue;return {type:'move',target:{x:c.x,y:c.y}};}
  return null;
}
`;
const eagerRouteTargetSha256='d25cbb32dc8fd9e49d2bf362e006fdb535daf2a2625a433265f7d46f002de391';
const hash=value=>createHash('sha256').update(value).digest('hex');
const point=(x,y)=>({x:x*NPC_RULES.tileSize,y:y*NPC_RULES.tileSize});
const edge=(a,b)=>[a,b].sort().join('>');
function cellsFor(keys){return Object.fromEntries(keys.map(key=>[key,{key,...tilePoint(key),walkable:true,scene:'valley'}]));}
function rectangle(x0,y0,x1,y1){
  const keys=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)keys.push(`${x},${y}`);
  return cellsFor(keys);
}
function freezeDeep(value){
  for(const child of Object.values(value))if(child&&typeof child==='object')freezeDeep(child);
  return Object.freeze(value);
}
function random(seed){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};}
function sumRoute(from,route){return route.reduce((sum,p,i)=>sum+distance(i?route[i-1]:from,p),0);}
function compareQuery(lazy,eager,cells,from,to,{maxSteps=30,blockedEdges={},elapsed=0,startKey=null,label='query'}={}){
  const expected=originalKnownRoute(cells,from,to,maxSteps,blockedEdges,elapsed,startKey);
  assert.deepEqual(knownRoute(cells,from,to,maxSteps,blockedEdges,elapsed,startKey),expected,`${label}: public/original`);
  assert.deepEqual(eagerKnownRoute(cells,from,to,maxSteps,blockedEdges,elapsed,startKey),expected,`${label}: eager/original`);
  assert.deepEqual(lazy.route(to,maxSteps),expected,`${label}: lazy/original`);
  assert.deepEqual(lazy.route(to,maxSteps),eager.route(to,maxSteps),`${label}: lazy/eager route`);
  const metrics=lazy.metrics(to,maxSteps);
  assert.deepEqual(metrics,eager.metrics(to,maxSteps),`${label}: lazy/eager metrics`);
  if(expected)assert.equal(metrics.returnedLength,sumRoute(from,expected),`${label}: independent returned length`);
  else assert.equal(metrics,null);
  return expected;
}

// Evaluate the exact private production function with its real read-only
// dependencies. This exposes no runtime test hook and changes no game source.
const discoverySource=readFileSync(new URL('../src/discovery.js',import.meta.url),'utf8');
const routeTargetStart=discoverySource.indexOf('function routeTarget(');
assert.ok(routeTargetStart>=0);
const routeTargetEnd=discoverySource.indexOf('// All consumption paths',routeTargetStart);
assert.ok(routeTargetEnd>routeTargetStart);
const lazyRouteTargetSource=discoverySource.slice(routeTargetStart,routeTargetEnd);
function compileRouteTarget(source,indexFactory){
  return new Function('CONFIG','NPC_RULES','BIOLOGY_RULES','bodySignals','distance','rememberedCells','rememberedEdges','createKnownRouteIndex',`${source}\nreturn routeTarget;`)(CONFIG,NPC_RULES,BIOLOGY_RULES,bodySignals,distance,rememberedCells,rememberedEdges,indexFactory);
}
const eagerRouteTarget=compileRouteTarget(eagerRouteTargetSource,createEagerIndex);
function captureSelection(npc,goal){
  const indices=[],queries=[];
  const routeTarget=compileRouteTarget(lazyRouteTargetSource,(...args)=>{
    const index=createKnownRouteIndex(...args);indices.push(index);
    return {metrics(to,maxSteps){
      const before={...index.stats},metrics=index.metrics(to,maxSteps);
      queries.push({key:tileKey(to),metrics,before,after:{...index.stats}});return metrics;
    }};
  });
  const snapshot=structuredClone(npc),action=routeTarget(npc,goal);
  assert.deepEqual(action,eagerRouteTarget(npc,goal),'Exact lazy private routeTarget action matches the frozen eager selection.');
  assert.deepEqual(npc,snapshot,'Selection cannot change the NPC, graph, blocked evidence or RNG.');
  assert.equal(indices.length,1,'One selection owns exactly one shared index.');
  return {action,index:indices[0],queries};
}
function npcFor(cells,from=point(0,0),seed=8192){
  const npc=createNpc({mode:'discovery',seed});npc.position={...from};npc.elapsed=100;
  npc.navigationAnchor=null;npc.memory.cells=cells;npc.memory.blockedEdges={};
  return npc;
}
function ranked(npc,goal){
  return Object.values(rememberedCells(npc)).filter(c=>c.walkable&&distance(c,npc.position)>45&&distance(c,npc.position)<900)
    .sort((a,b)=>distance(a,goal)-distance(b,goal));
}

test('the eager navigation and action oracles retain their archived source checksums',()=>{
  const source=readFileSync(new URL('./fixtures/known-route-eager.mjs',import.meta.url),'utf8').replaceAll("from '../../src/","from './");
  assert.equal(hash(source),eagerNavigationSha256);
  assert.equal(hash(eagerRouteTargetSource),eagerRouteTargetSha256);
});

test('lazy construction resolves one root without reading neighbors and exposes read-only live counters',()=>{
  const cells=cellsFor(['0,0','1,0','2,0']),reads=[];
  const observed=new Proxy(cells,{get(target,key){if(typeof key==='string')reads.push(key);return Reflect.get(target,key);}});
  const index=createKnownRouteIndex(observed,point(0,0));
  assert.deepEqual(reads,['0,0']);
  const initial=index.stats;
  assert.deepEqual(initial,{expansions:0,examinedEdges:0,discovered:1});
  assert.ok(Object.isFrozen(initial));
  assert.throws(()=>{initial.expansions=999;},TypeError);
  assert.throws(()=>{index.stats={expansions:999};},TypeError);
  assert.equal(Object.getOwnPropertyDescriptor(index,'stats').set,undefined);
  assert.ok(index.route(point(1,0)));
  assert.deepEqual(index.stats,{expansions:1,examinedEdges:4,discovered:2});
  assert.deepEqual(initial,{expansions:0,examinedEdges:0,discovered:1},'Previously returned snapshots cannot change.');
  assert.deepEqual(createKnownRouteIndex({},point(0,0)).stats,{expansions:0,examinedEdges:0,discovered:0});
});

test('fallback entry selection happens once and cached queries perform no neighbor reads',()=>{
  const cells=freezeDeep(cellsFor(['-1,0','-1,1','0,1','1,1','1,0','2,0'])),from=freezeDeep(point(0,0));
  const blockedEdges=freezeDeep({[edge('0,0','1,0')]:{retryAfter:100}});
  let enumerations=0,reads=0;
  const observed=new Proxy(cells,{
    ownKeys(target){enumerations++;return Reflect.ownKeys(target);},
    get(target,key){if(typeof key==='string')reads++;return Reflect.get(target,key);},
  });
  const index=createKnownRouteIndex(observed,from,blockedEdges,0),eager=createEagerIndex(cells,from,blockedEdges,0);
  assert.equal(enumerations,1,'The fallback scan belongs to construction alone.');
  assert.deepEqual(index.stats,{expansions:0,examinedEdges:0,discovered:1});
  compareQuery(index,eager,cells,from,point(2,0),{blockedEdges});
  const complete={...index.stats};reads=0;
  for(let i=0;i<40;i++){
    assert.ok(index.metrics(point(1,0)));
    assert.ok(index.route(point(-1,1)));
  }
  assert.equal(enumerations,1,'Later metrics and routes never select another entry.');
  assert.ok(reads<=120,`${reads} cell reads for 40 cached metrics and 40 cached routes`);
  assert.deepEqual(index.stats,complete);
});

test('root, unobserved and unwalkable queries cannot trigger graph expansion',()=>{
  const cells=rectangle(-3,-3,3,3),from=point(0,0);cells['2,2'].walkable=false;
  const lazy=createKnownRouteIndex(cells,from),eager=createEagerIndex(cells,from),initial={...lazy.stats};
  for(const to of [point(99,99),point(2,2),from,{x:5,y:3}])compareQuery(lazy,eager,cells,from,to);
  assert.deepEqual(lazy.stats,initial);
  assert.deepEqual(lazy.route(from,-1),[from],'The original start-equals-goal exception survives a negative step limit.');
});

test('suspension completes all four neighbors and later resumes the unexpanded goal and every sibling',()=>{
  const cells=rectangle(-3,-3,3,3),from=point(0,0),lazy=createKnownRouteIndex(cells,from),eager=createEagerIndex(cells,from);
  compareQuery(lazy,eager,cells,from,point(1,0));
  assert.deepEqual(lazy.stats,{expansions:1,examinedEdges:4,discovered:5},'An east discovery must still visit west, south and north.');
  for(const to of [point(-1,0),point(0,1),point(0,-1)])compareQuery(lazy,eager,cells,from,to);
  assert.equal(lazy.stats.expansions,1,'Already discovered root siblings need no new work.');
  compareQuery(lazy,eager,cells,from,point(2,0));
  assert.deepEqual(lazy.stats,{expansions:2,examinedEdges:8,discovered:8},'The previously returned east goal remains queued for expansion.');
  for(const to of [point(1,1),point(1,-1)])compareQuery(lazy,eager,cells,from,to);
  assert.equal(lazy.stats.expansions,2,'The first expanded goal also retains both perpendicular siblings.');
  for(const to of [point(-2,0),point(0,2),point(0,-2),point(-2,2),point(3,-3)])compareQuery(lazy,eager,cells,from,to);
  assert.equal(lazy.stats.examinedEdges,lazy.stats.expansions*4);
});

test('overlength and over-step queries preserve their discovered paths for later admissible queries',()=>{
  const cells=rectangle(0,0,32,0),from={x:0,y:6},lazy=createKnownRouteIndex(cells,from),eager=createEagerIndex(cells,from);
  assert.equal(compareQuery(lazy,eager,cells,from,point(3,0),{maxSteps:2}),null);
  const limited={...lazy.stats};
  assert.ok(compareQuery(lazy,eager,cells,from,point(3,0),{maxSteps:3}));
  assert.deepEqual(lazy.stats,limited);
  assert.equal(compareQuery(lazy,eager,cells,from,point(30,0),{maxSteps:Infinity}),null);
  const far={...lazy.stats};
  assert.equal(far.expansions,30);
  for(const to of [point(1,0),{x:1726,y:0},{x:1725,y:0},point(3,0)])compareQuery(lazy,eager,cells,from,to);
  assert.deepEqual(lazy.stats,far);
});

test('disconnected-first queries exhaust one component without losing its usable routes',()=>{
  const cells={...rectangle(-5,-5,5,5),...cellsFor(['100,100','101,100'])},from=point(0,0);
  const lazy=createKnownRouteIndex(cells,from),eager=createEagerIndex(cells,from);
  assert.equal(compareQuery(lazy,eager,cells,from,point(100,100)),null);
  assert.deepEqual(lazy.stats,{expansions:121,examinedEdges:484,discovered:121});
  const complete={...lazy.stats};
  for(const to of [point(101,100),point(1,0),point(-4,4),point(1,0),point(999,999)])compareQuery(lazy,eager,cells,from,to);
  assert.deepEqual(lazy.stats,complete);
});

test('many resumed queries share one cumulative 2,500-expansion budget including the final frontier',()=>{
  const cells=rectangle(-32,-32,31,31),from=point(0,0),lazy=createKnownRouteIndex(cells,from),eager=createEagerIndex(cells,from);
  const targets=Object.values(cells).sort((a,b)=>distance(a,from)-distance(b,from));
  let previous=0;
  for(const target of targets){
    assert.deepEqual(lazy.metrics(target),eager.metrics(target));
    assert.ok(lazy.stats.expansions>=previous&&lazy.stats.expansions<=2500);
    assert.equal(lazy.stats.examinedEdges,lazy.stats.expansions*4);
    previous=lazy.stats.expansions;
  }
  assert.deepEqual(lazy.stats,eager.stats,'The lazy cursor reaches exactly the frozen eager frontier, once.');
  assert.equal(lazy.stats.expansions,2500);
  assert.equal(lazy.stats.examinedEdges,10000);
  assert.ok(lazy.stats.discovered>2500&&lazy.stats.discovered<=4096);
  const complete={...lazy.stats};
  for(const to of [point(-32,-32),point(31,31),point(1,0),point(0,1),point(-1,0)])compareQuery(lazy,eager,cells,from,to);
  assert.deepEqual(lazy.stats,complete,'Neither later failures nor discovered-frontier queries restart the exhausted search.');
});

test('near-first, far-first, invalid-first and repeated queries agree with both frozen oracles on seeded maps',()=>{
  const rng=random(0x7a671a2);
  let comparisons=0,accepted=0;
  for(let trial=0;trial<24;trial++){
    const entries=[];
    for(let y=-5;y<=5;y++)for(let x=-5;x<=5;x++){
      if(rng()<.09)continue;
      const key=`${x},${y}`;entries.push([key,{key,...point(x,y),walkable:rng()>.18,scene:'valley'}]);
    }
    for(let i=entries.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[entries[i],entries[j]]=[entries[j],entries[i]];}
    const cells={...Object.fromEntries(entries),...cellsFor(['50,50'])},blockedEdges={};
    cells['8,8']={key:'8,8',...point(8,8),walkable:false,scene:'valley'};
    for(const [key] of entries){const [x,y]=key.split(',').map(Number);for(const next of [key,`${x+1},${y}`,`${x},${y+1}`])if(rng()<.08)blockedEdges[edge(key,next)]={retryAfter:[0,10,11,50][trial%4]};}
    const from={x:[0,6,6.000000000000001,27][trial%4],y:trial%3?3.25:0},elapsed=[0,10,11,60][trial%4],startKey=[null,'0,0','-1,1','missing'][trial%4];
    const options={blockedEdges,elapsed,startKey};
    const queries=[{to:from,maxSteps:30},{to:point(1,0),maxSteps:1},{to:point(50,50),maxSteps:Infinity},{to:point(99,99),maxSteps:30},{to:point(8,8),maxSteps:30}];
    for(let i=0;i<30;i++)queries.push({to:{x:(Math.floor(rng()*13)-6)*80+(rng()-.5)*79,y:(Math.floor(rng()*13)-6)*80+(rng()-.5)*79},maxSteps:[0,1,3,7,30,Infinity][i%6]});
    const near=[...queries].sort((a,b)=>distance(a.to,from)-distance(b.to,from));
    const orders=[near,[...near].reverse(),[queries[3],queries[4],queries[2],...queries]];
    const snapshot=JSON.stringify({cells,from,blockedEdges}),eager=createEagerIndex(cells,from,blockedEdges,elapsed,startKey);
    for(let order=0;order<orders.length;order++){
      const lazy=createKnownRouteIndex(cells,from,blockedEdges,elapsed,startKey);
      for(const query of [...orders[order],...orders[order].slice(0,5)]){
        const result=compareQuery(lazy,eager,cells,from,query.to,{...options,maxSteps:query.maxSteps,label:`seed 0x7a671a2 trial ${trial} order ${order} query ${comparisons}`});
        comparisons++;if(result)accepted++;
      }
      assert.ok(lazy.stats.expansions<=2500&&lazy.stats.examinedEdges<=10000&&lazy.stats.discovered<=Object.keys(cells).length);
    }
    assert.equal(JSON.stringify({cells,from,blockedEdges}),snapshot);
  }
  assert.equal(comparisons,2952);
  assert.ok(accepted>500,`${accepted} routes exercise exact reconstruction in different query orders`);
});

test('selection stops at its first admissible ranked endpoint and leaves graph, actor and RNG untouched',()=>{
  const npc=npcFor(rectangle(-32,-32,31,31)),goal=point(1,0);
  freezeDeep(npc);
  const {action,index,queries}=captureSelection(npc,goal);
  assert.deepEqual(action,{type:'move',target:goal});
  assert.deepEqual(queries.map(q=>q.key),['1,0']);
  assert.deepEqual(index.stats,{expansions:1,examinedEdges:4,discovered:5});
  assert.ok(createEagerIndex(npc.memory.cells,npc.position).stats.expansions>index.stats.expansions);
});

function detourFixture(kind='nominal'){
  const keys=['0,0','0,1'],bend=kind==='nominal'?12:6,row=kind==='nominal'?10:8;
  for(let x=1;x<=bend;x++)keys.push(`${x},0`);
  for(let y=1;y<=row;y++)keys.push(`${bend},${y}`);
  for(let x=5;x<bend;x++)keys.push(`${x},${row}`);
  for(let y=7;y<=10;y++)for(let x=0;x<=5;x++)keys.push(`${x},${y}`);
  return {npc:npcFor(cellsFor(keys)),goal:point(0,10),good:point(0,1)};
}

test('connected invalid-first endpoints do not consume the nearest-24 budget before a usable route',()=>{
  for(const kind of ['nominal','body']){
    const {npc,goal,good}=detourFixture(kind);
    if(kind==='body')npc.cognition.travel.secondsPerUnit=1/50;
    const order=ranked(npc,goal),goodRank=order.findIndex(c=>c.key===tileKey(good));
    assert.ok(goodRank>=24);
    const eager=createEagerIndex(npc.memory.cells,npc.position);
    for(const c of order.slice(0,24)){
      const metrics=eager.metrics(c);
      if(kind==='nominal')assert.equal(metrics,null);
      else assert.ok(metrics&&metrics.returnedLength>=50*(NPC_RULES.maxActionSeconds-1));
    }
    const {action,index,queries}=captureSelection(npc,goal);
    assert.deepEqual(action,{type:'move',target:good});
    assert.ok(queries.length>24,'Rejected connected endpoints do not use up valid-admission slots.');
    assert.deepEqual(queries.map(q=>q.key),order.slice(0,goodRank+1).map(c=>c.key),'Each ranked endpoint is queried once, in order.');
    assert.equal(index.stats.examinedEdges,index.stats.expansions*4);
  }
});

test('disconnected-first selection retains cached usable routes and counts only fully admissible endpoints',()=>{
  const cells={...cellsFor(['0,0','0,1']),...rectangle(-2,7,3,10)},npc=npcFor(cells),goal=point(0,10);
  const {action,index,queries}=captureSelection(npc,goal);
  assert.deepEqual(action,{type:'move',target:point(0,1)});
  assert.equal(queries.length,25);
  assert.ok(queries.slice(0,24).every(q=>q.metrics===null));
  assert.deepEqual(index.stats,{expansions:2,examinedEdges:8,discovered:2});
  assert.ok(queries.slice(1).every(q=>q.after.expansions===2));
});

test('no-progress selection checks exactly 24 admissible endpoints and retains stable sorting ties',()=>{
  const cells=rectangle(-6,-6,6,6),npc=npcFor(cells),goal=point(0,0);
  const {action,queries}=captureSelection(npc,goal);
  assert.equal(action,null);
  assert.equal(queries.length,24);
  assert.ok(queries.every(q=>q.metrics));
  assert.deepEqual(queries.map(q=>q.key),ranked(npc,goal).slice(0,24).map(c=>c.key));
  const tied=npcFor(cellsFor(['0,0','1,0','0,1','1,1']));
  tied.memory.blockedEdges[edge('1,0','1,1')]={retryAfter:200};
  tied.memory.blockedEdges[edge('0,1','1,1')]={retryAfter:200};
  const a=captureSelection(tied,point(1,1));
  assert.deepEqual(a.action,{type:'move',target:point(1,0)});
  tied.memory.cells=Object.fromEntries(Object.entries(tied.memory.cells).reverse());
  assert.deepEqual(captureSelection(tied,point(1,1)).action,{type:'move',target:point(0,1)});
});

test('selection rereads fallback anchors, blocked-edge expiry, current scenes and sensed-speed boundaries',()=>{
  const base=npcFor(rectangle(-4,-4,4,4),{x:0,y:6});
  const variants=[-1,0,NaN,Infinity,-Infinity,1/CONFIG.walkSpeed,1/50,(NPC_RULES.maxActionSeconds-1)/80];
  for(const speed of variants)for(const slow of ['none','stamina','fatigue','energy','groggy']){
    const npc=structuredClone(base);npc.cognition.travel.secondsPerUnit=speed;
    if(slow==='stamina')npc.physiology.stamina=5;
    if(slow==='fatigue')npc.physiology.fatigue=90;
    if(slow==='energy')npc.energy=5;
    if(slow==='groggy')npc.physiology.sleep.inertiaHours=.5;
    captureSelection(npc,point(0,3));
  }
  for(const scene of ['valley','lantern'])for(const startKey of [null,'-1,0','missing'])for(const elapsed of [99,100,101]){
    const npc=structuredClone(base);npc.scene=scene;npc.navigationAnchor=startKey;npc.elapsed=elapsed;
    const blockedEdges={[edge('0,0','0,0')]:{retryAfter:100},[edge('0,0','0,1')]:{retryAfter:100}};
    if(scene==='valley')npc.memory.blockedEdges=blockedEdges;
    else {npc.memory.caveCells={lantern:structuredClone(base.memory.cells)};npc.memory.caveEdges={lantern:blockedEdges};npc.memory.cells={};}
    captureSelection(npc,point(0,3));
  }
  const equality=npcFor(cellsFor(['0,0','1,0']));
  const exact=(NPC_RULES.maxActionSeconds-1)/80;
  for(const secondsPerUnit of [exact+1e-12,exact,exact-1e-12]){
    equality.cognition.travel.secondsPerUnit=secondsPerUnit;
    const {action}=captureSelection(equality,point(1,0));
    assert.equal(Boolean(action),secondsPerUnit<exact);
  }
});

test('seeded ranked selections preserve exact eager actions without repeated endpoint admission or RNG changes',()=>{
  const rng=random(0x28b7af10);let accepted=0,rejected=0;
  for(let trial=0;trial<64;trial++){
    const cells=rectangle(-10,-10,10,10),npc=npcFor(cells,{x:trial%3?6:0,y:trial%2?3:0},trial+1);
    for(const cell of Object.values(cells)){cell.walkable=rng()>.22;const [x,y]=cell.key.split(',').map(Number);if(rng()<.1)npc.memory.blockedEdges[edge(cell.key,`${x+1},${y}`)]={retryAfter:trial%2?101:100};}
    cells['0,0'].walkable=true;
    if(trial%5===0)npc.physiology.stamina=5;
    if(trial%5===1)npc.physiology.sleep.inertiaHours=.5;
    if(trial%5===2)npc.cognition.travel.secondsPerUnit=1/35;
    if(trial%8===0)npc.navigationAnchor='-1,0';
    if(trial%9===0)npc.memory.blockedEdges[edge('0,0','0,0')]={retryAfter:101};
    const goal=trial%6===0?{...npc.position}:point(Math.floor(rng()*25)-12,Math.floor(rng()*25)-12);
    const {action,index,queries}=captureSelection(npc,goal);
    assert.equal(new Set(queries.map(q=>q.key)).size,queries.length,'Admission never retries an endpoint.');
    assert.deepEqual(queries.map(q=>q.key),ranked(npc,goal).slice(0,queries.length).map(c=>c.key));
    assert.ok(index.stats.expansions<=2500&&index.stats.examinedEdges<=10000);
    if(action)accepted++;else rejected++;
  }
  assert.ok(accepted>30&&rejected>=10,`${accepted} selected actions and ${rejected} refusals`);
});
