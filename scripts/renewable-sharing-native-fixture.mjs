/** Self-contained browser-compatible physical fixture. Only local encounter
 * placement is synthetic. No ecology/body/proof stores or clocks are injected.
 * Native QA deliberately exercises feeding, not multi-day reproduction. */
export async function createRenewableSharingFixture(moduleBase) {
  const use = name => import(new URL(`src/${name}.js`, moduleBase).href);
  const { CONFIG } = await use('config');
  const { createOzarkWorldGeometry } = await use('ozark-world-geometry');
  const { createOzarkState, writeOzarkSave, OZARK_SAVE_KEY } = await use('ozark-save');
  const { bindOzarkWorldAgent } = await use('ozark-agent-world');
  const { tickEnvironment } = await use('environment');
  const { tickOzarkEcology } = await use('ozark-ecology');
  const { observeNpc, requestNpcAction, tickNpc } = await use('npc');
  const { processDiscoveryFeedback } = await use('discovery');
  const { SocialCoordinator } = await use('social');
  const { aquaticStockAudit } = await use('aquatic-state');
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const geometry = createOzarkWorldGeometry(), state = createOzarkState(geometry);
  const environment = state.environment, ecology = environment.ecology;
  const [sender, receiver] = state.agents;
  for (const actor of state.agents) bindOzarkWorldAgent(actor, geometry, state);
  const initialAquatic = structuredClone(ecology.aquatic);
  function advance(seconds) {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += CONFIG.fixedStep) {
      const dt = Math.min(CONFIG.fixedStep, seconds - elapsed);
      tickEnvironment(environment, dt);
      tickOzarkEcology(ecology, dt, environment, state.agents, {}, geometry);
      for (const actor of state.agents) {
        tickNpc(actor, dt, environment);
        processDiscoveryFeedback(actor);
      }
      state.elapsed = environment.elapsed;
    }
  }
  // All actors, bodies and ecology advance together. There is no artificial
  // aging, hunger override, reset population or unaccounted food injection.
  advance(60);
  let source, point;
  for (const plant of ecology.plants.filter(row => row.kind === 'apple_tree' && row.quantity > 2)) {
    point = [{x:plant.position.x+45,y:plant.position.y}, {x:plant.position.x-45,y:plant.position.y},
      {x:plant.position.x,y:plant.position.y+45}].find(position =>
      geometry.canOccupy(position.x, position.y, CONFIG.playerRadius) && geometry.lineOfSight(position, plant.position));
    if (point) { source = plant; break; }
  }
  require(source, 'No physical source for the local encounter fixture');
  for (const actor of state.agents) { actor.position = {...point}; observeNpc(actor, environment); }
  function finish(actor, action) {
    const admission = requestNpcAction(actor, action, environment);
    require(admission.code === 'ACTION_STARTED', 'Admission failed: ' + JSON.stringify(admission));
    for (let i = 0; actor.active && i < 1000; i++) advance(CONFIG.fixedStep);
    require(!actor.active && actor.lastResult?.ok, 'Paid action failed: ' + JSON.stringify(actor.lastResult));
    return structuredClone(actor.lastResult);
  }
  const acquired = finish(sender, {type:'pull',targetId:source.id});
  const sampled = finish(sender, {type:'sample',targetId:acquired.materialId});
  advance(90);
  const pullRecord = sender.discovery.experiments.find(row => row.primitive === 'pull' && row.ok &&
    row.actionId === acquired.eventId && row.targetId === source.id && row.materialId === acquired.materialId);
  const sampleRecord = sender.discovery.experiments.find(row => row.primitive === 'sample' && row.ok &&
    row.actionId === sampled.eventId && row.targetId === acquired.materialId && row.ingestionId === sampled.ingestionId);
  const sustained = sender.discovery.effects.filter(row => row.objectId === acquired.materialId &&
    row.effect === 'sustained' && row.actionId === sampled.eventId && row.ingestionId === sampled.ingestionId);
  const technique = sender.discovery.techniques.find(row => row.sourceId === source.id &&
    row.steps[0]?.type === 'pull' && row.steps[1]?.type === 'sample' &&
    row.evidence.includes(pullRecord?.id) && row.evidence.includes(sampleRecord?.id));
  require(pullRecord && sampleRecord && sustained.length === 1 && technique?.confidence === 'tentative' &&
    technique.successes === 1 && sender.stats.independentMeals === 1 &&
    sender.discovery.samplesPending[acquired.materialId] === undefined,
    'One real paid sample must earn exactly linked delayed source knowledge and clear its own pending wait');
  const foodFeedback = {pullExperimentId:pullRecord.id,sampleExperimentId:sampleRecord.id,
    ingestionId:sampled.ingestionId,effectId:sustained[0].id,techniqueId:technique.id,
    confidence:technique.confidence,successes:technique.successes,independentMeals:sender.stats.independentMeals,
    pendingCleared:true};
  const material = ecology.materials.find(row => row.id === acquired.materialId);
  require(material?.heldBy === sender.id && material.massGrams > 0, 'Sender must hold finite remainder');
  const social = new SocialCoordinator({communicationMode:'grounded',getAgents:()=>state.agents,getCommunity:()=>state.community,getEnvironment:()=>environment});
  for(const route of ['say','append','receive'])social[route]=()=>{throw new Error('Grounded sharing used legacy language: '+route);};
  const beforeMessages=JSON.stringify(state.community.messages);
  const before = {at:receiver.elapsed, metabolizedKcal:receiver.physiology.totals.metabolizedKcal,
    material:structuredClone(material), senderProof:structuredClone(sender.discovery),
    receiverEffects:structuredClone(receiver.discovery.effects), receiverTechniques:structuredClone(receiver.discovery.techniques),
    receiverMeals:receiver.stats.independentMeals};
  const offer = social.action(sender, {type:'offer_food',targetId:receiver.id,objectId:material.id});
  require(offer.code === 'FOOD_OFFERED', 'Offer failed: ' + JSON.stringify(offer));
  require(offer.gesture?.gesture==='offer' && offer.gesture?.provenance==='supplied-nonverbal-motor' && !offer.message,'Offer must be a supplied motor gesture, not speech');
  require(material.heldBy === sender.id && !receiver.inventory.items.includes(material.id), 'An offer cannot transfer ownership');
  const acceptance = social.action(receiver, {type:'accept_food',offerId:offer.offerId});
  require(acceptance.code === 'ACTION_STARTED', 'Consent must start a paid attempt: ' + JSON.stringify(acceptance));
  require(material.heldBy === sender.id, 'Consent cannot instantly transfer ownership');
  advance(.5);
  require(receiver.active && material.heldBy === sender.id, 'A half-second cannot complete the handoff');
  for (let i=0; receiver.active && i<1000; i++) advance(CONFIG.fixedStep);
  require(!receiver.active && receiver.lastResult?.ok, 'Handoff did not settle successfully');
  require(material.heldBy === receiver.id && receiver.inventory.items.includes(material.id) &&
    !sender.inventory.items.includes(material.id), 'Exact ownership must transfer once');
  for (const field of ['massGrams','energyKcal','waterMl','id','kind','materialType'])
    require(material[field] === before.material[field], 'Handoff altered finite material: ' + field);
  require(receiver.elapsed > before.at && receiver.physiology.totals.metabolizedKcal > before.metabolizedKcal,
    'Recipient must pay real time and metabolism');
  require(JSON.stringify(receiver.discovery.effects) === JSON.stringify(before.receiverEffects) &&
    JSON.stringify(receiver.discovery.techniques) === JSON.stringify(before.receiverTechniques) &&
    receiver.stats.independentMeals === before.receiverMeals, 'Food ownership is not ingestion or personal proof');
  require(ecology.aquatic.ledger.primaryProducedKcal > initialAquatic.ledger.primaryProducedKcal &&
    ecology.aquatic.ledger.fedKcal > initialAquatic.ledger.fedKcal, 'Ordinary ticks must renew food and feed living fish');
  const transferAfter = {at:receiver.elapsed,metabolizedKcal:receiver.physiology.totals.metabolizedKcal,material:structuredClone(material)};
  // The recipient now offers the same object back but nobody accepts. This
  // counter-offer is a negative restart control, not a second transfer. Using
  // the other speaker respects the ordinary repeated-conversation cooldown.
  const pendingOffer = social.action(receiver, {type:'offer_food',targetId:sender.id,objectId:material.id});
  require(pendingOffer.code === 'FOOD_OFFERED', 'Pending-offer restart control failed: ' + JSON.stringify(pendingOffer));
  require(material.heldBy === receiver.id, 'Unaccepted counter-offer cannot change ownership');
  require(JSON.stringify(state.community.messages)===beforeMessages,'Gestures must not manufacture conversation');
  const gestures=social.foodSharing.gestures();
  require(gestures.map(row=>row.gesture).join(',')==='offer,accept,offer','Actual supplied gesture history required');
  const audit = aquaticStockAudit(ecology);
  require(Object.values(audit).every(value => Number.isFinite(value) && Math.abs(value) < 1e-5),
    'Renewable aquatic stocks must conserve mass, calories and water: ' + JSON.stringify(audit));
  state.selectedAgentId = receiver.id; state.player = {...point};
  const rows = new Map(), storage = {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value)};
  const saved = writeOzarkSave(storage, state, geometry);
  require(saved && saved.ok !== false && rows.has(OZARK_SAVE_KEY), 'Fixture failed strict current save validation: ' + JSON.stringify(saved));
  return {saveKey:OZARK_SAVE_KEY,raw:rows.get(OZARK_SAVE_KEY),summary:{
    version:state.version,features:{...state.features},elapsed:state.elapsed,
    renewalVerified:true,timedHandoffVerified:true,groundedGesturesVerified:true,gestures,reproductionExercised:false,growthExercised:false,
    aquatic:{initial:initialAquatic.ledger,final:structuredClone(ecology.aquatic.ledger),
      initialFish:initialAquatic.fish.length,finalFish:ecology.aquatic.fish.length,audit},
    pendingConsent:{offerId:pendingOffer.offerId,materialId:material.id,senderId:receiver.id,receiverId:sender.id},
    transfer:{senderId:sender.id,receiverId:receiver.id,materialId:material.id,acquired,sampled,foodFeedback,
      offer,acceptance,result:structuredClone(receiver.lastResult),before,
      after:transferAfter},
    fixtureDisclosure:'Manual local encounter placement; real shared-clock feeding, paid acquisition, sampling, delayed sender feedback, voluntary offer and timed recipient grasp. No autonomous travel, request policy, survival, multi-day growth or reproduction claim. Growth/reproduction are tested separately.'
  }};
}
