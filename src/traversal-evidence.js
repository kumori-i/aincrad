// Supplied short-lived retry restraint, not a terrain danger map or acquired
// climbing ability. Only this actor's retained bodily receipt can support it.
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
export function unproductiveClimbApproach(npc,target){
  if(!npc.learning||!finitePoint(target)||!finitePoint(npc.position))return false;
  const relevant=npc.memory.experience.filter(event=>{
    const d=event.details,a=d?.action;
    return event.type==='action'&&Number.isFinite(event.at)&&event.at<=npc.elapsed&&
      npc.elapsed-event.at<300&&a?.type==='climb'&&
      a.target?.x===target.x&&a.target?.y===target.y&&
      d.scene===npc.scene&&
      (!finitePoint(d.startPosition)||Math.hypot(npc.position.x-d.startPosition.x,npc.position.y-d.startPosition.y)<=20);
  }).sort((a,b)=>b.at-a.at||b.id-a.id);
  const latest=relevant[0];
  // Conflicting identity or incomplete later evidence means unknown. Never
  // search backwards past it to resurrect an older adverse outcome.
  if(!latest||!Number.isSafeInteger(latest.id)||latest.id<=0||
    relevant.some((e,i)=>i>0&&e.at===latest.at&&e.id===latest.id))return false;
  const r=latest?.details.result;
  return !!r&&finitePoint(latest.details.startPosition)&&
      r.startScene===npc.scene&&r.scene===npc.scene&&r.ok===false&&['ROUTE_BLOCKED','SLIPPED'].includes(r.code)&&
      Number.isFinite(r.durationSeconds)&&r.durationSeconds>=(r.code==='SLIPPED'?.5:1)-1e-8&&
      r.movement?.traversal==='climbing'&&r.movement.progress==='negligible'&&
      r.movement.resistance==='strong'&&r.movement.effort==='rising';
}

// A personally completed climb can motivate another local test ahead, not a
// certified crossing. Any later movement replaces this short-lived support.
export function successfulClimbHeading(npc){
  if(!npc.learning||!finitePoint(npc.position))return null;
  const movements=npc.memory.experience.filter(e=>e.type==='action'&&
    ['move','swim','climb'].includes(e.details?.action?.type)&&
    Number.isFinite(e.at)&&e.at<=npc.elapsed&&npc.elapsed-e.at<90)
    .sort((a,b)=>b.at-a.at||b.id-a.id);
  const latest=movements[0],d=latest?.details,r=d?.result;
  if(!latest||!Number.isSafeInteger(latest.id)||latest.id<=0||
    movements.some((e,i)=>i>0&&e.at===latest.at&&e.id===latest.id)||
    d.action.type!=='climb'||d.scene!==npc.scene||r?.startScene!==npc.scene||r.scene!==npc.scene||
    r.ok!==true||r.code!=='ARRIVED'||!Number.isFinite(r.durationSeconds)||r.durationSeconds<=0||
    r.movement?.traversal!=='climbing'||!['limited','steady'].includes(r.movement.progress)||
    r.movement.effort!=='rising'||!finitePoint(d.startPosition)||!finitePoint(d.position)||
    Math.hypot(npc.position.x-d.position.x,npc.position.y-d.position.y)>20)return null;
  const x=d.position.x-d.startPosition.x,y=d.position.y-d.startPosition.y,length=Math.hypot(x,y);
  return length>=20?{x:x/length,y:y/length}:null;
}
