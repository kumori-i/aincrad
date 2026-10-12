import { CONFIG, NPC_RULES } from './config.js';
import { riverX, riverWidth, LAKE, waterDistance, canStandOutside, distance, onBridge } from './world.js';

/** Physical draw points belong to the engine, never the controller's initial knowledge. */
export function waterSource(id, environment={}) {
  if(typeof id!=='string'||id.length>70)return null;
  let point,name;
  const river=/^river:(west|east):(-?\d{1,3})$/.exec(id);
  const lake=/^lake:(\d{1,2})$/.exec(id);
  if(river){
    const row=Number(river[2]);if(Math.abs(row)>145)return null;
    const y=row*160,x=riverX(y)+(river[1]==='west'?-1:1)*(riverWidth(y)+34);
    point={x,y};name='Silverrun bank';
    if(onBridge(x,y)||waterDistance(x,y)<12||waterDistance(x,y)>65)return null;
  }else if(lake){
    const n=Number(lake[1]);if(n>=64)return null;
    const a=n/64*Math.PI*2;
    let lo=.85,hi=1.2;
    for(let i=0;i<18;i++){
      const m=(lo+hi)/2,x=LAKE.x+Math.cos(a)*LAKE.rx*m,y=LAKE.y+Math.sin(a)*LAKE.ry*m;
      if(waterDistance(x,y)<34)lo=m;else hi=m;
    }
    point={x:LAKE.x+Math.cos(a)*LAKE.rx*hi,y:LAKE.y+Math.sin(a)*LAKE.ry*hi};name='Stillwater shore';
    if(waterDistance(point.x,point.y)>65)return null;
  }else return null;
  if(!canStandOutside(point.x,point.y))return null;
  return {id,name,...point,available:!(environment.unavailableSources||[]).includes(id)};
}
export function nearbyWaterSources(actor, radius=NPC_RULES.visionRadius, environment={}) {
  const result=[];
  for(let row=Math.floor((actor.y-radius)/160);row<=Math.ceil((actor.y+radius)/160);row++){
    for(const side of ['west','east']){const s=waterSource(`river:${side}:${row}`,environment);if(s&&distance(actor,s)<=radius)result.push(s);}
  }
  if(distance(actor,LAKE)<Math.max(LAKE.rx,LAKE.ry)+radius+300){
    for(let n=0;n<64;n++){const s=waterSource(`lake:${n}`,environment);if(s&&distance(actor,s)<=radius)result.push(s);}
  }
  return result;
}
export function validSourceId(id) { return typeof id==='string' && Boolean(waterSource(id)); }
export function withinWorld(p) { return p && Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<CONFIG.halfSize&&Math.abs(p.y)<CONFIG.halfSize; }
