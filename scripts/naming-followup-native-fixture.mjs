/** Pure projection serialized into the native runner. Lexical/social evidence,
 * all clocks and physical action history are retained, not only a status flag. */
export function namingFollowupEvidence(state) {
  return structuredClone({player:state.player,playerBody:state.playerBody,elapsed:state.elapsed,distance:state.distance,
    selectedAgentId:state.selectedAgentId,community:state.community,
    clocks:{environmentElapsed:state.environment.elapsed,ecologyElapsed:state.environment.ecology.elapsed,ecologyPending:state.environment.ecology.pending},
    agents:state.agents.map(n=>({id:n.id,position:n.position,elapsed:n.elapsed,active:n.active??null,
      memory:n.memory,discovery:n.discovery,physiology:n.physiology,lexicon:n.lexicon??null,social:n.social}))});
}

/** Controlled placement and paid inspections only. After preparation, ordinary
 * PopulationRuntime ticks must produce every introduction and follow-up turn. */
export async function createNamingFollowupScene(moduleBase,projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG,NPC_RULES}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {senseEcology}=await use('ecology');
  const {observeNpc,requestNpcAction,tickNpc}=await use('npc');
  const {PopulationRuntime}=await use('population');
  const {lexicalLabels,chooseOwnName}=await use('naming-state');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  require(typeof projectEvidence==='function','Missing evidence projection');
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const [speaker,listener]=state.agents;
  for(const actor of state.agents)bindOzarkWorldAgent(actor,geometry,state);
  let runtime=null;
  const project=(current=state)=>projectEvidence(current);
  const tick=()=>{
    if(runtime)runtime.tick(CONFIG.fixedStep);
    else{
      tickEnvironment(environment,CONFIG.fixedStep);
      tickOzarkEcology(environment.ecology,CONFIG.fixedStep,environment,state.agents,{},geometry);
      for(const actor of state.agents)tickNpc(actor,CONFIG.fixedStep,environment);
    }
    state.elapsed=environment.elapsed;
  };
  for(let i=0;i<60/CONFIG.fixedStep;i++)tick();
  const source=environment.ecology.plants.find(p=>{
    const a={x:p.position.x+45,y:p.position.y},b={x:p.position.x+50,y:p.position.y+10};
    return p.quantity>0&&[a,b].every(q=>geometry.canOccupy(q.x,q.y,CONFIG.playerRadius)&&geometry.lineOfSight(q,p.position))&&geometry.lineOfSight(a,b)&&
      senseEcology(environment.ecology,b,'valley',NPC_RULES.visionRadius).filter(o=>geometry.lineOfSight(b,o.position)&&Math.hypot(o.position.x-p.position.x,o.position.y-p.position.y)<=12).length===1;
  });
  require(source,'No eligible fixed naming encounter');
  speaker.position={x:source.position.x+45,y:source.position.y};listener.position={x:source.position.x+50,y:source.position.y+10};
  state.player={...listener.position};state.selectedAgentId=listener.id;
  for(const actor of state.agents)observeNpc(actor,environment);
  const beforeEncounter=project();let own,inspections=0;
  for(;inspections<4&&!own;inspections++){
    require(requestNpcAction(speaker,{type:'inspect_object',targetId:source.id},environment).code==='ACTION_STARTED','Paid inspection not admitted');
    for(let i=0;speaker.active&&i<600;i++)tick();
    require(!speaker.active&&speaker.lastResult?.code==='OBJECT_OBSERVED','Paid inspection did not finish');
    // Explicit historical seeded-name fixture, not current model inference.
    chooseOwnName(speaker,speaker.discovery.experiments.at(-1),{objectId:source.id,at:speaker.elapsed,scene:speaker.scene,actorPosition:{...speaker.position},objectPosition:{...source.position}});
    own=lexicalLabels(speaker).find(row=>row.objectId===source.id&&row.status==='owner-chosen');
  }
  require(own,'Bounded fixed encounters produced no name; no favorable seed search');
  runtime=new PopulationRuntime(state,{cardinal:false});
  const summary={fixtureDisclosure:'Controlled initial placement at the first physically eligible local source and up to four real paid inspections. Legacy seeded-name fixture explicitly invoked after the paid encounter; no supplied confirmation or experience. Not current model inference. Ordinary PopulationRuntime drives all subsequent introduction and follow-up turns with world, ecology and body time continuing. This is not spontaneous travel, general language or survival evidence.',
    actorId:listener.id,speakerId:speaker.id,sourceObjectId:source.id,token:own.token,inspections,beforeEncounter,afterEncounter:project()};
  const binding=()=>listener.lexicon?.heard.find(row=>row.speakerId===speaker.id&&row.objectId===source.id&&row.token===own.token);
  const ground=()=>{
    for(let i=0;!binding()&&i<120;i++)tick();
    require(binding()&&!binding().confirmation,'Actual introduction must first ground the name');
    require(runtime.social.naming.opportunityCount()===1,'No live bounded follow-up opportunity');
    summary.grounded=project();summary.groundedAt=environment.elapsed;
    return {status:'heard-grounded',at:environment.elapsed,opportunityCount:runtime.social.naming.opportunityCount()};
  };
  const advance=({interrupt=false}={})=>{
    require(summary.grounded,'Grounding must precede follow-up');
    for(let i=0;i<480;i++){
      tick();
      if(interrupt?runtime.social.naming.pendingCount()>0:!!binding()?.confirmation)break;
    }
    const row=binding();
    if(interrupt){
      require(runtime.social.naming.pendingCount()===1&&!row.confirmation,'Interruption must retain an actual unconfirmed request');
      require(speaker.lexicon.own.find(r=>r.objectId===source.id).checkedWith.length===1,'Request was not actually consumed');
    }else{
      require(row?.confirmation,'Ordinary runtime did not complete independent confirmation');
      const c=row.confirmation;
      require(c.request.at-row.grounding.at>=1&&c.selection.at-c.request.at>=1&&c.confirmation.at-c.selection.at>=1,'Turns violated minimum spacing');
      require(c.confirmation.at-row.grounding.at<8,'Confirmation fell outside bounded opportunity');
      require(runtime.social.naming.opportunityCount()===0&&runtime.social.naming.pendingCount()===0,'Completed opportunity retained authority');
    }
    summary.after=project();summary.interrupted=interrupt;
    summary.status=interrupt?'heard-grounded':'confirmed';summary.elapsed=state.elapsed;
    summary.pendingAtSave=runtime.social.naming.pendingCount();summary.opportunitiesAtSave=runtime.social.naming.opportunityCount();
    for(const actor of state.agents){const prior=summary.grounded.agents.find(n=>n.id===actor.id);require(actor.elapsed>prior.elapsed&&actor.physiology.totals.metabolizedKcal>prior.physiology.totals.metabolizedKcal,'Conversation must pay ongoing body time');}
    return {status:summary.status,at:environment.elapsed,confirmation:structuredClone(row.confirmation),pending:summary.pendingAtSave};
  };
  const save=(storage)=>{
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    require(writeOzarkSave(disk,state,geometry),'Strict naming follow-up save rejected: '+state.saveError);
    const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict restore rejected: '+loaded.error);
    return {saveKey:OZARK_SAVE_KEY,raw,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
  };
  return {state,actor:listener,geometry,project,ground,advance,save,dispose:()=>runtime.dispose()};
}

/** Read-only actual native world renderer for the live controlled scene. */
export async function presentNamingFollowupScene(label) {
  const scene=window.__namingFollowupScene;if(!scene)throw new Error('Missing controlled naming scene');
  const {OzarkWorldRenderer}=await import('./src/ozark-world-renderer.js');
  for(const node of document.querySelectorAll('[data-naming-followup-qa]'))node.remove();
  const canvas=document.createElement('canvas');canvas.dataset.namingFollowupQa='true';
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'9998'});document.body.append(canvas);
  const caption=document.createElement('div');caption.dataset.namingFollowupQa='true';
  Object.assign(caption.style,{position:'fixed',top:'18px',left:'18px',maxWidth:'80vw',zIndex:'9999',background:'#18362ee8',color:'#f4e4be',font:'16px monospace',padding:'14px',whiteSpace:'pre-wrap'});
  caption.textContent=label+'\n'+scene.state.community.messages.slice(-4).map(m=>m.senderId+': '+m.text).join('\n');document.body.append(caption);
  const renderer=new OzarkWorldRenderer(canvas,scene.geometry);renderer.targetZoom=3;renderer.snap(scene.actor.position);
  const before=JSON.stringify(scene.project());
  for(let i=0;i<120;i++){renderer.draw(scene.state);if(!renderer.pendingChunks.size&&i>10)break;await new Promise(resolve=>requestAnimationFrame(resolve));}
  if(renderer.pendingChunks.size)throw new Error('Native naming scene did not settle');
  if(JSON.stringify(scene.project())!==before)throw new Error('Rendering changed naming evidence');
  return {label,readOnly:true};
}

/** Independent decoded-actor runtime test; actual app restoration is asserted
 * separately. Fresh sight cannot restore a spent request or runtime window. */
export async function checkNamingFollowupReload(moduleBase,raw){
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {observeNpc,tickNpc}=await use('npc');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {SocialCoordinator}=await use('social');
  const geometry=createOzarkWorldGeometry(),loaded=loadOzarkSave({getItem:k=>k===OZARK_SAVE_KEY?raw:null},geometry);
  if(loaded.blocked)throw new Error(loaded.error);
  const state=loaded.state,environment=state.environment;
  for(const n of state.agents){bindOzarkWorldAgent(n,geometry,state);observeNpc(n,environment);}
  const social=new SocialCoordinator({getAgents:()=>state.agents,getEnvironment:()=>environment,getCommunity:()=>state.community});
  if(social.naming.opportunityCount()||social.naming.pendingCount())throw new Error('Runtime naming authority restored');
  const before=JSON.stringify(state.agents.map(n=>n.lexicon)),messages=JSON.stringify(state.community.messages);
  for(let i=0;i<160;i++){
    tickEnvironment(environment,.25);tickOzarkEcology(environment.ecology,.25,environment,state.agents,{},geometry);
    for(const n of state.agents)tickNpc(n,.25,environment);state.elapsed=environment.elapsed;social.tick(.25);
  }
  if(JSON.stringify(state.agents.map(n=>n.lexicon))!==before||JSON.stringify(state.community.messages)!==messages||social.naming.opportunityCount()||social.naming.pendingCount())throw new Error('Interrupted request replayed after fresh sight and ordinary cooldown');
  social.dispose();return {noReplayAfterFreshSight:true,elapsedWindow:40,opportunityCount:0,pendingCount:0,scope:'Separate actors decoded from exact reopened bytes; actual application state preservation is independently asserted.'};
}
