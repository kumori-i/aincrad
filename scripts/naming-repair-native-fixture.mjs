export { namingFollowupEvidence as namingRepairEvidence, checkNamingFollowupReload as checkNamingRepairReload } from './naming-followup-native-fixture.mjs';

/** Controlled repair protocol fixture; no autonomous controller claim. */
export async function createNamingRepairScene(moduleBase,projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG,NPC_RULES}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {senseEcology}=await use('ecology');
  const {observeNpc,requestNpcAction,tickNpc}=await use('npc');
  const {SocialCoordinator}=await use('social');
  const {lexicalLabels}=await use('naming-state');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  require(typeof projectEvidence==='function','Missing evidence projection');
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const [speaker,listener]=state.agents;
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  let runtime=null;
  const project=(current=state)=>projectEvidence(current);
  const dt=.25; // Disclosed deterministic fixture integration, never a clock jump.
  const tick=()=>{
    tickEnvironment(environment,dt);
    tickOzarkEcology(environment.ecology,dt,environment,state.agents,{},geometry);
    for(const actor of state.agents)tickNpc(actor,dt,environment);
    state.elapsed=environment.elapsed;if(runtime)runtime.tick(dt);
  };
  for(let i=0;i<60/dt;i++)tick();
  const farOffset=NPC_RULES.visionRadius+20;
  const safe=q=>geometry.canOccupy(q.x,q.y,CONFIG.playerRadius)&&!['shallow-water','deep-water','deep-pond'].includes(geometry.groundAt(q));
  const source=environment.ecology.plants.find(p=>{
    const a={x:p.position.x+45,y:p.position.y},far={x:p.position.x+farOffset,y:p.position.y},near={x:p.position.x+65,y:p.position.y};
    return p.quantity>0&&[a,far,near].every(safe)&&geometry.lineOfSight(a,p.position)&&
      geometry.lineOfSight(a,far)&&geometry.lineOfSight(a,near)&&geometry.lineOfSight(near,p.position)&&
      senseEcology(environment.ecology,near,'valley',NPC_RULES.visionRadius).filter(o=>geometry.lineOfSight(near,o.position)&&Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1;
  });
  require(source,'No eligible fixed repair encounter');
  speaker.position={x:source.position.x+45,y:source.position.y};listener.position={x:source.position.x+farOffset,y:source.position.y};
  state.player={...speaker.position};state.selectedAgentId=listener.id;
  for(const actor of state.agents)observeNpc(actor,environment);
  const beforeEncounter=project();let own,inspections=0;
  for(;inspections<4&&!own;inspections++){
    require(requestNpcAction(speaker,{type:'inspect_object',targetId:source.id},environment).code==='ACTION_STARTED','Paid inspection not admitted');
    for(let i=0;speaker.active&&i<600;i++)tick();
    require(!speaker.active&&speaker.lastResult?.code==='OBJECT_OBSERVED','Paid inspection did not finish');
    own=lexicalLabels(speaker).find(row=>row.objectId===source.id&&row.status==='owner-chosen');
  }
  require(own,'Bounded fixed encounters produced no name; no favorable seed search');
  runtime=new SocialCoordinator({getAgents:()=>state.agents,getEnvironment:()=>environment,getCommunity:()=>state.community});
  const summary={fixtureDisclosure:'Controlled first physically eligible source; up to four paid inspections. Listener initially outside source sight but within speaker range. After an actual unresolved request and explicit clarification, fixture externally places listener at a disclosed nearby safe position. No observation override, dictionary injection or chosen-name search. Isolated SocialCoordinator, not PopulationRuntime/controllers, drives protocol; body/ecology/action time continues in 0.25-second integration steps. Not autonomous travel, general language or survival evidence.',
    actorId:listener.id,speakerId:speaker.id,sourceObjectId:source.id,token:own.token,inspections,beforeEncounter,afterEncounter:project()};
  const binding=()=>listener.lexicon?.heard.find(row=>row.speakerId===speaker.id&&row.objectId===source.id&&row.token===own.token);
  const receipt=()=>speaker.lexicon?.repairReceipts?.find(r=>r.speakerId===speaker.id&&r.listenerId===listener.id&&r.token===own.token);
  const clarify=()=>{
    for(let i=0;!receipt()&&i<400;i++)tick();
    require(receipt()&&!receipt().repoint&&!binding(),'Actual unresolved request must produce position-free clarification, not a binding');
    require(runtime.naming.pendingCount()===1&&runtime.naming.opportunityCount()===0,'Clarification must retain only ordinary-cooldown repair');
    require(!runtime.naming.visible(listener).some(o=>o.id===source.id),'Initial listener unexpectedly sees named source');
    summary.clarified=project();summary.clarifiedAt=environment.elapsed;
    return {status:'clarified',at:environment.elapsed,opportunityCount:runtime.naming.opportunityCount(),receipt:structuredClone(receipt())};
  };
  const advance=({interrupt=false}={})=>{
    require(summary.clarified,'Clarification must precede repair');
    summary.externalRelocation={at:environment.elapsed,from:{...listener.position},to:{x:source.position.x+65,y:source.position.y}};
    listener.position={...summary.externalRelocation.to};state.player={...listener.position};
    observeNpc(listener,environment);
    for(let i=0;!receipt()?.repoint&&i<400;i++)tick();
    require(receipt()?.repoint&&binding()&&!binding().confirmation,'Re-point must independently ground without claiming understanding');
    require(runtime.naming.opportunityCount()===1,'Genuine re-grounding must open bounded follow-up');
    summary.regrounded=project();
    require(requestNpcAction(listener,{type:'wait',seconds:5},environment).code==='STARTED','Paid work must remain available during dialogue');
    const action=listener.active;
    for(let i=0;i<40;i++){
      tick();if(interrupt?!!receipt()?.retry:!!binding()?.confirmation)break;
    }
    const row=binding(),repair=receipt();
    require(repair?.retry,'One fresh word-only retry must have been emitted');
    require(listener.active===action,'Repair must not cancel ongoing paid work');
    if(interrupt){
      require(runtime.naming.pendingCount()===1&&!row.confirmation,'Interrupted retry must remain unconfirmed');
    }else{
      require(row?.confirmation,'Independent selection and confirmation did not complete');
      const c=row.confirmation;
      require(c.request.messageId===repair.retry.messageId&&c.request.at>repair.repoint.at&&c.selection.at>c.request.at&&c.confirmation.at>c.selection.at,'Repair stages are not independent/ordered');
      require(c.confirmation.at-repair.repoint.at<8,'Confirmation exceeded bounded follow-up');
      require(runtime.naming.opportunityCount()===0&&runtime.naming.pendingCount()===0,'Completed repair retained authority');
    }
    summary.after=project();summary.interrupted=interrupt;summary.status=interrupt?'heard-grounded':'confirmed';summary.elapsed=state.elapsed;
    summary.pendingAtSave=runtime.naming.pendingCount();summary.opportunitiesAtSave=runtime.naming.opportunityCount();
    for(const actor of state.agents){const prior=summary.clarified.agents.find(n=>n.id===actor.id);require(actor.elapsed>prior.elapsed&&actor.physiology.totals.metabolizedKcal>prior.physiology.totals.metabolizedKcal,'Repair must pay ongoing body time');}
    return {status:summary.status,at:environment.elapsed,confirmation:structuredClone(row.confirmation),receipt:structuredClone(repair),pending:summary.pendingAtSave};
  };
  const save=(storage)=>{
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    require(writeOzarkSave(disk,state,geometry),'Strict naming repair save rejected: '+state.saveError);
    const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict restore rejected: '+loaded.error);
    return {saveKey:OZARK_SAVE_KEY,raw,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
  };
  return {state,actor:listener,geometry,project,clarify,advance,save,dispose:()=>runtime.dispose()};
}

/** Read-only actual native world renderer for the live controlled scene. */
export async function presentNamingRepairScene(label) {
  const scene=window.__namingRepairScene;if(!scene)throw new Error('Missing controlled naming scene');
  const {OzarkWorldRenderer}=await import('./src/ozark-world-renderer.js');
  for(const node of document.querySelectorAll('[data-naming-repair-qa]'))node.remove();
  const canvas=document.createElement('canvas');canvas.dataset.namingRepairQa='true';
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'9998'});document.body.append(canvas);
  const caption=document.createElement('div');caption.dataset.namingRepairQa='true';
  Object.assign(caption.style,{position:'fixed',top:'18px',left:'18px',maxWidth:'80vw',zIndex:'9999',background:'#18362ee8',color:'#f4e4be',font:'16px monospace',padding:'14px',whiteSpace:'pre-wrap'});
  caption.textContent=label+'\n'+scene.state.community.messages.slice(-4).map(m=>m.senderId+': '+m.text).join('\n');document.body.append(caption);
  const renderer=new OzarkWorldRenderer(canvas,scene.geometry);renderer.targetZoom=3;renderer.snap(scene.actor.position);
  const before=JSON.stringify(scene.project());
  for(let i=0;i<120;i++){renderer.draw(scene.state);if(!renderer.pendingChunks.size&&i>10)break;await new Promise(resolve=>requestAnimationFrame(resolve));}
  if(renderer.pendingChunks.size)throw new Error('Native naming scene did not settle');
  if(JSON.stringify(scene.project())!==before)throw new Error('Rendering changed naming evidence');
  return {label,readOnly:true};
}

