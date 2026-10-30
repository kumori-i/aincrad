// Observer-only projection. No naming lookup, policy inputs, clock or action ownership.
import { paintCommunicationPixels } from './communication-experiment-ui.js';
const number = v => Number.isFinite(v) ? v.toFixed(1) : '—';
const count = v => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
// View-local DOM state only. Retaining the disclosure node preserves expansion
// across refresh/error/recovery without storing anything in the learner.
const diagnosticViews = new WeakMap();
// Presentation labels only: these annotations never enter an agent's observations.
const survivalViews = new WeakMap();
const survivalGateLabels = Object.freeze({
  'visit:urgent-food':'Urgent-food phase reached', 'enter:urgent-food':'Urgent-food branch entered',
  'visit:ordinary-food':'Ordinary-food phase reached', 'enter:ordinary-food':'Ordinary-food branch entered',
  'visit:learned-run':'Learned-run phase reached', 'visit:optional':'Optional-action phase reached',
  'sample:source-caution':'Existing source-caution gate blocked sampling',
  'sample:composite-blocked':'Composite sampling gate blocked (subreason not recorded)',
  'sample:feedback-wait':'Waiting for existing sample feedback', 'sample:recent-failure':'Recent sampling failure gate',
  'sample:eligible':'Sampling eligibility passed', 'run:missing-or-expired':'Learned run missing, revised or expired',
  'run:awaiting':'Learned run awaiting feedback', 'run:complete':'Learned run complete',
  'run:no-target':'Learned-run target unavailable', 'run:availability-blocked':'Learned-run availability gate blocked',
  'run:eligibility-blocked':'Learned-run eligibility gate blocked', 'run:route-missing':'Learned-run route unavailable',
  'run:travel':'Learned run selected travel', 'run:action':'Learned run selected action',
  'food:held-supported-found':'Held supported-food branch found',
  'food:urgent-candidates':'Urgent-food filtered candidates',
  'food:ordinary-candidates':'Ordinary-food filtered candidates',
});
const observerActions=new Set(['inspect_object','indicate_object','grasp','release','pull','sample','strike','catch','move','swim','climb','jump','wait','rest','sleep','drink','fill_flask','enter_shelter','exit_shelter','give','accept','refuse']);
const observerNeeds=new Set(['understanding','water','food','thermal','survival','rest','safety']);
const choiceLabel=(value,allowed)=>allowed.has(value)?value.replaceAll('_',' '):'not recorded';
const phaseLabel=(value,foodBranch=false)=>value==='entered'?'entered':value==='visited'?(foodBranch?'reached; branch not entered':'reached'):'not visited (not a failure)';
export function renderSurvivalObserver(parent, snapshot, restoreFocus = false) {
  if(!snapshot||snapshot.version!==1)return;
  const document=parent.ownerDocument||globalThis.document;
  const add=(into,tag,text)=>{const e=document.createElement(tag);e.textContent=text;e.className='small';into.append(e);return e;};
  const b=snapshot.body;
  add(parent,'h3','Survival observer');
  if(b){
    add(parent,'p',`Satiety: ${number(b.satietyHours)} / ${number(b.satietyMaximumHours)} modeled game hours · ${number(b.satietyPercent)}/100. Modeled appetite duration, not stomach fullness or stored energy.`);
    add(parent,'p',`Available fuel: ${number(b.availableEnergyKcal)} kcal · stored reserves: ${number(b.storedEnergyKcal)} kcal`);
    add(parent,'p',`Cumulative intake: ${number(b.ingestedKcal)} kcal ingested · ${number(b.absorbedKcal)} kcal absorbed · ${number(b.metabolizedKcal)} kcal spent`);
    add(parent,'p',`${Number.isFinite(b.foodFeedbackEvents)?count(b.foodFeedbackEvents):'—'} food-sampling/feedback events (legacy counter; not whole meals)`);
  }
  let view=survivalViews.get(parent);
  if(!view){const details=document.createElement('details');details.dataset.survivalDiagnostics='true';const summary=add(details,'summary','Recent survival decisions (observer only)');const body=add(details,'div','');view={details,summary,body};survivalViews.set(parent,view);}
  const focused=restoreFocus||document.activeElement===view.summary;view.body.replaceChildren();parent.append(view.details);
  const c=snapshot.counters||{},records=Array.isArray(snapshot.records)?snapshot.records:[];
  add(view.body,'p',`Latest ${Math.min(records.length,8)} of ${records.length} retained decisions (maximum 64). ${count(c.evictedRecords)} older records evicted · ${count(c.droppedNotes)} notes truncated · ${count(c.rejectedNotes)} invalid notes omitted. At most 32 notes per decision; session-only, not saved.`);
  add(view.body,'p','Only visited branches are recorded; not visited is not failed. These are selected actions, not proof of completion or a complete explanation of motivation. No advice is sent to agents.');
  if(!records.length)add(view.body,'p','No recorded survival decision yet.');
  if(snapshot.active)add(view.body,'p','A decision is in progress; its record is not shown until closed.');
  for(const r of records.slice(-8).reverse()){
    const entry=add(view.body,'article','');entry.dataset.survivalDecision=String(count(r.sequence));
    const status=['selected','incomplete','superseded'].includes(r.status)?r.status:'unavailable';
    add(entry,'p',`#${count(r.sequence)} · ${number(r.at)}s · epoch ${Number.isFinite(r.epoch)?count(r.epoch):'—'} · ${status}`);
    add(entry,'p',`Selected need: ${choiceLabel(r.actualNeed,observerNeeds)} · selected action: ${choiceLabel(r.actualType,observerActions)}. Requested need: ${choiceLabel(r.requestedNeed,observerNeeds)} · requested action: ${choiceLabel(r.requestedType,observerActions)}.`);
    add(entry,'p',`Urgent food: ${phaseLabel(r.phases?.urgentFood,true)} · ordinary food: ${phaseLabel(r.phases?.ordinaryFood,true)} · learned run: ${phaseLabel(r.phases?.learnedRun)} · optional action: ${phaseLabel(r.phases?.optional)}`);
    for(const n of (Array.isArray(r.notes)?r.notes:[]).slice(0,32))if(Object.hasOwn(survivalGateLabels,n.code))add(entry,'p',`${survivalGateLabels[n.code]} · count ${count(n.count)}`);
  }
  if(focused)view.summary.focus({preventScroll:true});
}

export function renderLearningView(parent, snapshot, agentId, error = '', gestures = [], survival = null) {
  const document = parent.ownerDocument || globalThis.document;
  const add = (into, tag, text, className = '') => { const e=document.createElement(tag);e.textContent=text;e.className=className;into.append(e);return e; };
  const scrollTop=parent.scrollTop||0;
  let diagnostics=diagnosticViews.get(parent);
  const restoreDiagnosticFocus=!!diagnostics && document.activeElement===diagnostics.summary;
  const restoreSurvivalFocus=document.activeElement===survivalViews.get(parent)?.summary;
  parent.replaceChildren();
  const characterMessages=snapshot?.phase==='private-character-message';
  add(parent,'p',characterMessages?
    'Observer annotations, not agent speech. Letter strings below are exact emissions with no supplied English translation.':
    'Observer annotations, not agent speech. Symbols have no supplied English translation.','small');
  add(parent,'p',characterMessages?
    'Bodies, survival memories, private character models and bounded own-view examples save locally per individual. Legacy symbol associations remain archival. Fresh or reset worlds and replacement individuals begin untrained. Events in this view are session-only.':
    'Bodies, survival memories and private visual associations save locally per individual. Those associations can be used after app reopen; fresh or reset worlds and replacement individuals start empty. Events in this view are session-only.','small');
  renderSurvivalObserver(parent,survival,restoreSurvivalFocus);
  if(!snapshot){parent.scrollTop=scrollTop;add(parent,'p',`Communication learning unavailable. ${String(error).slice(0,160)}`,'small');return;}
  add(parent,'p',`${count(snapshot.elapsed)} simulation seconds · same main-world clock`,'small');
  const associations=snapshot.phase==='private-visual-association';
  const physicalReference=characterMessages||associations||snapshot.phase==='physical-reference-no-learning';
  if(associations)add(parent,'p','Counts below cover this app session, including individuals later replaced. The private memory row describes the current individual.','small');
  if(characterMessages)add(parent,'p',`${count(snapshot.opportunities)} optional opportunities · ${count(snapshot.exchanges)} attempted character messages · ${count(snapshot.observed)} canonical observed demonstrations · ${count(snapshot.correct)} independent reference matches · ${count(snapshot.censored)} censored · ${count(snapshot.pending)} pending`,'small');
  else if(associations)add(parent,'p',`${count(snapshot.opportunities)} optional opportunities · ${count(snapshot.exchanges)} attempted messages · ${count(snapshot.observed)} canonical observed demonstrations · ${count(snapshot.correct)} reference matches · ${count(snapshot.censored)} censored · ${count(snapshot.pending)} pending`,'small');
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
  if(characterMessages){
    const learner=snapshot.learners?.find(row=>row.agentId===agentId);
    const character=learner?.character;
    add(parent,'p','The emitted letters and recipient actions below are observations, not English object names or proof of understanding. Sender feedback is own-view visual similarity, not bodily reward.','small');
    if(character){
      add(parent,'h3','Private character learning');
      add(parent,'p',`${count(character.uniqueDemonstrations)} unique valid labeled demonstrations · ${count(character.replayUses)} prior-example replay uses · ${count(character.listenerUpdates)} listener optimizer steps · ${count(character.senderUpdates)} sender optimizer steps`,'small');
      for(const bank of (Array.isArray(character.partnerBanks)?character.partnerBanks:[]).slice(0,2))
        add(parent,'p',`Partner ${String(bank.partnerId||'unknown').slice(0,64)} · incarnation ${count(bank.partnerSerial)} · ${count(bank.retainedExamples)} retained own-view examples · ${bank.trained===true?'trained from at least one valid demonstration':'uniform until a valid demonstration'}`,'small');
    }
    if(learner){
      add(parent,'h3','Retained legacy symbol associations (archival)');
      add(parent,'p',`${count(learner.counts?.anchors)} old own anchors · ${count(learner.counts?.entries)} old partner-symbol entries · ${count(learner.counts?.examples)} old own examples. These do not train or name the character messages.`,'small');
    }
  }
  if(snapshot.phase==='physical-reference-no-learning')add(parent,'p','Physical-reference verification: symbols and selections are arbitrary; association learning is not enabled. Paid inspections and visible post-choice indications are measured separately from bodily reward.','small');
  const actor=snapshot.agents?.find(a=>a.id===agentId);
  if(actor)add(parent,'p',`${actor.name||actor.id}: ${physicalReference?'Satiety':'food'} ${number(actor.hunger)}/100 · water ${number(actor.thirst)}/100 · energy ${number(actor.energy)}/100`,'small');
  const rows=(snapshot.observationEvents||[]).filter(e=>e.senderId===agentId||e.receiverId===agentId).slice(-32).reverse();
  if(!rows.length)add(parent,'p',characterMessages?
    'No character message involving this agent yet. Nearby mutually visible, distinguishable objects and an optional-action opportunity are required. No learned meaning is established.':
    physicalReference?'No reference attempt involving this agent yet. Nearby mutually visible, distinguishable objects and an optional-action opportunity are required. No learned meaning is established.':
      'No symbol exchange involving this agent yet. A personal experience and nearby optional-action opportunity are required. No communication benefit is established.','small');
  for(const event of rows){
    const entry=add(parent,'article','','journal-entry');entry.dataset.learningEvent=String(event.id);entry.dataset.learningStatus=event.status;
    add(entry,'p',`#${event.id} · ${number(event.emittedAt)}s · ${event.senderId} → ${event.receiverId}`,'message-meta');
    const characterEvent=characterMessages&&event.phase==='private-character-message';
    if(characterMessages){
      const message=characterEvent&&typeof event.message==='string'&&/^[a-z]{1,6}$/.test(event.message)?event.message:'—';
      const shown=add(entry,'p',message,'learning-symbols');shown.dataset.characterMessage='true';
      const completed=event.action==='inspect_object'&&Number.isSafeInteger(event.selectedActionId)&&event.selectedActionId>0;
      const action=event.action==='inspect_object'?'inspect_object':'unavailable';
      add(entry,'p',completed?
        `${event.status} · recipient completed paid ${action}`:
        `${event.status} · recipient action requested: ${action}; completed inspection not recorded`,'small');
      if(characterEvent){
        add(entry,'p',`${event.choiceMode==='uniform-untrained'?'Uniform untrained choice':event.choiceMode==='model-sample'?'Sampled private listener choice':'Choice mode unavailable'} · listener optimizer step: ${event.listenerUpdate===true?'completed':'none'} · sender optimizer step: ${event.senderUpdate===true?'completed':'none'}`,'small');
        if(typeof event.referenceCorrect==='boolean')add(entry,'p',`Independent reference critic: ${event.referenceCorrect?'matched':'different'}. This observer check is not a model label.`,'small');
        if(event.feedbackStatus)add(entry,'p',`Response status: ${event.feedbackStatus}. A settled match or mismatch measures sender-local visual similarity, not understanding or bodily reward.`,'small');
      }
    }else{
      const tokens=Array.isArray(event.tokens)&&event.tokens.length===2&&event.tokens.every(t=>Number.isInteger(t)&&t>=0&&t<8)?event.tokens.join(' · '):'—';
      add(entry,'p',tokens,'learning-symbols');
      add(entry,'p',`${event.status} · selected action: ${event.action}${event.reward===null||!Number.isFinite(event.reward)?'':` · measured reward ${event.reward.toFixed(3)}`}`,'small');
    }
    if(event.phase==='private-visual-association')add(entry,'p',`${event.choiceMode||'pending'} (${event.choiceReason||'unavailable'}) · observed correction: ${event.correction||'none'} · funded visible indication ${number(event.observedSeconds||0)}s${typeof event.referenceCorrect==='boolean'?` · independent reference critic: ${event.referenceCorrect?'matched':'different'}`:''}`,'small');
    if(event.phase==='private-visual-association'&&event.feedbackStatus)
      add(entry,'p',`Sender-local visible response: ${event.feedbackStatus}. This is visual similarity, not proof of understanding or bodily reward.`,'small');
    if(event.phase==='physical-reference-no-learning')add(entry,'p',`Reference observation: ${event.reason||'pending'} · funded visible indication ${number(event.observedSeconds||0)}s${typeof event.referenceCorrect==='boolean'?` · independent reference critic: ${event.referenceCorrect?'matched':'different'}`:''}. No associative update.`,'small');
    if(event.endedAt!==undefined)add(entry,'p',`Settled at ${number(event.endedAt)}s${Number.isFinite(event.cost)?` · effort cost ${number(event.cost)}`:''}${Number.isFinite(event.benefit)?` · bodily feedback ${number(event.benefit)}`:''}`,'small');
    const crops=add(entry,'div','','communication-crops');
    for(const [label,pixels,at] of [['Sender’s earlier sight',event.senderPixels,event.senderObservedAt],['Listener’s own sight at selection',event.receiverPixels,event.receiverObservedAt]]){
      const figure=add(crops,'figure','');const canvas=add(figure,'canvas','');canvas.width=canvas.height=16;canvas.setAttribute('aria-label',label);paintCommunicationPixels(canvas,pixels);add(figure,'figcaption',`${label} · ${number(at)}s`);
    }
    if(event.demonstrationPixels){const figure=add(crops,'figure','');const canvas=add(figure,'canvas','');canvas.width=canvas.height=16;canvas.setAttribute('aria-label','Listener’s own post-choice demonstration');paintCommunicationPixels(canvas,event.demonstrationPixels);add(figure,'figcaption',`Listener’s own post-choice demonstration · ${number(event.demonstrationObservedAt)}s`);}
  }
  add(parent,'p',characterMessages?
    'Latest 32 involving this agent, from at most 256 retained session events. Crops are captured copies, not live sight. The letter policy can update from sparse own-view feedback; segmentation, physical indication, and visual matching remain supplied structure. No stable vocabulary, grammar, or survival benefit has been established.':
    physicalReference?'Latest 32 involving this agent, from at most 256 retained session events. Crops are captured copies, not live sight. The short schematic direction cue, geometric parser, segmented crops, fixed matching rules and arbitrary symbol inventory are supplied structure—not learned concepts or grammar.':
      'Latest 32 involving this agent, from at most 256 retained session events. Crops are copies captured at emission, not current sight. Supplied segmentation, motor actions, gesture coordination and reward rules are scaffolding, not learned grammar. A negative update may be effort without relief, not sickness.','small');
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
