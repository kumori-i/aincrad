// Offline observer only. Never imported by runtime policy or used to grant authority.
import {PROCEDURE_RECEIPT_LIMITS as L} from '../src/procedure-receipts.js';
import {validateLedgers,objectId,ingestionId} from '../src/receipt-proof.js';
import {createProcedureExperience} from '../src/procedure-experience.js';
const positive=x=>Number.isSafeInteger(x)&&x>0;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const rows=(x,max)=>Array.isArray(x)&&x.length<=max;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validExtras=e=>(e.materialId===undefined||objectId(e.materialId))&&(e.ingestionId===undefined||ingestionId(e.ingestionId));
function buildReport({world,history=[]}={}) {
 const report={version:1,observerOnly:true,authority:'none',historicalCoverage:'unknown',
  comparableRanking:'unproven',netBenefit:'unproven',actors:[]};
 const fail=reason=>freeze({...report,status:'unavailable',reason,actors:[]});
 if(!world||typeof world.worldLineage?.instanceId!=='string'||!world.worldLineage.instanceId||
  !rows(world.agents,100)||!rows(world.worldLineage.agents,100)||!rows(history,10000))return fail('invalid-input-scope');
 const ids=world.agents.map(a=>a?.id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)return fail('ambiguous-actor');
 for(const actor of world.agents){
  const lineage=world.worldLineage.agents.filter(l=>l?.agentId===actor.id);
  if(lineage.length!==1||!positive(lineage[0].serial))return fail('ambiguous-incarnation');
  const scope={worldId:world.worldLineage.instanceId,actorId:actor.id,serial:lineage[0].serial};
  const ref=(namespace,id)=>({...scope,namespace,id:typeof id==='string'||typeof id==='number'?id:null});
  const d=actor.discovery,receipts=actor.memory?.experience;
  if(!rows(d?.techniques,24)||!rows(d?.experiments,L.experiments)||!rows(d?.effects,64)||!rows(receipts,400)||!Number.isFinite(actor.elapsed))return fail('invalid-ledgers');
  const retained=validateLedgers({now:actor.elapsed,receiptsInput:receipts,experimentsInput:d.experiments,effectsInput:d.effects});
  const projection=createProcedureExperience(actor);
  if(projection.status!=='assessed')return fail('unavailable-retained-projection');
  const scopedHistory=history.filter(h=>h?.worldId===scope.worldId&&h?.actorId===scope.actorId&&h?.serial===scope.serial);
  // Historical recognition is a detached observer trace, never substituted into
  // the retained projection. Conflicting IDs poison the historical join.
  const historicalReceipts=[...receipts];
  for(const h of scopedHistory){const prior=historicalReceipts.filter(r=>r?.id===h.receipt?.id);
   if(!prior.length||!same(prior[0],h.receipt))historicalReceipts.push(h.receipt);}
  const historicalEffects=scopedHistory.filter(h=>h.receipt?.type==='condition'&&h.receipt.details?.code==='DISCOVERY_EFFECT')
   .map(h=>({...h.receipt.details.feedback,proofEventId:h.receipt.id}));
  const historical=validateLedgers({now:actor.elapsed,receiptsInput:historicalReceipts,
   experimentsInput:d.experiments,effectsInput:historicalEffects});
  const techniqueIds=d.techniques.map(t=>t?.id);
  const techniques=d.techniques.map(t=>{
   const result={technique:ref('technique',t?.id??null),status:'reported',links:[]};
   if(typeof t?.id!=='string'||techniqueIds.filter(id=>id===t.id).length!==1||!rows(t.evidence,16)||
    t.evidence.some(id=>!positive(id))||new Set(t.evidence).size!==t.evidence.length)return {...result,status:'invalid-technique-evidence'};
   result.links=t.evidence.map(id=>{
    const link={experiment:ref('experiment',id),status:'unresolved',retained:false,historicalTrace:false};
    const found=d.experiments.filter(e=>e?.id===id);
    if(found.length!==1)return {...link,reason:found.length?'ambiguous-experiment':'missing-experiment'};
    const e=found[0];if(!validExtras(e)||(e.primitive==='sample'&&e.ok&&!ingestionId(e.ingestionId)))return {...link,reason:'malformed-material-or-ingestion-reference'};if(!positive(e.actionId))return {...link,reason:'invalid-action-reference'};
    link.action=ref('action-receipt',e.actionId);
    const own=receipts.filter(r=>r?.id===e.actionId),past=scopedHistory.filter(h=>h.receipt?.id===e.actionId);
    link.historicalTrace=past.length>0;
    if(own.length>1||past.length>1)return {...link,reason:'ambiguous-action-receipt'};
    if(own.length&&past.length&&!same(own[0],past[0].receipt))return {...link,reason:'contradictory-historical-receipt'};
    if([...own,...past.map(h=>h.receipt)].some(r=>!validExtras(r?.details?.result??{})))return {...link,reason:'malformed-receipt-material-or-ingestion-reference'};
    if(!own.length){
     if(!past.length)return {...link,reason:'missing-action-receipt'};
     const check=validateLedgers({now:actor.elapsed,receiptsInput:[past[0].receipt],experimentsInput:[e],effectsInput:[]});
     return {...link,status:check.experiments.length?'historical-trace-only':'unresolved',reason:check.experiments.length?'not-retained-authority':'contradictory-historical-receipt'};
    }
    if(!retained.experiments.includes(e))return {...link,reason:'invalid-or-contradictory-retained-link'};
    link.status='retained-linked';link.retained=true;
    const episodes=projection.episodes.filter(p=>p.acquisition?.experimentId===id||p.samples.some(s=>s.experimentId===id));
    link.materials=episodes.map(p=>({material:ref('material',p.materialId),continuity:p.proofStatus,
     samples:p.samples.map(s=>({experiment:ref('experiment',s.experimentId),action:ref('action-receipt',s.actionId),
      ingestion:ref('ingestion',s.ingestionId),feedbackStatus:s.observedEffects.length?'retained-linked':'missing-or-unverified',
      historicalFeedback:historical.effects.filter(f=>f.valid&&f.sample.id===s.experimentId).map(f=>({feedback:ref('feedback',f.effect.id),recognition:ref('condition-receipt',f.recognition.id),effect:f.effect.effect,authority:'none',coverage:'historical-trace-only'})),
      feedback:s.observedEffects.map(f=>({feedback:ref('feedback',f.id),recognition:ref('condition-receipt',f.recognitionId),effect:f.effect}))}))}));
    return link;
   });return result;
  });
  report.actors.push({scope,techniques,retainedEvidenceGaps:projection.evidenceGaps});
 }
 return freeze({...report,status:'reported'});
}

export function reportTechniqueProvenance(input) {
 try{return buildReport(input);}catch{return freeze({version:1,observerOnly:true,authority:'none',status:'unavailable',reason:'malformed-evidence',actors:[],historicalCoverage:'unknown',comparableRanking:'unproven',netBenefit:'unproven'});}
}
