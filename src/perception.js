import { CONFIG, NPC_RULES } from './config.js';
import { canStandOutside, terrain, objectAtCell, distance } from './world.js';
import { nearbyWaterSources } from './resources.js';

export const tileKey=(p)=>`${Math.round(p.x/NPC_RULES.tileSize)},${Math.round(p.y/NPC_RULES.tileSize)}`;
export function tilePoint(key){const [x,y]=key.split(',').map(Number);return{x:x*NPC_RULES.tileSize,y:y*NPC_RULES.tileSize};}
export function lineOfSight(from,to){
  const d=distance(from,to),n=Math.max(1,Math.ceil(d/18));
  for(let i=1;i<n;i++){
    const x=from.x+(to.x-from.x)*i/n,y=from.y+(to.y-from.y)*i/n;
    if(terrain(x,y)==='mountain')return false;
    const cx=Math.floor(x/CONFIG.treeCell),cy=Math.floor(y/CONFIG.treeCell);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const o=objectAtCell(cx+dx,cy+dy);if(o&&distance(o,{x,y})<o.radius*o.scale)return false;
    }
  }
  return true;
}
/** Only local, unoccluded samples and physically visible draw points are returned. */
export function perceive(npc,environment={}){
  const cells=[],p=npc.position,r=NPC_RULES.visionRadius,s=NPC_RULES.tileSize;
  for(let y=Math.ceil((p.y-r)/s);y<=Math.floor((p.y+r)/s);y++)for(let x=Math.ceil((p.x-r)/s);x<=Math.floor((p.x+r)/s);x++){
    const point={x:x*s,y:y*s};if(distance(p,point)>r||!lineOfSight(p,point))continue;
    cells.push({key:`${x},${y}`,...point,walkable:canStandOutside(point.x,point.y),terrain:terrain(point.x,point.y),observedAt:npc.elapsed});
  }
  const sources=nearbyWaterSources(p,r,environment).filter(source=>lineOfSight(p,source));
  return {at:npc.elapsed,position:{...p},lifecycle:npc.lifecycle,hydration:npc.hydration,flask:{water:npc.flask.water,capacity:npc.flask.capacity},cells,sources};
}
