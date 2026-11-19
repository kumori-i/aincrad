// Research classification only; never imported by an agent or product chooser.
const range=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function classifyReturns(rows,{gap=null}={}){
 const places=[],transformed=[],used=new Set(),moves=[],bindings=new Map();
 let prior=0;
 for(const r of rows){
  if(r.serial!==++prior)throw Error('missing/reordered actor observation');
  if(r.kind==='bound')bindings.set(r.id,r);
  for(const p of places){
   if(p.closed)continue;
   if(r.epoch!==p.epoch||r.scene!==p.scene||r.lifecycle==='COLLAPSED'){p.closed='scope-ended';continue;}
   if(r.at>p.at+300&&!p.entry){p.closed='expired';continue;}
   if(p.entry&&r.at>p.entry.at+30){p.closed='window-ended';continue;}
   if(r.kind==='pose'&&r.position){
    const outside=range(r.position,p.position)>80;
    if(outside){if(p.entry)p.closed='departed';p.outside=true;}
    else if(p.outside&&!p.entered){p.entered=true;if(r.at>=p.at+20&&r.at<=p.at+300){const m=bindings.get(r.active);p.entry={at:r.at,serial:r.serial,move:m?.epoch===p.epoch&&m.scene===p.scene&&m.source===p.source&&m.goal&&range(m.goal,p.position)<=1?r.active:null};}}
    if(outside&&!p.entry)p.entered=false;
   }
   if(r.kind==='watch-sight'&&r.source===p.source){if(r.key!==p.key){p.closed='replacement-observed';continue;}if(r.held){p.closed='custody-observed';continue;}if(!r.position||range(r.position,p.position)>1){p.closed='relocation-observed';continue;}}
   if(p.entry&&r.kind==='watch-sight'&&r.source===p.source&&r.key===p.key&&!r.held&&r.actorPosition&&range(r.actorPosition,p.position)<=80&&!p.sight)p.sight={at:r.at,serial:r.serial};
   if(p.sight&&r.kind==='handling'&&r.source===p.source&&r.key===p.key&&r.sight?.serial>=p.sight.serial&&!p.followup)p.followup={receipt:r.receipt,ok:r.ok,paid:r.paid};
  }
  if(r.kind==='move-completion')moves.push(r);
  if(r.kind!=='handling'||!r.qualified||!r.ok||!r.sight||r.sight.key!==r.key)continue;
  const key=JSON.stringify([r.epoch,r.scene,r.key]);if(used.has(key))continue;
  used.add(key);
  if(r.successor){transformed.push({source:r.source,receipt:r.receipt,successor:r.successor});continue;}
  places.push({source:r.source,key:r.key,epoch:r.epoch,scene:r.scene,receipt:r.receipt,at:r.at,position:r.sight.position,outside:false,entered:false,entry:null,sight:null,followup:null,closed:null});
 }
 for(const p of places)if(!p.closed)p.closed=gap?'coverage-gap':'horizon';
 return {complete:gap===null,gap,places,transformed,moves};
}

// Join only already-observed clean private ledger episodes to unique physical
// action receipts. No inference from source IDs or episode timestamps alone.
export function observedCleanEpisodes(rows,followupReceipts){
 const receipts=rows.filter(r=>r.kind==='receipt'),byID=new Map(receipts.map(r=>[r.receipt,r]));
 const index=new Map();
 for(const r of receipts){
  const key=JSON.stringify([r.epoch,r.scene,r.at,r.target,r.type,r.code]);
  const a=index.get(key)??[];a.push(r);index.set(key,a);
 }
 const episodes=new Map();
 for(const row of rows)if(row.kind==='sequence')for(const e of row.status?.episodes??[]){
  if(e.uncertain!==false||e.interposed!==false)continue;
  const first=index.get(JSON.stringify([row.epoch,row.scene,e.firstAt,e.sourceId,e.firstType,e.firstCode]))??[];
  const next=index.get(JSON.stringify([row.epoch,row.scene,e.nextAt,e.outputId,e.type,e.code]))??[];
  if(first.length!==1||next.length!==1)continue;
  const [a]=first,[b]=next;
  if(!followupReceipts.has(a.receipt)||byID.get(a.receipt)!==a||byID.get(b.receipt)!==b||a.output!==e.outputId||!a.ok||!b.ok||!(a.duration>0)||!(b.duration>0)||a.serial>=b.serial||b.serial>=row.serial)continue;
  const key=JSON.stringify([row.epoch,a.receipt,b.receipt]);episodes.set(key,{source:e.sourceId,output:e.outputId,receiptA:a.receipt,receiptB:b.receipt,context:e.context});
 }
 return [...episodes.values()];
}
export function assertPoseCoverage(rows,actor,expected){
 let tick=0,serial=0;
 for(const r of rows){
  if(r.actor!==actor||r.serial!==++serial)throw Error('actor/serial coverage mismatch');
  if(r.kind==='pose'&&(r.tick!==tick++||!r.position))throw Error('pose coverage mismatch');
 }
 if(tick!==expected)throw Error('incomplete pose coverage');
 return tick;
}
