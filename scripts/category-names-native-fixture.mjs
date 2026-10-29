// Historical legacy-language regression only. Default main communication is grounded;
// reopened legacy records are archival, not an active main-world language channel.
/** Pure serializable evidence. Includes naming, sensory samples and exact
 * physical history; a name is never sufficient evidence of a physical effect. */
export function categoryNamesEvidence(state) {
  return structuredClone({player:state.player,playerBody:state.playerBody,elapsed:state.elapsed,distance:state.distance,
    selectedAgentId:state.selectedAgentId,community:state.community,
    clocks:{environmentElapsed:state.environment.elapsed,ecologyElapsed:state.environment.ecology.elapsed,ecologyPending:state.environment.ecology.pending},
    agents:state.agents.map(n=>({id:n.id,position:n.position,elapsed:n.elapsed,active:n.active??null,
      memory:n.memory,discovery:n.discovery,physiology:n.physiology,lexicon:n.lexicon??null,
      categoryNames:n.categoryNames??null,social:n.social}))});
}

/** Disclosed controlled placement and mocked token proposal over real ordinary
 * perception of existing world objects. No real model inference is claimed. */
export async function createCategoryNamesScene(moduleBase, projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG,NPC_RULES}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState: rawCreateOzarkState,writeOzarkSave,loadOzarkSave: rawLoadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindCommunicationMode}=await use('communication-mode');
  const historicalState=s=>{for(const n of s.agents)bindCommunicationMode(n,'legacy');return s;};
  const createOzarkState=(...args)=>historicalState(rawCreateOzarkState(...args));
  const loadOzarkSave=(...args)=>{const result=rawLoadOzarkSave(...args);if(result.state)historicalState(result.state);return result;};
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {senseEcology}=await use('ecology');
  const {observeNpc,tickNpc}=await use('npc');
  const {appearanceCuesMatch}=await use('peer-teaching');
  const {namingProposal,beginNamingProposal,acceptNamingProposal,categoryLabels,objectName}=await use('category-names');
  const {visualSampleCurrent}=await use('visual-group-memory');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  require(typeof projectEvidence==='function','Missing evidence projection');
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const actor=state.agents[0],objectIds=['object:675','object:669','object:672'];
  const cues={shape:'tuft of narrow blades',color:'green',texture:'fibrous'};
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const project=(current=state)=>projectEvidence(current);
  const tick=()=>{
    tickEnvironment(environment,.25);
    tickOzarkEcology(environment.ecology,.25,environment,state.agents,{},geometry);
    for(const n of state.agents)tickNpc(n,.25,environment);
    state.elapsed=environment.elapsed;
  };
  for(let i=0;i<240;i++)tick();
  // Fixed disclosed placement, not searching for a favorable model outcome.
  actor.position={x:455,y:1000};
  require(geometry.canOccupy(actor.position.x,actor.position.y,CONFIG.playerRadius),'Fixed category fixture position is not walkable');
  const visible=senseEcology(environment.ecology,actor.position,'valley',NPC_RULES.visionRadius)
    .filter(o=>geometry.lineOfSight(actor.position,o.position));
  for(const id of objectIds)require(visible.some(o=>o.id===id&&appearanceCuesMatch(o.appearance,cues)),`Real ordinary descriptor unavailable or different for ${id}`);
  const checkpoints=[];
  for(let index=0;index<2;index++){
    if(index)for(let i=0;i<4;i++)tick();
    observeNpc(actor,environment);
    checkpoints.push({at:actor.elapsed,position:{...actor.position},samples:structuredClone(actor.discovery.visualSamples)});
  }
  for(const id of objectIds)require(actor.discovery.visualSamples.records.some(r=>r.objectId===id&&r.times.length===2)&&visualSampleCurrent(actor,id),`Two current ordinary samples missing for ${id}`);
  const physicalEvidence=()=>JSON.stringify({discovery:actor.discovery,memory:actor.memory,physiology:actor.physiology,inventory:actor.inventory,cognition:actor.cognition,social:actor.social});
  const beforeNaming=physicalEvidence(),attempts=[];
  // Production chooses the first eligible observed cue triple. Every skipped
  // non-target proposal is an explicit mocked abstention, not a hidden retry.
  for(let count=0;count<64;count++){
    const request=namingProposal(actor);require(request,'Target appearance did not receive a bounded proposal');
    const target=appearanceCuesMatch(request.example.cues,cues);
    require(beginNamingProposal(actor,request),'Strict proposal admission failed');
    const response={token:target?'velora':null,model:'mock-native-fixture-only'};
    const accepted=acceptNamingProposal(actor,request,response);
    attempts.push({request:structuredClone(request),response,accepted});
    require(accepted===target,'Mock proposal outcome did not match strict admission');
    if(target)break;
  }
  require(beforeNaming===physicalEvidence(),'Naming mutated physical, sensory, effect or procedure evidence');
  for(const id of objectIds)require(objectName(actor,id)?.token==='velora',`Name not reused for ${id}`);
  const category=categoryLabels(actor).find(r=>r.token==='velora');
  require(category&&objectIds.every(id=>category.members.some(m=>m.objectId===id)),'One tentative category did not contain the three observed examples');
  require(!state.agents[1].categoryNames&&!state.agents[1].discovery.visualSamples?.records.length,'Unobserving peer acquired foreign vocabulary or examples');
  state.player={...actor.position};state.selectedAgentId=actor.id;
  const summary={actorId:actor.id,otherActorId:state.agents[1].id,elapsed:state.elapsed,objectIds,cues,token:'velora',
    modelInference:'mocked; real local model never called',model:'mock-native-fixture-only',attempts,checkpoints,
    unchangedPhysicalEvidence:true,currentSamplesBeforeSave:objectIds.map(id=>({objectId:id,current:visualSampleCurrent(actor,id)})),
    fixtureDisclosure:'Explicit historical legacy-channel regression, not default-main language. Controlled actor placement at (455, 1000); ordinary observeNpc twice, separated by one second of real world/body/ecology integration, for existing objects 675/669/672. Model replies are explicitly mocked (velora for the target cue triple, bounded null abstentions for any earlier eligible cue triple). No species/material cue, physical effect, action history or safety evidence is injected. Not autonomous travel, real inference or independent encounters.'};
  const save=storage=>{
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    require(writeOzarkSave(disk,state,geometry),'Strict category save rejected: '+state.saveError);
    const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict category restore rejected: '+loaded.error);
    const restored=loaded.state.agents.find(n=>n.id===actor.id);
    require(JSON.stringify(restored.categoryNames)===JSON.stringify(actor.categoryNames),'Restore changed category names/provenance');
    require(JSON.stringify(restored.discovery)===JSON.stringify(actor.discovery),'Restore changed sensory or physical learning evidence');
    for(const id of objectIds){require(objectName(restored,id)?.token==='velora',`Restored name missing for ${id}`);require(!visualSampleCurrent(restored,id),'Reload falsely restored current visual sample');}
    return {raw,saveKey:OZARK_SAVE_KEY,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
  };
  return {state,actor,geometry,project,save,summary};
}

/** Actual reopened app UI; selection is changed and restored through its normal
 * controls. Render-only checks never advance the stopped disposable world. */
export function presentCategoryNamesUi(expected) {
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const get=selector=>{const node=document.querySelector(selector);require(node,`Missing ${selector}`);return node;};
  const before=window.__ozarkWorld.fullSnapshot(),route=window.__ozarkWorld.snapshot(),bytes=localStorage.getItem('aincrad.world.v2');
  require(!route.blocked&&!route.started&&before.elapsed===expected.elapsed,'Reopening changed clocks or failed boot');
  require(before.selectedAgentId===expected.actorId,'Wrong selected actor');
  if(get('#npc-panel').classList.contains('hidden'))get('#open-npc').click();
  get('#npc-tab-character').click();get('#npc-discovery-details').open=true;
  const find=()=>[...document.querySelectorAll('[data-category-token]')].find(n=>n.dataset.categoryToken===expected.token);
  const entry=find();require(entry,'Missing selected-actor category name');
  require(entry.textContent.includes('mock-native-fixture-only'),'Mock provenance omitted from actual app panel');
  require(entry.textContent.includes('tentative appearance category'),'Missing uncertainty label');
  for(const id of expected.objectIds)require([...entry.querySelectorAll('[data-category-member]')].some(n=>n.dataset.categoryMember===id),'Missing category member '+id);
  require([...entry.querySelectorAll('[data-category-member]')].every(n=>n.dataset.categoryVisibility==='remembered'),'Reload must not claim current sight');
  const afterRender=window.__ozarkWorld.fullSnapshot();
  require(JSON.stringify(afterRender.agents)===JSON.stringify(before.agents)&&JSON.stringify(afterRender.environment)===JSON.stringify(before.environment),'Rendering mutated physical or learned evidence');
  require(localStorage.getItem('aincrad.world.v2')===bytes,'Render-only opening changed saved bytes');
  const select=get('#npc-select');select.value=expected.otherActorId;select.dispatchEvent(new Event('change',{bubbles:true}));
  require(window.__ozarkWorld.fullSnapshot().selectedAgentId===expected.otherActorId,'Actor switch failed');
  require(!find(),'Actor switch exposed another agent’s private category');
  select.value=expected.actorId;select.dispatchEvent(new Event('change',{bubbles:true}));
  const returned=find();require(returned,'Returning to original actor lost category display');
  returned.scrollIntoView({block:'center',inline:'nearest'});const rect=returned.getBoundingClientRect();
  require(rect.width>0&&rect.height>0&&rect.top<innerHeight&&rect.bottom>0,'Category evidence is not visible');
  const after=window.__ozarkWorld.fullSnapshot();
  require(after.selectedAgentId===before.selectedAgentId&&after.elapsed===before.elapsed&&JSON.stringify(after.agents)===JSON.stringify(before.agents)&&JSON.stringify(after.environment)===JSON.stringify(before.environment),'Selection/rendering altered actor evidence or clocks');
  return {readOnly:true,selectionRoundtrip:true,renderOnlyPreservedBytes:true,modelInference:'mocked',text:returned.textContent,
    bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
