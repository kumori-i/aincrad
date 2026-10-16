import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONFIG, NPC_RULES } from '../src/config.js';
import { distance } from '../src/world.js';
import { tileKey, tilePoint } from '../src/perception.js';
import { knownRoute, createKnownRouteIndex } from '../src/navigation.js';
import { knownRoute as originalKnownRoute } from './fixtures/known-route-original.mjs';

// Frozen verbatim from 0c3c319355c566cc6d618355a2fb2fd0d42a292b,
// apart from its three relative import paths. Never update it to match a refactor.
const originalSourceSha256='c62f43ac31eaa9163bb732bae8cc6b1f0df4422f36c5c84a31f0f1bb308d98b2';
const edge=(a,b)=>[a,b].sort().join('>');
const point=(x,y)=>({x:x*NPC_RULES.tileSize,y:y*NPC_RULES.tileSize});
function cellsFor(keys){
  return Object.fromEntries(keys.map(key=>[key,{key,...tilePoint(key),walkable:true,scene:'valley'}]));
}
function rectangle(x0,y0,x1,y1){
  const keys=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)keys.push(`${x},${y}`);
  return cellsFor(keys);
}
function routeLength(from,route){
  return route.reduce((n,p,i)=>n+(i?distance(route[i-1],p):distance(from,p)),0);
}
// Independently recover the old entry node, solely to measure the old returned
// coordinates. This does not use the implementation's retained metric helpers.
function originalStart(cells,from,blockedEdges,elapsed,startKey){
  let start=startKey||tileKey(from);
  const blocked=(a,b)=>(blockedEdges[edge(a,b)]?.retryAfter||0)>elapsed;
  if(!cells[start]?.walkable||blocked(start,start)){
    start=Object.values(cells)
      .filter(c=>c.walkable&&distance(c,from)<NPC_RULES.tileSize*2&&!blocked(c.key,c.key)&&!blocked(tileKey(from),c.key))
      .sort((a,b)=>distance(a,from)-distance(b,from))[0]?.key;
  }
  return start;
}
function originalMetrics(cells,from,route,blockedEdges,elapsed,startKey){
  if(route===null)return null;
  const start=tilePoint(originalStart(cells,from,blockedEdges,elapsed,startKey));
  const untrimmed=distance(from,start)<=6?[start,...route]:route;
  return {length:routeLength(from,untrimmed),returnedLength:routeLength(from,route),steps:untrimmed.length-2};
}
function compare(cells,from,to,{maxSteps=30,blockedEdges={},elapsed=0,startKey=null,index=null,label='route'}={}){
  const expected=originalKnownRoute(cells,from,to,maxSteps,blockedEdges,elapsed,startKey);
  assert.deepEqual(knownRoute(cells,from,to,maxSteps,blockedEdges,elapsed,startKey),expected,`${label}: public route`);
  index??=createKnownRouteIndex(cells,from,blockedEdges,elapsed,startKey);
  assert.deepEqual(index.route(to,maxSteps),expected,`${label}: indexed route`);
  assert.deepEqual(index.metrics(to,maxSteps),originalMetrics(cells,from,expected,blockedEdges,elapsed,startKey),`${label}: exact nominal and returned metrics`);
  return expected;
}
function freezeDeep(value){
  for(const child of Object.values(value))if(child&&typeof child==='object')freezeDeep(child);
  return Object.freeze(value);
}
function random(seed){
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};
}

test('navigation oracle is the exact original source, with unchanged distance constants',()=>{
  const source=readFileSync(new URL('./fixtures/known-route-original.mjs',import.meta.url),'utf8').replaceAll("from '../../src/","from './");
  assert.equal(createHash('sha256').update(source).digest('hex'),originalSourceSha256);
  assert.equal(NPC_RULES.tileSize,80);
  assert.equal(NPC_RULES.maxActionSeconds*CONFIG.walkSpeed,1800);
});

test('absent, unwalkable and disconnected observed cells retain old refusal behavior',()=>{
  const from={x:0,y:0};
  assert.equal(compare({},from,point(1,0)),null);
  const cells=cellsFor(['0,0','1,0','3,0','3,1']);
  assert.equal(compare(cells,from,point(2,0)),null);
  assert.equal(compare(cells,from,point(3,1)),null);
  cells['1,0'].walkable=false;
  assert.equal(compare(cells,from,point(1,0)),null);
  assert.deepEqual(compare(cells,from,from),[from]);
  cells['0,0'].walkable=false;
  assert.equal(compare(cells,from,from),null);
});

test('four-neighbor BFS ties preserve east, west, south, north ordering and duplicate endpoints',()=>{
  const cells=rectangle(-2,-2,2,2),from=point(0,0);
  for(const [x,y] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
    assert.deepEqual(compare(cells,from,point(x,y)),[point(x,0),point(x,y),point(x,y)]);
  }
  assert.deepEqual(compare(cells,from,point(1,1),{blockedEdges:{[edge('0,0','1,0')]:{retryAfter:10}}}),[point(0,1),point(1,1),point(1,1)]);
  // Object insertion order must not replace the fixed order of graph neighbors.
  const reversed=Object.fromEntries(Object.entries(cells).reverse());
  assert.deepEqual(compare(reversed,from,point(2,2)),compare(cells,from,point(2,2)));
});

test('fallback ties, blocked entry nodes, fallback segments and expiry preserve exact entry choice',()=>{
  const cells=cellsFor(['-1,0','1,0','-1,1','0,1','1,1']);
  const from=point(0,0),to=point(0,1);
  assert.deepEqual(compare(cells,from,to),[point(-1,0),point(-1,1),to,to]);
  const reversed=Object.fromEntries(Object.entries(cells).reverse());
  assert.deepEqual(compare(reversed,from,to),[to,to]);
  const variants=[
    {[edge('-1,0','-1,0')]:{retryAfter:50}},
    {[edge('0,0','-1,0')]:{retryAfter:50}},
    {[edge('-1,0','-1,1')]:{retryAfter:50}},
    {[edge('0,0','-1,0')]:{retryAfter:50},[edge('0,0','1,0')]:{retryAfter:50},[edge('0,0','0,1')]:{retryAfter:50}},
    {[edge('0,0','-1,0')]:{retryAfter:0}},
    {[edge('0,0','-1,0')]:{}},
  ];
  for(const blockedEdges of variants)for(const elapsed of [0,49,50,51]){
    compare(cells,from,to,{blockedEdges,elapsed,label:`fallback expiry ${elapsed}`});
  }
  const withOrigin={...cells,...cellsFor(['0,0'])};
  const blockedEdges={[edge('0,0','0,0')]:{retryAfter:50}};
  // A blocked self-entry changes the start but does not forbid later traversal
  // through that tile on a different, unblocked segment.
  assert.deepEqual(compare(withOrigin,from,to,{blockedEdges,elapsed:49}),[point(-1,0),from,to,to]);
  assert.deepEqual(compare(withOrigin,from,to,{blockedEdges,elapsed:50}),[to,to]);
  // The fallback radius is strictly less than two tile widths.
  assert.equal(compare(cellsFor(['2,0']),from,point(2,0)),null);
  assert.ok(compare(cellsFor(['2,0']),{x:0.000001,y:0},point(2,0)));
  const selfOnly=cellsFor(['0,0']);
  assert.equal(compare(selfOnly,from,from,{blockedEdges:{[edge('0,0','0,0')]:{retryAfter:1}}}),null);
});

test('explicit navigation anchors and their fallback match legacy and cave route callers',()=>{
  const cells=rectangle(-2,-2,3,2),from={x:3,y:4},to={x:170,y:15};
  const variants=[null,'','0,0','-1,0','2,0','40,40'];
  for(const startKey of variants){
    compare(cells,from,to,{startKey});
    compare(cells,from,to,{startKey,blockedEdges:{[edge(startKey||'0,0',startKey||'0,0')]:{retryAfter:100}},elapsed:99});
  }
  const caveCells=Object.fromEntries(Object.entries(cells).map(([key,value])=>[key,{...value,scene:'lantern'}]));
  assert.deepEqual(compare(caveCells,from,to,{startKey:'-1,0'}),compare(cells,from,to,{startKey:'-1,0'}));
  const far=cellsFor(['0,0','15,0','16,0']);
  assert.ok(compare(far,point(0,0),point(16,0),{startKey:'15,0'}),'a valid explicit anchor is not subjected to the fallback radius');
});

test('start-center trimming is inclusive at six units, with exact post-trim route sums',()=>{
  const cells=rectangle(-2,-2,4,3);
  for(const offset of [0,Number.EPSILON,5.999999999999999,6,6.000000000000001,39.5]){
    for(const from of [{x:offset,y:0},{x:0,y:offset},{x:offset/Math.SQRT2,y:offset/Math.SQRT2}]){
      for(const to of [{x:0,y:0},{x:9.25,y:-17.5},{x:80,y:0},{x:190.125,y:65.875}]){
        const route=compare(cells,from,to,{label:`trim ${JSON.stringify(from)} to ${JSON.stringify(to)}`});
        assert.ok(route);
        const steps=Math.abs(Math.round(to.x/80))+Math.abs(Math.round(to.y/80));
        assert.equal(route.length,steps+2-(distance(from,point(0,0))<=6?1:0));
      }
    }
  }
  const from={x:0,y:6},to={x:173,y:91};
  const index=createKnownRouteIndex(cells,from),route=index.route(to),metrics=index.metrics(to);
  assert.equal(metrics.returnedLength,routeLength(from,route));
  assert.notEqual(metrics.length,metrics.returnedLength);
  assert.notEqual(metrics.returnedLength,metrics.length-6,'trimming changes the first segment rather than merely subtracting actor-to-center distance');
  assert.deepEqual(index.metrics({x:0,y:-6}),{length:12,returnedLength:12,steps:0});
  assert.deepEqual(index.metrics({x:0,y:5}),{length:11,returnedLength:1,steps:0});
});

test('nominal 1,800-unit admission uses the untrimmed exact floating-point route length',()=>{
  const cells=rectangle(0,0,32,0),from={x:-20,y:0};
  assert.equal(compare(cells,from,{x:1739.999999999,y:0}),null);
  assert.ok(compare(cells,from,{x:1740,y:0}));
  assert.equal(createKnownRouteIndex(cells,from).metrics({x:1740,y:0}).length,1800);
  assert.ok(compare(cells,from,{x:1740.000000001,y:0}));
  // A returned route may fit the limit while its pre-trim route does not.
  const trimmedFrom={x:0,y:6},index=createKnownRouteIndex(cells,trimmedFrom);
  const boundary={x:1726,y:0},accepted=compare(cells,trimmedFrom,boundary,{index});
  assert.ok(accepted);
  assert.equal(index.metrics(boundary).length,1800);
  assert.ok(index.metrics(boundary).returnedLength<1800);
  const over={x:1725,y:0},wouldBeReturned=[...Array.from({length:22},(_,i)=>point(i+1,0)),over];
  assert.ok(routeLength(trimmedFrom,wouldBeReturned)<1800);
  assert.equal(compare(cells,trimmedFrom,over,{index}),null);
});

test('exact maxSteps boundaries, default thirty, and nominal rejection beyond twenty-two edges',()=>{
  const cells=rectangle(0,0,32,0),from=point(0,0),index=createKnownRouteIndex(cells,from);
  for(const maxSteps of [-1,0,1,1.5,2,3,21,22,29,30,31,Infinity]){
    for(const count of [0,1,2,3,21,22,23,29,30,31])compare(cells,from,point(count,0),{index,maxSteps,label:`${count} edges, maxSteps=${maxSteps}`});
  }
  assert.ok(compare(cells,from,point(3,0),{index,maxSteps:3}));
  assert.equal(compare(cells,from,point(3,0),{index,maxSteps:2}),null);
  assert.deepEqual(index.route(point(22,0)),originalKnownRoute(cells,from,point(22,0)));
  // With the current constants the 1,800-unit contract rejects 30-edge paths
  // before they could distinguish a default maxSteps of thirty from thirty-one.
  assert.equal(index.route(point(30,0)),null);
  assert.equal(index.route(point(31,0),31),null);
});

test('one search includes the enqueued frontier at expansion 2,500 and never expands it',()=>{
  const cells=rectangle(-32,-32,31,31),from=point(0,0);
  // An independent graph-only oracle records the last permitted frontier.
  const queue=['0,0'],seen=new Set(queue);
  let expansions=0;
  for(;expansions<queue.length&&expansions<2500;expansions++){
    const [x,y]=queue[expansions].split(',').map(Number);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const key=`${x+dx},${y+dy}`;
      if(cells[key]?.walkable&&!seen.has(key)){seen.add(key);queue.push(key);}
    }
  }
  assert.equal(Object.keys(cells).length,4096);
  assert.ok(queue.length>2500,'the final expansion has an enqueued, unexpanded frontier');
  const index=createKnownRouteIndex(cells,from);
  // Lazy construction resolves only the root. A walkable corner beyond the
  // permitted frontier explicitly drives the one search to its total cap.
  assert.equal(index.metrics(point(-32,-32)),null);
  const stats={...index.stats};
  assert.equal(stats.expansions,2500);
  assert.equal(stats.examinedEdges,10000);
  assert.equal(stats.discovered,queue.length);
  for(const key of [...queue.slice(0,50),...queue.slice(2498),...Object.keys(cells).filter(key=>!seen.has(key)).slice(0,50)]){
    compare(cells,from,tilePoint(key),{index,label:`search frontier ${key}`});
  }
  assert.deepEqual(index.stats,stats,'endpoint route/metric queries must not perform more BFS work');
  // Frontier routes are discovered but too long for the fixed nominal limit;
  // do not weaken distance rules just to manufacture a successful cap fixture.
  for(const key of queue.slice(2500))assert.equal(index.route(tilePoint(key),Infinity),null);
});

test('stats count only one bounded observed search and inputs remain unchanged',()=>{
  const cells=freezeDeep(cellsFor(['0,0','1,0','2,0','1,1','10,10']));
  const from=freezeDeep({x:2,y:3});
  const blockedEdges=freezeDeep({[edge('1,0','2,0')]:{retryAfter:10,reason:'physical obstruction'}});
  const snapshot=JSON.stringify({cells,from,blockedEdges});
  const index=createKnownRouteIndex(cells,from,blockedEdges,0);
  assert.equal(index.metrics(point(10,10)),null,'A disconnected walkable query exhausts the reachable component.');
  assert.deepEqual(index.stats,{expansions:3,examinedEdges:12,discovered:3});
  for(const key of Object.keys(cells))compare(cells,from,tilePoint(key),{index,blockedEdges});
  assert.equal(JSON.stringify({cells,from,blockedEdges}),snapshot);
  assert.deepEqual(index.stats,{expansions:3,examinedEdges:12,discovered:3});
  const empty=createKnownRouteIndex({},from);
  assert.deepEqual(empty.stats,{expansions:0,examinedEdges:0,discovered:0});
});

test('knownRoute still stops at an early goal instead of building the full index',()=>{
  const cells=cellsFor(['0,0','1,0']);
  Object.defineProperty(cells,'2,0',{enumerable:true,get(){throw new Error('an early goal must not read the next frontier');}});
  const from=point(0,0);
  for(const to of [from,point(1,0)]){
    assert.deepEqual(knownRoute(cells,from,to),originalKnownRoute(cells,from,to));
  }
});

test('indexed endpoint metrics are constant-time queries with no repeated graph walk',()=>{
  let reads=0;
  const cells=rectangle(-20,-20,20,20),targets=Object.values(cells).map(({x,y})=>({x,y}));
  Object.assign(cells,cellsFor(['1000,1000']));
  for(const cell of Object.values(cells))Object.defineProperty(cell,'walkable',{get(){reads++;return true;},enumerable:true});
  const index=createKnownRouteIndex(cells,point(0,0));
  assert.equal(index.metrics(point(1000,1000)),null,'A disconnected walkable query performs the shared search before cached-query checks.');
  assert.equal(index.stats.expansions,targets.length);
  const stats={...index.stats};
  reads=0;
  for(const target of targets)index.metrics(target);
  assert.ok(reads<=targets.length,`${reads} walkability reads for ${targets.length} metric queries`);
  assert.deepEqual(index.stats,stats);
});

test('winding routes, coordinate rounding ties and distant anchors keep exact old geometry',()=>{
  const keys=[];
  // Two nearby endpoints connected only by a long, observed U-shaped detour.
  for(let x=0;x<=12;x++)keys.push(`${x},0`,`${x},2`);
  keys.push('12,1');
  const detour=cellsFor(keys);
  assert.equal(compare(detour,point(0,0),point(0,2)),null);
  assert.ok(compare(detour,point(0,0),point(7,2)));
  const cells=rectangle(-3,-3,3,3);
  for(const offset of [-40.000000001,-40,-39.999999999,39.999999999,40,40.000000001]){
    for(const from of [{x:offset,y:3.25},{x:3.25,y:offset}]){
      for(const to of [{x:offset,y:-offset},{x:-offset,y:offset}])compare(cells,from,to);
    }
  }
  const translated=rectangle(247,-249,253,-243),from={x:20005.625,y:-19676.75};
  for(const to of [{x:20080.125,y:-19590.5},{x:19760,y:-19880}]){
    compare(translated,from,to);
    compare(translated,from,to,{startKey:'249,-246'});
  }
});

test('deterministic randomized observed maps exactly match the frozen route oracle',()=>{
  const rng=random(0x51a9c4ed);
  let comparisons=0,accepted=0,refused=0;
  for(let trial=0;trial<80;trial++){
    const entries=[];
    for(let y=-6;y<=6;y++)for(let x=-6;x<=6;x++){
      if(rng()<0.12)continue;
      const key=`${x},${y}`;
      entries.push([key,{key,...point(x,y),walkable:rng()>.24,scene:trial%2?'valley':'lantern'}]);
    }
    // Shuffle insertion order so fallback ties cannot rely on sorted objects.
    for(let i=entries.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[entries[i],entries[j]]=[entries[j],entries[i]];}
    const cells=Object.fromEntries(entries),blockedEdges={};
    for(const [key] of entries){
      const [x,y]=key.split(',').map(Number);
      for(const next of [key,`${x+1},${y}`,`${x},${y+1}`])if(rng()<.09)blockedEdges[edge(key,next)]={retryAfter:[0,10,11,40][Math.floor(rng()*4)]};
    }
    const offsets=[0,5.999999999999999,6,6.000000000000001,31.125];
    const from={x:(Math.floor(rng()*5)-2)*80+offsets[trial%offsets.length],y:(rng()-.5)*70};
    const elapsed=[0,10,11,50][trial%4];
    const startKey=[null,'0,0','-1,1','missing'][trial%4];
    // An isolated observed probe leaves the seeded local graph and all route
    // queries unchanged while explicitly exhausting a lazy cursor once.
    Object.assign(cells,cellsFor(['1000,1000']));
    const snapshot=JSON.stringify({cells,from,blockedEdges});
    const index=createKnownRouteIndex(cells,from,blockedEdges,elapsed,startKey);
    assert.equal(index.metrics(point(1000,1000)),null);
    const stats={...index.stats};
    for(let query=0;query<48;query++){
      const to={x:(Math.floor(rng()*15)-7)*80+(rng()-.5)*79,y:(Math.floor(rng()*15)-7)*80+(rng()-.5)*79};
      const maxSteps=[0,1,3,7,15,29,30,31][query%8];
      const route=compare(cells,from,to,{maxSteps,blockedEdges,elapsed,startKey,index,label:`seed 0x51a9c4ed trial ${trial} query ${query}`});
      comparisons++;if(route)accepted++;else refused++;
    }
    assert.ok(stats.expansions<=2500&&stats.examinedEdges<=10000&&stats.discovered<=Object.keys(cells).length);
    assert.deepEqual(index.stats,stats);
    assert.equal(JSON.stringify({cells,from,blockedEdges}),snapshot);
  }
  assert.equal(comparisons,3840);
  assert.ok(accepted>500,`${accepted} accepted randomized paths exercise reconstruction`);
  assert.ok(refused>500,`${refused} randomized refusals exercise admission`);
});
