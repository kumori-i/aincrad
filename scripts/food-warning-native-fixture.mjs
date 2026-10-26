export { namingFollowupEvidence as foodWarningEvidence } from './naming-followup-native-fixture.mjs';

/** Serializable controlled adverse encounter. Never inserts learned proof. */
export async function createFoodWarningScene(moduleBase, projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology,bindOzarkEcology}=await use('ozark-ecology');
  const {lookupEcologyObject}=await use('ecology');
  const {observeNpc,requestNpcAction,tickNpc}=await use('npc');
  const {PopulationRuntime}=await use('population');
  const {discoveryDecision,processDiscoveryFeedback}=await use('discovery');
  const {receivedMaterialCaution}=await use('food-warning');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const [speaker,listener]=state.agents;
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const project=(current=state)=>projectEvidence(current);
  const tick=()=>{
    tickEnvironment(environment,.1);
    tickOzarkEcology(environment.ecology,.1,environment,state.agents,{},geometry);
    for(const n of state.agents){tickNpc(n,.1,environment);processDiscoveryFeedback(n);}
    state.elapsed=environment.elapsed;
  };
  const finish=(actor,action)=>{
    const admitted=requestNpcAction(actor,action,environment);
    require(admitted.code==='ACTION_STARTED','Action not admitted: '+JSON.stringify(admitted));
    for(let i=0;actor.active&&i<600;i++)tick();
    require(!actor.active&&actor.lastResult?.ok,'Physical action failed: '+JSON.stringify(actor.lastResult));
    return structuredClone(actor.lastResult);
  };
  for(let i=0;i<600;i++)tick();
  const source=environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>2&&
    geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));
  require(source,'No eligible physical apple source');
  for(const actor of state.agents){actor.position={x:source.position.x+45,y:source.position.y};observeNpc(actor,environment);}
  const acquired=finish(speaker,{type:'pull',targetId:source.id}),materialId=acquired.materialId;
  const material=lookupEcologyObject(environment.ecology,materialId);
  // Disclosed physical surprise only: age changes normal spoil chemistry, not
  // mass, calories, body state, observations, receipts or learned outcomes.
  material.ageHours=12*24;material.spoiled=true;
  // Install the ordinary event-time consumption observer, without ticking
  // autonomous controllers or manufacturing a witnessed inquiry.
  const runtime=new PopulationRuntime(state,{cardinal:false}),social=runtime.social;
  try {
  const sampled=finish(speaker,{type:'sample',targetId:materialId});
  for(let i=0;i<1800&&!speaker.discovery.effects.some(e=>e.objectId===materialId&&e.effect==='discomfort');i++)tick();
  const effect=speaker.discovery.effects.find(e=>e.objectId===materialId&&e.effect==='discomfort');
  require(effect,'Real sample produced no delayed adverse evidence within 180 seconds');
  require(!listener.discovery.effects.length&&!listener.discovery.techniques.length,'Peer received firsthand proof before delivery');

    observeNpc(speaker,environment);observeNpc(listener,environment);
    const proposed=social.discoveryDialogue(speaker);
    require(proposed?.type==='say'&&proposed.effectId===effect.id,'Ordinary dialogue did not prioritize real adverse warning: '+JSON.stringify(proposed));
    const beforeDelivery=project(),peerPosition={...listener.position};
    // The exact same proposed event fails out of hearing range; no later replay.
    listener.position={x:listener.position.x+1000,y:listener.position.y};
    const missed=social.action(speaker,proposed);
    require(!missed.ok&&!receivedMaterialCaution(listener,materialId),'Missed warning granted caution');
    require(!listener.discovery.reports.some(r=>r.warning),'Missed warning created report');
    listener.position=peerPosition;
    const delivered=social.action(speaker,proposed);
    require(delivered.ok,'Grounded local warning was not delivered: '+JSON.stringify(delivered));
    const report=listener.discovery.reports.find(r=>r.warning);
    require(report&&report.sourceId===speaker.id&&report.status==='unverified','Missing attributed unverified report');
    const ownEffects=listener.discovery.effects.length,ownTechniques=listener.discovery.techniques.length;
    finish(speaker,{type:'release',targetId:materialId});observeNpc(listener,environment);
    finish(listener,{type:'grasp',targetId:materialId});observeNpc(listener,environment);
    require(receivedMaterialCaution(listener,materialId),'Delivered warning did not caution after exact item regrasp');
    require(listener.discovery.inquiries?.some(q=>q.sourceId===materialId),'Ordinary consumption observer supplied no witnessed inquiry');
    const endpointBefore=JSON.stringify(state),pairedInput=structuredClone(state),choices=[];
    for(const heard of [true,false]){
      const branch=structuredClone(pairedInput),actor=branch.agents.find(n=>n.id===listener.id);
      bindOzarkEcology(branch.environment.ecology,geometry);
      for(const n of branch.agents)bindOzarkWorldAgent(n,geometry,branch);
      // This narrow ablation removes only the warning report; social delivery,
      // witnessed inquiry, physical state, RNG and all firsthand history match.
      if(!heard)actor.discovery.reports=actor.discovery.reports.filter(r=>!r.warning);
      observeNpc(actor,branch.environment);
      const selected=discoveryDecision(actor);
      choices.push({heard,at:actor.elapsed,action:structuredClone(selected.action),reason:selected.reason});
    }
    require(JSON.stringify(state)===endpointBefore,'Copied policy comparison mutated live endpoint');
    const decision=choices[0],control=choices[1],receivedAt=report.warning.receivedAt;
    const choiceComparison={sameFullStateAndRng:true,ablation:'remove-only-warning-report',choices,
      receivedAt,choiceAt:listener.elapsed,latencySeconds:listener.elapsed-receivedAt,
      firstSampleAt:speaker.discovery.experiments.find(e=>e.primitive==='sample'&&e.targetId===materialId)?.at,
      adverseEffectAt:effect.at};
    require(choiceComparison.latencySeconds<=30,'No timely recipient opportunity: '+JSON.stringify(choiceComparison));
    require(control.action?.type==='sample'&&control.action.targetId===materialId,'No eligible sample opportunity in warning-ablated control: '+JSON.stringify(choiceComparison));
    require(!(decision.action?.type==='sample'&&decision.action.targetId===materialId),'Ordinary policy selected warned exact material: '+JSON.stringify(choiceComparison));
    require(listener.discovery.effects.length===ownEffects&&listener.discovery.techniques.length===ownTechniques,'Warning copied speaker experience');
    state.player={...listener.position};state.selectedAgentId=listener.id;
    const interruption=requestNpcAction(listener,{type:'inspect_object',targetId:materialId},environment);
    require(interruption.code==='ACTION_STARTED','Interruption fixture action not admitted');tick();
    require(listener.active,'Inspection completed before interruption');
    const summary={actorId:listener.id,speakerId:speaker.id,sourceId:source.id,materialId,elapsed:state.elapsed,
      messageId:delivered.message.id,reportId:report.id,reportText:report.text,acquired,sampled,effect:structuredClone(effect),
      beforeDelivery,missed,decision,choiceComparison,interrupted:structuredClone(listener.active),
      fixtureDisclosure:'Controlled initial placement at first eligible apple source; real paid pull, sample, release and peer grasp. Material age is explicitly set to 12 days to exercise unchanged spoilage chemistry; no mass, energy, body state, learning or receipt injection. Shared body/ecology time continues. Ordinary dialogue chooses warning, actual speech transport gates delivery. Out-of-range rejection is followed by a new explicit in-range delivery, not automatic replay. Ordinary PopulationRuntime consumption subscription witnesses the initial real sample, while its controllers are not ticked. Two independently rebound full-state/RNG clones compare ordinary policy with the warning report retained versus removed; control must select the exact held sample and heard arm must not, within 30 seconds of receipt. Live endpoint remains untouched by clone decisions. Save interrupts one paid inspection, not speech (speech is synchronous). Not spontaneous encounter, small-dose safety or survival evidence.'};
    const save=storage=>{
      const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
      require(writeOzarkSave(disk,state,geometry),'Strict warning save rejected: '+state.saveError);
      const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
      require(!loaded.blocked,'Strict restore rejected: '+loaded.error);
      require(receivedMaterialCaution(loaded.state.agents[1],materialId),'Reopen lost delivered caution');
      return {raw,saveKey:OZARK_SAVE_KEY,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
    };
    return {state,actor:listener,speaker,listener,geometry,project,save,tick,finish,materialId,summary};
  } finally {runtime.dispose();}
}

/** Project the real selected-agent panel without updating simulation or disk. */
export function presentFoodWarningUi(expected) {
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const get=selector=>{const node=document.querySelector(selector);require(node,`Missing ${selector}`);return node;};
  const before=window.__ozarkWorld.fullSnapshot(),route=window.__ozarkWorld.snapshot(),bytes=localStorage.getItem('aincrad.world.v2');
  require(!route.blocked&&!route.started&&before.elapsed===expected.elapsed,'Reopening changed clocks or failed boot');
  require(before.selectedAgentId===expected.actorId,'Wrong selected actor');
  if(get('#npc-panel').classList.contains('hidden'))get('#open-npc').click();
  get('#npc-tab-character').click();get('#npc-discovery-details').open=true;
  const entries=[...get('#npc-object-knowledge').querySelectorAll('.knowledge-entry')];
  const entry=entries.find(n=>n.textContent.includes(expected.reportText));
  require(entry,'Missing reported warning in actual selected-agent panel');
  require(entry.textContent.includes('unverified')&&entry.textContent.includes('reported'),'Warning presented as firsthand certainty');
  entry.scrollIntoView({block:'center',inline:'nearest'});const rect=entry.getBoundingClientRect();
  require(rect.width>0&&rect.height>0&&rect.top<innerHeight&&rect.bottom>0,'Warning entry is not visible');
  require(JSON.stringify(window.__ozarkWorld.fullSnapshot())===JSON.stringify(before),'Panel rendering changed state');
  require(localStorage.getItem('aincrad.world.v2')===bytes,'Panel rendering changed save bytes');
  return {readOnly:true,text:entry.textContent,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
