import { CONFIG, NPC_RULES, SOCIAL_RULES } from './config.js';
import { DISCOVERY_RULES } from './discovery-config.js';

// Supplied token machinery, not an invented grammar or a category classifier.
// These tiny independent receipts survive ordinary conversation/action compaction.
export const OWN_NAME_LIMIT=24, HEARD_NAME_LIMIT=48, NAMING_CHOICE_LIMIT=256;
const agents=['aster','mira'];
const reserved=new Set(('constructor prototype proto object objects aster mira human all you your yours they them their this that these those here there it its she her him his who what where when why how and the food water apple tree fish animal stone rock red green blue brown yellow round smooth rough small large long short inspect grasp release pull sample strike catch move eat drink wait rest sleep say name point select confirm tiny streamlined body fins still scaled bony frame silver grey pale pink scales exposed soft tissue bones sharp unpleasant strong furry ears stocky tail slender bushy mottled russet fur rapid footfalls quiet breathing rustling stem leaves branching thin bark trunk leafy crown blossoms growths bare branches low tangled stems purple prickly clusters tuft narrow blades fibrous closely cropped dense dark').split(' '));
export const validNameToken=value=>typeof value==='string'&&/^[a-z]{3,16}$/.test(value)&&!reserved.has(value);
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const id=x=>typeof x==='string'&&/^object:[1-9][0-9]{0,8}$/.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const time=(x,n)=>Number.isFinite(x)&&x>=0&&x<=n.elapsed&&x<=1e10;
const point=p=>exact(p,['x','y'])&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<CONFIG.halfSize&&Math.abs(p.y)<CONFIG.halfSize;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const message=x=>typeof x==='string'&&/^message:[1-9][0-9]{0,14}$/.test(x)&&Number.isSafeInteger(Number(x.slice(8)));
const ordinal=x=>Number(x.slice(8));
const clone=x=>structuredClone(x);
const initial=n=>((n.seed>>>0)^(n.id==='mira'?0xb5297a4d:0x68e31da4))>>>0;
const step=x=>(Math.imul(x,1664525)+1013904223)>>>0;
const consonants='bdfgklmnprstvz',vowels='aeiou';
function choice(rng){
  let r=step(rng),bits=r,token='';
  for(let i=0;i<3;i++){token+=consonants[bits%consonants.length];bits=Math.floor(bits/consonants.length);token+=vowels[bits%5];bits=Math.floor(bits/5);}
  return {rng:r,token,declined:r%4===0};
}
export function createLexicon(npc){return {version:1,ownerId:npc.id,rng:initial(npc),counter:0,considered:[],own:[],heard:[],saturated:false};}
const eventKeys=['messageId','at','scene','speakerPosition','listenerPosition','objectPosition'];
function validEvent(e,n,pointValid,requireListenerSight=true){
  return exact(e,eventKeys)&&message(e.messageId)&&time(e.at,n)&&e.scene==='valley'&&
    ['speakerPosition','listenerPosition','objectPosition'].every(k=>point(e[k])&&(!pointValid||pointValid(e[k],e.at)))&&
    distance(e.speakerPosition,e.listenerPosition)<=SOCIAL_RULES.peerRange&&
    distance(e.speakerPosition,e.objectPosition)<=NPC_RULES.visionRadius&&(!requireListenerSight||distance(e.listenerPosition,e.objectPosition)<=NPC_RULES.visionRadius);
}
const encounterKeys=['objectId','at','scene','actorPosition','objectPosition','experimentId','actionId','primitive','code','durationSeconds'];
const codes={inspect_object:'OBJECT_OBSERVED',grasp:'object_held',pull:'piece_detached'};
function validEncounter(e,n,pointValid){
  return exact(e,encounterKeys)&&id(e.objectId)&&time(e.at,n)&&e.scene==='valley'&&point(e.actorPosition)&&point(e.objectPosition)&&
    (!pointValid||pointValid(e.actorPosition,e.at)&&pointValid(e.objectPosition,e.at))&&positive(e.experimentId)&&positive(e.actionId)&&
    Object.hasOwn(codes,e.primitive)&&e.code===codes[e.primitive]&&Number.isFinite(e.durationSeconds)&&e.at>=e.durationSeconds&&
    e.durationSeconds+1e-8>=DISCOVERY_RULES.durations[e.primitive]*DISCOVERY_RULES.minimumCostMultiplier&&
    e.durationSeconds<=DISCOVERY_RULES.durations[e.primitive]+1e-8&&distance(e.actorPosition,e.objectPosition)<=(e.primitive==='inspect_object'?NPC_RULES.visionRadius:DISCOVERY_RULES.reach);
}
const list=(xs,n,pointValid)=>Array.isArray(xs)&&xs.length<=1&&xs.every(x=>exact(x,['peerId','event'])&&agents.includes(x.peerId)&&x.peerId!==n.id&&validEvent(x.event,n,pointValid,false));
function validConfirmation(c,grounding,n,pointValid){
  if(c===null)return true;
  if(!exact(c,['request','selection','confirmation'])||!validEvent(c.request,n,pointValid,false)||![c.selection,c.confirmation].every(e=>validEvent(e,n,pointValid)))return false;
  return grounding.at<c.request.at&&c.request.at<c.selection.at&&c.selection.at<c.confirmation.at&&
    ordinal(grounding.messageId)<ordinal(c.request.messageId)&&ordinal(c.request.messageId)<ordinal(c.selection.messageId)&&ordinal(c.selection.messageId)<ordinal(c.confirmation.messageId);
}
function retainedEvent(n,e,senderId,recipientId){
  const matches=(n.social?.heard||[]).filter(m=>m.id===e.messageId);
  return matches.length===0||matches.length===1&&matches[0].channel==='peer'&&matches[0].senderId===senderId&&matches[0].recipientId===recipientId&&matches[0].at===e.at&&matches[0].model!==true;
}
function retainedEncounter(n,e){
  const experiments=(n.discovery?.experiments||[]).filter(r=>r.id===e.experimentId);
  if(experiments.length>1)return false;
  if(experiments.length){const x=experiments[0];if(x.targetId!==e.objectId||x.actionId!==e.actionId||x.primitive!==e.primitive||x.code!==e.code||x.at!==e.at||x.durationSeconds!==e.durationSeconds||x.ok!==true)return false;}
  const receipts=(n.memory?.experience||[]).filter(r=>r.id===e.actionId);
  if(receipts.length>1)return false;
  if(receipts.length){const r=receipts[0],x=r.details?.result;if(r.type!=='action'||r.at!==e.at||r.details?.action?.type!==e.primitive||r.details?.action?.targetId!==e.objectId||x?.code!==e.code||x.durationSeconds!==e.durationSeconds||x.ok!==true||x.handling?.source!=='experienced'||x.handling.activeActionSeconds!==e.durationSeconds||!['rising','steady'].includes(x.handling.effort))return false;}
  return true;
}
export function validLexicon(raw,npc,{pointValid}={}){
  if(!exact(raw,['version','ownerId','rng','counter','considered','own','heard','saturated'])||raw.version!==1||!agents.includes(npc.id)||raw.ownerId!==npc.id||
    !Number.isSafeInteger(raw.counter)||raw.counter<0||raw.counter>NAMING_CHOICE_LIMIT||!Number.isInteger(raw.rng)||raw.rng<0||raw.rng>0xffffffff||
    !Array.isArray(raw.considered)||raw.considered.length!==raw.counter||!raw.considered.every(positive)||new Set(raw.considered).size!==raw.considered.length||
    !Array.isArray(raw.own)||raw.own.length>OWN_NAME_LIMIT||!Array.isArray(raw.heard)||raw.heard.length>HEARD_NAME_LIMIT||typeof raw.saturated!=='boolean'||raw.saturated&&raw.heard.length!==HEARD_NAME_LIMIT)return false;
  const choices=new Map();let rng=initial(npc);for(let i=1;i<=raw.counter;i++){const c=choice(rng);rng=c.rng;choices.set(i,c);}
  if(rng!==raw.rng)return false;
  const ownObjects=new Set(),ownTokens=new Set(),ownChoices=new Set(),events=new Set();
  for(const row of raw.own){
    const c=choices.get(row?.choice);
    if(!exact(row,['token','objectId','choice','encounter','announcedTo','checkedWith'])||!validNameToken(row.token)||!id(row.objectId)||!c||c.declined||c.token!==row.token||
      !validEncounter(row.encounter,npc,pointValid)||!retainedEncounter(npc,row.encounter)||row.encounter.objectId!==row.objectId||row.encounter.experimentId!==raw.considered[row.choice-1]||!list(row.announcedTo,npc,pointValid)||!list(row.checkedWith,npc,pointValid)||
      row.announcedTo.some(x=>x.event.at<row.encounter.at)||row.checkedWith.some(x=>!row.announcedTo.some(a=>a.peerId===x.peerId&&a.event.at<x.event.at&&ordinal(a.event.messageId)<ordinal(x.event.messageId)))||
      ownObjects.has(row.objectId)||ownTokens.has(row.token)||ownChoices.has(row.choice))return false;
    for(const x of [...row.announcedTo,...row.checkedWith]){if(events.has(x.event.messageId)||!retainedEvent(npc,x.event,npc.id,x.peerId))return false;events.add(x.event.messageId);}
    ownObjects.add(row.objectId);ownTokens.add(row.token);ownChoices.add(row.choice);
  }
  const bindings=new Set();
  for(const row of raw.heard){
    const key=`${row?.speakerId}|${row?.token}|${row?.objectId}`;
    if(!exact(row,['speakerId','token','objectId','grounding','confirmation'])||!agents.includes(row.speakerId)||row.speakerId===npc.id||!validNameToken(row.token)||!id(row.objectId)||
      !validEvent(row.grounding,npc,pointValid)||!retainedEvent(npc,row.grounding,row.speakerId,npc.id)||!validConfirmation(row.confirmation,row.grounding,npc,pointValid)||bindings.has(key)||events.has(row.grounding.messageId))return false;
    bindings.add(key);events.add(row.grounding.messageId);
    if(row.confirmation)for(const [role,e] of Object.entries(row.confirmation)){if(events.has(e.messageId)||!retainedEvent(npc,e,role==='selection'?npc.id:row.speakerId,role==='selection'?row.speakerId:npc.id))return false;events.add(e.messageId);}
  }
  return true;
}
function genuineEncounter(npc,e,sight){
  if(!e||!Array.isArray(npc.discovery?.experiments)||npc.discovery.experiments.filter(x=>x.id===e.id).length!==1||!npc.discovery.experiments.includes(e))return null;
  if(!e||e.ok!==true||!point(sight?.actorPosition)||!point(sight?.objectPosition)||!exact(sight,['objectId','at','scene','actorPosition','objectPosition'])||sight.objectId!==e.targetId||sight.at!==e.at||sight.at!==npc.elapsed||sight.scene!==npc.scene||
    sight.actorPosition.x!==npc.position.x||sight.actorPosition.y!==npc.position.y)return null;
  const encounter={...clone(sight),experimentId:e.id,actionId:e.actionId,primitive:e.primitive,code:e.code,durationSeconds:e.durationSeconds};
  if(!validEncounter(encounter,npc))return null;
  const rows=(npc.memory?.experience||[]).filter(r=>r.id===e.actionId),r=rows.length===1?rows[0]:null,result=r?.details?.result;
  if(r?.type!=='action'||r.at!==e.at||r.details.action?.type!==e.primitive||r.details.action?.targetId!==e.targetId||result?.ok!==true||result.code!==e.code||
    result.durationSeconds!==e.durationSeconds||result.handling?.source!=='experienced'||result.handling.activeActionSeconds!==e.durationSeconds||!['rising','steady'].includes(result.handling.effort))return null;
  return encounter;
}
export function chooseOwnName(npc,experiment,sight){
  const encounter=genuineEncounter(npc,experiment,sight);if(!encounter)return null;
  const lex=npc.lexicon??createLexicon(npc);if(!validLexicon(lex,npc)||lex.own.length>=OWN_NAME_LIMIT||lex.counter>=NAMING_CHOICE_LIMIT||lex.considered.includes(experiment.id)||lex.own.some(r=>r.objectId===encounter.objectId))return null;
  npc.lexicon=lex;const c=choice(lex.rng);lex.rng=c.rng;lex.counter++;lex.considered.push(experiment.id);
  if(c.declined||!validNameToken(c.token)||lex.own.some(r=>r.token===c.token))return null;
  const row={token:c.token,objectId:encounter.objectId,choice:lex.counter,encounter,announcedTo:[],checkedWith:[]};lex.own.push(row);if(!validLexicon(lex,npc)){lex.own.pop();return null;}return row;
}
export function recordGrounding(npc,speakerId,token,objectId,evidence){
  const lex=npc.lexicon??createLexicon(npc);
  if(!validLexicon(lex,npc)||!agents.includes(speakerId)||speakerId===npc.id||!validNameToken(token)||!id(objectId)||!validEvent(evidence,npc))return null;
  const existing=lex.heard.find(r=>r.speakerId===speakerId&&r.token===token&&r.objectId===objectId);if(existing)return existing;
  if(lex.heard.some(r=>r.grounding.messageId===evidence.messageId||r.confirmation&&Object.values(r.confirmation).some(e=>e.messageId===evidence.messageId)))return null;
  npc.lexicon=lex;
  if(lex.heard.length>=HEARD_NAME_LIMIT){lex.saturated=true;return null;}
  const row={speakerId,token,objectId,grounding:clone(evidence),confirmation:null};lex.heard.push(row);if(!validLexicon(lex,npc)){lex.heard.pop();return null;}return row;
}
export function resolveName(npc,token,speakerId,visibleIds){
  const lex=npc.lexicon;if(!lex||!validLexicon(lex,npc)||lex.saturated||!validNameToken(token)||speakerId!==undefined&&speakerId!==null&&!agents.includes(speakerId))return null;
  const rows=[...lex.own.map(r=>({...r,speakerId:npc.id})),...lex.heard].filter(r=>r.token===token&&(speakerId==null||r.speakerId===speakerId));
  // Resolve conflict BEFORE visibility filtering. An occluded homonym is still a conflict.
  const ids=new Set(rows.map(r=>r.objectId));if(ids.size!==1)return null;
  const result=[...ids][0];return new Set(visibleIds||[]).has(result)?result:null;
}
export function confirmReference(npc,binding,evidence){
  const lex=npc.lexicon;if(!lex||!validLexicon(lex,npc)||lex.saturated||!lex.heard.includes(binding)||binding.confirmation!==null||!validConfirmation(evidence,binding.grounding,npc))return false;
  const used=new Set(lex.heard.flatMap(r=>[r.grounding.messageId,...(r.confirmation?Object.values(r.confirmation).map(e=>e.messageId):[])]));
  if(Object.values(evidence).some(e=>used.has(e.messageId))||resolveName(npc,binding.token,binding.speakerId,[binding.objectId])!==binding.objectId)return false;
  binding.confirmation=clone(evidence);if(!validLexicon(lex,npc)){binding.confirmation=null;return false;}return true;
}
export function lexicalLabels(npc){
  if(!npc.lexicon||!validLexicon(npc.lexicon,npc))return [];
  return [...npc.lexicon.own.map(r=>({token:r.token,objectId:r.objectId,speakerId:npc.id,status:'owner-chosen',at:r.encounter.at})),
    ...npc.lexicon.heard.map(r=>({token:r.token,objectId:r.objectId,speakerId:r.speakerId,status:r.confirmation?'confirmed':'heard-grounded',at:r.confirmation?.confirmation.at??r.grounding.at}))];
}

export function markNameAnnounced(npc,row,peerId,event){
  const lex=npc.lexicon;
  if(!lex||!validLexicon(lex,npc)||!lex.own.includes(row)||!agents.includes(peerId)||peerId===npc.id||row.announcedTo.length||!validEvent(event,npc,undefined,false)||event.at<row.encounter.at)return false;
  row.announcedTo.push({peerId,event:clone(event)});if(!validLexicon(lex,npc)){row.announcedTo.pop();return false;}return true;
}
export function markReferenceRequested(npc,row,peerId,event){
  const lex=npc.lexicon,announcement=row?.announcedTo?.find(a=>a.peerId===peerId);
  if(!lex||!validLexicon(lex,npc)||!lex.own.includes(row)||!announcement||row.checkedWith.length||!validEvent(event,npc,undefined,false)||event.at<=announcement.event.at||ordinal(event.messageId)<=ordinal(announcement.event.messageId))return false;
  row.checkedWith.push({peerId,event:clone(event)});if(!validLexicon(lex,npc)){row.checkedWith.pop();return false;}return true;
}
