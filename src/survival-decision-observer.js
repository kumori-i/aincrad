import { BIOLOGY_RULES } from './biology-config.js';

// Observer-only, process-local diagnostics. Never queried by a policy or serialized.
export const SURVIVAL_DECISION_LIMITS=Object.freeze({records:64,notes:32,counter:2147483647});
export const SURVIVAL_DECISION_CODES=Object.freeze([
  'visit:urgent-food','enter:urgent-food','visit:ordinary-food','enter:ordinary-food','visit:learned-run','visit:optional',
  'sample:source-caution','sample:composite-blocked','sample:feedback-wait','sample:recent-failure','sample:eligible',
  'run:missing-or-expired','run:awaiting','run:complete','run:no-target','run:availability-blocked','run:eligibility-blocked','run:route-missing','run:travel','run:action',
  'food:held-supported-found','food:urgent-candidates','food:ordinary-candidates',
]);
const codes=new Set(SURVIVAL_DECISION_CODES),stores=new WeakMap(),tokens=new WeakMap(),L=SURVIVAL_DECISION_LIMITS;
const actionTypes=new Set(['inspect_object','indicate_object','grasp','release','pull','sample','strike','catch','move','swim','climb','jump','wait','rest','sleep','drink','fill_flask','enter_shelter','exit_shelter','give','accept','refuse']);
const needs=new Set(['understanding','water','food','thermal','survival','rest','safety']);
const qualitative={
 hunger:['content','peckish','hungry','ravenous','faint with hunger'],thirst:['quenched','dry mouth','thirsty','parched','desperate thirst'],
 thermal:['hot','warm','cold','cool','comfortable','dangerously hot','dangerously cold','overheated','shivering'],energy:['steady','waning','low','depleted'],
 stamina:['easy breathing','breathing hard','winded','exhausted'],fatigue:['fresh','tired','weary','exhausted'],sleepiness:['alert','drowsy','sleepy','struggling to stay awake','groggy'],
 pain:['none','aching','hurting','severe'],wetness:['dry','damp','wet','soaked'],overall:['unconscious','recovering','urgent','distressed','uncomfortable','settled'],
 activity:['awake','sleeping','resting','walking','dozing'],relief:['relieved','easing','none'],digestion:['empty','settled','full','overfull'],sleep:['dozing','deep sleep','light sleep','groggy','awake'],
};
function plain(value){if(!value||typeof value!=='object')return false;const p=Object.getPrototypeOf(value);return p===Object.prototype||p===null;}
function own(object,key){if(!plain(object))return undefined;const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}
function number(value,max=1e12){return Number.isFinite(value)&&value>=0?Math.min(value,max):null;}
function increment(object,key,n=1){object[key]=Math.min(L.counter,object[key]+n);}
function identity(actor){if(!plain(actor))return null;const discovery=own(actor,'discovery'),physiology=own(actor,'physiology');return plain(discovery)&&plain(physiology)?{discovery,physiology}:null;}
function fresh(id){return {...id,current:null,records:[],counters:{begun:0,finished:0,incomplete:0,superseded:0,evictedRecords:0,droppedNotes:0,rejectedNotes:0},gateCounts:Object.fromEntries(SURVIVAL_DECISION_CODES.map(code=>[code,0]))};}
function store(actor,create=false){const id=identity(actor);if(!id){if(actor&&typeof actor==='object'){const stale=stores.get(actor);if(stale?.current)tokens.delete(stale.current);stores.delete(actor);}return null;}let s=stores.get(actor);if(s&&(s.discovery!==id.discovery||s.physiology!==id.physiology)){if(s.current)tokens.delete(s.current);stores.delete(actor);s=null;}if(!s&&create){s=fresh(id);stores.set(actor,s);}return s;}
function body(actor,existing){const f=own(actor,'physiology');if(!plain(f))return null;const totals=own(f,'totals'),stats=own(actor,'stats'),human=own(f,'profile')==='human',satiety=human?number(own(f,'satietyHours'),BIOLOGY_RULES.humanSatietyMaximumHours):null;
 const out={satietyHours:satiety,satietyMaximumHours:human?BIOLOGY_RULES.humanSatietyMaximumHours:null,satietyPercent:satiety===null?null:satiety/BIOLOGY_RULES.humanSatietyMaximumHours*100,
 availableEnergyKcal:number(own(f,'availableEnergyKcal')),storedEnergyKcal:number(own(f,'storedEnergyKcal')),ingestedKcal:number(own(totals,'ingestedKcal')),absorbedKcal:number(own(totals,'absorbedKcal')),metabolizedKcal:number(own(totals,'metabolizedKcal')),health:number(own(f,'health'),100),foodFeedbackEvents:number(own(stats,'independentMeals'),L.counter),independentDrinks:number(own(stats,'independentDrinks'),L.counter)};
 if(existing!==undefined){out.qualitative={};for(const [key,values] of Object.entries(qualitative)){const v=own(existing,key);out.qualitative[key]=values.includes(v)?v:null;}}return out;
}
function context(token){if(!token||typeof token!=='object')return null;const c=tokens.get(token);return c&&store(c.actor)===c.store&&c.store.current===token?c:null;}
function archive(token,status){const c=context(token);if(!c)return;const s=c.store;c.record.status=status;s.records.push(c.record);if(s.records.length>L.records){s.records.shift();increment(s.counters,'evictedRecords');}increment(s.counters,status==='selected'?'finished':status);s.current=null;tokens.delete(token);}
function copy(value){if(Array.isArray(value))return value.map(copy);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)]));return value;}

export function beginSurvivalDecision(actor,existingBody){try{const s=store(actor,true);if(!s)return null;if(s.current)archive(s.current,'superseded');increment(s.counters,'begun');const token=Object.freeze({});const record={sequence:s.counters.begun,epoch:number(own(actor,'epoch')),at:number(own(actor,'elapsed')),status:'active',body:body(actor,existingBody),phases:{urgentFood:'not-visited',ordinaryFood:'not-visited',learnedRun:'not-visited',optional:'not-visited'},notes:[],requestedType:null,actualType:null,requestedNeed:null,actualNeed:null};tokens.set(token,{actor,store:s,record});s.current=token;return token;}catch{return null;}}
export function noteSurvivalDecision(token,code,count=1){try{const c=context(token);if(!c)return;if(!codes.has(code)||!Number.isSafeInteger(count)||count<0){increment(c.store.counters,'rejectedNotes');return;}count=Math.min(count,L.counter);increment(c.store.gateCounts,code,count);const phase={'urgent-food':'urgentFood','ordinary-food':'ordinaryFood','learned-run':'learnedRun',optional:'optional'};const [kind,name]=code.split(':');if((kind==='visit'||kind==='enter')&&phase[name]){const key=phase[name];if(kind==='enter'||c.record.phases[key]!=='entered')c.record.phases[key]=kind==='enter'?'entered':'visited';}if(c.record.notes.length<L.notes)c.record.notes.push({code,count});else increment(c.store.counters,'droppedNotes');}catch{}}
export function noteCurrentSurvivalDecision(actor,code,count=1){try{const s=store(actor);if(s?.current)noteSurvivalDecision(s.current,code,count);}catch{}}
export function finishSurvivalDecision(token,requestedAction,result,requestedNeed){try{const c=context(token);if(!c)return;const requested=own(requestedAction,'type'),actual=own(own(result,'action'),'type'),actualNeed=own(result,'need');c.record.requestedType=actionTypes.has(requested)?requested:null;c.record.actualType=actionTypes.has(actual)?actual:null;c.record.requestedNeed=needs.has(requestedNeed)?requestedNeed:null;c.record.actualNeed=needs.has(actualNeed)?actualNeed:null;archive(token,'selected');}catch{}}
export function closeSurvivalDecision(token){try{archive(token,'incomplete');}catch{}}
export function survivalDecisionSnapshot(actor){try{const s=store(actor),empty=fresh({discovery:null,physiology:null});return {version:1,limits:{...L},body:body(actor),counters:copy((s||empty).counters),gateCounts:copy((s||empty).gateCounts),records:copy(s?.records||[]),active:Boolean(s?.current)};}catch{return null;}}
