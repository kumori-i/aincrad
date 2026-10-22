import { peerTeachingLabel } from './peer-teaching.js';
import { observationalInquiries } from './observational-learning.js';
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
export function createNpcPanel({getNpc,getAgents,getController,getRuntime,getCommunity,selectAgent,renderer,getEnvironment,save,notify}){
  const panel=$('npc-panel'),bridge=window.aincradAgent;
  let visible=false,lastRefresh=-1,tab='character',seenMessageId=0,replyTo=null,lastMessageSignature='';
  function close(){visible=false;renderer.inspectorOpen=false;$('app').dataset.inspecting='false';panel.classList.add('hidden');$('world').focus();}
  function toggle(){visible=!visible;renderer.inspectorOpen=visible;$('app').dataset.inspecting=String(visible);panel.classList.toggle('hidden',!visible);if(visible){lastRefresh=-1;update(performance.now()/1000);$('close-npc').focus();}else $('world').focus();}
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
  async function configure(enabled){try{if(!bridge)throw new Error('Local model conversation is available in the desktop application.');getRuntime().cancel();const config=await bridge.configure({enabled,endpoint:enabled?$('npc-endpoint').value:'http://127.0.0.1:11434/v1',model:enabled?$('npc-model').value:''});useProvider(config);$('model-status').textContent=enabled?'Local model conversation enabled. Physical experiments remain experiential.':'Both characters use the offline experiential learner.';save();}catch(error){$('model-status').textContent=error.message;}}
  $('connect-model').addEventListener('click',()=>configure(true));$('offline-controller').addEventListener('click',()=>configure(false));
  if(bridge)bridge.status().then(status=>{$('npc-endpoint').value=status.endpoint;$('npc-model').value=status.model;if(status.enabled)useProvider(status);}).catch(error=>{$('model-status').textContent=error.message;});
  else{$('connect-model').disabled=true;$('offline-controller').disabled=true;}
  $('journal-form').addEventListener('submit',event=>{event.preventDefault();const text=$('journal-message').value.trim();if(!text)return;const result=getRuntime().social.postUserMessage(text,{to:$('journal-recipient').value,replyTo});if(!result.ok){$('journal-send-status').textContent='Message was not sent: '+title(result.code);return;}$('journal-message').value='';replyTo=null;$('journal-send-status').textContent='Message sent. They can respond when their needs allow.';save();lastMessageSignature='';lastRefresh=-1;update(performance.now()/1000);});
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
    const community=getCommunity(),messages=community.messages||[],last=messages.at(-1),pending=Object.values(community.questions||{}).filter(q=>q.status==='pending');
    const unseen=messages.filter(m=>serial(m.id)>seenMessageId&&m.senderId!=='human').length;if(visible&&tab==='conversation')seenMessageId=serial(last?.id);$('journal-unread').textContent=visible&&tab==='conversation'?'':unseen?'('+unseen+')':'';
    $('journal-pending').textContent=pending.length?pending.map(q=>q.text).join(' · ')+' · Replies are optional.':'No reply is required. This conversation stays open.';
    const signature=messages.length+':'+(last?.id||0)+':'+(last?.text||'');if(lastMessageSignature!==signature){lastMessageSignature=signature;const list=$('journal-messages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<35;list.replaceChildren();if(!messages.length)add(list,'p','No messages yet. Leave a note, or let them meet and explore.','small');
      for(const message of messages.slice(-80)){const entry=add(list,'div','', 'journal-entry');entry.dataset.sender=message.senderId;const sender=message.senderId==='human'?'You':getAgents().find(n=>n.id===message.senderId)?.name||'Journal';const recipient=message.recipientId==='human'?'you':message.recipientId==='all'?'everyone':getAgents().find(n=>n.id===message.recipientId)?.name||'';add(entry,'div',`${sender}${recipient?' → '+recipient:''} · ${message.teaching?'nearby · taught procedure':message.channel==='peer'?'nearby':message.channel==='note'?'field note':'journal'}${message.offline?' · offline learner':''}`,'message-meta');add(entry,'p',message.text);
        if(message.senderId!=='human'&&message.kind==='question'){const button=add(entry,'button','Reply');button.type='button';button.addEventListener('click',()=>{replyTo=message.id;$('journal-recipient').value=message.senderId;$('journal-send-status').textContent='Replying to '+sender+'’s question.';$('journal-message').focus();});}}
      if(nearBottom)list.scrollTop=list.scrollHeight;
    }
    const notes=$('npc-field-notes');notes.replaceChildren();if(!community.notes?.length)add(notes,'p','No field notes have been left yet.','small');
    for(const note of (community.notes||[]).slice(-20).reverse()){const node=add(notes,'article','', 'field-note');add(node,'h3',note.title);add(node,'div',`${getAgents().find(n=>n.id===note.authorId)?.name||note.authorId} · ${note.scene==='valley'?'in the valley':note.scene}`,'small');add(node,'p',note.text);}
  }
  function renderDiscovery(n,skills){
    const d=n.discovery||{},knowledge=$('npc-object-knowledge'),experiments=$('npc-experiments');knowledge.replaceChildren();experiments.replaceChildren();
    renderObservationalInquiries(knowledge,n,getAgents());
    const effects=d.effects||[],reports=d.reports||[];
    if(!effects.length&&!reports.length)add(knowledge,'p','No bodily effects or reported techniques retained yet.','small');
    for(const effect of effects.slice(-8).reverse()){const entry=add(knowledge,'div','', 'knowledge-entry');add(entry,'p',describeRemembered(n,effect.objectId));add(entry,'p',`Experienced: ${effect.effect}${effect.hunger==='easing'?' · hunger easing':''}${effect.thirst==='easing'?' · thirst easing':''}${effect.energy==='easing'?' · energy easing':''}`,'small');add(entry,'p','Supported by a physically executed sample and later bodily feedback.','provenance');}
    for(const report of reports.slice(-6).reverse()){const entry=add(knowledge,'div','', 'knowledge-entry');const author=report.sourceId==='human'?'You':getAgents().find(a=>a.id===report.sourceId)?.name||'Another character';add(entry,'p',report.text);if(report.teaching?.transfer){const transfer=report.teaching.transfer;add(entry,'p',`Heard appearance-based trial · teacher source ${report.teaching.sourceObjectId}${transfer.targetObjectId?` · my locally observed candidate ${transfer.targetObjectId}`:' · no local candidate bound'}. Similar appearance does not establish safety or benefit. Only my own paid trial and later bodily feedback can test it.`,'small');}if(report.sourceId==='human'&&!report.proposed?.length&&/\b(kill|catch|strike|pull|sample|hit|eat|pick)\b/i.test(report.text))add(entry,'p','No executable target recognized. Name an observed object ID or a unique visible description and an operation to try.','small');add(entry,'p',report.teaching?`Taught by ${author} · heard ${Math.floor(Math.max(0,n.elapsed-report.teaching.receivedAt))}s ago · ${title(report.teaching.acquisition)} → Sample · ${peerTeachingLabel(report,n.elapsed)}. Advice does not grant proficiency.`:`${author} reported this · ${report.status||'unverified'}. Advice does not grant proficiency.`,'provenance');}
    if(!d.experiments?.length)add(experiments,'p','No object experiments have been completed.','small');
    for(const experiment of (d.experiments||[]).slice(-8).reverse()){const entry=add(experiments,'div','', 'knowledge-entry');add(entry,'p',`${title(experiment.primitive)} · ${describeRemembered(n,experiment.targetId)}`);add(entry,'p',`${experiment.ok?'Executed':'Attempt failed'} · ${title(experiment.code)}`,'provenance');}
    if(!d.techniques?.length)add(skills,'p','No useful multi-step technique has been established yet.','small');
    for(const technique of d.techniques||[]){const details=add(skills,'details','');add(details,'summary',describeRemembered(n,technique.sourceId)+' · '+technique.confidence);add(details,'p',technique.steps.map(step=>title(step.type)).join(' → '),'small');add(details,'p',`${technique.successes||0} successful repetitions · ${technique.failures||0} failures · ${technique.evidence?.length||0} retained experimental outcomes.`,'small');add(details,'p','Bodily benefit and manipulation proficiency are tracked separately.','small');}
    const practice=Object.entries(d.practice||{});if(practice.length){add(skills,'p','Practice from physical attempts','eyebrow');for(const [primitive,record] of practice)add(skills,'p',`${title(primitive.split('|')[0])}: ${record.successes||0} executed successes · ${record.failures||0} failed attempts`,'small');}
  }
  function update(now){
    if(now-lastRefresh<.5)return;lastRefresh=now;const n=getNpc(),env=getEnvironment(),b=bodySignals(n),s=sensedEnvironment(n),c=n.cognition||{};
    $('npc-short').textContent=getAgents().map(a=>{const signals=bodySignals(a);return `${a.name} · ${signals.activity==='awake'?signals.overall:signals.activity} · ${signals.hunger}`;}).join('\n');$('npc-short').dataset.condition=b.overall==='urgent'?'critical':n.lifecycle==='COLLAPSED'?'collapsed':n.lifecycle==='RECOVERING'?'recovering':b.overall==='uncomfortable'?'thirsty':'healthy';updateConversation();if(!visible)return;
    $('npc-name').textContent=n.name;$('npc-lifecycle').textContent=title(n.lifecycle.toLowerCase());$('npc-select').value=n.id;$('follow-npc').textContent=renderer.followNpc?'Follow your avatar':'Follow '+n.name;
    $('npc-feelings').textContent=`${title(b.overall)}${b.relief!=='none'?' · '+b.relief:''}. ${b.activity==='sleeping'?'She is sleeping and cannot see her surroundings.':b.activity==='dozing'?'She is settling into sleep.':b.activity==='resting'?'She is taking a rest.':''}`;
    const body=$('npc-body-list');body.replaceChildren();const sensations=[['Hunger','hunger'],['Thirst','thirst'],['Temperature','thermal'],['Energy','energy'],['Breathing','stamina'],['Fatigue','fatigue'],['Alertness','sleepiness'],['Pain','pain']];if(b.digestion)sensations.push(['Digestion','digestion']);if(b.sleep)sensations.push(['Sleep state','sleep']);for(const [label,key] of sensations){const cell=add(body,'div','');add(cell,'span',label);add(cell,'b',title(b[key]));}
    $('npc-environment').textContent=`${title(s.timeOfDay)} · ${s.weather} · ${s.warmth} · ${s.shelter} · ${b.wetness}`;$('npc-flask').textContent=n.flask.water<=.00001?'empty':n.flask.water>.75?'full':'some water';
    $('npc-expedition-mode').textContent='Aincrad · techniques come from experiments and attributed advice.';$('npc-carried-items').classList.remove('hidden');$('npc-discovery-details').classList.remove('hidden');
    {const items=$('npc-carried-items');items.replaceChildren();if(!n.inventory.items?.length)add(items,'p','Her hands are empty.','small');for(const id of n.inventory.items||[])add(items,'p',describeRemembered(n,id));}
    const drives=$('npc-drives');drives.replaceChildren();for(const [name,drive] of Object.entries(c.drives||{})){const item=add(drives,'span',title(name)+' · '+drive.tension);item.title=drive.reason||'';}
    const plan=c.plan;const planState=plan?.status==='active'?'Her intention':plan?.status==='completed'&&plan.goalVerified!==true?'Steps finished; goal unverified':title(plan?.status);$('npc-goal').textContent=plan?`${planState}: ${plan.goal}`:'She is feeling her body and investigating her surroundings.';const steps=$('npc-plan');steps.replaceChildren();if(plan)for(let i=0;i<plan.steps.length;i++){const step=plan.steps[i];add(steps,'li',`${i===plan.cursor&&plan.status==='active'?'Now: ':''}${title(step.type)}${step.targetId?' · '+describeRemembered(n,step.targetId):step.sourceId?' at remembered water':step.shelterId?' at remembered shelter':''}`,i<plan.cursor?'done':'');}
    $('npc-current').textContent=n.active?'Current activity: '+title(n.active.request.type):getController().pending?'Considering a local model response; bodily care continues.':'Choosing her next activity.';$('npc-controller').textContent='Experiential actions · '+(getController().provider.kind==='local-model'?'model conversation':'offline dialogue');$('npc-decision').textContent=/balancing food [\d.]+/.test(n.decision)?'Her next activity follows bodily sensations and remembered outcomes.':n.decision;
    $('npc-counts').textContent=`${n.discovery?.experiments?.length||0} retained experiments · ${n.discovery?.techniques?.length||0} learned techniques · ${n.stats.collapses} collapses`;$('npc-rescuer').textContent=`Last rescuer: ${n.stats.lastRescuer||'none'}. Received care is distinct from independent survival.`;
    const beliefs=$('npc-beliefs');beliefs.replaceChildren();if(!c.beliefs?.length)add(beliefs,'li','No retained beliefs yet.');for(const belief of (c.beliefs||[]).slice(-12).reverse())add(beliefs,'li',`${belief.source} · ${belief.status}: ${belief.text}`);
    $('npc-map-legend').textContent='Dark tiles are unknown. Water and steep ground come from local observations; parchment marks observed objects.';
    for(const [id,table,label] of [['npc-sources','sources','No water discovered yet.'],['npc-foods','foods','No objects remembered yet.'],['npc-shelters','shelters','No shelter discovered yet.']]){const list=$(id);list.replaceChildren();if(table==='foods'){const objects=Object.values(n.discovery?.observations||{}).slice(-8);if(!objects.length)add(list,'li',label);for(const item of objects)add(list,'li',item.id+' · '+objectDescription(item)+' · '+(item.scene===n.scene?'remembered in this scene':'remembered in another place'));continue;}const known=Object.values(n.memory[table]).slice(-8);if(!known.length)add(list,'li',label);for(const item of known)add(list,'li',`${item.name||item.id} · ${table==='shelters'?'remembered entrance':item.available?'last observed accessible':'last observed unavailable'}`);}drawMap(n);
    const skills=$('npc-skills');skills.replaceChildren();renderDiscovery(n,skills);
    const history=$('npc-history');history.replaceChildren();for(const event of n.memory.experience.slice(-12).reverse()){const d=event.details;add(history,'p',`${title(event.type)} · ${title(d.result?.code||d.code||d.skillId||d.setting||'remembered outcome')}`,'small');}const lesson=n.memory.lessons.at(-1);$('npc-lesson').textContent=lesson?`${lesson.verified} ${lesson.hypothesis}`:'Consequences and observations support learning; untested ideas stay uncertain.';
    $('world-hour').value=env.settings.hourOverride===null?'auto':String(env.settings.hourOverride);$('world-weather-control').value=env.settings.weatherOverride||'auto';$('npc-rescue-presentation').value=n.rescuePresentation;$('npc-learning').checked=n.learning;
    $('npc-model-explanation').textContent='Physical actions remain grounded. Exact-object human suggestions and nearby peer teaching can guide paid trials, not grant food knowledge or proficiency. Optional local-model prose is not proof and does not retrain model weights.';
    $('npc-condition').classList.toggle('hidden',!$('npc-numeric-debug').checked);if($('npc-numeric-debug').checked){for(const [id,key] of [['hydration','hydration'],['nourishment','nourishment'],['health','health']]){$('npc-'+id).value=n[key];$('npc-'+id+'-value').textContent=n[key].toFixed(1)+' / 100';}$('npc-heat').textContent=n.thermal.hot.toFixed(1);$('npc-cold').textContent=n.thermal.cold.toFixed(1);$('npc-energy-debug').textContent=n.energy.toFixed(1);$('npc-stamina-debug').textContent=n.stamina.toFixed(1);$('npc-fatigue-debug').textContent=n.fatigue.toFixed(1);$('npc-sleep-debug').textContent=n.sleepPressure.toFixed(1);$('npc-survival').textContent='Physiology advances in game hours and days. Starvation and dehydration follow different accumulated deficits; there is no fixed lifespan countdown.';}
  }
  return {toggle,close,update,follow,changeTab};
}
