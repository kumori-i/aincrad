// Trusted sensory adapter. Engine IDs remain here and in actuator bookkeeping;
// the neural policies receive only the returned numeric RGB features.
import { drawEcologyObject } from './art.js';
import { describeEcologyObject, lookupEcologyObject, renderEcology } from './ecology.js';
import { recentDiscoveryAim } from './discovery.js';
import { actorLineOfSight } from './perception.js';
import { isSleeping } from './biology.js';
import { NPC_RULES } from './config.js';

export function poolCommunicationPixels(pixels) {
  if (!pixels || pixels.length !== 768 || Array.from(pixels).some(v => !Number.isFinite(v) || v < 0 || v > 255)) throw new TypeError('Expected 16 by 16 RGB pixels');
  const features = Array(48).fill(0);
  for (let y=0;y<16;y++) for (let x=0;x<16;x++) for (let c=0;c<3;c++)
    features[(Math.floor(y/4)*4+Math.floor(x/4))*3+c] += pixels[(y*16+x)*3+c]/(16*255);
  return features;
}

export function createCommunicationPixelSensor(document, {draw=drawEcologyObject}={}) {
  const source=document.createElement('canvas'), small=document.createElement('canvas');
  source.width=source.height=256;small.width=small.height=16;
  const context=source.getContext('2d',{willReadFrequently:true}), out=small.getContext('2d',{willReadFrequently:true});
  if (!context || !out) throw new Error('Pixel sensor needs Canvas2D');
  let disposed=false;
  return {
    capture(npc,state) {
      const crops=new Map();
      if(disposed || npc.lifecycle!=='AWAKE' || isSleeping(npc)) return crops;
      const ecology=state.environment.ecology;
      const sprites=new Map(renderEcology(ecology,npc.scene).map(o=>[o.id,o]));
      for(const observation of Object.values(npc.discovery.observations).slice(-128)) {
        const id=observation.id, held=npc.inventory.items.includes(id);
        if(observation.scene!==npc.scene || observation.observedAt>npc.elapsed || npc.elapsed-observation.observedAt>1.1) continue;
        const actual=lookupEcologyObject(ecology,id);
        if(!actual || actual.scene!==npc.scene || actual.heldBy && actual.heldBy!==npc.id) continue;
        if(!held && (!recentDiscoveryAim(npc,id) || Math.hypot(actual.position.x-npc.position.x,actual.position.y-npc.position.y)>NPC_RULES.visionRadius || !actorLineOfSight(npc,npc.position,actual.position))) continue;
        if(held && (actual.heldBy!==npc.id || !describeEcologyObject(ecology,id,{actorId:npc.id}))) continue;
        // The same read-only visual projection handles a personally held item.
        // No new sensory record, nutrition fact, or physical resource is created.
        const sprite=held?renderEcology({...ecology,plants:[],animals:[],aquatic:null,materials:[{...actual,heldBy:null}]},npc.scene)[0]:sprites.get(id);
        if(!sprite)continue;
        context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,256,256);
        draw(context,{...sprite,x:128,y:190},state.elapsed,null);
        const rgba=context.getImageData(0,0,256,256).data;
        let minX=256,minY=256,maxX=-1,maxY=-1;
        for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(rgba[(y*256+x)*4+3]>0){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
        if(maxX<minX)continue;
        const w=maxX-minX+1,h=maxY-minY+1,scale=14/Math.max(w,h),dw=w*scale,dh=h*scale;
        out.setTransform(1,0,0,1,0,0);out.fillStyle='#27352d';out.fillRect(0,0,16,16);out.imageSmoothingEnabled=false;
        out.drawImage(source,minX,minY,w,h,(16-dw)/2,(16-dh)/2,dw,dh);
        const data=out.getImageData(0,0,16,16).data,pixels=[];
        for(let i=0;i<data.length;i+=4)pixels.push(data[i],data[i+1],data[i+2]);
        crops.set(id,{pixels,features:poolCommunicationPixels(pixels),at:npc.elapsed,observedAt:observation.observedAt,epoch:npc.epoch});
      }
      return crops;
    },
    dispose(){disposed=true;source.width=source.height=small.width=small.height=0;},
  };
}
