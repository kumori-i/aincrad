/** Private, generation-only physical corridors. These routes are never memories
 * or commands for inhabitants, and do not change terrain or any world state. */
import { CONFIG } from './config.js';
import { canStandOutside, distance } from './world.js';

const GRID = 160, RADIUS = 16, SAMPLE = 12, MAX_NODES = 6000;
const MAX_ANCHORS = 32, MAX_CACHE = 32768, MAX_ROUTES = 128;
const DIRECTIONS = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]];
const standing = new Map(), edges = new Map(), routes = new Map();
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  && Math.abs(p.x) < CONFIG.halfSize && Math.abs(p.y) < CONFIG.halfSize;
const pointKey = p => `${p.x},${p.y}`;
const gridKey = (x,y) => `${x},${y}`;
const gridPoint = (x,y) => ({x:x*GRID,y:y*GRID});
function cache(map,key,value,limit=MAX_CACHE) {
  if(map.size>=limit&&!map.has(key))map.delete(map.keys().next().value);
  map.set(key,value);return value;
}
function stands(p) {
  if(!validPoint(p))return false;
  const key=pointKey(p);
  return standing.has(key)?standing.get(key):cache(standing,key,canStandOutside(p.x,p.y,RADIUS));
}
/** Check the actual endpoints and every <=12-unit subdivision at radius16. */
export function corridorSegmentClear(from,to) {
  if(!validPoint(from)||!validPoint(to))return false;
  const a=pointKey(from),b=pointKey(to),key=a<b?`${a}>${b}`:`${b}>${a}`;
  if(edges.has(key))return edges.get(key);
  if(!stands(from)||!stands(to))return cache(edges,key,false);
  const steps=Math.max(1,Math.ceil(distance(from,to)/SAMPLE));
  for(let i=1;i<steps;i++)if(!canStandOutside(from.x+(to.x-from.x)*i/steps,from.y+(to.y-from.y)*i/steps,RADIUS))return cache(edges,key,false);
  return cache(edges,key,true);
}
function attachments(p) {
  const cx=Math.round(p.x/GRID),cy=Math.round(p.y/GRID),candidates=[];
  for(let y=cy-3;y<=cy+3;y++)for(let x=cx-3;x<=cx+3;x++){
    const point=gridPoint(x,y);candidates.push({x,y,point,id:gridKey(x,y),cost:distance(p,point)});
  }
  candidates.sort((a,b)=>a.cost-b.cost||a.y-b.y||a.x-b.x);
  const out=[];
  for(const c of candidates){if(corridorSegmentClear(p,c.point))out.push(c);if(out.length===6)break;}
  return out;
}
class MinHeap {
  constructor(){this.items=[];}
  push(value){
    const a=this.items;let i=a.length;a.push(value);
    while(i){const parent=(i-1)>>1;if(a[parent].f<=value.f)break;a[i]=a[parent];i=parent;}a[i]=value;
  }
  pop(){
    const a=this.items,first=a[0],last=a.pop();if(!a.length)return first;
    let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&a[child+1].f<a[child].f)child++;if(a[child].f>=last.f)break;a[i]=a[child];i=child;}a[i]=last;return first;
  }
}
function findRoute(from,to) {
  const key=`${pointKey(from)}>${pointKey(to)}`;
  if(routes.has(key))return routes.get(key);
  if(!stands(from)||!stands(to))return cache(routes,key,{reason:'invalid_endpoint'},MAX_ROUTES);
  if(corridorSegmentClear(from,to))return cache(routes,key,{points:[{...from},{...to}]},MAX_ROUTES);
  const starts=attachments(from),ends=attachments(to);
  if(!starts.length||!ends.length)return cache(routes,key,{reason:'endpoint_unattached'},MAX_ROUTES);
  const goals=new Set(ends.map(p=>p.id)),nodes=new Map(),open=new MinHeap();
  for(const s of starts){const node={...s,g:s.cost,f:s.cost+distance(s.point,to)*1.08,parent:null};nodes.set(s.id,node);open.push(node);}
  let visited=0;
  while(open.items.length&&visited<MAX_NODES){
    const node=open.pop();if(nodes.get(node.id)!==node||node.closed)continue;node.closed=true;visited++;
    if(goals.has(node.id)){
      const middle=[];for(let at=node;at;at=at.parent)middle.push({...at.point});middle.reverse();
      const points=[{x:from.x,y:from.y},...middle,{x:to.x,y:to.y}].filter((p,i,all)=>!i||distance(p,all[i-1])>1e-8);
      return cache(routes,key,{points},MAX_ROUTES);
    }
    for(const [dx,dy]of DIRECTIONS){
      const x=node.x+dx,y=node.y+dy,id=gridKey(x,y),g=node.g+GRID*Math.hypot(dx,dy),old=nodes.get(id);
      if(old&&old.g<=g)continue;
      const point=gridPoint(x,y);if(!stands(point)||!corridorSegmentClear(node.point,point))continue;
      const next={x,y,id,point,g,f:g+distance(point,to)*1.08,parent:node};nodes.set(id,next);open.push(next);
    }
  }
  return cache(routes,key,{reason:visited>=MAX_NODES?'search_budget':'route_unreachable'},MAX_ROUTES);
}
/** Bounded nearest-connected spanning tree. Failed edges never connect a node.
 * The returned array also has a frozen .failures list for generation audits. */
export function buildHabitatCorridors(anchors=[]) {
  const points=[],failures=[],seen=new Set();
  for(const raw of Array.isArray(anchors)?anchors.slice(0,MAX_ANCHORS):[]){
    const key=typeof raw?.key==='string'?raw.key.slice(0,100):'';
    if(!key||seen.has(key)||!validPoint(raw)||!stands(raw)){
      failures.push({from:null,to:key||null,reason:'invalid_anchor'});continue;
    }
    seen.add(key);points.push({key,x:raw.x,y:raw.y});
  }
  if(Array.isArray(anchors)&&anchors.length>MAX_ANCHORS)failures.push({from:null,to:null,reason:'anchor_limit'});
  const result=[],connected=new Set(points.length?[points[0].key]:[]),attempted=new Set(),attempts=new Map();
  for(let attempt=0;attempt<Math.max(0,points.length-1)*2;attempt++){
    let pair=null;
    for(const to of points){
      if(connected.has(to.key)||(attempts.get(to.key)||0)>=2)continue;
      for(const from of points){
        if(!connected.has(from.key))continue;const key=`${from.key}>${to.key}`;if(attempted.has(key))continue;
        const length=distance(from,to);
        if(!pair||length<pair.length)pair={from,to,key,length};
      }
    }
    if(!pair)break;
    attempted.add(pair.key);attempts.set(pair.to.key,(attempts.get(pair.to.key)||0)+1);
    const route=findRoute(pair.from,pair.to);
    if(!route.points){failures.push({from:pair.from.key,to:pair.to.key,reason:route.reason});continue;}
    const path=Object.freeze(route.points.map(p=>Object.freeze({x:p.x,y:p.y})));
    result.push(Object.freeze({from:pair.from.key,to:pair.to.key,points:path,length:path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0)}));
    connected.add(pair.to.key);
  }
  for(const point of points)if(!connected.has(point.key))failures.push({from:null,to:point.key,reason:'unconnected_anchor'});
  Object.defineProperty(result,'failures',{value:Object.freeze(failures.map(v=>Object.freeze(v))),enumerable:false});
  return Object.freeze(result);
}
/** Arc-length samples stay on the validated physical polyline, including ends. */
export function sampleCorridor(points,spacing=300) {
  if(!Array.isArray(points)||!points.length||points.length>MAX_NODES+2||points.some(p=>!validPoint(p)))return[];
  if(points.some((p,i)=>i?!corridorSegmentClear(points[i-1],p):!stands(p)))return[];
  const step=Number.isFinite(spacing)&&spacing>0?Math.max(12,spacing):300,out=[{x:points[0].x,y:points[0].y}];
  let walked=0,next=step;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],length=distance(a,b);if(length<1e-8)continue;
    while(next<=walked+length+1e-8){
      if(out.length>=4096)return[];
      const ratio=Math.min(1,(next-walked)/length);out.push({x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio});next+=step;
    }
    walked+=length;
  }
  const last=points.at(-1);if(distance(out.at(-1),last)>1e-8)out.push({x:last.x,y:last.y});return out;
}
