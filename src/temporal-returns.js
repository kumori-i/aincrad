/** Experimental observed-trajectory prediction. No world/body access or action policy. */
import { temporalCapacityFor } from './temporal-capacity.js';
export const TEMPORAL_LIMITS=Object.freeze({rows:4096,transitions:512,forecast:10000,sweeps:8,alpha:.2,halfLifeSeconds:300});
export const TEMPORAL_CHANNELS=Object.freeze(['food','water','harm','time','work']);
export const TEMPORAL_OPERATIONS=Object.freeze(['inspect_object','grasp','release','pull','sample','strike','move','wait','rest','sleep','observe','say','ask_human','journal_reply','write_note','read_note','enter_shelter','exit_shelter','fill_flask','drink']);
const BETA=Math.log(2)/TEMPORAL_LIMITS.halfLifeSeconds;
const zero=()=>[0,0,0,0,0];
const finite=v=>Number.isFinite(v)&&v>=0;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,n=100)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,'').slice(0,n):'unknown';
const bodyEnums={hunger:['content','peckish','hungry','ravenous','faint with hunger'],thirst:['quenched','dry mouth','thirsty','parched','desperate thirst'],energy:['steady','waning','low','depleted'],stamina:['easy breathing','breathing hard','winded','exhausted'],fatigue:['fresh','tired','weary','exhausted'],pain:['none','aching','hurting','severe'],digestion:['empty','settled','full','overfull']};
const oneOf=(v,allowed)=>allowed.includes(v)?v:'unknown';
/** Canonical public context. Opaque bindings and all unlisted fields are excluded. */
export function temporalContext(raw={}){
 raw=raw&&typeof raw==='object'?raw:{};
 const body=Object.fromEntries(Object.entries(bodyEnums).map(([k,values])=>[k,oneOf(raw.body?.[k],values)]));
 const appearance=Object.fromEntries(['shape','color','texture','motion','size','smell'].map(k=>[k,text(raw.appearance?.[k])]));
 const exposures=[],counts=new Uint8Array(64),scopes=['own','other'],ages=['<45','45..180','180..600','>600'];
 // The same bounded public counts, accumulated once rather than scanning each bin.
 for(const e of (Array.isArray(raw.exposures)?raw.exposures:[])){
  const scope=scopes.indexOf(e?.scope),age=ages.indexOf(e?.age),channels=e?.channels;
  if(scope<0||age<0||!integer(channels)||channels>7||!integer(e.count))continue;
  const i=(scope*4+age)*8+channels;counts[i]=Math.min(2,counts[i]+Math.min(2,e.count));
 }
 for(const scope of scopes)for(const age of ages)for(let channels=0;channels<8;channels++){
  const count=counts[(scopes.indexOf(scope)*4+ages.indexOf(age))*8+channels];
  if(count)exposures.push({scope,age,channels,count});
 }
 return {body,appearance,warmth:oneOf(raw.warmth,['hot','warm','cold','cool','comfortable']),shelter:oneOf(raw.shelter,['sheltered','open air']),relation:oneOf(raw.relation,['held','reach','route']),focus:raw.focus===true,outputOfFocus:raw.outputOfFocus===true,heldCount:integer(raw.heldCount)?Math.min(4,raw.heldCount):0,countBand:oneOf(raw.countBand,['0','1','2+']),workBand:oneOf(raw.workBand,['0','1','2..3','4..7','8..15','16+']),history:(Array.isArray(raw.history)?raw.history:[]).slice(-2).map(h=>({operation:oneOf(h?.operation,TEMPORAL_OPERATIONS),outcome:oneOf(h?.outcome,['success','physical failure','refused','canceled','unknown'])})),exposures,historyCensored:raw.historyCensored===true};
}
// Lossless positional encoding avoids repeating property names for every exposure.
// The digits are public count bands in fixed (scope, age, channel) order, never IDs.
const APPEARANCE_FIELDS=['shape','color','texture','motion','size','smell'];
const EXPOSURE_SCOPES=['own','other'],EXPOSURE_AGES=['<45','45..180','180..600','>600'];
export function temporalKey(context,operation){
 if(!TEMPORAL_OPERATIONS.includes(operation))throw new TypeError('Unknown temporal operation');
 const c=temporalContext(context),counts=Array(64).fill(0);
 for(const e of c.exposures)counts[(EXPOSURE_SCOPES.indexOf(e.scope)*4+EXPOSURE_AGES.indexOf(e.age))*8+e.channels]=e.count;
 return JSON.stringify([1,operation,Object.keys(bodyEnums).map(k=>c.body[k]),APPEARANCE_FIELDS.map(k=>c.appearance[k]),[c.warmth,c.shelter,c.relation,c.focus,c.outputOfFocus,c.heldCount,c.countBand,c.workBand],c.history.map(h=>[h.operation,h.outcome]),counts.join(''),c.historyCensored]);
}
/** Canonical public key validation; decoding never adds non-observed features. */
export function decodeTemporalKey(key){
 if(typeof key!=='string'||key.length>4096)return null;
 try{
  const [version,operation,body,appearance,other,history,counts,historyCensored]=JSON.parse(key);
  if(version!==1||!TEMPORAL_OPERATIONS.includes(operation)||!Array.isArray(body)||!Array.isArray(appearance)||!Array.isArray(other)||!Array.isArray(history)||typeof counts!=='string'||!/^\d{64}$/.test(counts))return null;
  const exposures=[];for(let i=0;i<64;i++)if(counts[i]!=='0')exposures.push({scope:EXPOSURE_SCOPES[Math.floor(i/32)],age:EXPOSURE_AGES[Math.floor(i/8)%4],channels:i%8,count:Number(counts[i])});
  const context=temporalContext({body:Object.fromEntries(Object.keys(bodyEnums).map((k,i)=>[k,body[i]])),appearance:Object.fromEntries(APPEARANCE_FIELDS.map((k,i)=>[k,appearance[i]])),warmth:other[0],shelter:other[1],relation:other[2],focus:other[3],outputOfFocus:other[4],heldCount:other[5],countBand:other[6],workBand:other[7],history:history.map(h=>({operation:h?.[0],outcome:h?.[1]})),exposures,historyCensored});
  return temporalKey(context,operation)===key?{operation,context}:null;
 }catch{return null;}
}
const cleanKey=key=>decodeTemporalKey(key)?key:null;
export const temporalDiscount=seconds=>finite(seconds)?Math.exp(-BETA*seconds):0;
/** Discounted integral of a public per-minute rate over [from,to] after interval start. */
export function temporalIntegral(from,to,rate=1){if(!finite(from)||!finite(to)||to<from||!finite(rate))throw new TypeError('Invalid temporal interval');return rate*Math.exp(-BETA*from)*(-Math.expm1(-BETA*(to-from)))/(60*BETA);}
export function createTemporalReturns(){return {version:1,rows:[],transitions:[],lastClosedSeq:0,updateCount:0,saturated:false,numericalGuard:false,historyCensored:false};}
function rowFor(model,key,create=false){let r=model.rows.find(r=>r.key===key);if(!r&&create){if(model.rows.length>=(temporalCapacityFor(model)?.rows??TEMPORAL_LIMITS.rows)){model.saturated=true;return null;}r={key,q:zero(),visits:0,updates:0,lastAt:0};model.rows.push(r);}return r;}
export function temporalPrediction(model,key){const r=rowFor(model,key);return r?{q:[...r.q],visits:r.visits,known:r.visits>0}:{q:zero(),visits:0,known:false};}
function cleanTransition(t,elapsed=Infinity){
 if(!t||!integer(t.seq)||t.seq<1||t.seq>1e9||!integer(t.nextSeq)||t.nextSeq>1e9||t.nextSeq<=t.seq||!finite(t.startAt)||!finite(t.endAt)||t.endAt<t.startAt||t.endAt>elapsed||!cleanKey(t.key)||!cleanKey(t.nextKey)||!Array.isArray(t.reward)||t.reward.length!==5||Array.from(t.reward).some(v=>!finite(v)||v>TEMPORAL_LIMITS.forecast))return null;
 return {seq:t.seq,nextSeq:t.nextSeq,startAt:t.startAt,endAt:t.endAt,key:t.key,nextKey:t.nextKey,reward:[...t.reward]};
}
/** Admission requires the caller's canonical completed receipt; repeated replay is not a visit. */
export function appendTemporalTransition(model,raw){
 const t=cleanTransition(raw),last=model.transitions.at(-1);if(!t||t.seq<=model.lastClosedSeq||last&&t.startAt<last.endAt)return false;
 model.lastClosedSeq=t.seq;const row=rowFor(model,t.key,true);if(row){row.visits=Math.min(1e9,row.visits+1);row.lastAt=t.endAt;}rowFor(model,t.nextKey,true);
 model.transitions.push(t);if(model.transitions.length>(temporalCapacityFor(model)?.transitions??TEMPORAL_LIMITS.transitions)){model.transitions.shift();model.historyCensored=true;}return true;
}
/** Actual-successor full returns; each sweep reads a frozen table and updates each row once. */
export function trainTemporalReturns(model,{mode='online',rewardView=null}={}){
 if(mode==='frozen')return {targets:0,updatedRows:0};
 if(!['online','immediate','permuted'].includes(mode))throw new TypeError('Unknown temporal training mode');
 if(mode==='permuted'&&(!Array.isArray(rewardView)||rewardView.length!==model.transitions.length||rewardView.some(v=>!Array.isArray(v)||v.length!==3||Array.from(v).some(x=>!finite(x)||x>TEMPORAL_LIMITS.forecast))))throw new TypeError('Invalid learner-only permutation');
 if(mode==='permuted'){const signature=rows=>rows.map(v=>JSON.stringify(v)).sort().join('|');if(signature(rewardView)!==signature(model.transitions.map(t=>t.reward.slice(0,3))))throw new TypeError('Permutation must preserve observed biological returns');}
 let targets=0,updatedRows=0;const rowIndex=new Map(model.rows.map(r=>[r.key,r]));
 for(let sweep=0;sweep<TEMPORAL_LIMITS.sweeps;sweep++){
  // Rows remain immutable throughout target construction; defer all writes below.
  // Reading this index is the frozen sweep snapshot without copying unused rows.
  const grouped=new Map();let carry=null;
  for(let i=model.transitions.length-1;i>=0;i--){
   const t=model.transitions[i],next=model.transitions[i+1],continuous=next&&next.seq===t.nextSeq&&next.key===t.nextKey&&next.startAt===t.endAt;
   const tail=continuous?carry:(rowIndex.get(t.nextKey)?.q||zero()),r=mode==='permuted'?[...rewardView[i],...t.reward.slice(3)]:t.reward;
   const g=r.map((v,c)=>v+(mode==='immediate'?0:temporalDiscount(t.endAt-t.startAt)*tail[c]));carry=g;targets++;
   let group=grouped.get(t.key);if(!group){group={sum:zero(),count:0};grouped.set(t.key,group);}group.count++;g.forEach((v,c)=>group.sum[c]+=v);
  }
  for(const [key,g]of grouped){const row=rowIndex.get(key);if(!row)continue;row.q=row.q.map((v,c)=>{const q=v+TEMPORAL_LIMITS.alpha*(g.sum[c]/g.count-v);if(!finite(q)||q>TEMPORAL_LIMITS.forecast)model.numericalGuard=true;return Math.max(0,Math.min(TEMPORAL_LIMITS.forecast,Number.isFinite(q)?q:0));});row.updates=Math.min(1e9,row.updates+1);updatedRows++;}
  model.updateCount=Math.min(1e9,model.updateCount+1);
 }
 return {targets,updatedRows};
}
/** Durable forecasts are allowlisted parameters, not proof or executable skill knowledge. No restore training. */
export function validateTemporalReturns(raw,elapsed=Infinity){
 const model=createTemporalReturns();if(raw?.version!==1)return model;const keys=new Set();
 for(const r of (Array.isArray(raw.rows)?raw.rows:[]).slice(0,TEMPORAL_LIMITS.rows)){
  const key=cleanKey(r?.key);if(!key||keys.has(key)||!Array.isArray(r.q)||r.q.length!==5||Array.from(r.q).some(v=>!finite(v))||!integer(r.visits)||!integer(r.updates)||!finite(r.lastAt)||r.lastAt>elapsed)continue;
  if(r.q.some(v=>v>TEMPORAL_LIMITS.forecast))model.numericalGuard=true;
  keys.add(key);model.rows.push({key,q:r.q.map(v=>Math.min(TEMPORAL_LIMITS.forecast,v)),visits:Math.min(1e9,r.visits),updates:Math.min(1e9,r.updates),lastAt:r.lastAt});
 }
 model.lastClosedSeq=integer(raw.lastClosedSeq)?Math.min(1e9,raw.lastClosedSeq):0;
 let lastSeq=0,lastEnd=0;
 for(const rawT of (Array.isArray(raw.transitions)?raw.transitions:[]).slice(-TEMPORAL_LIMITS.transitions)){const t=cleanTransition(rawT,elapsed);if(!t||t.seq<=lastSeq||t.startAt<lastEnd||t.seq>model.lastClosedSeq)continue;model.transitions.push(t);lastSeq=t.seq;lastEnd=t.endAt;}
 model.updateCount=integer(raw.updateCount)?Math.min(1e9,raw.updateCount):0;
 model.saturated=raw.saturated===true||model.rows.length>=TEMPORAL_LIMITS.rows;model.numericalGuard||=raw.numericalGuard===true;model.historyCensored=raw.historyCensored===true;return model;
}
