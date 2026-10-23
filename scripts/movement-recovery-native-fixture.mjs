/** Serialized into a disposable sandboxed renderer; no module-scope captures.
 * The fixture supplies only initial placement and the first ordinary walk.
 * The controller must select and pay for the subsequent recovery itself. */
export async function createMovementRecoveryScene(moduleBase) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {observeNpc,requestNpcAction,tickNpc}=await use('npc');
  const {processDiscoveryFeedback}=await use('discovery');
  const {NpcController}=await use('controller');
  const {isRecovery}=await use('movement-recovery');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),actor=state.agents[0];
  actor.position={x:240,y:3120};state.player={...actor.position};
  for(const human of state.agents)bindOzarkWorldAgent(human,geometry,state);
  let controller=null;
  const project=(current=state)=>structuredClone({player:current.player,playerBody:current.playerBody,
    elapsed:current.elapsed,distance:current.distance,
    clocks:{environmentElapsed:current.environment.elapsed,ecologyElapsed:current.environment.ecology.elapsed,ecologyPending:current.environment.ecology.pending},
    agents:current.agents.map(n=>({id:n.id,position:n.position,elapsed:n.elapsed,active:n.active??null,memory:n.memory,discovery:n.discovery,physiology:n.physiology}))});
  const tick=()=>{
    tickEnvironment(state.environment,CONFIG.fixedStep);
    tickOzarkEcology(state.environment.ecology,CONFIG.fixedStep,state.environment,state.agents,{},geometry);
    for(const n of state.agents){if(n===actor&&controller)controller.tick(CONFIG.fixedStep);else{tickNpc(n,CONFIG.fixedStep,state.environment);processDiscoveryFeedback(n);}}
    state.elapsed=state.environment.elapsed;
  };
  const startBody=structuredClone(actor.physiology);
  for(let i=0;i<16*60;i++)tick();
  const start=project();
  controller=new NpcController(actor,{environment:state.environment});
  const summary={fixtureDisclosure:'Controlled initial forest placement and one test-directed ordinary walk. All clocks, bodies and finite ecology advance normally. The ordinary offline controller must then independently select and pay for a supplied own-trail recovery heuristic. This is not spontaneous strategy invention, a fresh-world survival trial, or guaranteed escape.',preparationSeconds:16,startBody,start};
  const blocked=()=>{
    require(!actor.active,'Initial action already active');
    observeNpc(actor,state.environment);
    const request={type:'move',target:{x:240,y:3200}},admission=requestNpcAction(actor,request,state.environment);
    require(admission.code==='STARTED','Observed initial walk was not admitted');
    for(let i=0;actor.active&&i<240;i++)tick();
    require(!actor.active&&actor.lastResult?.code==='ROUTE_BLOCKED','Expected actual forest blockage');
    summary.blocked=project();summary.failedReceipt=structuredClone(actor.memory.experience.find(e=>e.id===actor.lastResult.eventId));
    return structuredClone({failedReceipt:summary.failedReceipt,position:actor.position,at:actor.elapsed});
  };
  const admit=()=>{
    require(actor.lastResult?.code==='ROUTE_BLOCKED'&&!actor.active,'Recovery requires the actual blocked action');
    for(let i=0;!actor.active&&i<120;i++)tick();
    require(actor.active&&isRecovery(actor.active),'Ordinary controller did not choose the expected recovery');
    require(actor.active.request.duration===.75,'Recovery exceeded its bounded duration');
    summary.admitted=project();summary.recoveryRequest=structuredClone(actor.active.request);
    summary.decision=structuredClone(actor.memory.experience.filter(e=>e.type==='decision').at(-1));
    require(summary.decision?.details.provider==='discovery-learner','Admission must come from ordinary discovery choice');
    require(summary.decision.details.summary.includes('retrace'),'Missing controller recovery explanation');
    return structuredClone({request:actor.active.request,decision:summary.decision,at:actor.elapsed,position:actor.position});
  };
  const advance=({interrupt=false}={})=>{
    require(isRecovery(actor.active),'No genuine controller-selected retreat is active');
    tick();
    if(interrupt){
      require(isRecovery(actor.active)&&actor.active.attemptedDistance>0&&actor.active.travelled>0,'Interruption must preserve real paid unfinished motion');
    }else{
      for(let i=0;actor.active&&i<120;i++)tick();
      require(!actor.active&&actor.lastResult?.code==='ARRIVED','Retreat did not actually finish');
      require(actor.lastResult.distance>9&&actor.lastResult.durationSeconds>0,'Retreat needs paid displacement');
      summary.completedReceipt=structuredClone(actor.memory.experience.find(e=>e.id===actor.lastResult.eventId));
    }
    summary.after=project();summary.interrupted=interrupt;
    require(actor.position.y<summary.admitted.agents[0].position.y,'Retreat must actually move away');
    require(actor.physiology.totals.metabolizedKcal>summary.admitted.agents[0].physiology.totals.metabolizedKcal,'Retreat must pay metabolism');
    return structuredClone({position:actor.position,active:actor.active,lastResult:actor.lastResult,at:actor.elapsed});
  };
  const save=(storage)=>{
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    require(writeOzarkSave(disk,state,geometry),'Strict current save rejected the encounter');
    const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict current restore rejected the encounter: '+loaded.error);
    return {saveKey:OZARK_SAVE_KEY,raw,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
  };
  return{state,actor,geometry,project,blocked,admit,advance,save,dispose:()=>controller.dispose()};
}

/** Actual application renderer, read-only camera/caption for controlled QA. */
export async function presentMovementRecoveryScene(label) {
  const scene=window.__movementRecoveryScene;
  if(!scene)throw new Error('No controlled scene');
  const {OzarkWorldRenderer}=await import('./src/ozark-world-renderer.js');
  for(const node of document.querySelectorAll('[data-movement-recovery-qa]'))node.remove();
  const canvas=document.createElement('canvas');canvas.dataset.movementRecoveryQa='true';
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',zIndex:'9998'});document.body.append(canvas);
  const caption=document.createElement('div');caption.dataset.movementRecoveryQa='true';
  Object.assign(caption.style,{position:'fixed',top:'18px',left:'18px',zIndex:'9999',background:'#18362ee8',color:'#f4e4be',font:'18px monospace',padding:'14px'});
  caption.textContent=label;document.body.append(caption);
  const renderer=new OzarkWorldRenderer(canvas,scene.geometry);renderer.targetZoom=3;renderer.snap(scene.actor.position);
  const before=JSON.stringify(scene.project());
  for(let i=0;i<120;i++){
    renderer.draw(scene.state);
    if(!renderer.pendingChunks.size&&i>10)break;
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(renderer.pendingChunks.size)throw new Error('Native forest rendering did not settle');
  if(JSON.stringify(scene.project())!==before)throw new Error('Rendering changed world evidence');
  return {label,readOnly:true};
}

/** Fresh decoder/admission check alongside, not replacing, actual app reopen. */
export async function checkMovementRecoveryReload(moduleBase,raw,request){
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {observeNpc,requestNpcAction}=await use('npc');
  const {recoveryChoice}=await use('movement-recovery');
  const geometry=createOzarkWorldGeometry(),loaded=loadOzarkSave({getItem:k=>k===OZARK_SAVE_KEY?raw:null},geometry);
  if(loaded.blocked)throw new Error(loaded.error);
  const actor=loaded.state.agents[0];bindOzarkWorldAgent(actor,geometry,loaded.state);
  const before={position:{...actor.position},elapsed:actor.elapsed,physiology:structuredClone(actor.physiology)};
  observeNpc(actor,loaded.state.environment);
  const proposed=recoveryChoice(actor,{type:'move',target:{x:240,y:3120}},'understanding');
  const admission=requestNpcAction(actor,request,loaded.state.environment);
  if(proposed!==null||admission.code!=='UNOBSERVED_TARGET'||actor.active)throw new Error('Saved recovery authority was replayed');
  if(actor.elapsed!==before.elapsed||JSON.stringify(actor.position)!==JSON.stringify(before.position)||JSON.stringify(actor.physiology)!==JSON.stringify(before.physiology))throw new Error('Rejected replay moved or charged body');
  return {freshObservationPerformed:true,proposed,admission,physicalStatePreserved:true,scope:'Independent actor decoded from the exact reopened bytes in this renderer; actual app snapshot preservation is separately asserted.'};
}
