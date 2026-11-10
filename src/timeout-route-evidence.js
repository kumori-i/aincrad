import { NPC_RULES } from './config.js';
import { bodySignals } from './interoception.js';
import { tileKey } from './perception.js';
import { ozarkPersistentWorldAgent } from './ozark-agent-world.js';

// Reconstructed implementation. Authority is session-only and cannot be loaded
// from saves or acquired by copying another actor's retained receipts.
const actors=new WeakMap(), windows=new WeakMap();
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const copy=p=>({x:p.x,y:p.y});
export const timeoutDirection=(from,to)=>`${tileKey(from)}>${tileKey(to)}`;
function state(npc){
  let s=actors.get(npc);
  if(!s||s.scene!==npc.scene||s.epoch!==npc.epoch||s.discovery!==npc.discovery||npc.elapsed<s.at){
    s={scene:npc.scene,epoch:npc.epoch,discovery:npc.discovery,at:npc.elapsed,entries:[]};actors.set(npc,s);
  }
  s.at=npc.elapsed;
  s.entries=s.entries.filter(e=>npc.elapsed>=e.at&&npc.elapsed-e.at<60&&distance(e.origin,npc.position)<=NPC_RULES.tileSize*2&&e.receipts.every(r=>npc.memory.experience.includes(r)&&npc.elapsed>=r.at&&npc.elapsed-r.at<60));
  return s;
}
export function noteTimeoutRoutePaid(npc,active,before,target,paid){
  if(!ozarkPersistentWorldAgent(npc)||active.request.type!=='move'||!(paid>0))return;
  let w=windows.get(active);
  if(!w||w.index!==active.index){w={index:active.index,origin:copy(before),target:copy(target),paid:0,scene:npc.scene,epoch:npc.epoch,discovery:npc.discovery};windows.set(active,w);}
  w.paid+=paid;
}
export function finishTimeoutRouteEvidence(npc,active,event){
  const w=active&&windows.get(active);if(active)windows.delete(active);
  if(!ozarkPersistentWorldAgent(npc)||active?.request.type!=='move')return;
  const s=state(npc),result=event.details?.result;
  // Success interrupts a pair. Previously established preferences simply decay.
  if(result?.ok){s.entries=s.entries.filter(e=>e.receipts.length===2);return;}
  if(result?.code!=='ACTION_TIMEOUT'||!w||w.index!==active.index||w.scene!==npc.scene||w.epoch!==npc.epoch||w.discovery!==npc.discovery||
    active.expiresAt-active.startedAt<NPC_RULES.maxActionSeconds-.05||npc.elapsed-active.startedAt<NPC_RULES.maxActionSeconds-.05||w.paid<8||
    distance(w.origin,w.target)-distance(npc.position,w.target)>NPC_RULES.tileSize/4||tileKey(w.origin)===tileKey(w.target)||!npc.memory.experience.includes(event))return;
  const key=timeoutDirection(w.origin,w.target),previous=s.entries.find(e=>e.key===key&&distance(e.origin,w.origin)<=NPC_RULES.tileSize/2&&distance(e.target,w.target)<=NPC_RULES.tileSize/2&&distance(e.finish,npc.position)<=NPC_RULES.tileSize/2);
  const receipts=previous?[previous.receipts.at(-1),event]:[event];
  s.entries=s.entries.filter(e=>e.key!==key);
  s.entries.push({key,origin:w.origin,target:w.target,finish:copy(npc.position),at:npc.elapsed,receipts});
  if(s.entries.length>8)s.entries.shift();
}
export function timeoutRouteBlocks(npc){
  const s=state(npc),body=bodySignals(npc);
  if(!ozarkPersistentWorldAgent(npc)||body.overall==='urgent'||['ravenous','faint with hunger'].includes(body.hunger)||
    ['parched','desperate thirst'].includes(body.thirst)||body.energy==='depleted'||body.pain==='severe'||
    ['overheated','shivering'].includes(body.thermal)||body.thermal.startsWith('dangerously')||
    npc.memory.experience.some(e=>e.type==='condition'&&e.details?.code==='CONTACT_INJURY'&&e.details.provenance==='experienced contact'&&e.details.scene===npc.scene&&e.at<=npc.elapsed&&npc.elapsed-e.at<60))return null;
  const keys=s.entries.filter(e=>e.receipts.length===2).map(e=>e.key);
  return keys.length?new Set(keys):null;
}
