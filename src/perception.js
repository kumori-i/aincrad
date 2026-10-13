import { CONFIG, NPC_RULES, CAVES, CAVE_EXIT } from './config.js';
import { canStand, terrain, objectAtCell, caveDistance, CAVE_OBJECTS, distance } from './world.js';
import { nearbyWaterSources, nearbyFoodSources, nearbyShelters } from './resources.js';
import { environmentConditions } from './environment.js';

export const tileKey=(p)=>`${Math.round(p.x/NPC_RULES.tileSize)},${Math.round(p.y/NPC_RULES.tileSize)}`;
export function tilePoint(key){const [x,y]=key.split(',').map(Number);return{x:x*NPC_RULES.tileSize,y:y*NPC_RULES.tileSize};}
/** Valley and each cavern own separate observed maps and failed edges. */
export function rememberedCells(npc,scene=npc.scene){
  if(scene==='valley')return npc.memory.cells;
  npc.memory.caveCells??={};return npc.memory.caveCells[scene]??=(Object.create(null));
}
export function rememberedEdges(npc,scene=npc.scene){
  if(scene==='valley')return npc.memory.blockedEdges;
  npc.memory.caveEdges??={};return npc.memory.caveEdges[scene]??=(Object.create(null));
}
export function scenePointValid(point,scene='valley'){
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return false;
  return scene==='valley'?Math.abs(point.x)<CONFIG.halfSize&&Math.abs(point.y)<CONFIG.halfSize:CAVES.some(c=>c.id===scene)&&point.x>0&&point.y>0&&point.x<2500&&point.y<2000;
}
export function lineOfSight(from,to,scene='valley'){
  const d=distance(from,to),n=Math.max(1,Math.ceil(d/18));
  for(let i=1;i<n;i++){
    const x=from.x+(to.x-from.x)*i/n,y=from.y+(to.y-from.y)*i/n;
    if(scene!=='valley'){
      if(caveDistance(x,y)>0||CAVE_OBJECTS.some(o=>distance(o,{x,y})<o.radius*o.scale))return false;
      continue;
    }
    if(terrain(x,y)==='mountain')return false;
    const cx=Math.floor(x/CONFIG.treeCell),cy=Math.floor(y/CONFIG.treeCell);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const o=objectAtCell(cx+dx,cy+dy);if(o&&distance(o,{x,y})<o.radius*o.scale)return false;
    }
  }
  return true;
}
/** Only local, unoccluded samples and physically visible interaction points are returned. */
export function perceive(npc,environment={}){
  const cells=[],p=npc.position,r=NPC_RULES.visionRadius,s=NPC_RULES.tileSize,scene=npc.scene;
  for(let y=Math.ceil((p.y-r)/s);y<=Math.floor((p.y+r)/s);y++)for(let x=Math.ceil((p.x-r)/s);x<=Math.floor((p.x+r)/s);x++){
    const point={x:x*s,y:y*s};if(!scenePointValid(point,scene)||distance(p,point)>r||!lineOfSight(p,point,scene))continue;
    cells.push({key:`${x},${y}`,...point,scene,walkable:canStand(point.x,point.y,scene),terrain:scene==='valley'?terrain(point.x,point.y):caveDistance(point.x,point.y)<0?'cave-floor':'cave-wall',observedAt:npc.elapsed});
  }
  const visible=resource=>lineOfSight(p,resource,scene);
  const sources=scene==='valley'?nearbyWaterSources(p,r,environment).filter(visible):[];
  const foods=scene==='valley'?nearbyFoodSources(p,r,environment).filter(visible).map(({renewAt,...visibleFood})=>visibleFood):[];
  const shelters=scene==='valley'?nearbyShelters(p,r).filter(visible).map(({shelteredTemperature,...entrance})=>entrance):[];
  const exit=scene!=='valley'&&distance(p,CAVE_EXIT)<=r&&lineOfSight(p,CAVE_EXIT,scene)?{...CAVE_EXIT,observedAt:npc.elapsed}:null;
  return {at:npc.elapsed,scene,exit,position:{...p},lifecycle:npc.lifecycle,hydration:npc.hydration,nourishment:npc.nourishment,health:npc.health,thermal:{...npc.thermal},feelings:{...npc.feelings},sensation:environmentConditions(environment,{position:p,scene,wetness:npc.thermal.wetness}),flask:{water:npc.flask.water,capacity:npc.flask.capacity},inventory:{apples:npc.inventory.apples.length,capacity:npc.inventory.capacity},cells,sources,foods,shelters};
}
