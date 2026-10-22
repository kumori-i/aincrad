const DEFAULTS=Object.freeze({enabled:false,endpoint:'http://127.0.0.1:11434/v1',model:'',timeoutMs:8000,maxCallsPerHour:60,maxTokens:700});
const AGENTS=new Set(['aster','mira']);
function validateConfig(raw={}){
  const u=new URL(raw.endpoint??DEFAULTS.endpoint);
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!/^\/v1\/?$/.test(u.pathname)||Number(u.port)<1024||Number(u.port)>65535)throw new Error('Use a loopback OpenAI-compatible endpoint, such as http://127.0.0.1:11434/v1.');
  const model=typeof raw.model==='string'?raw.model.trim().slice(0,120):'';
  if(raw.enabled===true&&!model)throw new Error('Choose the name of a model already installed on your local server.');
  const bounded=(v,d,min,max)=>Number.isInteger(v)?Math.max(min,Math.min(max,v)):d;
  return {enabled:raw.enabled===true,endpoint:u.toString().replace(/\/$/,''),model,timeoutMs:bounded(raw.timeoutMs,8000,1000,30000),maxCallsPerHour:bounded(raw.maxCallsPerHour,60,1,60),maxTokens:bounded(raw.maxTokens,700,64,1200)};
}
const BODY_SIGNALS={
  hunger:['content','peckish','hungry','ravenous','faint with hunger'],thirst:['quenched','dry mouth','thirsty','parched','desperate thirst'],
  thermal:['dangerously hot','dangerously cold','overheated','shivering','hot','warm','cold','cool','comfortable'],energy:['steady','waning','low','depleted'],
  stamina:['easy breathing','breathing hard','winded','exhausted'],fatigue:['fresh','tired','weary','exhausted'],sleepiness:['alert','drowsy','sleepy','struggling to stay awake'],
  pain:['none','aching','hurting','severe'],wetness:['dry','damp','wet','soaked'],overall:['unconscious','recovering','urgent','distressed','uncomfortable','settled'],
  activity:['awake','resting','sleeping','walking'],relief:['relieved','easing','none'],
};
const DISCOVERY_BODY_SIGNALS={...BODY_SIGNALS,sleepiness:[...BODY_SIGNALS.sleepiness,'groggy'],activity:[...BODY_SIGNALS.activity,'dozing'],digestion:['empty','settled','full','overfull'],sleep:['awake','dozing','light sleep','deep sleep','groggy']};
const SENSES={timeOfDay:['night','dawn','morning','afternoon','evening'],weather:['clear','cloudy','rainy','windy'],warmth:['hot','warm','cold','cool','comfortable'],wind:['calm','breezy','gusty'],shelter:['sheltered','open air'],shade:['shaded','exposed'],precipitation:['rain','none']};
const TELEMETRY=/(hydration|nourishment|health|fatigue|energy|stamina|thermal|feelings|sensation|temperature|sleepPressure|riskCost|bodyFeedback|physiologicalPriorities|wetness|bodyGain|hunger|thirst|physiology|digestion|digestive|waterDeficit|awakeHours|sleepDepth|bodyCondition|massKg|sleepInertia|stomach|reserve|calories|nutrients)/i;
const HIDDEN_ECOLOGY=/^(species|diet|edible|edibility|nutrition|nutritionalValue|calories|kcal|protein|fat|carbohydrate|materialKind|materialType|renewAt|ripenAt|predator|prey|intrinsicFood|metabolism)$/i;
const DISCOVERY_JOURNAL_ACTIONS=new Set(['ask_human','journal_reply']);
const isObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function containsNumber(value){return typeof value==='number'||typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*%?$/.test(value)||value&&typeof value==='object'&&Object.values(value).some(containsNumber);}
function validateData(value,depth=0){
  if(depth>10)throw new Error('Observation data exceeds its nesting limit.');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='string'){if(value.length>1200)throw new Error('Observation text exceeds its limit.');return;}
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Observation numbers must be finite.');return;}
  if(!value||typeof value!=='object')throw new Error('Observation contains unsupported data.');
  if(Object.keys(value).length>160)throw new Error('Observation data exceeds its field limit.');
  for(const [key,item] of Object.entries(value)){
    if(key.length>80||['__proto__','constructor','prototype'].includes(key))throw new Error('Observation contains an unsupported field.');
    if(TELEMETRY.test(key)&&containsNumber(item))throw new Error('Exact bodily telemetry is private to the simulation.');
    validateData(item,depth+1);
  }
}
function qualitative(value,contract,label){
  if(!isObject(value)||Object.keys(value).some(key=>!Object.hasOwn(contract,key)))throw new Error('Invalid '+label+'.');
  for(const [key,allowed] of Object.entries(contract))if(!allowed.includes(value[key]))throw new Error('Invalid qualitative '+label+' '+key+'.');
  return {...value};
}
function privateEcology(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){if(HIDDEN_ECOLOGY.test(key))throw new Error('Hidden ecological metadata is private to the simulation.');privateEcology(item);}
}
function boundedArrays(raw,contracts){
  const result={};
  for(const [name,limit] of contracts){const value=raw[name]??[];if(!Array.isArray(value)||value.length>limit)throw new Error('Invalid '+name+'.');result[name]=value;}
  return result;
}
function validateInquiries(rows){
  const keys=['sourceId','actorId','at','actorPosition','sourcePosition','attempts','retired','deferredReason','question','status','provenance','priorAdverse','ownAttempts','ownEffects'];
  const objectId=v=>typeof v==='string'&&/^object:\d{1,9}$/.test(v);
  const point=v=>isObject(v)&&Object.keys(v).length===2&&['x','y'].every(k=>Number.isFinite(v[k])&&Math.abs(v[k])<24000);
  const boundedText=(v,n)=>typeof v==='string'&&v.length<=n;
  const positive=v=>Number.isSafeInteger(v)&&v>0;
  const time=v=>Number.isFinite(v)&&v>=0;
  const ingestion=v=>typeof v==='string'&&/^ingestion:\d{1,16}$/.test(v);
  const optional=(v,key,check)=>!Object.hasOwn(v,key)||check(v[key]);
  for(const q of rows){
    if(!isObject(q)||Object.keys(q).length!==keys.length||keys.some(k=>!Object.hasOwn(q,k))||!objectId(q.sourceId)||
      !(AGENTS.has(q.actorId)||objectId(q.actorId))||q.actorId===q.sourceId||!Number.isFinite(q.at)||q.at<0||
      !point(q.actorPosition)||!point(q.sourcePosition)||typeof q.retired!=='boolean'||typeof q.priorAdverse!=='boolean'||
      q.provenance!=='witnessed consumption'||!['uncertain','waiting','supported','contradicted','inconclusive','unavailable','expired','retired'].includes(q.status)||
      !boundedText(q.question,160)||!(q.deferredReason===null||boundedText(q.deferredReason,200))||
      !Array.isArray(q.attempts)||q.attempts.length>3||q.attempts.some(id=>!Number.isSafeInteger(id)||id<1)||
      !Array.isArray(q.ownAttempts)||q.ownAttempts.length>3||!Array.isArray(q.ownEffects)||q.ownEffects.length>64)throw new Error('Invalid observational inquiry.');
    for(const e of q.ownAttempts)if(!isObject(e)||Object.keys(e).some(k=>!['id','at','primitive','targetId','ok','code','durationSeconds','materialId','resultObjectId','actionId','ingestionId'].includes(k))||!['grasp','pull','sample'].includes(e.primitive)||!objectId(e.targetId)||typeof e.ok!=='boolean'||!boundedText(e.code,60)||!positive(e.id)||!positive(e.actionId)||!time(e.at)||!time(e.durationSeconds)||e.durationSeconds>30||!optional(e,'materialId',objectId)||!optional(e,'resultObjectId',objectId)||!optional(e,'ingestionId',ingestion))throw new Error('Invalid inquiry attempt.');
    for(const e of q.ownEffects)if(!isObject(e)||Object.keys(e).some(k=>!['id','at','objectId','actionId','ingestionId','effect','hunger','thirst','energy','pain','source','proofEventId'].includes(k))||e.source!=='experienced'||!objectId(e.objectId)||!['sustained','water relief','discomfort','no noticeable change'].includes(e.effect)||!boundedText(e.id,80)||!e.id.length||!time(e.at)||!positive(e.actionId)||!ingestion(e.ingestionId)||!['hunger','thirst','energy'].every(k=>['easing','unchanged'].includes(e[k]))||!['none','aching','hurting'].includes(e.pain)||!optional(e,'proofEventId',positive))throw new Error('Invalid inquiry feedback.');
  }
  return rows;
}
function validateHandlingInquiries(rows){
  const keys=['sourceId','priorSourceId','at','status','question','provenance'];
  const objectId=v=>typeof v==='string'&&/^object:[1-9][0-9]{0,8}$/.test(v);
  const question='Grasping did not acquire this. Pulling detached something from that similar-looking source. Could pulling work here?';
  if(Object.getPrototypeOf(rows)!==Array.prototype||Reflect.ownKeys(rows).length!==rows.length+1||
    Reflect.ownKeys(rows).some(k=>k!=='length'&&!(typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<rows.length&&Object.hasOwn(Object.getOwnPropertyDescriptor(rows,k),'value'))))throw new Error('Invalid handling inquiries.');
  return rows.map(q=>{
    if(!isObject(q)||![Object.prototype,null].includes(Object.getPrototypeOf(q))||Reflect.ownKeys(q).length!==keys.length||
      keys.some(k=>{const d=Object.getOwnPropertyDescriptor(q,k);return !d||!d.enumerable||!Object.hasOwn(d,'value');})||
      !objectId(q.sourceId)||!objectId(q.priorSourceId)||q.sourceId===q.priorSourceId||
      !Number.isFinite(q.at)||q.at<0||q.at>1e10||
      !['uncertain','attempting','detached','did-not-detach','unavailable','retired'].includes(q.status)||
      q.question!==question||q.provenance!=='own handling outcomes')throw new Error('Invalid handling inquiry.');
    return Object.fromEntries(keys.map(k=>[k,q[k]]));
  });
}
// New cross-source metadata is inert, bounded sensory testimony. The model
// bridge accepts no hidden classifier, target coordinates, program or extra verb.
function validateTransferTeaching(teaching,{message=false,row=null}={}) {
  if (!isObject(teaching) || !Object.hasOwn(teaching,'transfer')) return;
  if(row?.channel!=='peer'||!(message?AGENTS.has(row?.senderId)&&AGENTS.has(row?.recipientId)&&row.senderId!==row.recipientId:AGENTS.has(row?.sourceId)))throw new Error('Invalid appearance-based teaching provenance.');
  const id=v=>typeof v==='string'&&/^object:[1-9][0-9]{0,8}$/.test(v);
  const token=v=>typeof v==='string'&&/^[a-zA-Z0-9:_\-.]{1,80}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
  const time=v=>Number.isFinite(v)&&v>=0&&v<=1e10;
  const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
  const t=teaching.transfer;
  if(Object.keys(teaching).some(k=>!['version','sourceObjectId','senderTechniqueId','acquisition','receivedAt','state','lastCode','transfer'].includes(k))||
    teaching.version!==1||!id(teaching.sourceObjectId)||!token(teaching.senderTechniqueId)||
    !['pull','grasp'].includes(teaching.acquisition)||!time(teaching.receivedAt)||
    !['ready','waiting','complete','unavailable'].includes(teaching.state)||
    Object.hasOwn(teaching,'lastCode')&&!text(teaching.lastCode,60)||
    !isObject(t)||Object.keys(t).some(k=>!['version','cues','observedAt','targetObjectId'].includes(k))||
    t.version!==1||!time(t.observedAt)||t.observedAt>teaching.receivedAt||teaching.receivedAt-t.observedAt>=8||!isObject(t.cues)||Object.keys(t.cues).length!==3||
    !['shape','color','texture'].every(k=>text(t.cues[k],100))||
    Object.hasOwn(t,'targetObjectId')&&(message||!id(t.targetObjectId)||t.targetObjectId===teaching.sourceObjectId))
    throw new Error('Invalid appearance-based teaching.');
}
function validateObservation(raw){
  if(!isObject(raw))throw new Error('Observation is missing or exceeds its size limit.');
  let encoded;try{encoded=JSON.stringify(raw);}catch{throw new Error('Observation must be serializable data.');}
  if(Buffer.byteLength(encoded)>65536)throw new Error('Observation is missing or exceeds its size limit.');
  validateData(raw);
  if(!isObject(raw.identity)||!AGENTS.has(raw.identity.id)||typeof raw.identity.name!=='string'||!raw.identity.name.length||raw.identity.name.length>80)throw new Error('Invalid NPC identity.');
  const c=raw.condition;
  if(!isObject(c)||Object.keys(c).some(key=>!['scene','lifecycle','position','body','senses','inventory'].includes(key))||c.lifecycle!=='AWAKE'||typeof c.scene!=='string'||!c.scene.length||c.scene.length>80||!isObject(c.position)||Object.keys(c.position).some(key=>!['x','y'].includes(key))||!Number.isFinite(c.position.x)||!Number.isFinite(c.position.y)||Math.abs(c.position.x)>24000||Math.abs(c.position.y)>24000)throw new Error('Invalid NPC condition.');
  const discovery=raw.mode==='discovery';
  if(raw.mode!==undefined&&!['legacy','discovery'].includes(raw.mode))throw new Error('Invalid simulation mode.');
  const inventory=c.inventory;
  if(discovery){
    for(const key of ['knownFoods','skills','procedureCandidates','procedureUse'])if(raw[key]!==undefined)throw new Error('Supplied food/procedure fields are unavailable in discovery mode.');
    if(!isObject(inventory)||Object.keys(inventory).some(key=>!['objects','capacity','flask'].includes(key))||!Array.isArray(inventory.objects)||inventory.objects.length>20||!Number.isInteger(inventory.capacity)||inventory.capacity<1||inventory.capacity>20||inventory.objects.length>inventory.capacity||!['empty','some','full'].includes(inventory.flask))throw new Error('Invalid discovery inventory.');
    privateEcology(raw);
  }else if(!isObject(inventory)||Object.keys(inventory).some(key=>!['apples','capacity','flask'].includes(key))||!Number.isInteger(inventory.apples)||inventory.apples<0||inventory.apples>3||inventory.capacity!==3||!['empty','some','full'].includes(inventory.flask))throw new Error('Invalid discrete inventory.');
  const condition={scene:c.scene,lifecycle:c.lifecycle,position:{x:c.position.x,y:c.position.y},body:qualitative(c.body,discovery?DISCOVERY_BODY_SIGNALS:BODY_SIGNALS,'body'),senses:qualitative(c.senses,SENSES,'senses'),inventory:{...inventory}};
  const arrays=boundedArrays(raw,discovery?[['knownSources',12],['knownShelters',12],['knownTiles',140]]:[['knownSources',12],['knownFoods',12],['knownShelters',12],['knownTiles',140],['recentExperience',10],['lessons',3],['skills',12],['procedureCandidates',12]]);
  let discoveryData;
  if(discovery){if(!isObject(raw.discovery)||Object.keys(raw.discovery).some(key=>!['observations','experiments','effects','techniques','reports','inquiries','handlingInquiries'].includes(key))||Object.hasOwn(raw.discovery,'handlingInquiries')&&!Array.isArray(raw.discovery.handlingInquiries))throw new Error('Invalid discovery experience.');discoveryData=boundedArrays(raw.discovery,[['observations',40],['experiments',24],['effects',24],['techniques',16],['reports',16],['inquiries',16],['handlingInquiries',16]]);validateInquiries(discoveryData.inquiries);discoveryData.handlingInquiries=validateHandlingInquiries(discoveryData.handlingInquiries);for(const report of discoveryData.reports)validateTransferTeaching(report?.teaching,{row:report});}
  for(const [name,contract] of [['innerLife',{drives:8,beliefs:16,predictions:12,questions:8}],['social',{peers:2,journal:12,nearbyMessages:6,notes:12}]]){
    if(raw[name]!==undefined&&!isObject(raw[name]))throw new Error('Invalid '+name+'.');
    for(const [key,limit] of Object.entries(contract))if(raw[name]?.[key]!==undefined&&(!Array.isArray(raw[name][key])||raw[name][key].length>limit))throw new Error('Invalid '+name+' '+key+'.');
  }
  for(const message of [...(raw.social?.nearbyMessages||[]),...(raw.social?.journal||[])])validateTransferTeaching(message?.teaching,{message:true,row:message});
  const result=Object.fromEntries(['objective','observedAt','knownExit','procedureUse','actionStatus','actions','innerLife','social','beliefs','goal','plan'].filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  return {identity:{id:raw.identity.id,name:raw.identity.name},...(raw.mode?{mode:raw.mode}:{}),condition,...result,...arrays,...(discovery?{discovery:discoveryData}: {})};
}
const ACTIONS=new Set(['observe','move','inspect','fill_flask','drink','gather_food','eat','enter_shelter','exit_shelter','wait','rest','sleep','say','ask_human','journal_reply','write_note','read_note']);
const NEEDS=new Set(['survival','safety','belonging','competence','understanding','creativity','purpose','contribution']);
function textField(value,max,label,{optional=false}={}){
  if(optional&&value===undefined)return undefined;
  if(typeof value!=='string'||!value.trim().length||value.length>max)throw new Error('Invalid '+label+'.');
  return value;
}
function references(value){
  const result={};
  for(const key of ['sourceId','foodId','shelterId'])if(value[key]!==undefined)result[key]=textField(value[key],70,'action reference');
  if(Object.keys(result).length>1)throw new Error('Choose one action target.');return result;
}
function parseAction(a){
  if(!isObject(a)||!ACTIONS.has(a.type))throw new Error('The model requested an unsupported action.');
  const special={say:['targetId','text'],ask_human:['text','topic'],journal_reply:['text','replyTo'],write_note:['title','text','beliefIds'],read_note:['noteId'],rest:['seconds'],sleep:['seconds'],wait:['seconds']};
  const allowed=new Set(['type',...(special[a.type]||['sourceId','foodId','shelterId','target','duration'])]);
  if(Object.keys(a).some(key=>!allowed.has(key)))throw new Error('The model requested unsupported action fields.');
  const action={type:a.type,...references(a)};
  if(a.target!==undefined){
    if(Object.keys(action).length>1||!isObject(a.target)||Object.keys(a.target).some(key=>!['x','y'].includes(key))||!Number.isFinite(a.target.x)||!Number.isFinite(a.target.y)||Math.abs(a.target.x)>=24000||Math.abs(a.target.y)>=24000)throw new Error('Invalid movement target.');
    action.target={x:a.target.x,y:a.target.y};
  }
  if(['wait','rest','sleep'].includes(a.type)&&a.seconds!==undefined){if(!Number.isFinite(a.seconds)||a.seconds<.25||a.seconds>(a.type==='wait'?5:12))throw new Error('Invalid rest or wait duration.');action.seconds=a.seconds;}
  if(a.duration!==undefined){if(!Number.isFinite(a.duration)||a.duration<=0||a.duration>12)throw new Error('Invalid action duration.');action.duration=a.duration;}
  if(a.type==='say'){if(!AGENTS.has(a.targetId))throw new Error('Invalid conversation recipient.');action.targetId=a.targetId;action.text=textField(a.text,600,'conversation text');}
  if(a.type==='ask_human'){action.text=textField(a.text,600,'question');if(a.topic!==undefined)action.topic=textField(a.topic,80,'question topic');}
  if(a.type==='journal_reply'){action.text=textField(a.text,600,'journal response');if(a.replyTo!==undefined)action.replyTo=textField(a.replyTo,80,'journal message reference');}
  if(a.type==='write_note'){
    action.title=textField(a.title,80,'note title');action.text=textField(a.text,600,'note text');
    if(a.beliefIds!==undefined){if(!Array.isArray(a.beliefIds)||a.beliefIds.length>8)throw new Error('Invalid note belief references.');action.beliefIds=a.beliefIds.map(id=>textField(id,80,'belief reference'));}
  }
  if(a.type==='read_note')action.noteId=textField(a.noteId,80,'note reference');
  return action;
}
function parseDecision(content,{mode='legacy'}={}){
  if(typeof content!=='string'||content.length>16000)throw new Error('The model response is empty or too large.');
  const value=JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(!isObject(value))throw new Error('The model response must be a JSON object.');
  if(mode==='discovery'){
    if(Object.keys(value).some(key=>!['action','reason'].includes(key))||!isObject(value.action)||!DISCOVERY_JOURNAL_ACTIONS.has(value.action.type))throw new Error('Discovery models may compose optional human-journal messages only; physical choices and techniques require executed experience or explicit human advice.');
    const action=parseAction(value.action);
    return {action,reason:typeof value.reason==='string'?value.reason.slice(0,600):'Local model composed optional journal language from supplied experience.'};
  }
  if(mode!=='legacy')throw new Error('Invalid decision mode.');
  if(Object.keys(value).some(key=>!['action','skillId','sourceId','foodId','shelterId','plan','reason'].includes(key)))throw new Error('The model requested unsupported decision fields.');
  const reason=typeof value.reason==='string'?value.reason.slice(0,600):'Local model selected a bounded experiment.';
  const variants=['action','skillId','plan'].filter(key=>value[key]!==undefined);
  if(variants.length!==1)throw new Error('Choose one action, supplied procedure or plan.');
  if(value.plan!==undefined){
    const p=value.plan;
    if(!isObject(p)||Object.keys(p).some(key=>!['goal','need','steps','completion','interrupt'].includes(key))||!NEEDS.has(p.need)||!Array.isArray(p.steps)||p.steps.length<3||p.steps.length>6||Object.keys(references(value)).length)throw new Error('Invalid bounded plan.');
    return {plan:{goal:textField(p.goal,160,'plan goal'),need:p.need,steps:p.steps.map(parseAction),completion:textField(p.completion,160,'plan completion'),interrupt:textField(p.interrupt,160,'plan interruption')},reason};
  }
  if(value.skillId!==undefined)return {skillId:textField(value.skillId,80,'procedure reference'),...references(value),reason};
  if(Object.keys(references(value)).length)throw new Error('Action references belong inside the action.');
  return {action:parseAction(value.action),reason};
}
async function boundedResponseText(response){
  if(!response.body?.getReader){const text=await response.text();if(text.length>131072)throw new Error('Local model response exceeds the size limit.');return text;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>131072){await reader.cancel();throw new Error('Local model response exceeds the size limit.');}text+=decoder.decode(value,{stream:true});}
  return text+decoder.decode();
}
const PROMPT='You control the embodied character identified in this Aincrad observation. Exact physiology is private: reason from felt hunger, thirst, warmth, pain, effort, tiredness and sleepiness rather than invented percentages. Overheated or shivering describes accumulated bodily strain that warrants relief even after entering temperate shelter; dangerously hot or dangerously cold describes urgent exposure. Maslow-inspired drives are concurrent: survival, safety, belonging, competence, understanding, creativity, purpose and contribution. Prepare supplies and consider observed route costs before exploration; interrupt plans for urgent bodily sensations. Ask useful grounded questions, converse with a locally reachable known peer, or leave readable notes when worthwhile. The human journal is always available, but the human may never answer; continue caring for yourself while waiting and do not repeat pending questions. Direct observations, inferences and reported claims have different evidence. Never invent resource locations, current availability, future weather, another character\'s private state, or successful physical outcomes. Only supplied local observations, memories and acquired procedures are available. The engine validates and executes all actions, plans and conversations; intentions and rescue are not independent physical success. Return JSON only with exactly one choice: {"action":{"type":"observe|move|inspect|fill_flask|drink|gather_food|eat|enter_shelter|exit_shelter|wait|rest|sleep|say|ask_human|journal_reply|write_note|read_note",...},"reason":"compact evidence-based reasoning"}; {"skillId":"supplied id","sourceId":"known water id","reason":"..."} (use foodId or shelterId for the matching procedure, exactly one reference); or {"plan":{"goal":"...","need":"one listed drive","steps":[3 to 6 bounded actions],"completion":"...","interrupt":"..."},"reason":"..."}. Move accepts one known sourceId/foodId/shelterId or target:{x,y}; rest/sleep seconds are 0.25 to 12, wait seconds 0.25 to 5. Say accepts targetId and text (up to 600 characters). Ask_human accepts text (up to 600) and optional topic (up to 80). Journal_reply accepts text (up to 600) and optional replyTo identifying a received human journal message (up to 80); use it to answer a human without opening another question. Write_note accepts title (up to 80), text (up to 600) and optional beliefIds (up to 8 known IDs). Read_note accepts noteId. Plans cannot assign authoritative outcomes, budgets or statuses. You have no operating-system, filesystem, shell, code-execution or rescue tool.';
const DISCOVERY_PROMPT='You compose optional human-journal language for the embodied Aincrad character in this discovery-mode observation. You do not select physical actions, experiments, techniques, routes or plans. The human may never answer; physical activity continues independently. Use only the supplied qualitative sensations, opaque sensory observations, executed experiments, experienced effects, remembered uncertainty and received human messages. Your pretrained associations are not observations or verified facts. Do not supply edible-item lists, food methods, recipes, hunting, climbing or gathering instructions; do not infer object identity, species, diet, edibility or hidden bodily measurements from familiar appearances. Distinguish experienced evidence from unverified human reports and do not invent discoveries or completed outcomes. A reported technique remains a hypothesis until physically tested. Return JSON only: {"action":{"type":"journal_reply","text":"up to 600 characters","replyTo":"optional received message ID"},"reason":"compact evidence-based explanation"} or {"action":{"type":"ask_human","text":"up to 600 characters","topic":"optional topic up to 80 characters"},"reason":"..."}. Do not send peer messages or write notes from pretrained knowledge. You have no physical-action, procedure, plan, operating-system, filesystem, shell, code-execution or rescue tool.';
class ModelService {
  constructor({config=DEFAULTS,fetchImpl=fetch,now=()=>Date.now()}={}){this.config=validateConfig(config);this.fetch=fetchImpl;this.now=now;this.pending=null;this.queue=[];this.windowAt=this.now();this.calls=0;}
  configure(config){const next=validateConfig(config);this.cancel();this.config=next;return this.status();}
  status(){return {...this.config,pending:Boolean(this.pending||this.queue.length),pendingAgentIds:[...new Set([this.pending?.agentId,...this.queue.map(item=>item.agentId)].filter(Boolean))],callsThisHour:this.calls};}
  cancel(agentId){
    if(agentId!==undefined&&!AGENTS.has(agentId))throw new Error('Invalid cancellation identity.');
    const matches=item=>agentId===undefined||item.agentId===agentId;
    for(const item of this.queue.filter(matches))item.reject(new Error('Local model request cancelled or timed out.'));
    this.queue=this.queue.filter(item=>!matches(item));
    if(this.pending&&matches(this.pending))this.pending.controller.abort();
    return {cancelled:true};
  }
  async decide(raw){
    if(!this.config.enabled)throw new Error('No local model is configured.');
    const observation=validateObservation(raw),agentId=observation.identity.id;
    if(this.queue.some(item=>item.agentId===agentId))throw new Error('This character already has a model decision waiting.');
    return new Promise((resolve,reject)=>{this.queue.push({agentId,observation,resolve,reject});this.drain();});
  }
  drain(){
    if(this.pending)return;
    const item=this.queue.shift();if(!item)return;
    if(this.now()-this.windowAt>=3600000){this.windowAt=this.now();this.calls=0;}
    if(this.calls>=this.config.maxCallsPerHour){item.reject(new Error('The local model call budget is exhausted for this hour.'));this.drain();return;}
    const controller=new AbortController();this.pending={...item,controller};this.calls++;
    const active=this.pending,timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    const cancelled=new Promise((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('Local model request cancelled or timed out.')),{once:true}));
    const finish=()=>{clearTimeout(timer);if(this.pending===active)this.pending=null;};
    Promise.race([this.request(item.observation,controller.signal),cancelled]).then(result=>{finish();item.resolve(result);this.drain();},error=>{finish();item.reject(error);this.drain();});
  }
  async request(observation,signal){
    const response=await this.fetch(this.config.endpoint+'/chat/completions',{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.config.model,temperature:.25,max_tokens:this.config.maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:observation.mode==='discovery'?DISCOVERY_PROMPT:PROMPT},{role:'user',content:JSON.stringify(observation)}]})});
    if(!response.ok)throw new Error(`Local model returned HTTP ${response.status}.`);
    if(Number(response.headers?.get?.('content-length')||0)>131072)throw new Error('Local model response exceeds the size limit.');
    const text=await boundedResponseText(response),data=JSON.parse(text);return parseDecision(data.choices?.[0]?.message?.content,{mode:observation.mode||'legacy'});
  }
}
module.exports={DEFAULTS,validateConfig,validateObservation,parseDecision,ModelService};
