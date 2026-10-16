import { CONFIG, NPC_RULES } from '../../src/config.js';
import { distance } from '../../src/world.js';
import { tileKey, tilePoint } from '../../src/perception.js';

/** A bounded tile search over observed data. No terrain/world lookup occurs here. */
export function knownRoute(cells,from,to,maxSteps=30,blockedEdges={},elapsed=0,startKey=null){
  let start=startKey||tileKey(from);const goal=tileKey(to);
  const blocked=(a,b)=>(blockedEdges[[a,b].sort().join('>')]?.retryAfter||0)>elapsed;
  // A failed snap to the center of the current coarse tile is also real route evidence.
  // Choose another observed entry node instead of retrying the same obstructed segment.
  if(!cells[start]?.walkable||blocked(start,start))start=Object.values(cells).filter(c=>c.walkable&&distance(c,from)<NPC_RULES.tileSize*2&&!blocked(c.key,c.key)&&!blocked(tileKey(from),c.key)).sort((a,b)=>distance(a,from)-distance(b,from))[0]?.key;
  if(!start||!cells[goal]?.walkable)return null;
  const queue=[start],parent=new Map([[start,null]]);
  for(let i=0;i<queue.length&&i<2500;i++){
    const key=queue[i];if(key===goal)break;
    const [x,y]=key.split(',').map(Number);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const next=`${x+dx},${y+dy}`;
      const edge=[key,next].sort().join('>');
      if((blockedEdges[edge]?.retryAfter||0)>elapsed)continue;
      if(cells[next]?.walkable&&!parent.has(next)){parent.set(next,key);queue.push(next);}
    }
  }
  if(!parent.has(goal))return null;
  const keys=[];let at=goal;
  while(at!==start){keys.unshift(at);at=parent.get(at);if(keys.length>maxSteps)return null;}
  const route=[tilePoint(start),...keys.map(tilePoint),{x:to.x,y:to.y}];
  if(route.reduce((n,p,i)=>n+(i?distance(route[i-1],p):distance(from,p)),0)>NPC_RULES.maxActionSeconds*CONFIG.walkSpeed)return null;
  return route.filter((p,i)=>i||distance(from,p)>6);
}
