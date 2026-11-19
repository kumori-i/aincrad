import {BODY_NUMERIC_FIELDS} from './observer.mjs';
// Consumed offline before any outcome classification.
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonnegative=x=>Number.isFinite(x)&&x>=0;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const require=(ok,msg)=>{if(!ok)throw Error(msg);};
export function validateArmStream(rows,actor,steps,{candidate=false,startAt=null,dt=1/60}={}){
 let prior=0,tick=0,at=-1,epoch=-1,lastBody=-60,lastPoseAt=null;
 const receipts=new Map(),links=new Map(),pending=new Map(),completions=new Set(),completionReceipts=new Set(),handlingIDs=new Set(),sightBySerial=new Map(),handling=[];
 for(const r of rows){
  require(r.actor===actor&&r.serial===++prior&&nonnegative(r.at)&&r.at>=at&&Number.isSafeInteger(r.epoch)&&r.epoch>=epoch&&text(r.scene),'actor/serial/time/scope mismatch');
  at=r.at;epoch=r.epoch;
  switch(r.kind){
   case 'pose':
    require(r.tick===tick++&&point(r.position)&&text(r.lifecycle)&&
      (r.active===null||links.has(r.active)),'pose coverage/link mismatch');
    if(startAt!==null)require(Math.abs(r.at-(startAt+tick*dt))<1e-5,'pose clock mismatch');
    lastPoseAt=r.at;break;
   case 'body':
    require(r.tick===tick-1&&r.tick===lastBody+60&&r.at===lastPoseAt&&text(r.lifecycle),'body cadence mismatch');
    require(BODY_NUMERIC_FIELDS.every(k=>Number.isFinite(r[k])),'body schema mismatch');
    lastBody=r.tick;break;
   case 'receipt':
    require(positive(r.receipt)&&!receipts.has(r.receipt)&&text(r.type)&&typeof r.ok==='boolean'&&text(r.code)&&(r.duration===null||nonnegative(r.duration)),'invalid/duplicate canonical receipt');
    receipts.set(r.receipt,r);break;
   case 'handling':
    require(positive(r.receipt)&&r.paid>0&&Number.isFinite(r.paid)&&text(r.type)&&text(r.source)&&typeof r.qualified==='boolean'&&nonnegative(r.startedAt)&&r.startedAt<=r.at,'handling schema mismatch');
    require(!handlingIDs.has(r.receipt),'duplicate handling receipt');handlingIDs.add(r.receipt);
    if(r.sight!==null){const h=r.sight;require(positive(h.key)&&h.key===r.key&&point(h.position)&&nonnegative(h.at)&&h.at<=r.startedAt&&r.startedAt-h.at<=2,'invalid handling sight');if(h.serial!==null){const w=sightBySerial.get(h.serial);require(w?.key===h.key&&w.source===r.source&&w.at===h.at&&w.epoch===r.epoch&&w.scene===r.scene&&!w.held&&JSON.stringify(w.position)===JSON.stringify(h.position),'mismatched watched sight');}}
    if(r.qualified)require(r.ok===true,'qualified failed action');
    handling.push(r);break;
   case 'watch-sight':
    require(text(r.source)&&positive(r.key)&&point(r.position)&&point(r.actorPosition)&&typeof r.held==='boolean','sight schema mismatch');sightBySerial.set(r.serial,r);break;
   case 'sequence':
    require(r.tick===tick-1&&(r.status===null||(Number.isSafeInteger(r.status.admissions)&&Array.isArray(r.status.episodes))),'sequence schema/tick mismatch');break;
   case 'revisit':{
    require(candidate&&text(r.source)&&point(r.target)&&point(r.goal)&&['issued','consumed','consume-rejected'].includes(r.phase),'revisit phase schema mismatch');
    if(r.phase==='issued')pending.set(r.source,r);
    else{
     const p=pending.get(r.source);require(p?.phase==='issued'&&r.at>=p.at&&JSON.stringify(r.goal)===JSON.stringify(p.goal)&&JSON.stringify(r.target)===JSON.stringify(p.target),'revisit consume without matching issue');
     if(r.phase==='consumed')require(r.epoch===p.epoch&&r.scene===p.scene,'accepted consume scope mismatch');
     pending.set(r.source,r);
    }
    break;
   }
   case 'bound':{
    const p=pending.get(r.source);
    require(candidate&&r.id===r.serial&&p?.phase==='consumed'&&r.epoch===p.epoch&&r.scene===p.scene&&JSON.stringify(r.goal)===JSON.stringify(p.goal)&&JSON.stringify(r.target)===JSON.stringify(p.target),'unmatched/duplicate revisit bind');
    links.set(r.id,r);pending.delete(r.source);break;
   }
   case 'move-completion':{
    const b=links.get(r.id),p=receipts.get(r.receipt);
    require(candidate&&b&&!completions.has(r.id)&&b.source===r.source&&b.epoch===r.epoch&&b.scene===r.scene&&JSON.stringify(b.goal)===JSON.stringify(r.goal)&&JSON.stringify(b.target)===JSON.stringify(r.target)&&!completionReceipts.has(r.receipt)&&p?.type==='move'&&p.ok===r.ok&&p.code===r.code&&p.at===r.at&&p.serial<r.serial&&r.serial>b.serial&&point(r.position)&&(r.paid===null||nonnegative(r.paid))&&(r.propelled===null||nonnegative(r.propelled)),'unmatched/duplicate revisit completion');
    completions.add(r.id);completionReceipts.add(r.receipt);break;
   }
   default: throw Error('unknown observer row');
  }
 }
 for(const h of handling){
  const a=receipts.get(h.receipt);
  require(a&&a.at===h.at&&a.epoch===h.epoch&&a.scene===h.scene&&a.target===h.source&&a.type===h.type&&a.ok===h.ok&&a.code===h.code&&a.serial<h.serial&&Math.abs(a.duration-h.paid)<=1e-8&&h.startedAt+h.paid<=h.at+1e-5&&a.successor===h.successor,'unmatched canonical handling receipt');
 }
 require(tick===steps&&lastBody===Math.floor((steps-1)/60)*60,'incomplete sampled pose/body coverage');
 return {receipts:receipts.size,bound:links.size,completed:completions.size,unresolved:links.size-completions.size,ticks:tick};
}
