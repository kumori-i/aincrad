import { ECOLOGY_MATERIALS } from './ecology-config.js';

// The same 10-unit footprint must be admissible in current-format saves.
// This is bounded surface advection, not generic buoyancy or actor walking.
const RADIUS=10,MAX_SWEEP=1;
function flowing(geometry,p){
 const water=geometry.classify(p.x,p.y,RADIUS,'swim'),v=water.currentDirection;
 return water.walkable&&water.waterKind==='surface'&&
  Number.isFinite(v?.x)&&Number.isFinite(v?.y)&&Number.isFinite(water.depthProxy)&&water.depthProxy>0?water:null;
}
export function advectLooseSurfaceMaterial(material,seconds,geometry){
 if(typeof geometry?.canSweepSwimFootprint!=='function'||material.kind!=='material'||material.heldBy||material.scene!=='valley')return false;
 const coefficient=ECOLOGY_MATERIALS[material.materialType]?.surfaceTransport;
 if(!(coefficient>0&&coefficient<=1)||!(Number.isFinite(seconds)&&seconds>0&&seconds<=.5))return false;
 const {currentMaxSpeed,wadeMaxDepthProxy}=geometry.profile;
 if(!(Number.isFinite(currentMaxSpeed)&&currentMaxSpeed>0&&currentMaxSpeed<=100&&Number.isFinite(wadeMaxDepthProxy)&&wadeMaxDepthProxy>0))return false;
 const original=material.position;
 let point=original,water=flowing(geometry,point);
 if(!water)return false;
 const steps=Math.max(1,Math.ceil(currentMaxSpeed*coefficient*seconds/MAX_SWEEP));
 for(let i=0;i<steps;i++){
  const v=water.currentDirection,norm=Math.hypot(v.x,v.y);
  if(!(norm>0))break;
  const step=currentMaxSpeed*coefficient*Math.min(1,water.depthProxy/wadeMaxDepthProxy)*seconds/steps;
  const dx=v.x/norm*step,dy=v.y/norm*step;
  const next={x:point.x+dx,y:point.y+dy};
  // Surface classification at both samples plus the native conservative
  // terrain/footprint and exact structural segment sweep.
  if(!flowing(geometry,{x:point.x+dx/2,y:point.y+dy/2}))break;
  const destination=flowing(geometry,next);if(!destination||!geometry.canSweepSwimFootprint(point,next,RADIUS))break;
  point=next;water=destination;
 }
 if(point===original)return false;
 material.position=point;
 return true;
}
