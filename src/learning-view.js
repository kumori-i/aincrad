// Observer-only projection. No naming lookup, policy inputs, clock or action ownership.
import { paintCommunicationPixels } from './communication-experiment-ui.js';
const number = v => Number.isFinite(v) ? v.toFixed(1) : '—';
const count = v => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
// View-local DOM state only. Retaining the disclosure node preserves expansion
// across refresh/error/recovery without storing anything in the learner.
const diagnosticViews = new WeakMap();
export function renderLearningView(parent, snapshot, agentId, error = '', gestures = []) {
  const document = parent.ownerDocument || globalThis.document;
  const add = (into, tag, text, className = '') => { const e=document.createElement(tag);e.textContent=text;e.className=className;into.append(e);return e; };
  const scrollTop=parent.scrollTop||0;
  let diagnostics=diagnosticViews.get(parent);
  const restoreDiagnosticFocus=!!diagnostics && document.activeElement===diagnostics.summary;
  parent.replaceChildren();
  add(parent,'p','Observer annotations, not agent speech. Symbols have no supplied English translation.','small');
  add(parent,'p','Bodies and survival memories save locally. Private visual associations restart empty on app reopen or world reset. This bounded view is session-only.','small');
  if(!snapshot){add(parent,'p',`Communication learning unavailable. ${String(error).slice(0,160)} Survival continues independently.`,'small');return;}
  add(parent,'p',`${count(snapshot.elapsed)} simulation seconds · same main-world clock`,'small');
  const associations=snapshot.phase==='private-visual-association';
  const physicalReference=associations||snapshot.phase==='physical-reference-no-learning';
  if(associations)add(parent,'p',`${count(snapshot.opportunities)} optional opportunities · ${count(snapshot.exchanges)} attempted messages · ${count(snapshot.observed)} canonical observed demonstrations · ${count(snapshot.correct)} reference matches · ${count(snapshot.censored)} censored · ${count(snapshot.pending)} pending`,'small');
  else add(parent,'p',physicalReference?`${count(snapshot.exchanges)} reference attempts · ${count(snapshot.observed)} observed demonstrations · ${count(snapshot.correct)} reference matches · ${count(snapshot.censored)} censored · ${count(snapshot.pending)} pending · no learning updates`:`${count(snapshot.exchanges)} messages / action selections · ${count(snapshot.updates)} updates · ${count(snapshot.positive)} positive · ${count(snapshot.negative)} negative · ${count(snapshot.relief)} relief · ${count(snapshot.discomfort)} discomfort · ${count(snapshot.effortExpiry)} effort-only expiries · ${count(snapshot.censored)} censored · ${count(snapshot.pending)} pending`,'small');
  if(associations){
    add(parent,'p',`${count(snapshot.matchedChoices)} association-matched choices · ${count(snapshot.exploratoryChoices)} uniform exploratory choices · ${count(snapshot.correctionAttempts)} corrective observations · ${count(snapshot.evidenceAdditions)} new visual exemplars · ${count(snapshot.supportUpdates)} repeated support · ${count(snapshot.conflicts)} conflicts · ${count(snapshot.correctionAbstentions)} corrective abstentions`,'small');
    add(parent,'p','Reference matching is not bodily relief or sickness. Symbols and fixed visual thresholds are supplied biases; private examples acquire partner-specific associations only after observed paid demonstrations. This does not establish grammar, abstract concepts or survival benefit.','small');
    const memory=snapshot.learners?.find(l=>l.agentId===agentId);
    if(memory){
      add(parent,'h3','Private visual memory');
      add(parent,'p',`${count(memory.counts?.anchors)} own stable anchors / 16 · ${count(memory.counts?.entries)} partner-symbol entries · ${count(memory.counts?.examples)} own demonstrated examples · ${count(memory.counts?.conflicts)} conflicted entries`,'small');
      for(const anchor of memory.anchors||[])add(parent,'p',`Own anchor symbol: ${Math.floor(anchor.symbol/8)} · ${anchor.symbol%8}`,'learning-symbols');
    }
  }
  if(snapshot.phase==='physical-reference-no-learning')add(parent,'p','Physical-reference verification: symbols and selections are arbitrary; association learning is not enabled. Paid inspections and visible post-choice indications are measured separately from bodily reward.','small');
  const actor=snapshot.agents?.find(a=>a.id===agentId);
  if(actor)add(parent,'p',`${actor.name||actor.id}: food ${number(actor.hunger)}/100 · water ${number(actor.thirst)}/100 · energy ${number(actor.energy)}/100`,'small');
  const rows=(snapshot.observationEvents||[]).filter(e=>e.senderId===agentId||e.receiverId===agentId).slice(-32).reverse();
  if(!rows.length)add(parent,'p',physicalReference?'No reference attempt involving this agent yet. Nearby mutually visible, distinguishable objects and an optional-action opportunity are required. No learned meaning is established.':'No symbol exchange involving this agent yet. A personal experience and nearby optional-action opportunity are required. No communication benefit is established.','small');
  for(const event of rows){
    const entry=add(parent,'article','','journal-entry');entry.dataset.learningEvent=String(event.id);entry.dataset.learningStatus=event.status;
    add(entry,'p',`#${event.id} · ${number(event.emittedAt)}s · ${event.senderId} → ${event.receiverId}`,'message-meta');
    const tokens=Array.isArray(event.tokens)&&event.tokens.length===2&&event.tokens.every(t=>Number.isInteger(t)&&t>=0&&t<8)?event.tokens.join(' · '):'—';
    add(entry,'p',tokens,'learning-symbols');
    add(entry,'p',`${event.status} · selected action: ${event.action}${event.reward===null||!Number.isFinite(event.reward)?'':` · measured reward ${event.reward.toFixed(3)}`}`,'small');
    if(event.phase==='private-visual-association')add(entry,'p',`${event.choiceMode||'pending'} (${event.choiceReason||'unavailable'}) · observed correction: ${event.correction||'none'} · funded visible indication ${number(event.observedSeconds||0)}s${typeof event.referenceCorrect==='boolean'?` · independent reference critic: ${event.referenceCorrect?'matched':'different'}`:''}`,'small');
    if(event.phase==='physical-reference-no-learning')add(entry,'p',`Reference observation: ${event.reason||'pending'} · funded visible indication ${number(event.observedSeconds||0)}s${typeof event.referenceCorrect==='boolean'?` · independent reference critic: ${event.referenceCorrect?'matched':'different'}`:''}. No associative update.`,'small');
    if(event.endedAt!==undefined)add(entry,'p',`Settled at ${number(event.endedAt)}s${Number.isFinite(event.cost)?` · effort cost ${number(event.cost)}`:''}${Number.isFinite(event.benefit)?` · bodily feedback ${number(event.benefit)}`:''}`,'small');
    const crops=add(entry,'div','','communication-crops');
    for(const [label,pixels,at] of [['Sender’s earlier sight',event.senderPixels,event.senderObservedAt],['Listener’s own sight at selection',event.receiverPixels,event.receiverObservedAt]]){
      const figure=add(crops,'figure','');const canvas=add(figure,'canvas','');canvas.width=canvas.height=16;canvas.setAttribute('aria-label',label);paintCommunicationPixels(canvas,pixels);add(figure,'figcaption',`${label} · ${number(at)}s`);
    }
    if(event.demonstrationPixels){const figure=add(crops,'figure','');const canvas=add(figure,'canvas','');canvas.width=canvas.height=16;canvas.setAttribute('aria-label','Listener’s own post-choice demonstration');paintCommunicationPixels(canvas,event.demonstrationPixels);add(figure,'figcaption',`Listener’s own post-choice demonstration · ${number(event.demonstrationObservedAt)}s`);}
  }
  add(parent,'p',physicalReference?'Latest 32 involving this agent, from at most 256 retained session events. Crops are captured copies, not live sight. The short schematic direction cue, geometric parser, segmented crops, fixed matching rules and arbitrary symbol inventory are supplied structure—not learned concepts or grammar.':'Latest 32 involving this agent, from at most 256 retained session events. Crops are copies captured at emission, not current sight. Supplied segmentation, motor actions, gesture coordination and reward rules are scaffolding, not learned grammar. A negative update may be effort without relief, not sickness.','small');
  const motors=gestures.filter(e=>e.senderId===agentId||e.recipientId===agentId).slice(-8);
  if(motors.length){add(parent,'h3','Supplied nonverbal coordination (not learned symbols)');for(const e of motors)add(parent,'p',`${number(e.at)}s · ${e.senderId} → ${e.recipientId}: ${e.gesture}${e.objectId?` · visible held item ${e.objectId}`:''}`,'small');}
  if(!diagnostics){
    const details=document.createElement('details');details.dataset.learningDiagnostics='true';
    const summary=add(details,'summary','Opportunity diagnostics (whole population)');
    const body=add(details,'p','','small');diagnostics={details,summary,body};diagnosticViews.set(parent,diagnostics);
  }
  parent.append(diagnostics.details);
  const g=snapshot.gates||{};diagnostics.body.textContent=Object.entries(g).map(([k,v])=>`${k}: ${count(v)}`).join(' · ');
  if(restoreDiagnosticFocus)diagnostics.summary.focus({preventScroll:true});
  parent.scrollTop=scrollTop;
}
