/** Bounded canonical observations for a scripted temporal-learning feasibility arm.
 * No ecology lookup, private physiology, policy choice, or automatic runtime hook.
 */
import { createTemporalReturns,validateTemporalReturns,temporalKey,decodeTemporalKey,temporalDiscount,temporalIntegral,appendTemporalTransition } from './temporal-returns.js';
import { prepareTemporalStorage,admitTemporalContext,decodeTemporalWire,encodeTemporalWire } from './temporal-storage.js';
const MAX=256,MAX_RECEIPTS=768;
const finite=v=>Number.isFinite(v)&&v>=0;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const objectId=v=>typeof v==='string'&&/^object:\d{1,9}$/.test(v);
function sequenceId(value,prefix){if(typeof value!=='string'||value.length>prefix.length+11||!value.startsWith(prefix+':'))return null;const suffix=value.slice(prefix.length+1);if(!/^[1-9]\d{0,9}$/.test(suffix))return null;const n=Number(suffix);return n<=1e9?n:null;}
const ingestionId=v=>sequenceId(v,'ingestion')!==null;
const sourceSequence=id=>sequenceId(id,'feedback');
const workDuration=o=>o.workedSeconds??o.durationSeconds;
const text=(v,n=60)=>typeof v==='string'?v.slice(0,n):'';
function cleanAction(a){if(!a||typeof a.type!=='string')return null;try{temporalKey({},a.type);}catch{return null;}return {type:a.type,...(objectId(a.targetId)?{targetId:a.targetId}:{}),...(finite(a.seconds)&&a.seconds<=1200?{seconds:a.seconds}:{}),...(a.target&&Number.isFinite(a.target.x)&&Number.isFinite(a.target.y)&&Math.abs(a.target.x)<=24000&&Math.abs(a.target.y)<=24000?{target:{x:a.target.x,y:a.target.y}}:{})};}
export function createTemporalLedger(){return prepareTemporalStorage({version:1,model:createTemporalReturns(),nextSeq:1,eventOrder:0,clockAt:0,feedbackCursor:0,creditBlocked:false,open:null,receipts:[],ingestions:[],events:[],totals:[0,0,0],rejectedEvents:0,censoredEvents:0,historyCensored:false});}
function advance(memory,at){if(!finite(at)||at<memory.clockAt)throw new TypeError('Temporal clock cannot reverse');if(!integer(memory.eventOrder)||memory.eventOrder>=1e9)throw new RangeError('Temporal event order exhausted');memory.clockAt=at;memory.eventOrder++;}
function rewardTime(open,at){if(open.unknownContext){open.accountedUntil=at;return;}open.reward[3]+=temporalIntegral(open.accountedUntil-open.startAt,at-open.startAt);open.accountedUntil=at;}
function censorOwners(memory,owners){if(!owners.size)return;if(memory.open&&owners.has(memory.open.seq))memory.open=null;memory.model.transitions=memory.model.transitions.filter(t=>!owners.has(t.seq));memory.model.historyCensored=true;memory.historyCensored=true;}
/** Actual submission only. Opening/closing itself does not train or choose an action. */
export function beginTemporalDecision(memory,{at,context,action}){
 if(!integer(memory.nextSeq)||memory.nextSeq<1||memory.nextSeq>=1e9)throw new RangeError('Temporal submission order exhausted');
 const request=cleanAction(action);if(!request)throw new TypeError('Invalid actual temporal action');const candidateKey=temporalKey(context,request.type);advance(memory,at);
 const key=admitTemporalContext(memory,candidateKey)?candidateKey:null,unknown=key===null?{unknownContext:true}:{};
 const seq=memory.nextSeq++;if(memory.open){
  rewardTime(memory.open,at);
  if(memory.open.key!==null&&key!==null)appendTemporalTransition(memory.model,{seq:memory.open.seq,nextSeq:seq,startAt:memory.open.startAt,endAt:at,key:memory.open.key,nextKey:key,reward:memory.open.reward});
  else {memory.model.lastClosedSeq=Math.max(memory.model.lastClosedSeq,memory.open.seq);memory.model.historyCensored=true;memory.historyCensored=true;}
 }
 memory.open={seq,startAt:at,key,...unknown,request,order:memory.eventOrder,accountedUntil:at,reward:[0,0,0,0,0]};
 memory.receipts.push({seq,at,key,...unknown,request,order:memory.eventOrder});
 while(memory.receipts.length>MAX_RECEIPTS){const lost=memory.receipts.shift();censorOwners(memory,new Set([lost.seq]));const ing=memory.ingestions.filter(x=>x.seq===lost.seq);if(ing.length){const ids=new Set(ing.map(x=>x.id)),owners=new Set(memory.events.filter(e=>ids.has(e.ingestionId)).map(e=>e.owner));censorOwners(memory,owners);memory.events=memory.events.filter(e=>!ids.has(e.ingestionId));memory.ingestions=memory.ingestions.filter(x=>!ids.has(x.id));}}
 return seq;
}
/** Completion copies only the actual bounded public receipt; it never supplies reward for success. */
export function completeTemporalDecision(memory,{seq,at,actionId,result}){
 if(!integer(seq)||!finite(at))return false;const receipt=memory.receipts.find(r=>r.seq===seq);if(!receipt||receipt.outcome||at<receipt.at||at>memory.clockAt)return false;
 const outcome={ok:result?.ok===true,code:text(result?.code),durationSeconds:finite(result?.durationSeconds)?Math.min(1200,result.durationSeconds):0,...(finite(result?.workedSeconds)?{workedSeconds:Math.min(1200,result.workedSeconds)}:{}),...(integer(actionId)&&actionId>0&&actionId<=1e9?{actionId}:{}),...(ingestionId(result?.ingestionId)?{ingestionId:result.ingestionId}:{}),...(objectId(result?.materialId)?{materialId:result.materialId}:{}),...(['light','moderate','strenuous'].includes(result?.exertion)?{exertion:result.exertion}:{})};
 receipt.outcome=outcome;receipt.completedAt=at;
 if(receipt.request.type==='sample'&&outcome.ok&&outcome.code==='SWALLOWED'&&outcome.actionId&&outcome.ingestionId&&objectId(receipt.request.targetId)&&!memory.ingestions.some(i=>i.id===outcome.ingestionId)){
  memory.ingestions.push({id:outcome.ingestionId,objectId:receipt.request.targetId,actionId:outcome.actionId,seq,at,channels:0,channelProof:{},creditBlocked:false});
  if(memory.ingestions.length>MAX){const lost=memory.ingestions.shift(),owners=new Set(memory.events.filter(e=>e.ingestionId===lost.id).map(e=>e.owner));censorOwners(memory,owners);memory.events=memory.events.filter(e=>e.ingestionId!==lost.id);memory.historyCensored=true;}
 }
 // A felt label describes only completed real work, never a refusal. In this
 // serial feasibility adapter, the actual work is contained in its open interval.
 if(outcome.exertion&&workDuration(outcome)>0&&memory.open?.seq===seq&&!memory.open.unknownContext){const rank={light:1/3,moderate:2/3,strenuous:1}[outcome.exertion],start=Math.max(receipt.at,at-workDuration(outcome));memory.open.reward[4]+=temporalIntegral(start-memory.open.startAt,at-memory.open.startAt,rank);}
 return true;
}
/** Advance elapsed accounting without inventing a decision; used at native physical ticks. */
export function advanceTemporalClock(memory,at){advance(memory,at);}
/** Capture newly emitted public biological feedback, including while asleep. */
export function recordTemporalFeedback(memory,event,{now=memory.clockAt}={}){
 const sourceSeq=sourceSequence(event?.id);if(!integer(sourceSeq)||sourceSeq<1||sourceSeq>1e9){memory.rejectedEvents++;return false;}if(sourceSeq<=memory.feedbackCursor)return false;
 memory.feedbackCursor=sourceSeq;
 if(memory.creditBlocked){memory.censoredEvents++;return false;}
 if(!finite(now)||now<memory.clockAt||!finite(event.at)||event.at!==now||event.provenance!=='sampled'||!ingestionId(event.ingestionId)||!objectId(event.objectId)||!integer(event.actionId)||event.actionId<1||event.actionId>1e9){memory.rejectedEvents++;return false;}
 advance(memory,now);const ingestion=memory.ingestions.find(i=>i.id===event.ingestionId&&i.objectId===event.objectId&&i.actionId===event.actionId&&i.at<=event.at);
 if(!ingestion){memory.censoredEvents++;return false;}
 let channels=0;if(event.effect==='sustained')channels|=1;if(event.thirst==='easing')channels|=2;if(event.effect==='discomfort')channels|=4;
 channels&=~ingestion.channels;ingestion.channels|=channels;if(!channels)return false;
 for(let c=0;c<3;c++)if(channels&(1<<c))ingestion.channelProof[c]={sourceSeq,at:event.at};
 // Consumed but unowned observations cannot be moved to a later decision.
 if(ingestion.creditBlocked||!memory.open||memory.open.unknownContext===true||event.at<memory.open.startAt){memory.censoredEvents++;return false;}
 const row={sourceSeq,id:event.id,ingestionId:ingestion.id,objectId:ingestion.objectId,actionId:ingestion.actionId,at:event.at,order:memory.eventOrder,owner:memory.open.seq,channels};memory.events.push(row);
 for(let c=0;c<3;c++)if(channels&(1<<c)){memory.totals[c]++;memory.open.reward[c]+=temporalDiscount(event.at-memory.open.startAt);}
 if(memory.events.length>MAX){const lost=memory.events.shift();censorOwners(memory,new Set([lost.owner]));memory.historyCensored=true;}
 return true;
}
/** Pure bounded restoration; never trains, emits reward, or infers completion. */
export function validateTemporalLedger(raw,elapsed,{sourceFeedback=[]}={}){
 const memory=createTemporalLedger();if(raw?.version!==1||!finite(elapsed))return memory;
 raw=decodeTemporalWire(raw);const savedKeys=raw.contextKeys;
 memory.model=validateTemporalReturns(raw.model,elapsed);memory.nextSeq=integer(raw.nextSeq)&&raw.nextSeq>0?Math.min(1e9,raw.nextSeq):1;memory.eventOrder=integer(raw.eventOrder)?Math.min(1e9,raw.eventOrder):0;memory.clockAt=finite(raw.clockAt)&&raw.clockAt<=elapsed?raw.clockAt:elapsed;memory.feedbackCursor=integer(raw.feedbackCursor)&&raw.feedbackCursor<=1e9?raw.feedbackCursor:0;memory.creditBlocked=raw.creditBlocked===true||!integer(raw.feedbackCursor)||raw.feedbackCursor>1e9;
 for(const event of (Array.isArray(sourceFeedback)?sourceFeedback:[]).slice(-256)){const seq=sourceSequence(event?.id);if(integer(seq)&&seq>0&&seq<=1e9&&(!finite(event.at)||event.at>elapsed))memory.feedbackCursor=Math.max(memory.feedbackCursor,seq);}
 for(const r of (Array.isArray(raw.receipts)?raw.receipts:[]).slice(-MAX_RECEIPTS).sort((a,b)=>(a?.seq??0)-(b?.seq??0))){
  const request=cleanAction(r?.request);if(!request||!integer(r.seq)||r.seq<1||r.seq>=memory.nextSeq||memory.receipts.some(x=>x.seq===r.seq)||!finite(r.at)||r.at>elapsed||!integer(r.order)||r.order>memory.eventOrder)continue;
  const unknown=r.key===null&&r.unknownContext===true,parsed=unknown?null:decodeTemporalKey(r.key);if(!unknown&&(!parsed||parsed.operation!==request.type))continue;const key=r.key;
  const previousReceipt=memory.receipts.at(-1);if(previousReceipt&&(r.at<previousReceipt.at||r.order<=previousReceipt.order))continue;
  const receipt={seq:r.seq,at:r.at,key,...(unknown?{unknownContext:true}:{}),request,order:r.order};memory.receipts.push(receipt);
  if(r.outcome&&finite(r.completedAt)&&r.completedAt>=r.at&&r.completedAt<=elapsed){const previous=memory.clockAt;memory.clockAt=elapsed;completeTemporalDecision(memory,{seq:r.seq,at:r.completedAt,actionId:r.outcome.actionId,result:r.outcome});memory.clockAt=previous;}
 }
 // Restore channel masks only against their canonical successful swallow receipt.
 const generated=memory.ingestions;memory.ingestions=[];
 for(const e of (Array.isArray(raw.events)?raw.events:[]).slice(-MAX)){const seq=sourceSequence(e?.id);if(integer(seq)&&seq>0&&seq<=1e9)memory.feedbackCursor=Math.max(memory.feedbackCursor,seq);}
 for(const i of (Array.isArray(raw.ingestions)?raw.ingestions:[]).slice(-MAX)){
  const proof=generated.find(p=>p.id===i?.id&&p.seq===i.seq&&p.at===i.at&&p.objectId===i.objectId&&p.actionId===i.actionId);if(!proof||memory.ingestions.some(x=>x.id===i.id))continue;
  const channelProof={};let channels=0;for(let c=0;c<3;c++){const p=i.channelProof?.[c];if(p&&integer(p.sourceSeq)&&p.sourceSeq>0&&p.sourceSeq<=memory.feedbackCursor&&finite(p.at)&&p.at>=i.at&&p.at<=elapsed){channelProof[c]={sourceSeq:p.sourceSeq,at:p.at};channels|=1<<c;}}
  const creditBlocked=i.creditBlocked===true||!integer(i.channels)||i.channels>7||i.channels!==channels||[0,1,2].some(c=>i.channelProof?.[c]&&!channelProof[c]);
  memory.ingestions.push({...proof,channels,channelProof,creditBlocked});
 }
 const ordered=memory.receipts.slice().sort((a,b)=>a.seq-b.seq);
 const owns=(receipt,event)=>receipt&&receipt.unknownContext!==true&&(receipt.at<event.at||receipt.at===event.at&&receipt.order<event.order)&&!ordered.some(n=>n.seq>receipt.seq&&(n.at<event.at||n.at===event.at&&n.order<event.order));
 for(const e of (Array.isArray(raw.events)?raw.events:[]).slice(-MAX).sort((a,b)=>(a?.sourceSeq??0)-(b?.sourceSeq??0))){
  if(!e||!integer(e.sourceSeq)||e.sourceSeq!==sourceSequence(e.id)||e.sourceSeq>memory.feedbackCursor||memory.events.some(x=>x.sourceSeq===e.sourceSeq)||!finite(e.at)||e.at>elapsed||!integer(e.order)||e.order>memory.eventOrder||!integer(e.channels)||e.channels<1||e.channels>7)continue;
  const previousEvent=memory.events.at(-1);if(previousEvent&&(e.at<previousEvent.at||e.order<=previousEvent.order))continue;
  const ingestion=memory.ingestions.find(i=>i.id===e.ingestionId&&i.objectId===e.objectId&&i.actionId===e.actionId&&i.at<=e.at&&(i.channels&e.channels)===e.channels),receipt=memory.receipts.find(r=>r.seq===e.owner);
  if(!ingestion||!owns(receipt,e)||[0,1,2].some(c=>(e.channels&(1<<c))&&(ingestion.channelProof[c]?.sourceSeq!==e.sourceSeq||ingestion.channelProof[c]?.at!==e.at)))continue;
  memory.events.push({sourceSeq:e.sourceSeq,id:e.id,ingestionId:e.ingestionId,objectId:e.objectId,actionId:e.actionId,at:e.at,order:e.order,owner:e.owner,channels:e.channels});
 }
 const canonicalReward=(receipt,endAt)=>{if(receipt.unknownContext)return [0,0,0,0,0];const reward=[0,0,0,temporalIntegral(0,endAt-receipt.at),0];for(const e of memory.events.filter(e=>e.owner===receipt.seq))for(let c=0;c<3;c++)if(e.channels&(1<<c))reward[c]+=temporalDiscount(e.at-receipt.at);const o=receipt.outcome;if(o?.exertion&&workDuration(o)>0&&receipt.completedAt<=endAt){const rank={light:1/3,moderate:2/3,strenuous:1}[o.exertion];reward[4]=temporalIntegral(Math.max(0,receipt.completedAt-workDuration(o)-receipt.at),receipt.completedAt-receipt.at,rank);}return reward;};
 const matches=(a,b)=>a.length===b.length&&a.every((v,c)=>Math.abs(v-b[c])<=1e-10);
 memory.model.transitions=memory.model.transitions.filter(t=>{const r=memory.receipts.find(r=>r.seq===t.seq),n=memory.receipts.find(r=>r.seq===t.nextSeq);return r&&n&&r.key!==null&&n.key!==null&&t.nextSeq===t.seq+1&&r.key===t.key&&n.key===t.nextKey&&r.at===t.startAt&&n.at===t.endAt&&matches(t.reward,canonicalReward(r,t.endAt));});
 const r=raw.open,receipt=memory.receipts.find(x=>x.seq===r?.seq);
 if(receipt&&r.seq===memory.nextSeq-1&&r.key===receipt.key&&r.startAt===receipt.at&&r.order===receipt.order&&finite(r.accountedUntil)&&r.accountedUntil>=r.startAt&&r.accountedUntil<=memory.clockAt&&Array.isArray(r.reward)&&r.reward.length===5&&Array.from(r.reward).every(v=>finite(v)&&v<=10000)&&matches(r.reward,canonicalReward(receipt,r.accountedUntil).map((v,c)=>c===3?v:canonicalReward(receipt,memory.clockAt)[c])))memory.open={seq:r.seq,startAt:r.startAt,key:r.key,...(receipt.unknownContext?{unknownContext:true}:{}),request:receipt.request,order:r.order,accountedUntil:r.accountedUntil,reward:[...r.reward]};
 memory.totals=Array.isArray(raw.totals)&&raw.totals.length===3?Array.from(raw.totals,v=>integer(v)?Math.min(1e9,v):0):[0,0,0];
 for(const k of ['rejectedEvents','censoredEvents'])memory[k]=integer(raw[k])?Math.min(1e9,raw[k]):0;memory.historyCensored=raw.historyCensored===true;
 memory.storage=raw.storage;prepareTemporalStorage(memory,savedKeys);encodeTemporalWire(memory);
 return memory;
}
