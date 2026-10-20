import { matchingResultObject, validResultObjectRow } from './discovery-result-object.js';
import { DISCOVERY_RULES } from './discovery-config.js';

const text=(v,max=300)=>typeof v==='string'?v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max):'';
const num=(v,max=1e10)=>Number.isFinite(v)?Math.max(0,Math.min(max,v)):0;
export const objectId=v=>typeof v==='string'&&/^object:\d{1,9}$/.test(v);
const point=v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<24000&&Math.abs(v.y)<24000?{x:v.x,y:v.y}:null;
export function cleanSensoryObject(raw){
  if(!objectId(raw?.id)||!point(raw.position))return null;
  const appearance=Object.fromEntries(['shape','color','texture','motion','sound','size','smell','details'].filter(k=>typeof raw.appearance?.[k]==='string').map(k=>[k,text(raw.appearance[k],100)]));
  return {id:raw.id,scene:text(raw.scene,50)||'valley',position:point(raw.position),appearance,...(typeof raw.motion==='string'?{motion:text(raw.motion,80)}:{}),...(Number.isFinite(raw.count)?{count:Math.floor(num(raw.count,1000))}:{}),observedAt:num(raw.observedAt)};
}
export function createDiscoveryMemory(){return {version:1,nextId:1,observations:{},experiments:[],effects:[],reports:[],techniques:[],practice:{},trials:{},seenFeedback:[],run:null,lastAttemptAt:0,lastDialogueAt:-60,reportCursor:0,search:{home:null,startedAt:0},samplesPending:{},foodDiscoveries:0};}
function primitive(raw){return raw&&DISCOVERY_RULES.primitives.includes(raw.type)&&['$source','$material'].includes(raw.targetId)?{type:raw.type,targetId:raw.targetId}:null;}
function techniqueProof(raw,d){
  if(!objectId(raw?.sourceId)||!Array.isArray(raw.evidence)||!Array.isArray(raw.steps)||raw.steps.length!==2)return null;
  const evidence=[...new Set(raw.evidence)].filter(id=>d.experiments.some(e=>e.id===id));if(evidence.length<2)return null;
  const chains=[];
  for(const sample of d.experiments.filter(e=>evidence.includes(e.id)&&e.primitive==='sample'&&e.ok&&e.ingestionId)){
    const effect=d.effects.find(e=>e.effect==='sustained'&&e.ingestionId===sample.ingestionId&&e.actionId===sample.actionId);
    const acquired=d.experiments.find(e=>evidence.includes(e.id)&&e.ok&&e.id<sample.id&&e.at<=sample.at&&e.targetId===raw.sourceId&&(e.primitive==='pull'&&e.materialId===sample.targetId||e.primitive==='grasp'&&e.targetId===sample.targetId));
    if(effect&&acquired&&raw.steps[0]?.type===acquired.primitive&&raw.steps[0]?.targetId==='$source'&&raw.steps[1]?.type==='sample'&&raw.steps[1]?.targetId==='$material')chains.push(sample.ingestionId);
  }
  if(!chains.length)return null;return {evidence,successes:new Set(chains).size};
}
// The persisted practice aggregate is derived first from retained experiments,
// then from retained per-object trials. Keep this reduction shared with live
// optional-trial retirement so a save never invents a different aggregate.
export function deriveDiscoveryPractice(experiments,trialsByObject){
  const practice={};
  for(const type of DISCOVERY_RULES.primitives){const trials=experiments.filter(e=>e.primitive===type),successful=trials.filter(e=>e.ok&&e.durationSeconds>0);if(trials.length)practice[type]={successes:successful.length,failures:trials.filter(e=>!e.ok).length,seconds:successful.reduce((sum,e)=>sum+e.durationSeconds,0)};}
  const entries=Object.entries(trialsByObject);
  for(const type of DISCOVERY_RULES.primitives){const trials=entries.filter(([key])=>key.endsWith(`|${type}`));if(trials.length)practice[type]={successes:trials.reduce((sum,[,v])=>sum+v.successes,0),failures:trials.reduce((sum,[,v])=>sum+v.failures,0),seconds:trials.reduce((sum,[,v])=>sum+v.seconds,0)};}
  return practice;
}
/** Persistence restores data only. A forged routine cannot outlive its executed evidence. */
export function validateDiscoveryMemory(raw,npc=null,rawExperience=npc?.memory?.experience){
  const d=createDiscoveryMemory();if(!raw||raw.version!==1)return d;d.nextId=Math.max(1,Math.floor(num(raw.nextId,1e9)));
  for(const item of Object.values(raw.observations||{}).slice(-DISCOVERY_RULES.maxObjects)){const o=cleanSensoryObject(item);if(o)d.observations[o.id]=o;}
  d.experiments=(Array.isArray(raw.experiments)?raw.experiments:[]).slice(-DISCOVERY_RULES.maxExperiments).filter(e=>Number.isInteger(e?.id)&&e.id>0&&DISCOVERY_RULES.primitives.includes(e.primitive)&&objectId(e.targetId)&&validResultObjectRow(e.primitive,e.targetId,e)&&(!npc||(Array.isArray(rawExperience)?rawExperience:[]).some(x=>x.id===e.actionId&&matchingResultObject(e,x)))).map(e=>({id:e.id,at:num(e.at),primitive:e.primitive,targetId:e.targetId,ok:e.ok===true,code:text(e.code,60),durationSeconds:num(e.durationSeconds,30),...(objectId(e.materialId)?{materialId:e.materialId}:{}),...(Object.hasOwn(e,'resultObjectId')?{resultObjectId:e.resultObjectId}:{}),...(Number.isInteger(e.actionId)?{actionId:e.actionId}:{}),...(typeof e.ingestionId==='string'?{ingestionId:text(e.ingestionId,80)}:{})}));
  const uniqueIds=new Set(),uniqueActions=new Set();d.experiments=d.experiments.filter(e=>{if(!Number.isInteger(e.actionId)||e.actionId<=0||uniqueIds.has(e.id)||uniqueActions.has(e.actionId))return false;uniqueIds.add(e.id);uniqueActions.add(e.actionId);return !npc||npc.memory.experience.some(x=>x.id===e.actionId&&x.type==='action'&&x.details.action?.type===e.primitive&&x.details.action?.targetId===e.targetId&&x.details.result?.ok===e.ok&&x.details.result?.code===e.code&&(x.details.result?.materialId||undefined)===(e.materialId||undefined)&&(x.details.result?.ingestionId||undefined)===(e.ingestionId||undefined)&&x.at===e.at&&matchingResultObject(e,x));});
  const ids=new Set(d.experiments.map(e=>e.id));d.nextId=Math.max(d.nextId,1+Math.max(0,...ids));
  d.effects=(Array.isArray(raw.effects)?raw.effects:[]).slice(-DISCOVERY_RULES.maxEffects).filter(e=>objectId(e?.objectId)&&Number.isInteger(e.actionId)&&e.actionId>0&&typeof e.ingestionId==='string'&&/^ingestion:\d+$/.test(e.ingestionId)&&['sustained','water relief','discomfort','no noticeable change'].includes(e.effect)&&d.experiments.some(x=>x.primitive==='sample'&&x.ok&&x.targetId===e.objectId&&x.actionId===e.actionId&&x.ingestionId===e.ingestionId&&e.at>=x.at)&&(!npc||npc.physiology?.feedback?.some(f=>f.id===e.id&&f.ingestionId===e.ingestionId&&f.actionId===e.actionId&&f.effect===e.effect&&f.objectId===e.objectId&&f.provenance==='sampled'&&f.at===e.at)||npc.memory.experience.some(x=>x.id===e.proofEventId&&x.type==='condition'&&x.at>=e.at&&x.details.code==='DISCOVERY_EFFECT'&&x.details.feedback?.id===e.id&&x.details.feedback?.ingestionId===e.ingestionId&&x.details.feedback?.actionId===e.actionId&&x.details.feedback?.effect===e.effect&&x.details.feedback?.objectId===e.objectId&&x.details.feedback?.source==='experienced'&&x.details.feedback?.at===e.at))).map(e=>({id:text(e.id,80),at:num(e.at),objectId:e.objectId,actionId:num(e.actionId),ingestionId:text(e.ingestionId,80),effect:e.effect,hunger:e.hunger==='easing'?'easing':'unchanged',thirst:e.thirst==='easing'?'easing':'unchanged',energy:e.energy==='easing'?'easing':'unchanged',pain:['none','aching','hurting'].includes(e.pain)?e.pain:'none',source:'experienced',...(Number.isInteger(e.proofEventId)&&e.proofEventId>0?{proofEventId:e.proofEventId}:{})}));
  d.reports=(Array.isArray(raw.reports)?raw.reports:[]).slice(-DISCOVERY_RULES.maxReports).filter(r=>typeof r?.text==='string'&&['human','aster','mira'].includes(r.sourceId)).map(r=>({id:text(r.id,80),text:text(r.text,600),sourceId:r.sourceId,channel:text(r.channel,20),messageId:text(r.messageId,80),at:num(r.at),...(objectId(r.objectId)?{objectId:r.objectId}:{}),status:['unverified','supported','contradicted'].includes(r.status)?r.status:'unverified',proposed:(Array.isArray(r.proposed)?r.proposed:[]).slice(0,6).filter(p=>DISCOVERY_RULES.primitives.includes(p?.type)&&objectId(p.targetId)&&d.observations[p.targetId]).map(p=>({type:p.type,targetId:p.targetId})),cursor:Math.floor(num(r.cursor,6)),evidence:(Array.isArray(r.evidence)?r.evidence:[]).filter(id=>ids.has(id)).slice(-12)}));
  for(const [key,value] of Object.entries(raw.trials||{}).slice(-768)){
    const [id,type]=key.split('|');if(!objectId(id)||!DISCOVERY_RULES.primitives.includes(type)||!d.observations[id])continue;
    const tail=d.experiments.filter(e=>e.targetId===id&&e.primitive===type),latest=tail.at(-1);
    const trial={attempts:Math.max(tail.length,num(value?.attempts,1e6)),successes:Math.max(tail.filter(e=>e.ok).length,num(value?.successes,1e6)),failures:Math.max(tail.filter(e=>!e.ok).length,num(value?.failures,1e6)),seconds:num(value?.seconds,1e8),lastAt:num(value?.lastAt),lastCode:text(value?.lastCode,60)};
    // Additive bounded metadata; old saves do not invent success/failure from a
    // code. Recover the last result only from matching retained action evidence.
    if(typeof value?.lastOk==='boolean')trial.lastOk=value.lastOk;
    if(latest&&latest.at>=trial.lastAt){trial.lastAt=latest.at;trial.lastCode=latest.code;trial.lastOk=latest.ok;}
    else if(typeof trial.lastOk!=='boolean'){
      const event=npc?.memory.experience.find(e=>e.type==='action'&&e.at===trial.lastAt&&e.details.action?.type===type&&e.details.action?.targetId===id&&e.details.result?.code===trial.lastCode);
      if(typeof event?.details.result?.ok==='boolean')trial.lastOk=event.details.result.ok;
    }
    d.trials[key]=trial;
  }
  for(const e of d.experiments){
    const key=`${e.targetId}|${e.primitive}`;
    if(!d.trials[key]){const tail=d.experiments.filter(x=>x.targetId===e.targetId&&x.primitive===e.primitive),latest=tail.at(-1);d.trials[key]={attempts:tail.length,successes:tail.filter(x=>x.ok).length,failures:tail.filter(x=>!x.ok).length,seconds:tail.filter(x=>x.ok).reduce((sum,x)=>sum+x.durationSeconds,0),lastAt:latest.at,lastCode:latest.code,lastOk:latest.ok};}
  }
  for(const trial of Object.values(d.trials)){trial.successes=Math.min(trial.attempts,trial.successes);trial.failures=Math.min(trial.attempts-trial.successes,trial.failures);trial.seconds=Math.min(trial.seconds,trial.successes*30);}
  d.practice=deriveDiscoveryPractice(d.experiments,d.trials);
  for(const r of d.reports){const attempted=d.experiments.filter(e=>r.evidence.includes(e.id));r.cursor=Math.min(r.cursor,attempted.length,r.proposed.length);r.status=d.effects.some(e=>e.effect==='sustained'&&attempted.some(x=>x.ingestionId===e.ingestionId))?'supported':attempted.some(e=>!e.ok)||d.effects.some(e=>e.effect==='discomfort'&&attempted.some(x=>x.ingestionId===e.ingestionId))?'contradicted':'unverified';}
  for(const t of (Array.isArray(raw.techniques)?raw.techniques:[]).slice(-DISCOVERY_RULES.maxTechniques)){
    const proof=techniqueProof(t,d);if(!proof)continue;
    d.techniques.push({id:text(t.id,80),sourceId:t.sourceId,steps:t.steps.map(primitive),evidence:proof.evidence.slice(-16),effect:'sustained',confidence:t.confidence==='revised'?'revised':proof.successes>=2?'supported':'tentative',successes:proof.successes,failures:num(t.failures,1e5),at:num(t.at)});
  }
  d.seenFeedback=(Array.isArray(raw.seenFeedback)?raw.seenFeedback:[]).filter(v=>typeof v==='string'||Number.isInteger(v)).slice(-128);d.samplesPending=Object.fromEntries(Object.entries(raw.samplesPending||{}).filter(([id,v])=>objectId(id)&&Number.isFinite(v)).slice(-16).map(([id,v])=>[id,num(v)]));
  for(const k of ['lastAttemptAt','reportCursor','foodDiscoveries'])d[k]=num(raw[k]);d.lastDialogueAt=Number.isFinite(raw.lastDialogueAt)?Math.max(-60,Math.min(1e10,raw.lastDialogueAt)):-60;
  d.search={home:point(raw.search?.home),startedAt:num(raw.search?.startedAt)};d.run=null;return d;
}
