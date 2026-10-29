import { survivalDecisionSnapshot } from './survival-decision-observer.js';
import { renderLearningView } from './learning-view.js';
import { visualGroups, visualSampleCurrent } from './visual-group-memory.js';
import { lexicalLabels } from './naming-state.js';
import { categoryLabels, objectName, namedObject } from './category-names.js';
import { humanHintHelp } from './human-hints.js';
import { peerTeachingLabel } from './peer-teaching.js';
import { observationalInquiries } from './observational-learning.js';
import { handlingInquiries } from './handling-inquiry.js';
import { NPC_RULES } from './config.js';
import { demonstrateCollapse } from './npc.js';
import { DesktopModelProvider, LocalLearnerProvider } from './controller.js';
import { recordEvent } from './npc-memory.js';
import { WEATHER_KINDS } from './environment.js';
import { bodySignals, sensedEnvironment } from './interoception.js';

const $=id=>document.getElementById(id);
const title=value=>String(value||'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
const serial=id=>Number(String(id||'').split(':').pop())||0;
function add(parent,tag,text,className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
function objectDescription(object){const a=object?.appearance||{};return [a.size,a.color,a.shape,a.texture].filter(Boolean).join(' · ')||'An unfamiliar object';}
function describeRemembered(n,id){return objectDescription(n.discovery?.observations?.[id]);}
const inquiryStatus = {
  uncertain: 'Uncertain · own test not completed',
  waiting: 'Own sample taken · awaiting bodily feedback',
  supported: 'Expected hunger benefit supported by own bodily feedback',
  contradicted: 'Own adverse bodily feedback · do not assume this is beneficial or safe',
  inconclusive: 'Own bodily feedback did not establish hunger benefit',
  unavailable: 'Procedure unavailable · food benefit remains untested',
  retired: 'Question retired · no new test implied',
  expired: 'Experiment window elapsed · no conclusion about food benefit',
};
// This projection and renderer only read existing evidence. UI refreshes cannot
// select actions, advance inquiry state, or reconstruct missing bodily proof.
export function renderObservationalInquiries(parent, npc, agents = []) {
  const rows = observationalInquiries(npc);
  if (!rows.length) return;
  add(parent, 'p', 'Observation-led questions', 'eyebrow');
  const pending = q => !q.priorAdverse && ['uncertain', 'waiting'].includes(q.status);
  const ordered = [...rows].reverse().sort((a, b) => Number(pending(b)) - Number(pending(a)));
  for (const q of ordered.slice(0, 4)) {
    const entry = add(parent, 'div', '', 'knowledge-entry');
    entry.dataset.inquirySource = q.sourceId;
    entry.dataset.inquiryStatus = q.status;
    add(entry, 'p', q.question);
    add(entry, 'p', describeRemembered(npc, q.sourceId), 'small');
    const actor = agents.find(a => a.id === q.actorId)?.name || 'another visible creature';
    add(entry, 'p', `Witnessed ${actor} consume from this exact source. Observation alone does not establish benefit to me.`, 'provenance');
    add(entry, 'p', inquiryStatus[q.status] || 'Uncertain', 'small');
    if (q.priorAdverse) add(entry, 'p', 'Earlier own adverse experience with this source prevents a new observation-led test.', 'small');
    if (!q.ownAttempts.length) add(entry, 'p', q.retired ? 'No own experiment is linked to this retired question; no outcome inferred.' : q.status === 'expired' || q.priorAdverse ? 'No own experiment retained for this question.' : 'No own experiment retained. A test can wait for bodily care or access; that is not evidence against food benefit.', 'small');
    for (const attempt of q.ownAttempts.slice(-3)) {
      add(entry, 'p', `Own experiment: ${title(attempt.primitive)} · ${attempt.ok ? 'executed' : 'attempt failed'} · ${title(attempt.code)}`, 'provenance');
    }
    if (q.ownAttempts.some(a => !a.ok) && !q.ownEffects.length) add(entry, 'p', 'A failed physical attempt does not contradict food benefit.', 'small');
    for (const effect of q.ownEffects.slice(-2)) add(entry, 'p', `Own bodily feedback: ${title(effect.effect)}${['aching', 'hurting'].includes(effect.pain) ? ' · ' + effect.pain : ''}`, 'provenance');
  }
  if (rows.length > 4) add(parent, 'p', `Showing 4 of ${rows.length} retained questions, with pending tests first. Older questions remain in memory.`, 'small');
}
const handlingInquiryStatus = {
  uncertain: 'Uncertain · pulling this source is not yet tested',
  attempting: 'Own pull attempt selected · no outcome inferred',
  detached: 'Own pull result · something detached; no food benefit established',
  'did-not-detach': 'Own pull result · nothing detached; no food conclusion',
  unavailable: 'Pull unavailable or question window elapsed · no new outcome inferred',
  retired: 'Question retired · no new test implied',
};
// A read-only view of personal motor evidence, separate from witnessed eating
// and heard procedures. Opening this panel never selects a pull or a sample.
export function renderHandlingInquiries(parent, npc) {
  const rows = handlingInquiries(npc);
  if (!rows.length) return;
  add(parent, 'p', 'Own handling questions', 'eyebrow');
  const pending = q => ['uncertain', 'attempting'].includes(q.status);
  const ordered = [...rows].reverse().sort((a, b) => Number(pending(b)) - Number(pending(a)));
  for (const q of ordered.slice(0, 4)) {
    const entry = add(parent, 'div', '', 'knowledge-entry');
    entry.dataset.handlingInquirySource = q.sourceId;
    entry.dataset.handlingInquiryStatus = q.status;
    add(entry, 'p', q.question);
    add(entry, 'p', `Current source (${q.sourceId}): ${describeRemembered(npc, q.sourceId)}`, 'small');
    add(entry, 'p', `Remembered source (${q.priorSourceId}): ${describeRemembered(npc, q.priorSourceId)}`, 'small');
    add(entry, 'p', q.status === 'retired'
      ? 'Retired question: full original proof is no longer retained. This remembered question is not a currently verified motor result, witnessed consumption or heard advice.'
      : 'Own prior motor result: pulling detached something from the remembered source. Grasping this source did not acquire it. This is my own handling history, not witnessed consumption or heard advice.', 'provenance');
    add(entry, 'p', 'Similar appearance is uncertain. It does not establish safety, food benefit or a shared category. No sampling is implied.', 'small');
    add(entry, 'p', handlingInquiryStatus[q.status] || 'Uncertain', 'small');
  }
  if (rows.length > 4) add(parent, 'p', `Showing 4 of ${rows.length} retained handling questions, with pending attempts first. Older questions remain in memory.`, 'small');
}
// A projection only: remembered membership never grants sight or action authority.
export function renderVisualGroups(parent, npc) {
  const groups = visualGroups(npc);
  if (!groups.length) return;
  add(parent, 'p', 'Tentative remembered similarity', 'eyebrow');
  add(parent, 'p', 'Supplied rule: exact shape, color and texture match. At least two individuals, each seen at two distinct simulation times. These are time-separated observations, not independent encounters or discovered categories.', 'small');
  for (const [index, group] of groups.entries()) {
    const entry = add(parent, 'div', '', 'knowledge-entry');
    entry.dataset.visualGroup = String(index);
    add(entry, 'p', `Looks alike: ${group.cues.shape} · ${group.cues.color} · ${group.cues.texture}`);
    for (const member of group.members) {
      const current = visualSampleCurrent(npc, member.objectId);
      const row = add(entry, 'p', `${member.objectId} · ${current ? 'current ordinary visual sample' : 'remembered only'} · ${member.times.length} retained observations at ${member.times.map(String).join(', ')} simulation seconds`, 'provenance');
      row.dataset.visualMember = member.objectId;
      row.dataset.visualStatus = current ? 'current' : 'remembered';
    }
    add(entry, 'p', 'Other properties unknown: no shared food, safety, behavior or name is inferred. Absence is not disproof. Remembered members cannot be acted on from this group.', 'small');
  }
}
/** Current label annotation, never a rewrite of what an old event said or knew. */
export function renderObjectName(parent, npc, objectId, { historical = false } = {}) {
  const name = objectName(npc, objectId);
  if (name) {
    const row = add(parent, 'p', `${historical ? 'Current label: ' : ''}“${name.token}”`);
    row.dataset.currentObjectName = objectId;
    const provenance = name.source === 'model-category' ? 'my model-proposed appearance word' :
      name.source === 'heard-category' ? `${name.speakerId}’s word, locally grounded by me` : 'retained individual name';
    add(parent, 'p', `Exact individual: ${objectId} · ${provenance}${historical ? ' · this annotation is not evidence the name was known at the time' : ''}`, 'provenance');
  } else add(parent, 'p', `Exact individual: ${objectId}`, 'provenance');
}
/** Old messages remain literal historical text. Only the selected listener's
 * present vocabulary can supply an explicitly current, secondary annotation. */
export function renderMessageNames(parent, npc, text) {
  const ids = [...new Set(String(text || '').match(/\bobject:[1-9][0-9]{0,8}\b/g) || [])].slice(0, 4);
  for (const id of ids) if (objectName(npc, id)) renderObjectName(parent, npc, id, { historical:true });
}
export function modelNamingStatus(enabled, desktop = true) {
  if (!desktop) return 'Local-model naming is available in the desktop application. No new names are invented while it is unavailable; existing names and offline learning remain usable.';
  return enabled ? 'Local model configured for conversation and tentative appearance names. Proposals may abstain or fail; physical experiments remain experiential.' :
    'Offline experiential learner. New model-chosen names are paused; existing names and observed similarity remain usable. No seeded naming fallback.';
}
// Include ownership and derived membership, not sample times: switching actors
// or changing cues refreshes present annotations without rewriting old text.
export function vocabularyDisplaySignature(npc) {
  return JSON.stringify({owner:npc?.id, categories:categoryLabels(npc).map(row =>
    [row.speakerId,row.token,row.members.map(member => member.objectId)]),
    individuals:lexicalLabels(npc).map(row => [row.speakerId,row.token,row.objectId])});
}
export function namingRequestStatus(status) {
  return ({pending:'Naming proposal pending; no word has been adopted yet.', accepted:'A local-model naming proposal was accepted.',
    'not-adopted':'The last naming proposal abstained or was not admissible; no fallback word was invented.',
    unavailable:'The last naming request was unavailable or failed; no fallback word was invented.',
    cancelled:'The naming request was cancelled; no pending reply can rename this world.',
    discarded:'A stale naming reply was discarded.', idle:'No naming proposal has run in this controller session.'})[status?.state] ||
    'No naming proposal has run in this controller session.';
}
/** A category is an actor's tentative word over remembered sensory examples,
 * not a global dictionary, taxonomic truth or permission to repeat an action. */
export function renderCategoryNames(parent, npc, agents = []) {
  const rows = categoryLabels(npc);
  if (!rows.length) return;
  add(parent, 'p', 'Tentative appearance names', 'eyebrow');
  add(parent, 'p', 'Words proposed by a local model or learned through local examples. Reuse follows a supplied exact shape, color and texture rule, not discovered species. Matching appearance never transfers food benefit, safety or actions.', 'small');
  for (const row of rows.slice(-8).reverse()) {
    const entry = add(parent, 'div', '', 'knowledge-entry');
    entry.dataset.categoryToken = row.token;
    entry.dataset.categorySpeaker = row.speakerId;
    entry.dataset.categorySource = row.source;
    add(entry, 'p', `“${row.token}” · tentative appearance category`);
    const speaker = agents.find(agent => agent.id === row.speakerId)?.name || row.speakerId;
    add(entry, 'p', row.source === 'own'
      ? `Model-proposed for my own observations${row.model ? ' · ' + row.model : ''}`
      : `Heard from ${speaker} · grounded in my own local example, not copied from their whole category`, 'provenance');
    add(entry, 'p', `${row.cues.shape} · ${row.cues.color} · ${row.cues.texture}`, 'small');
    for (const example of row.examples) add(entry, 'p', `Grounding example: ${example.objectId} · observed at ${example.times.map(String).join(', ')} simulation seconds`, 'provenance');
    for (const member of row.members) {
      const current = visualSampleCurrent(npc, member.objectId);
      const item = add(entry, 'p', `${member.objectId} · ${current ? 'current ordinary visual sample' : 'remembered only'} · ${member.times.length} matching observations`, 'provenance');
      item.dataset.categoryMember = member.objectId;
      item.dataset.categoryVisibility = current ? 'current' : 'remembered';
    }
    if (!row.members.length) add(entry, 'p', 'No retained matching members. The old name is preserved, but changed or missing cues do not retain its membership.', 'small');
    if (row.members.length > 1) add(entry, 'p', 'More than one matching individual: the word alone does not identify which one. A local pointing example or precise instance is still needed.', 'small');
    if (rows.some(other => other !== row && other.token === row.token &&
        (other.speakerId !== row.speakerId || JSON.stringify(other.cues) !== JSON.stringify(row.cues))))
      add(entry, 'p', 'This word has another attributed meaning. Keep the speaker and local example explicit; do not assume a shared definition.', 'small');
    add(entry, 'p', 'Membership is tentative and can change with observation. Remembered examples are not current sight; no bodily outcome belongs to every lookalike.', 'small');
  }
  if (rows.length > 8) add(parent, 'p', `Showing 8 of ${rows.length} retained appearance words. Other meanings remain in memory.`, 'small');
}
// Display retained lexical evidence only. A label is not a current sensory receipt.
export function renderGroundedNames(parent, npc, agents = []) {
  const rows = lexicalLabels(npc);
  if (!rows.length && !npc.lexicon?.saturated) return;
  add(parent, 'p', 'Names for individuals', 'eyebrow');
  add(parent, 'p', 'Personal names, not shared categories or food knowledge. Remembered labels require fresh sight for reference.', 'small');
  for (const row of rows.slice(-8).reverse()) {
    const entry = add(parent, 'div', '', 'knowledge-entry');
    entry.dataset.namingObject = row.objectId;
    entry.dataset.namingStatus = row.status;
    entry.dataset.namingSpeaker = row.speakerId;
    add(entry, 'p', `${row.token} · ${row.objectId}`);
    const speaker = agents.find(a => a.id === row.speakerId)?.name || row.speakerId;
    const status = row.status === 'owner-chosen' ? 'Chosen by me after my own encounter · legacy supplied token, not a model proposal' :
      row.status === 'confirmed' ? `Confirmed reference · I used ${speaker}’s name for this visible individual` :
      `Heard and locally grounded · ${speaker}’s name; later reference not confirmed`;
    add(entry, 'p', status, 'provenance');
    const sameWord = rows.filter(other => other.token === row.token);
    const speakerConflict = new Set(sameWord.filter(other => other.speakerId === row.speakerId).map(other => other.objectId)).size > 1;
    const unqualifiedConflict = new Set(sameWord.map(other => other.objectId)).size > 1;
    if (speakerConflict) add(entry, 'p', 'Conflicting referents for this speaker’s word; reference is currently ambiguous, including any historical confirmation.', 'small');
    else if (unqualifiedConflict) add(entry, 'p', 'This word has conflicting referents across speakers; name the speaker to disambiguate. Historical confirmation is not unqualified shared meaning.', 'small');
    add(entry, 'p', npc.discovery?.observations?.[row.objectId] ? describeRemembered(npc, row.objectId) : 'Sensory record unavailable; the name does not restore sight.', 'small');
  }
  if (rows.length > 8) add(parent, 'p', `Showing 8 of ${rows.length} retained names. Other names and conflicts remain in memory.`, 'small');
  if (npc.lexicon?.saturated) add(parent, 'p', 'New naming memory is full; reference checks unavailable.', 'small');
}
export function createNpcPanel({getNpc,getAgents,getController,getRuntime,getCommunity,selectAgent,renderer,getEnvironment,save,notify,getLearning=()=>null,getLearningError=()=>'',onClose=()=>{}}){
  const panel=$('npc-panel'),bridge=window.aincradAgent;
  const grounded=getRuntime().communicationMode==='grounded';
  if(grounded){$('journal-form').classList.add('hidden');$('journal-pending').classList.add('hidden');$('npc-model-explanation').closest('details').classList.add('hidden');$('journal-conversation').querySelector('.eyebrow').textContent='LEARNED COMMUNICATION';$('journal-conversation').querySelector('p').textContent='Actual symbol emissions and personal outcomes. English labels below are for you, not messages sent to agents.';}
  let visible=false,lastRefresh=-1,tab='character',seenMessageId=0,replyTo=null,lastMessageSignature='';
  function close(){visible=false;renderer.inspectorOpen=false;$('app').dataset.inspecting='false';panel.classList.add('hidden');$('world').focus();onClose();}
  function toggle(){visible=!visible;renderer.inspectorOpen=visible;$('app').dataset.inspecting=String(visible);panel.classList.toggle('hidden',!visible);if(visible){lastRefresh=-1;update(performance.now()/1000);$('close-npc').focus();}else {$('world').focus();onClose();}}
  $('open-npc').addEventListener('click',toggle);$('npc-short').addEventListener('click',toggle);$('close-npc').addEventListener('click',close);
  function changeTab(next){tab=next;panel.dataset.journalTab=next;for(const name of ['character','conversation','notes']){$('journal-'+name).classList.toggle('hidden',name!==tab);$('npc-tab-'+name).setAttribute('aria-pressed',String(name===tab));}lastRefresh=-1;update(performance.now()/1000);}
  for(const name of ['character','conversation','notes'])$('npc-tab-'+name).addEventListener('click',()=>changeTab(name));
  $('npc-select').addEventListener('change',()=>{selectAgent($('npc-select').value);lastRefresh=-1;update(performance.now()/1000);});
  function follow(enabled){renderer.followNpc=enabled;renderer.followId=getNpc().id;$('follow-npc').textContent=enabled?'Follow your avatar':'Follow '+getNpc().name;if(enabled)renderer.snap(getNpc().position);$('world').focus();}
  $('follow-npc').addEventListener('click',()=>follow(!renderer.followNpc));
  $('npc-numeric-debug').addEventListener('change',()=>{$('npc-condition').classList.toggle('hidden',!$('npc-numeric-debug').checked);lastRefresh=-1;});
  $('npc-rescue-presentation').addEventListener('change',()=>{const n=getNpc();n.rescuePresentation=$('npc-rescue-presentation').value==='quiet'?'quiet':'divine';recordEvent(n,'debug',{setting:'rescue presentation',value:n.rescuePresentation,provenance:'debug'});save();});
  $('npc-learning').addEventListener('change',()=>{const n=getNpc();n.learning=$('npc-learning').checked;n.skillRun=null;getController().cancel();recordEvent(n,'debug',{setting:'persistent learning',value:n.learning,provenance:'debug'});save();});
  $('npc-demonstrate').addEventListener('click',()=>{const n=getNpc();if(demonstrateCollapse(n)){save();notify(`Developer demonstration: ${n.name} has collapsed. Her identity and experience will be retained.`);}else notify(n.name+' is already unconscious or recovering.');});
  function configureWorld(){const env=getEnvironment(),hour=$('world-hour').value,weather=$('world-weather-control').value;env.settings.hourOverride=hour==='auto'?null:Number(hour);env.settings.weatherOverride=WEATHER_KINDS.includes(weather)?weather:null;getRuntime().cancel();for(const n of getAgents())recordEvent(n,'debug',{setting:'world conditions',value:{...env.settings},provenance:'debug'});save();notify('Test conditions changed. Body effects advance only while the world is running.');}
  $('world-hour').addEventListener('change',configureWorld);$('world-weather-control').addEventListener('change',configureWorld);
  function useProvider(config){getRuntime().setProviderFactory(n=>config.enabled?new DesktopModelProvider(bridge,config.model,n.id):new LocalLearnerProvider());}
  async function configure(enabled){if(grounded)return;try{if(!bridge)throw new Error('Local model conversation and naming are available in the desktop application.');getRuntime().cancel();const config=await bridge.configure({enabled,endpoint:enabled?$('npc-endpoint').value:'http://127.0.0.1:11434/v1',model:enabled?$('npc-model').value:''});useProvider(config);$('model-status').textContent=modelNamingStatus(enabled);save();}catch(error){$('model-status').textContent=error.message;}}
  $('connect-model').addEventListener('click',()=>configure(true));$('offline-controller').addEventListener('click',()=>configure(false));
  if(bridge&&!grounded)bridge.status().then(status=>{$('npc-endpoint').value=status.endpoint;$('npc-model').value=status.model;if(status.enabled)useProvider(status);$('model-status').textContent=modelNamingStatus(status.enabled);}).catch(error=>{$('model-status').textContent=error.message;});
  else{$('connect-model').disabled=true;$('offline-controller').disabled=true;$('model-status').textContent=modelNamingStatus(false,false);}
  $('journal-form').addEventListener('submit',event=>{event.preventDefault();if(grounded)return;const text=$('journal-message').value.trim();if(!text)return;const result=getRuntime().social.postUserMessage(text,{to:$('journal-recipient').value,replyTo});if(!result.ok){$('journal-send-status').textContent='Message was not sent: '+title(result.code);return;}$('journal-message').value='';replyTo=null;$('journal-send-status').textContent='Message sent. They can respond when their needs allow.';save();lastMessageSignature='';lastRefresh=-1;update(performance.now()/1000);});
  $('journal-message').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();$('journal-form').requestSubmit();}});
  $('journal-recipient').addEventListener('change',()=>{if(replyTo){replyTo=null;$('journal-send-status').textContent='Writing a new message.';}});
  function drawMap(n){
    const canvas=$('npc-map'),g=canvas.getContext('2d'),size=canvas.width,half=720,scale=size/(half*2);g.fillStyle='#24372d';g.fillRect(0,0,size,size);
    const cells=n.scene==='valley'?n.memory.cells||{}:n.memory.caveCells?.[n.scene]||{};
    for(const c of Object.values(cells)){const x=(c.x-n.position.x+half)*scale,y=(c.y-n.position.y+half)*scale;if(x<-20||y<-20||x>size||y>size)continue;g.fillStyle=c.walkable?'#7c9b4a':c.terrain==='water'||c.terrain==='shallows'?'#4799aa':'#805932';g.globalAlpha=n.elapsed-c.observedAt>60?.45:.9;g.fillRect(x-8,y-8,NPC_RULES.tileSize*scale-1,NPC_RULES.tileSize*scale-1);}g.globalAlpha=1;
    const points=n.scene==='valley'?[...Object.values(n.memory.sources).map(s=>({...s,color:s.available?'#83d1e9':'#d3846e'})),...Object.values(n.discovery?.observations||{}).filter(o=>o.scene===n.scene).map(o=>({...o.position,color:'#d6b38c'})),...Object.values(n.memory.shelters).map(s=>({...s,color:'#e6bc58'}))]:[];
    for(const s of points){const x=(s.x-n.position.x+half)*scale,y=(s.y-n.position.y+half)*scale;if(x<0||y<0||x>size||y>size)continue;g.fillStyle=s.color;g.fillRect(Math.round(x)-2,Math.round(y)-2,5,5);}g.fillStyle='#fff0c1';g.fillRect(size/2-2,size/2-2,5,5);
  }
  function updateConversation(){
    if(grounded){
      $('journal-unread').textContent='';
      if(visible&&tab==='conversation'){try{renderLearningView($('journal-messages'),getLearning()?.snapshot(),getNpc().id,getLearningError(),getRuntime().social.foodSharing?.gestures?.()||[],survivalDecisionSnapshot(getNpc()));}catch{renderLearningView($('journal-messages'),null,getNpc().id,'Observer refresh failed.',[],survivalDecisionSnapshot(getNpc()));}}
      const notes=$('npc-field-notes');notes.replaceChildren();add(notes,'p','Archived field notes are inert historical records; they are not read by agents.','small');
      for(const message of (getCommunity().messages||[]).slice(-40)){const entry=add(notes,'article','','journal-entry');entry.dataset.sender=message.senderId;add(entry,'p',message.text);add(entry,'p','Archived English message · inert; not a current agent utterance','small');}
      for(const note of (getCommunity().notes||[]).slice(-20).reverse()){const node=add(notes,'article','','field-note');add(node,'h3',note.title);add(node,'p',note.text);}
      return;
    }
    const community=getCommunity(),messages=community.messages||[],last=messages.at(-1),pending=Object.values(community.questions||{}).filter(q=>q.status==='pending');
    const unseen=messages.filter(m=>serial(m.id)>seenMessageId&&m.senderId!=='human').length;if(visible&&tab==='conversation')seenMessageId=serial(last?.id);$('journal-unread').textContent=visible&&tab==='conversation'?'':unseen?'('+unseen+')':'';
    $('journal-pending').textContent=pending.length?pending.map(q=>q.text).join(' · ')+' · Replies are optional.':'No reply is required. This conversation stays open.';
    const signature=messages.length+':'+(last?.id||0)+':'+(last?.text||'')+':'+vocabularyDisplaySignature(getNpc());if(lastMessageSignature!==signature){lastMessageSignature=signature;const list=$('journal-messages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<35;list.replaceChildren();if(!messages.length)add(list,'p','No messages yet. Leave a note, or let them meet and explore.','small');
      for(const message of messages.slice(-80)){const entry=add(list,'div','', 'journal-entry');entry.dataset.sender=message.senderId;const sender=message.senderId==='human'?'You':getAgents().find(n=>n.id===message.senderId)?.name||'Journal';const recipient=message.recipientId==='human'?'you':message.recipientId==='all'?'everyone':getAgents().find(n=>n.id===message.recipientId)?.name||'';add(entry,'div',`${sender}${recipient?' → '+recipient:''} · ${message.teaching?'nearby · taught procedure':message.channel==='peer'?'nearby':message.channel==='note'?'field note':'journal'}${message.offline?' · offline learner':''}`,'message-meta');add(entry,'p',message.text);renderMessageNames(entry,getNpc(),message.text);
        if(message.senderId!=='human'&&message.kind==='question'){const button=add(entry,'button','Reply');button.type='button';button.addEventListener('click',()=>{replyTo=message.id;$('journal-recipient').value=message.senderId;$('journal-send-status').textContent='Replying to '+sender+'’s question.';$('journal-message').focus();});}}
      if(nearBottom)list.scrollTop=list.scrollHeight;
    }
    const notes=$('npc-field-notes');notes.replaceChildren();if(!community.notes?.length)add(notes,'p','No field notes have been left yet.','small');
    for(const note of (community.notes||[]).slice(-20).reverse()){const node=add(notes,'article','', 'field-note');add(node,'h3',note.title);add(node,'div',`${getAgents().find(n=>n.id===note.authorId)?.name||note.authorId} · ${note.scene==='valley'?'in the valley':note.scene}`,'small');add(node,'p',note.text);renderMessageNames(node,getNpc(),note.text);}
  }
  function renderDiscovery(n,skills){
    const d=n.discovery||{},knowledge=$('npc-object-knowledge'),experiments=$('npc-experiments');knowledge.replaceChildren();experiments.replaceChildren();
    if(grounded)add(knowledge,'p','Observer descriptions. Old names and received reports below are archival and inert, not current language.','small');
    renderCategoryNames(knowledge,n,getAgents());
    renderGroundedNames(knowledge,n,getAgents());
    renderVisualGroups(knowledge,n);
    renderObservationalInquiries(knowledge,n,getAgents());
    renderHandlingInquiries(knowledge,n);
    const effects=d.effects||[],reports=d.reports||[];
    if(!effects.length&&!reports.length)add(knowledge,'p','No bodily effects or reported techniques retained yet.','small');
    for(const effect of effects.slice(-8).reverse()){const entry=add(knowledge,'div','', 'knowledge-entry');renderObjectName(entry,n,effect.objectId,{historical:true});add(entry,'p',describeRemembered(n,effect.objectId));add(entry,'p',`Experienced: ${effect.effect}${effect.hunger==='easing'?' · hunger easing':''}${effect.thirst==='easing'?' · thirst easing':''}${effect.energy==='easing'?' · energy easing':''}`,'small');add(entry,'p','Supported by a physically executed sample and later bodily feedback.','provenance');}
    for(const report of reports.slice(-6).reverse()){const entry=add(knowledge,'div','', 'knowledge-entry');const author=report.sourceId==='human'?'You':getAgents().find(a=>a.id===report.sourceId)?.name||'Another character';add(entry,'p',report.text);renderMessageNames(entry,n,report.text);if(report.teaching?.transfer){const transfer=report.teaching.transfer;add(entry,'p',`Heard appearance-based trial · teacher source ${report.teaching.sourceObjectId}${transfer.targetObjectId?` · my locally observed candidate ${transfer.targetObjectId}`:' · no local candidate bound'}. Similar appearance does not establish safety or benefit. Only my own paid trial and later bodily feedback can test it.`,'small');}if(report.sourceId==='human')add(entry,'p',humanHintHelp(report),'small');add(entry,'p',report.teaching?`Taught by ${author} · heard ${Math.floor(Math.max(0,n.elapsed-report.teaching.receivedAt))}s ago · ${title(report.teaching.acquisition)} → Sample · ${peerTeachingLabel(report,n.elapsed)}. Advice does not grant proficiency.`:`${author} reported this · ${report.status||'unverified'}. Advice does not grant proficiency.`,'provenance');}
    if(!d.experiments?.length)add(experiments,'p','No object experiments have been completed.','small');
    for(const experiment of (d.experiments||[]).slice(-8).reverse()){const entry=add(experiments,'div','', 'knowledge-entry');renderObjectName(entry,n,experiment.targetId,{historical:true});add(entry,'p',`${title(experiment.primitive)} · ${describeRemembered(n,experiment.targetId)}`);add(entry,'p',`${experiment.ok?'Executed':'Attempt failed'} · ${title(experiment.code)}`,'provenance');}
    if(!d.techniques?.length)add(skills,'p','No useful multi-step technique has been established yet.','small');
    for(const technique of d.techniques||[]){const details=add(skills,'details','');add(details,'summary',namedObject(n,technique.sourceId)+' · '+technique.confidence);renderObjectName(details,n,technique.sourceId,{historical:true});add(details,'p',describeRemembered(n,technique.sourceId),'small');add(details,'p',technique.steps.map(step=>title(step.type)).join(' → '),'small');add(details,'p',`${technique.successes||0} successful repetitions · ${technique.failures||0} failures · ${technique.evidence?.length||0} retained experimental outcomes.`,'small');add(details,'p','Bodily benefit and manipulation proficiency are tracked separately.','small');}
    const practice=Object.entries(d.practice||{});if(practice.length){add(skills,'p','Practice from physical attempts','eyebrow');for(const [primitive,record] of practice)add(skills,'p',`${title(primitive.split('|')[0])}: ${record.successes||0} executed successes · ${record.failures||0} failed attempts`,'small');}
  }
  function update(now){
    if(now-lastRefresh<.5)return;lastRefresh=now;const n=getNpc(),env=getEnvironment(),b=bodySignals(n),s=sensedEnvironment(n),c=n.cognition||{};
    $('npc-short').textContent=getAgents().map(a=>{const signals=bodySignals(a);return `${a.name} · ${signals.activity==='awake'?signals.overall:signals.activity} · ${signals.hunger}`;}).join('\n');$('npc-short').dataset.condition=b.overall==='urgent'?'critical':n.lifecycle==='COLLAPSED'?'collapsed':n.lifecycle==='RECOVERING'?'recovering':b.overall==='uncomfortable'?'thirsty':'healthy';updateConversation();if(!visible)return;
    $('npc-name').textContent=n.name;$('npc-lifecycle').textContent=title(n.lifecycle.toLowerCase());$('npc-select').value=n.id;$('follow-npc').textContent=renderer.followNpc?'Follow your avatar':'Follow '+n.name;
    $('npc-feelings').textContent=`${title(b.overall)}${b.relief!=='none'?' · '+b.relief:''}. ${b.activity==='sleeping'?'She is sleeping and cannot see her surroundings.':b.activity==='dozing'?'She is settling into sleep.':b.activity==='resting'?'She is taking a rest.':''}`;
    const body=$('npc-body-list');body.replaceChildren();const sensations=[['Hunger','hunger'],['Thirst','thirst'],['Temperature','thermal'],['Energy','energy'],['Breathing','stamina'],['Fatigue','fatigue'],['Alertness','sleepiness'],['Pain','pain']];if(b.digestion)sensations.push(['Digestion','digestion']);if(b.sleep)sensations.push(['Sleep state','sleep']);for(const [label,key] of sensations){const cell=add(body,'div','');add(cell,'span',label);add(cell,'b',title(b[key]));}
    $('npc-environment').textContent=`${title(s.timeOfDay)} · ${s.weather} · ${s.warmth} · ${s.shelter} · ${b.wetness}`;$('npc-flask').textContent=n.flask.water<=.00001?'empty':n.flask.water>.75?'full':'some water';
    $('npc-expedition-mode').textContent=grounded?'Aincrad · personal experiments and physical observation.':'Aincrad · techniques come from experiments and attributed advice.';$('npc-carried-items').classList.remove('hidden');$('npc-discovery-details').classList.remove('hidden');
    {const items=$('npc-carried-items');items.replaceChildren();if(grounded)add(items,'p','Item labels below are observer descriptions or archived names, not current agent vocabulary.','small');if(!n.inventory.items?.length)add(items,'p','Her hands are empty.','small');for(const id of n.inventory.items||[]){renderObjectName(items,n,id);add(items,'p',describeRemembered(n,id));}}
    const drives=$('npc-drives');drives.replaceChildren();for(const [name,drive] of Object.entries(c.drives||{})){const item=add(drives,'span',title(name)+' · '+drive.tension);item.title=drive.reason||'';}
    const plan=c.plan;const planState=plan?.status==='active'?'Her intention':plan?.status==='completed'&&plan.goalVerified!==true?'Steps finished; goal unverified':title(plan?.status);$('npc-goal').textContent=plan?`${planState}: ${plan.goal}`:'She is feeling her body and investigating her surroundings.';const steps=$('npc-plan');steps.replaceChildren();if(plan)for(let i=0;i<plan.steps.length;i++){const step=plan.steps[i];add(steps,'li',`${i===plan.cursor&&plan.status==='active'?'Now: ':''}${title(step.type)}${step.targetId?' · '+describeRemembered(n,step.targetId):step.sourceId?' at remembered water':step.shelterId?' at remembered shelter':''}`,i<plan.cursor?'done':'');}
    $('npc-current').textContent=n.active?'Current activity: '+title(n.active.request.type):getController().pending?'Considering a local model response; bodily care continues.':'Choosing her next activity.';$('npc-controller').textContent=grounded?'Experiential actions · learned symbols; English communication disabled':'Experiential actions · '+(getController().provider.kind==='local-model'?'model conversation and naming':'offline dialogue; new naming paused');$('npc-decision').textContent=/balancing food [\d.]+/.test(n.decision)?'Her next activity follows bodily sensations and remembered outcomes.':n.decision;
    $('npc-counts').textContent=`${n.discovery?.experiments?.length||0} retained experiments · ${n.discovery?.techniques?.length||0} learned techniques · ${n.stats.collapses} collapses`;$('npc-rescuer').textContent=`Last rescuer: ${n.stats.lastRescuer||'none'}. Received care is distinct from independent survival.`;
    const beliefs=$('npc-beliefs');beliefs.replaceChildren();if(grounded)add(beliefs,'li','Observer memory summaries; received English claims are archival and inert.');if(!c.beliefs?.length)add(beliefs,'li','No retained beliefs yet.');for(const belief of (c.beliefs||[]).slice(-12).reverse())add(beliefs,'li',`${belief.source} · ${belief.status}: ${belief.text}`);
    $('npc-map-legend').textContent='Dark tiles are unknown. Water and steep ground come from local observations; parchment marks observed objects.';
    for(const [id,table,label] of [['npc-sources','sources','No water discovered yet.'],['npc-foods','foods','No objects remembered yet.'],['npc-shelters','shelters','No shelter discovered yet.']]){const list=$(id);list.replaceChildren();if(table==='foods'){const objects=Object.values(n.discovery?.observations||{}).slice(-8);if(!objects.length)add(list,'li',label);for(const item of objects)add(list,'li',namedObject(n,item.id)+' · '+objectDescription(item)+' · '+(item.scene===n.scene?'remembered in this scene':'remembered in another place'));continue;}const known=Object.values(n.memory[table]).slice(-8);if(!known.length)add(list,'li',label);for(const item of known)add(list,'li',`${item.name||item.id} · ${table==='shelters'?'remembered entrance':item.available?'last observed accessible':'last observed unavailable'}`);}drawMap(n);
    const skills=$('npc-skills');skills.replaceChildren();renderDiscovery(n,skills);
    const history=$('npc-history');history.replaceChildren();for(const event of n.memory.experience.slice(-12).reverse()){const d=event.details;add(history,'p',`${title(event.type)} · ${title(d.result?.code||d.code||d.skillId||d.setting||'remembered outcome')}`,'small');}const lesson=n.memory.lessons.at(-1);$('npc-lesson').textContent=lesson?`${lesson.verified} ${lesson.hypothesis}`:'Consequences and observations support learning; untested ideas stay uncertain.';
    $('world-hour').value=env.settings.hourOverride===null?'auto':String(env.settings.hourOverride);$('world-weather-control').value=env.settings.weatherOverride||'auto';$('npc-rescue-presentation').value=n.rescuePresentation;$('npc-learning').checked=n.learning;
    $('npc-model-explanation').textContent=namingRequestStatus(getController().namingStatus)+' Physical actions remain grounded. Exact-object human suggestions and nearby peer teaching can guide paid trials, not grant food knowledge or proficiency. A local model can propose tentative appearance words; the supplied exact-cue rule reuses them. Pretrained associations are not observations, species truth or food safety. Proposals and prose do not retrain model weights.';
    $('npc-condition').classList.toggle('hidden',!$('npc-numeric-debug').checked);if($('npc-numeric-debug').checked){for(const [id,key] of [['hydration','hydration'],['nourishment','nourishment'],['health','health']]){$('npc-'+id).value=n[key];$('npc-'+id+'-value').textContent=n[key].toFixed(1)+' / 100';}$('npc-heat').textContent=n.thermal.hot.toFixed(1);$('npc-cold').textContent=n.thermal.cold.toFixed(1);$('npc-energy-debug').textContent=n.energy.toFixed(1);$('npc-stamina-debug').textContent=n.stamina.toFixed(1);$('npc-fatigue-debug').textContent=n.fatigue.toFixed(1);$('npc-sleep-debug').textContent=n.sleepPressure.toFixed(1);$('npc-survival').textContent='Physiology advances in game hours and days. Starvation and dehydration follow different accumulated deficits; there is no fixed lifespan countdown.';}
  }
  return {toggle,close,update,follow,changeTab,openLearning(){if(!visible)toggle();changeTab('conversation');},isVisible:()=>visible};
}
