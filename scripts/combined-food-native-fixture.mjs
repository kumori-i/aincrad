/** Pure exact-state evidence, serialized into the native runner. */
export function combinedFoodEvidence(state) {
  return structuredClone({player:state.player,playerBody:state.playerBody,elapsed:state.elapsed,distance:state.distance,
    selectedAgentId:state.selectedAgentId,community:state.community,
    clocks:{environmentElapsed:state.environment.elapsed,ecologyElapsed:state.environment.ecology.elapsed,ecologyPending:state.environment.ecology.pending},
    stocks:{plants:state.environment.ecology.plants,materials:state.environment.ecology.materials,ledger:state.environment.ecology.ledger},
    agents:state.agents.map(n=>({id:n.id,position:n.position,elapsed:n.elapsed,active:n.active??null,memory:n.memory,
      inventory:n.inventory,flask:n.flask,nourishment:n.nourishment,discovery:n.discovery,physiology:n.physiology,lexicon:n.lexicon??null,social:n.social}))});
}

/** Controlled physical food/funding scene, not autonomous discovery. */
export async function createCombinedFoodScene(moduleBase, projectEvidence) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {CONFIG}=await use('config'),{DISCOVERY_RULES}=await use('discovery-config');
  const {createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {createOzarkState,writeOzarkSave,loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save');
  const {bindOzarkWorldAgent}=await use('ozark-agent-world');
  const {tickEnvironment}=await use('environment'),{tickOzarkEcology}=await use('ozark-ecology');
  const {lookupEcologyObject}=await use('ecology');
  const {observeNpc,requestNpcAction,tickNpc,cancelNpcAction}=await use('npc');
  const {projectPhysiology}=await use('biology');
  const {processDiscoveryFeedback}=await use('discovery');
  const {witnessedMaterialCompletion}=await use('discovery-completion');
  const {discoveryActionPaidSeconds}=await use('discovery-actions');
  const {npcEffortCost}=await use('npc-effort-funding');
  const require=(v,m)=>{if(!v)throw new Error(m);},near=(a,b,m)=>require(Math.abs(a-b)<1e-7,`${m}: ${a} != ${b}`);
  const geometry=createOzarkWorldGeometry(),state=createOzarkState(geometry),environment=state.environment;
  const [whole,partial]=state.agents;
  const tick=()=>{tickEnvironment(environment,.1);tickOzarkEcology(environment.ecology,.1,environment,state.agents,{},geometry);
    for(const n of state.agents){tickNpc(n,.1,environment);processDiscoveryFeedback(n);}state.elapsed=environment.elapsed;};
  for(const n of state.agents)bindOzarkWorldAgent(n,geometry,state);
  for(let i=0;i<600;i++)tick(); // Shared60-second warmup before controlled encounter placement.
  const source=environment.ecology.plants.find(p=>p.kind==='apple_tree'&&p.quantity>=2&&
    geometry.canOccupy(p.position.x+45,p.position.y,CONFIG.playerRadius)&&geometry.lineOfSight({x:p.position.x+45,y:p.position.y},p.position));
  require(source,'No eligible finite apple source');
  for(const n of state.agents){n.position={x:source.position.x+45,y:source.position.y};n.physiology.satietyHours=0;
    n.physiology.hoursSinceMeal=9;n.physiology.availableEnergyKcal=700;projectPhysiology(n);bindOzarkWorldAgent(n,geometry,state);observeNpc(n,environment);}
  state.player={...whole.position};state.selectedAgentId=whole.id;
  const finish=(n,action)=>{const admitted=requestNpcAction(n,action,environment);require(admitted.code==='ACTION_STARTED','Action admission failed');
    for(let i=0;n.active&&i<600;i++)tick();require(!n.active&&n.lastResult?.ok,'Paid action failed '+JSON.stringify(n.lastResult));return structuredClone(n.lastResult);};
  // Finite water-only setup is disclosed, never recorded as a collected resource.
  partial.flask.water=.5;const waterBefore=structuredClone(partial.physiology),waterResult=requestNpcAction(partial,{type:'drink'},environment);
  require(waterResult.code==='DRANK','Real water action failed');near(partial.physiology.satietyHours,0,'Water gave satiety');
  near(partial.physiology.totals.ingestedKcal,waterBefore.totals.ingestedKcal,'Water gave calories');
  near(partial.physiology.totals.ingestedWaterMl-waterBefore.totals.ingestedWaterMl,500,'Water transfer');
  const water={result:waterResult,startingFlaskLitres:.5,satietyHours:partial.physiology.satietyHours,ingestedKcal:partial.physiology.totals.ingestedKcal};
  const wholePull=finish(whole,{type:'pull',targetId:source.id}),bites=[];
  bites.push(finish(whole,{type:'sample',targetId:wholePull.materialId}));
  const partialSample=whole.discovery.experiments.at(-1),partialCheckpoint={at:whole.elapsed,satietyHours:whole.physiology.satietyHours,nourishment:whole.nourishment,
    ingestedKcal:whole.physiology.totals.ingestedKcal,materialId:wholePull.materialId};
  near(partialCheckpoint.ingestedKcal,95/6,'One portion calorie transfer');near(partialCheckpoint.satietyHours,4/6,'One portion immediate satiety');
  require(!partialSample.finishedMaterial&&!witnessedMaterialCompletion(whole,partialSample),'Partial portion gained completion');
  for(let i=1;i<6;i++){bites.push(finish(whole,{type:'sample',targetId:wholePull.materialId}));require(Boolean(bites[i].finishedMaterial)===(i===5),'Only final portion completes');}
  const completed=whole.discovery.experiments.at(-1),wholeCheckpoint={at:whole.elapsed,satietyHours:whole.physiology.satietyHours,nourishment:whole.nourishment,
    ingestedKcal:whole.physiology.totals.ingestedKcal,absorbedKcal:whole.physiology.totals.absorbedKcal,pendingKcal:whole.physiology.stomach.reduce((s,v)=>s+v.remainingKcal,0),completed:structuredClone(completed)};
  near(wholeCheckpoint.ingestedKcal,95,'Whole apple calories');near(whole.nourishment,whole.physiology.satietyHours/6*100,'Immediate last-bite projection');
  require(witnessedMaterialCompletion(whole,completed),'Actual final paid bite lacks live witness');
  require(!lookupEcologyObject(environment.ecology,wholePull.materialId),'Finished physical material persists');
  const beforeNoTick=JSON.stringify(projectEvidence(state));require(JSON.stringify(projectEvidence(state))===beforeNoTick,'Read-only paused projection changed time');
  // Normal shared body/ecology clock, not a custom payer or forged progress counter.
  partial.physiology.availableEnergyKcal=0;partial.physiology.storedEnergyKcal=0;projectPhysiology(partial);
  const quantity=source.quantity,inventory=JSON.stringify(partial.inventory),ingested=partial.physiology.totals.ingestedKcal;
  require(requestNpcAction(partial,{type:'pull',targetId:source.id},environment).code==='ACTION_STARTED','Zero-work pull admission failed');
  tick();near(discoveryActionPaidSeconds(partial,partial.active),0,'Zero energy paid work');near(partial.active.worked,0,'Zero energy progress');
  require(source.quantity===quantity&&JSON.stringify(partial.inventory)===inventory,'Unpaid action changed ownership/stock');
  const zero={worked:partial.active.worked,paidSeconds:discoveryActionPaidSeconds(partial,partial.active),quantity};cancelNpcAction(partial);
  // Fund half of the upcoming .1-second action slice, plus the unchanged .1-second basal cost.
  partial.physiology.availableEnergyKcal=npcEffortCost(.05,DISCOVERY_RULES.effort.pull)+100/150*.1;projectPhysiology(partial);
  const before=partial.physiology.totals.metabolizedKcal;
  require(requestNpcAction(partial,{type:'pull',targetId:source.id},environment).code==='ACTION_STARTED','Partial-work pull admission failed');tick();
  const paid=discoveryActionPaidSeconds(partial,partial.active);near(paid,.05,'Partial funded seconds');near(partial.active.worked,paid,'Public work matches witness');
  near(partial.physiology.totals.metabolizedKcal-before,npcEffortCost(.05,DISCOVERY_RULES.effort.pull)+100/150*.1,'Basal plus certified work debit');
  require(source.quantity===quantity&&JSON.stringify(partial.inventory)===inventory,'Partial action changed ownership/stock');near(partial.physiology.totals.ingestedKcal,ingested,'Partial pull ingested food');
  const partialWork={paidSeconds:paid,worked:partial.active.worked,action:structuredClone(partial.active),metabolizedKcal:partial.physiology.totals.metabolizedKcal,quantity};
  require(witnessedMaterialCompletion(whole,completed),'Completion witness expired before save checkpoint');
  const checkpointToSavedStateSeconds=state.elapsed-wholeCheckpoint.at;near(checkpointToSavedStateSeconds,.2,'Last-bite to saved capture-state delay');
  const summary={checkpointToSavedStateSeconds,pausedProjectionUnchanged:true,nativeCoverage:{whole:'immediate engine projection; actual app screenshot after two0.1-second funding slices',partial:'30g engine assertion in native renderer, not separate app screenshot',water:'immediate engine assertion plus actual app zero-satiety water-only actor screenshot after funding probes',hourlyCurves:'1/2/3-hour rendered projections not covered',restartReceipt:'unsuccessful RESTART_INTERRUPTED has no paid-duration field; prior physical debit retained; cancellation duration separately unit-tested',fullChecklistAcceptance:false},actorId:whole.id,partialActorId:partial.id,sourceId:source.id,elapsed:state.elapsed,whole:wholeCheckpoint,partial:partialCheckpoint,water,zero,partialWork,
    fixtureDisclosure:'Shared60-second warmup then controlled positions at first eligible finite apple source; each actor starts at700 available kcal and zero satiety. One disclosed0.5L flask supply exercises real water-only drinking, without collection credit. All apple pulls and ordinary30g samples are real paid actions, with shared bodies/ecology time. Second actor is explicitly depleted, then given only a0.05-second work budget plus one basal slice to test funded progress; these are test body assignments, not survival assistance claims. No learned receipts, food calories or completion/payment witnesses are injected. No autonomous foraging, safe-food or survival claim.'};
  const save=storage=>{const physicalBeforeSave={clocks:{elapsed:state.elapsed,environmentElapsed:environment.elapsed,ecologyElapsed:environment.ecology.elapsed,ecologyPending:environment.ecology.pending},
        stocks:structuredClone({plants:environment.ecology.plants,materials:environment.ecology.materials,ledger:environment.ecology.ledger}),
        agents:state.agents.map(n=>structuredClone({id:n.id,physiology:n.physiology,inventory:n.inventory,flask:n.flask}))};
    const rows=new Map(),disk=storage||{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v)};
    const {npc:alias,...diagnosticState}=state;const diagnostic=loadOzarkSave({getItem:()=>JSON.stringify(diagnosticState)},geometry);require(!diagnostic.blocked,diagnostic.error);
    require(writeOzarkSave(disk,state,geometry),'Strict combined save rejected: '+state.saveError);const raw=disk.getItem(OZARK_SAVE_KEY),loaded=loadOzarkSave(disk,geometry);
    require(!loaded.blocked,'Strict combined restore rejected: '+loaded.error);const restored=loaded.state.agents.find(n=>n.id===partial.id);
    require(restored.active===null&&discoveryActionPaidSeconds(restored,partial.active)===0,'Restore recreated payment witness');
    require(!witnessedMaterialCompletion(loaded.state.agents[0],completed),'Restore recreated completion witness');
    return {raw,saveKey:OZARK_SAVE_KEY,expectedRestored:projectEvidence(loaded.state),summary:structuredClone(summary),
      physicalBeforeSave};};
  return {state,geometry,summary,save,project:()=>projectEvidence(state)};
}

/** Separate decoded-byte engine probe; not access to the app's private actors. */
export async function probeCombinedFoodRestore(moduleBase,raw,summary) {
  const use=name=>import(new URL(`src/${name}.js`,moduleBase).href);
  const {loadOzarkSave,OZARK_SAVE_KEY}=await use('ozark-save'),{createOzarkWorldGeometry}=await use('ozark-world-geometry');
  const {discoveryActionPaidSeconds,tickDiscoveryAction}=await use('discovery-actions');
  const {witnessedMaterialCompletion}=await use('discovery-completion');
  const loaded=loadOzarkSave({getItem:k=>k===OZARK_SAVE_KEY?raw:null},createOzarkWorldGeometry());if(loaded.blocked)throw Error(loaded.error);
  const whole=loaded.state.agents.find(n=>n.id===summary.actorId),partial=loaded.state.agents.find(n=>n.id===summary.partialActorId);
  if(witnessedMaterialCompletion(whole,summary.whole.completed)||discoveryActionPaidSeconds(partial,summary.partialWork.action)!==0)throw Error('Restored runtime witness');
  const before=JSON.stringify({body:partial.physiology,inventory:partial.inventory,ecology:loaded.state.environment.ecology});
  partial.active=structuredClone(summary.partialWork.action);const advanced=tickDiscoveryAction(partial,1,loaded.state.environment);
  if(advanced!==false||partial.active!==null||JSON.stringify({body:partial.physiology,inventory:partial.inventory,ecology:loaded.state.environment.ecology})!==before)throw Error('Copied interrupted action replayed');
  return {decodedByteProbe:true,noPaymentWitness:true,noCompletionWitness:true,noCopiedActionReplay:true};
}

/** Explicit normalization of the already-restored app, before selector UI saves.
 * This is a save transition, not rendering; original and canonical bytes survive. */
export function canonicalCombinedFoodCheckpoint(projectEvidence) {
  const require=(v,m)=>{if(!v)throw Error(m);};
  const before=window.__ozarkWorld.fullSnapshot(),originalRaw=localStorage.getItem('aincrad.world.v2');
  require(!window.__ozarkWorld.snapshot().started,'Canonical checkpoint must not advance simulation');
  require(window.__ozarkWorld.save()===true,'Explicit canonical checkpoint save failed');
  const after=window.__ozarkWorld.fullSnapshot(),raw=localStorage.getItem('aincrad.world.v2');
  require(JSON.stringify(after)===JSON.stringify(before),'Canonical save changed full live state');
  const saved=JSON.parse(raw),expected=projectEvidence(before),canonicalEvidence=projectEvidence(saved);
  require(JSON.stringify(canonicalEvidence)===JSON.stringify(expected),'Canonical save changed physical/history evidence');
  // Include retained cognition, statistics and random state beyond the native
  // physical/history projection, without mistaking codec normalization for ticks.
  for(const actor of before.agents){const stored=saved.agents.find(n=>n.id===actor.id);
    for(const key of ['cognition','stats','rng'])require(JSON.stringify(stored[key])===JSON.stringify(actor[key]),'Canonical save changed '+actor.id+' '+key);
  }
  return {originalRaw,raw,canonicalEvidence,fullLiveStateUnchanged:true,savedEvidenceMatchesLive:true};
}

export async function presentCombinedFoodUi(expected) {
  const require=(v,m)=>{if(!v)throw Error(m);},get=s=>{const n=document.querySelector(s);require(n,'Missing '+s);return n;};
  const before=window.__ozarkWorld.fullSnapshot(),bytes=localStorage.getItem('aincrad.world.v2');
  require(!window.__ozarkWorld.snapshot().started&&before.elapsed===expected.elapsed,'Unexpected native progression');
  if(get('#npc-panel').classList.contains('hidden'))get('#open-npc').click();get('#npc-tab-character').click();
  require(JSON.stringify(window.__ozarkWorld.fullSnapshot())===JSON.stringify(before)&&localStorage.getItem('aincrad.world.v2')===bytes,'Opening panel changed state/save');
  const selectionSaved=get('#npc-select').value!==expected.actorId;
  if(selectionSaved){get('#npc-select').value=expected.actorId;get('#npc-select').dispatchEvent(new Event('change',{bubbles:true}));}
  const selected=window.__ozarkWorld.fullSnapshot(),selectedBytes=localStorage.getItem('aincrad.world.v2');
  require(selected.selectedAgentId===expected.actorId,'Wrong selected actor');
  const expectedSelected=structuredClone(before);expectedSelected.selectedAgentId=expected.actorId;
  require(JSON.stringify(selected)===JSON.stringify(expectedSelected),'Selector changed full live state beyond selectedAgentId');
  const expectedDisk=JSON.parse(bytes);expectedDisk.selectedAgentId=expected.actorId;
  require(selectedBytes===(selectionSaved?JSON.stringify(expectedDisk):bytes),'Selector save changed canonical bytes beyond selectedAgentId');
  const checkbox=get('#npc-numeric-debug');checkbox.closest('details').open=true;if(!checkbox.checked)checkbox.click();
  // The inert native route does not run periodic panel updates. Refresh through
  // the ordinary read-only tab event after enabling exact numeric diagnostics.
  get('#npc-tab-character').click();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const actor=selected.agents.find(n=>n.id===expected.actorId),label=get('#npc-nourishment').previousElementSibling;
  require(label.textContent.includes('Satiety')&&label.title==='Satiety is modeled appetite duration, not stomach fullness or stored energy.','Misleading appetite label');
  const actual=get('#npc-nourishment-value').textContent,expectedText=actor.nourishment.toFixed(1)+' / 100';
  require(actual===expectedText,'Rendered projection mismatch: actual '+JSON.stringify(actual)+'; expected '+JSON.stringify(expectedText));
  for(const [id,key] of [['energy','energy'],['fatigue','fatigue'],['sleep','sleepPressure']])require(get('#npc-'+id+'-debug').textContent===actor[key].toFixed(1),'Separate '+id+' diagnostic mismatch');
  get('#npc-condition').scrollIntoView({block:'center'});
  require(JSON.stringify(window.__ozarkWorld.fullSnapshot())===JSON.stringify(selected)&&localStorage.getItem('aincrad.world.v2')===selectedBytes,'Read-only rendering changed state/save after selection');
  return {readOnly:!selectionSaved,renderingReadOnly:true,selectionSaved,selectionOnlySelectedAgentId:true,
    foodSatisfaction:get('#npc-nourishment-value').textContent,label:label.textContent,tooltip:label.title};
}
