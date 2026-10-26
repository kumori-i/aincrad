export { namingFollowupEvidence as visualGroupsEvidence } from './naming-followup-native-fixture.mjs';

/** Controlled placement and genuine ordinary sensing; not autonomous encounters. */
export async function createVisualGroupsScene(moduleBase, projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG,NPC_RULES}=await use('config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment');
  const {tickOzarkEcology}=await use('ozark-ecology');
  const {senseEcology}=await use('ecology');
  const {observeNpc,tickNpc}=await use('npc');
  const {cleanAppearanceCues,appearanceCuesMatch}=await use('peer-teaching');
  const {visualGroups}=await use('visual-group-memory');
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const actor=state.agents[0];
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  const project=(current=state)=>projectEvidence(current);
  const tick=()=>{
    tickEnvironment(environment,.25);
    tickOzarkEcology(environment.ecology,.25,environment,state.agents,{},geometry);
    for(const n of state.agents)tickNpc(n,.25,environment);
    state.elapsed=environment.elapsed;
  };
  for(let i=0;i<240;i++)tick();
  const candidates=[],initialPosition={...actor.position};
  // Fixture placement examines physical positions; similarity uses only the
  // normal sensory descriptor, never a species/diet/edibility comparison.
  for(const plant of environment.ecology.plants){
    const position={x:plant.position.x+45,y:plant.position.y};
    if(Math.hypot(position.x-initialPosition.x,position.y-initialPosition.y)>1800||!geometry.canOccupy(position.x,position.y,CONFIG.playerRadius)||!geometry.lineOfSight(position,plant.position))continue;
    const object=senseEcology(environment.ecology,position,'valley',NPC_RULES.visionRadius).find(o=>o.id===plant.id);
    const cues=object&&cleanAppearanceCues(Object.fromEntries(['shape','color','texture'].map(k=>[k,object.appearance?.[k]])));
    if(cues)candidates.push({position,objectId:object.id,cues});
  }
  let pair;
  for(let i=0;i<candidates.length&&!pair;i++)for(let j=i+1;j<candidates.length;j++){
    if(appearanceCuesMatch(candidates[i].cues,candidates[j].cues)){pair=[candidates[i],candidates[j]];break;}
  }
  require(pair,'No naturally generated matching pair available for disclosed fixture');
  const checkpoints=[];
  for(const target of pair){
    tick();
    actor.position={...target.position};
    observeNpc(actor,environment);
    for(let i=0;i<4;i++)tick();
    observeNpc(actor,environment);
    checkpoints.push({at:actor.elapsed,objectId:target.objectId,position:{...actor.position},evidence:structuredClone(actor.discovery.visualSamples)});
  }
  require(pair.every(p=>actor.discovery.visualSamples?.records.some(r=>r.objectId===p.objectId&&r.times.length===2)),'Real sensed samples failed support threshold');
  require(visualGroups(actor).length>0,'Matching sensed individuals did not derive a tentative group');
  require(!state.agents[1].discovery.visualSamples?.records.length,'Unobserving peer acquired foreign evidence');
  state.player={...actor.position};state.selectedAgentId=actor.id;
  const summary={actorId:actor.id,elapsed:state.elapsed,objectIds:pair.map(p=>p.objectId),checkpoints,
    fixtureDisclosure:'Controlled relocation within 1800 pixels of initial placement to the first naturally generated pair with matching normal shape/color/texture sensory descriptions; two ordinary observeNpc calls separated by one second of actual world/body/ecology integration per target. Not independent encounters or autonomous travel. No cue, history, category, name or effect injection. Similarity rule is supplied.'};
  const save=storage=>{
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    require(writeOzarkSave(disk,state,geometry),'Strict visual group save rejected: '+state.saveError);
    const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict restore rejected: '+loaded.error);
    require(JSON.stringify(loaded.state.agents[0].discovery.visualSamples)===JSON.stringify(actor.discovery.visualSamples),'Restore changed visual support');
    return {raw,saveKey:OZARK_SAVE_KEY,expectedRestored:project(loaded.state),summary:structuredClone(summary)};
  };
  return {state,actor,geometry,project,save};
}

/** Actual reopened application panel, not a separately drawn UI fixture. */
export function presentVisualGroupsUi(expected) {
  const require=(value,message)=>{if(!value)throw new Error(message);};
  const get=selector=>{const node=document.querySelector(selector);require(node,`Missing ${selector}`);return node;};
  const before=window.__ozarkWorld.fullSnapshot(),route=window.__ozarkWorld.snapshot(),bytes=localStorage.getItem('aincrad.world.v2');
  require(!route.blocked&&!route.started&&before.elapsed===expected.elapsed,'Reopening changed clocks or failed boot');
  require(before.selectedAgentId===expected.actorId,'Wrong selected actor');
  if(get('#npc-panel').classList.contains('hidden'))get('#open-npc').click();
  get('#npc-tab-character').click();get('#npc-discovery-details').open=true;
  const groups=[...document.querySelectorAll('[data-visual-group]')];
  const entry=groups.find(node=>expected.objectIds.every(id=>[...node.querySelectorAll('[data-visual-member]')].some(n=>n.dataset.visualMember===id)));
  require(entry,'Missing selected-actor tentative similarity group');
  require(get('#npc-object-knowledge').textContent.includes('Tentative remembered similarity'),'Missing tentative label');
  require([...entry.querySelectorAll('[data-visual-member]')].every(node=>node.dataset.visualStatus==='remembered'),'Reload must not claim current sight');
  entry.scrollIntoView({block:'center',inline:'nearest'});const rect=entry.getBoundingClientRect();
  require(rect.width>0&&rect.height>0&&rect.top<innerHeight&&rect.bottom>0,'Group evidence is not visible');
  const after=window.__ozarkWorld.fullSnapshot();
  require(JSON.stringify(after.agents)===JSON.stringify(before.agents)&&JSON.stringify(after.environment)===JSON.stringify(before.environment)&&after.elapsed===before.elapsed,'Panel rendering changed state');
  require(localStorage.getItem('aincrad.world.v2')===bytes,'Panel rendering changed save bytes');
  return {readOnly:true,text:entry.textContent,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
}
