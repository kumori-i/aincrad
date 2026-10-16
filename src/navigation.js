import { CONFIG, NPC_RULES } from './config.js';
import { distance } from './world.js';
import { tileKey, tilePoint } from './perception.js';

function observedStart(cells,from,blockedEdges,elapsed,startKey){
  let start=startKey||tileKey(from);
  const blocked=(a,b)=>(blockedEdges[[a,b].sort().join('>')]?.retryAfter||0)>elapsed;
  // A failed snap to the center of the current coarse tile is also real route evidence.
  // Choose another observed entry node instead of retrying the same obstructed segment.
  if(!cells[start]?.walkable||blocked(start,start))start=Object.values(cells).filter(c=>c.walkable&&distance(c,from)<NPC_RULES.tileSize*2&&!blocked(c.key,c.key)&&!blocked(tileKey(from),c.key)).sort((a,b)=>distance(a,from)-distance(b,from))[0]?.key;
  return start;
}
function observedSearch(cells,from,start){
  const nodes=new Map(),stats={expansions:0,examinedEdges:0,discovered:0};
  const search={cells,from,start,nodes,stats,omitStart:false,queue:[],cursor:0};
  if(!start)return search;
  const point=tilePoint(start),length=distance(from,point);search.omitStart=!(length>6);
  nodes.set(start,{parent:null,point,steps:0,length,returnedLength:search.omitStart?0:length});
  search.queue.push(start);stats.discovered=1;return search;
}
function advanceObservedSearch(search,blockedEdges,elapsed,goal,stopOnDiscovery){
  const {cells,from,start,nodes,stats,queue,omitStart}=search;
  while(search.cursor<queue.length&&stats.expansions<2500){
    if(stopOnDiscovery&&nodes.has(goal))break;
    const key=queue[search.cursor];if(!stopOnDiscovery&&key===goal)break;
    search.cursor++;stats.expansions++;
    const node=nodes.get(key),[x,y]=key.split(',').map(Number);
    // Always finish all four neighbors before suspending. A later endpoint
    // query resumes this same queue and budget without losing a sibling.
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      stats.examinedEdges++;const next=`${x+dx},${y+dy}`;
      const edge=[key,next].sort().join('>');
      if((blockedEdges[edge]?.retryAfter||0)>elapsed)continue;
      if(cells[next]?.walkable&&!nodes.has(next)){
        const nextPoint=tilePoint(next),segment=distance(node.point,nextPoint);
        nodes.set(next,{parent:key,point:nextPoint,steps:node.steps+1,length:node.length+segment,returnedLength:omitStart&&key===start?distance(from,nextPoint):node.returnedLength+segment});queue.push(next);stats.discovered++;
      }
    }
  }
}
function observedMetrics(search,to,maxSteps){
  const goal=tileKey(to),node=search.nodes.get(goal);
  if(!search.cells[goal]?.walkable||!node||node.steps>0&&node.steps>maxSteps)return null;
  const finalSegment=distance(node.point,to),length=node.length+finalSegment;
  if(length>NPC_RULES.maxActionSeconds*CONFIG.walkSpeed)return null;
  // knownRoute removes a start center within six units only AFTER its nominal
  // length check. Discovery's sensed-speed limit uses that returned path.
  const returnedLength=search.omitStart&&goal===search.start?distance(search.from,to):node.returnedLength+finalSegment;
  return {length,returnedLength,steps:node.steps};
}
function observedRoute(search,to,maxSteps){
  if(!observedMetrics(search,to,maxSteps))return null;
  const keys=[];let at=tileKey(to);
  while(at!==search.start){keys.unshift(at);at=search.nodes.get(at).parent;}
  const route=[tilePoint(search.start),...keys.map(tilePoint),{x:to.x,y:to.y}];
  return route.filter((p,i)=>i||distance(search.from,p)>6);
}
/** A bounded tile search over observed data. No terrain/world lookup occurs here. */
export function knownRoute(cells,from,to,maxSteps=30,blockedEdges={},elapsed=0,startKey=null){
  const start=observedStart(cells,from,blockedEdges,elapsed,startKey),goal=tileKey(to);
  if(!start||!cells[goal]?.walkable)return null;
  const search=observedSearch(cells,from,start);advanceObservedSearch(search,blockedEdges,elapsed,goal,false);
  return observedRoute(search,to,maxSteps);
}
/** One lazy, ephemeral shared search for endpoint admission, never saved or cached. */
export function createKnownRouteIndex(cells,from,blockedEdges={},elapsed=0,startKey=null){
  const start=observedStart(cells,from,blockedEdges,elapsed,startKey);
  const search=observedSearch(cells,from,start);
  const metrics=(to,maxSteps=30)=>{
    const goal=tileKey(to);
    if(!search.nodes.has(goal)&&cells[goal]?.walkable)advanceObservedSearch(search,blockedEdges,elapsed,goal,true);
    return observedMetrics(search,to,maxSteps);
  };
  return {route:(to,maxSteps=30)=>metrics(to,maxSteps)?observedRoute(search,to,maxSteps):null,metrics,get stats(){return Object.freeze({...search.stats});}};
}
