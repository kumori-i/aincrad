// Process-local observer counts for the ordinary character channel. The live
// rows are references to its diagnostic events; snapshots copy only an
// allowlist and never expose crops, object bindings, or learning authority.
export const CHARACTER_MEASUREMENT_LIMITS=Object.freeze({eventRows:256,censorReasons:64,counter:2147483647});

const KEYS=Object.freeze([
  'optionalChecks','feasibleOpportunities','emissions','paidInspectionStarts',
  'paidInspectionCompletions','paidInspectionOutcomeUnavailable',
  'paidReplyStarts','paidReplyCompletions','paidReplyOutcomeUnavailable',
  'canonicalDemonstrations','criticCorrect',
  'validListenerDemonstrations','ambiguousListenerLabels','rejectedListenerLabels',
  'listenerReplayUses','listenerOptimizerSteps','visualMatches','visualMismatches',
  'senderUpdates','originalCensors','responseCensors',
]);
const KEY_SET=new Set(KEYS);
const MAX=CHARACTER_MEASUREMENT_LIMITS.counter;
const safeNumber=value=>Number.isFinite(value)&&value>=0&&value<=1e12?value:null;
const safeCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX?value:null;
const safeId=value=>Number.isSafeInteger(value)&&value>0?value:null;
const safeText=value=>typeof value==='string'&&value.length<=64?value:null;
const safeCode=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value)?value:null;
const safeName=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value)?value:null;
const safeBoolean=value=>typeof value==='boolean'?value:null;
const reasonCode=value=>safeCode(value)??'unknown';

function copyActorBody(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return {
    lifecycle:safeText(value.lifecycle),hunger:safeText(value.hunger),
    thirst:safeText(value.thirst),energy:safeText(value.energy),
    pain:safeText(value.pain),overall:safeText(value.overall),
    urgent:safeBoolean(value.urgent),collapses:safeCount(value.collapses),
    meals:safeCount(value.meals),drinks:safeCount(value.drinks),
  };
}
function copyBody(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return {sender:copyActorBody(value.sender),receiver:copyActorBody(value.receiver)};
}
function copyEvent(event){
  return {
    id:safeId(event.id),emittedAt:safeNumber(event.emittedAt),
    senderObservedAt:safeNumber(event.senderObservedAt),
    receiverObservedAt:safeNumber(event.receiverObservedAt),
    demonstrationObservedAt:safeNumber(event.demonstrationObservedAt),
    endedAt:safeNumber(event.endedAt),observedSeconds:safeNumber(event.observedSeconds),
    senderId:safeName(event.senderId),receiverId:safeName(event.receiverId),
    message:typeof event.message==='string'&&/^[a-z]{1,6}$/.test(event.message)?event.message:null,
    action:safeCode(event.action),choiceMode:safeCode(event.choiceMode),
    choiceReason:safeCode(event.choiceReason),
    status:safeCode(event.status),reason:safeCode(event.reason),
    correction:safeCode(event.correction),feedbackStatus:safeCode(event.feedbackStatus),
    feedbackReason:safeCode(event.feedbackReason),
    selectedActionId:safeId(event.selectedActionId),
    indicationActionId:safeId(event.indicationActionId),
    responseActionId:safeId(event.responseActionId),
    referenceCorrect:safeBoolean(event.referenceCorrect),
    listenerReplayUses:safeCount(event.listenerReplayUses),
    listenerUpdate:safeBoolean(event.listenerUpdate),senderUpdate:safeBoolean(event.senderUpdate),
    bodyAtEmission:copyBody(event.bodyAtEmission),
    bodyAtDemonstration:copyBody(event.bodyAtDemonstration),
    bodyAtEnd:copyBody(event.bodyAtEnd),
  };
}

export function createCharacterCommunicationMeasurement({
  eventRows=CHARACTER_MEASUREMENT_LIMITS.eventRows,
  censorReasons=CHARACTER_MEASUREMENT_LIMITS.censorReasons,
}={}){
  if(!Number.isInteger(eventRows)||eventRows<1||eventRows>CHARACTER_MEASUREMENT_LIMITS.eventRows||
      !Number.isInteger(censorReasons)||censorReasons<1||censorReasons>CHARACTER_MEASUREMENT_LIMITS.censorReasons)
    throw new RangeError('Invalid character measurement bounds');
  const rows=[],counts=Object.fromEntries(KEYS.map(key=>[key,0])),reasons=new Map();
  let reasonOverflow=0,eventsEvicted=0,eventsRetired=0,saturated=false;
  const increment=(value,amount)=>{
    if(amount>MAX-value){saturated=true;return MAX;}
    return value+amount;
  };
  function count(key,amount=1){
    if(!KEY_SET.has(key)||!Number.isSafeInteger(amount)||amount<0)return false;
    counts[key]=increment(counts[key],amount);
    return true;
  }
  function censor(kind,stage,reason){
    if(kind!=='original'&&kind!=='response')return false;
    count(kind==='original'?'originalCensors':'responseCensors');
    const row={kind,stage:reasonCode(stage),reason:reasonCode(reason)};
    const key=`${row.kind}:${row.stage}:${row.reason}`;
    const existing=reasons.get(key);
    if(existing)existing.count=increment(existing.count,1);
    else if(reasons.size<censorReasons)reasons.set(key,{...row,count:1});
    else reasonOverflow=increment(reasonOverflow,1);
    return true;
  }
  function retain(event){
    if(!event||typeof event!=='object'||Array.isArray(event)||rows.includes(event))return false;
    if(rows.length===eventRows){rows.shift();eventsEvicted=increment(eventsEvicted,1);}
    rows.push(event);
    return true;
  }
  function retire(ids){
    if(!(ids instanceof Set))return 0;
    let removed=0;
    for(let index=rows.length-1;index>=0;index--){
      if(ids.has(rows[index].senderId)||ids.has(rows[index].receiverId)){
        rows.splice(index,1);removed++;
      }
    }
    eventsRetired=increment(eventsRetired,removed);
    return removed;
  }
  function snapshot(){
    return {version:1,limits:{eventRows,censorReasons,counter:MAX},
      counts:{...counts},reasons:[...reasons.values()].map(row=>({...row})),
      reasonOverflow,eventsRetained:rows.length,eventsEvicted,eventsRetired,saturated,
      events:rows.map(copyEvent)};
  }
  // The attachment keeps this stable internal array so its existing journal
  // reads the same mutable event rows. Only snapshot() crosses into the UI.
  return Object.freeze({rows,count,censor,retain,retire,snapshot});
}
