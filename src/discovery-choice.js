/** Selection-consistency diagnostic. No new reward or movement-cost estimate. */
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sameAction=(a,b)=>canonical(a)===canonical(b);

export function consistentSelection(orderedChoices,nominee){
  const sponsor=orderedChoices[0];if(!sponsor)return null;
  if(sponsor.action.type==='move')return {selected:sponsor,sponsor,nominee:null,movement:sponsor,veto:false};
  const original=orderedChoices.find(c=>c.action===nominee?.action);
  if(!original||original.action.type==='move')throw Error('The nominated object must be an existing candidate by action identity.');
  const movement=orderedChoices.find(c=>c.action.type==='move')||null;
  const veto=Boolean(movement&&movement.score>original.score);
  return {selected:veto?movement:original,sponsor,nominee:original,movement,veto};
}

// Explicit developer instrumentation only. Nothing is added to actor state,
// observations, experience, journals, saves, or selection estimates.
const diagnostics=new WeakMap();
export function configureChoiceDiagnostics(npc,callback=null){
  if(typeof callback!=='function'){diagnostics.delete(npc);return;}
  diagnostics.set(npc,{callback,nextId:1,pending:null,submitting:null,active:null,error:null});
}
const describe=c=>c?{action:copy(c.action),legacyScore:c.score}:null;
export function choiceDiagnosticStatus(npc){const d=diagnostics.get(npc);return d?{configured:true,error:d.error?copy(d.error):null}:{configured:false,error:null};}
function emit(d,row){
  if(d.error)return;
  try{d.callback(copy(row));}catch(error){d.error={message:String(error?.message||error).slice(0,600),eventType:row.type,decisionId:row.decisionId};d.pending=null;d.submitting=null;d.active=null;}
}
export function beginChoiceDecision(npc){const d=diagnostics.get(npc);if(d&&!d.error)d.pending=null;}
export function traceChoice(npc,gate,ranked=null){
  const d=diagnostics.get(npc);if(!d||d.error)return;
  const record={decisionId:d.nextId++,at:npc.elapsed,sponsor:describe(gate.sponsor),nominee:describe(gate.nominee),movement:describe(gate.movement),winner:describe(gate.selected),veto:gate.veto,
    ...(ranked?{learnedScore:ranked.score,selection:copy(ranked.selection)}:{})};
  d.pending=record;emit(d,{type:'choice',...record});
}
export function beginChoiceRequest(npc,action){
  const d=diagnostics.get(npc);if(!d?.pending||d.error)return;
  const record=d.pending;d.pending=null;
  if(!sameAction(record.winner.action,action))throw Error('The submitted choice does not carry its own candidate score.');
  d.submitting=record;
}
export function finishChoiceRequest(npc,result){
  const d=diagnostics.get(npc);if(!d?.submitting||d.error)return;
  const record=d.submitting;d.submitting=null;
  if(npc.active){
    if(!sameAction(record.winner.action,npc.active.request))throw Error('The started action differs from its scored choice.');
    d.active={reference:npc.active,record};emit(d,{type:'started',decisionId:record.decisionId,at:npc.elapsed,action:copy(npc.active.request),legacyScore:record.winner.legacyScore});
  }else emit(d,{type:'rejected',decisionId:record.decisionId,at:npc.elapsed,action:record.winner.action,legacyScore:record.winner.legacyScore,result:copy(result)});
}
export function completeChoiceRequest(npc,active,request,result,event){
  const d=diagnostics.get(npc);if(!d||d.error)return;
  const record=d.active?.reference===active?d.active.record:d.submitting;
  if(!record)return;
  if(!sameAction(record.winner.action,request))throw Error('The completed action differs from its scored choice.');
  d.active=null;d.submitting=null;
  emit(d,{type:'outcome',decisionId:record.decisionId,actionId:event.id,at:event.at,action:copy(request),legacyScore:record.winner.legacyScore,result:{ok:result.ok,code:result.code,durationSeconds:result.durationSeconds||0}});
}
