// Read-only integrity and exposure organizer; never reconstructs private authority.
import assert from 'node:assert/strict';
import {MOTOR_RECALL_ORDINARY_V1 as P} from './motor-recall-ordinary-v1-protocol.mjs';
import {validateChoiceWorldScope} from './choice-diagnostic-v2-collector.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from './producer-retest-ci-namespace.mjs';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const failures=new Set(['object_still_attached','object_too_heavy','object_resists_grasp']);
const narration='Grasping did not acquire this source. My own earlier pull detached a piece here. I can try that operation once more; the result is uncertain.';
function paid(r,type){const a=r?.details?.action,o=r?.details?.result;return r?.type==='action'&&a?.type===type&&typeof a.targetId==='string'&&Number.isFinite(o?.durationSeconds)&&o.durationSeconds>0&&o.handling?.source==='experienced'&&o.handling.activeActionSeconds===o.durationSeconds;}
const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<1e-6;
const physiologyKeys=['availableEnergyKcal','storedEnergyKcal','waterDeficitMl','health','condition','stamina','fatigue','sleepPressure'];
const bodyKeys=['hunger','thirst','thermal','energy','stamina','fatigue','sleepiness','pain','wetness','overall','activity','digestion','sleep','relief'];
function numbers(o){assert.ok(plain(o)&&Object.keys(o).length>0);for(const v of Object.values(o))assert.ok(Number.isFinite(v));}
function physical(o){assert.ok(plain(o.position)&&Number.isFinite(o.position.x)&&Number.isFinite(o.position.y));assert.ok(['AWAKE','COLLAPSED','RECOVERING'].includes(o.lifecycle));assert.ok(plain(o.physiology));for(const k of physiologyKeys)assert.ok(Number.isFinite(o.physiology[k]));numbers(o.physiology.totals);assert.ok(plain(o.physiology.outsideAssistance));for(const v of Object.values(o.physiology.outsideAssistance))assert.ok(Number.isFinite(v));assert.ok(plain(o.stats));assert.ok(Number.isSafeInteger(o.rng));}
function publicSnapshot(s){physical(s);assert.ok(plain(s.body));for(const k of bodyKeys)assert.ok(typeof s.body[k]==='string'&&s.body[k].length>0);for(const k of ['run','cycle','active'])assert.ok(s[k]===null||plain(s[k]));assert.ok(s.runSourceId===null||typeof s.runSourceId==='string');}
function projection(a){return {id:a.id,elapsed:a.elapsed,position:a.position,lifecycle:a.lifecycle,rng:a.rng,physiology:Object.fromEntries([...physiologyKeys,'totals','outsideAssistance'].map(k=>[k,a.physiology[k]]))};}
function validateArm(arm,mode){
 assert.ok(plain(arm));assert.equal(arm.protocol,P.id);assert.equal(arm.mode,mode);assert.equal(arm.seed,P.seed);assert.equal(arm.seconds,P.seconds);assert.equal(arm.completedSteps,P.steps);assert.equal(arm.status,'completed');assert.equal(arm.failure,null);
 assert.equal(arm.source,P[mode+'Source']);assert.equal(arm.sourceAfter,arm.source);assert.match(arm.harnessSha256??'',/^[a-f0-9]{64}$/);assert.deepEqual(arm.normalizationPaths,NORMALIZED_PATHS);
 const worlds={};for(const f of ['initial','save']){assert.equal(typeof arm[f+'Raw'],'string');assert.equal(sha256(arm[f+'Raw']),arm[f+'Sha256']);worlds[f]=JSON.parse(arm[f+'Raw']);assert.equal(comparableHash(worlds[f]),arm[f+'ComparableSha256']);}
 for(const [name,time]of [['initial',0],['save',P.seconds]]){assert.ok(near(worlds[name].elapsed,time));for(const a of worlds[name].agents)assert.ok(near(a.elapsed,time));}
 const scope=validateChoiceWorldScope(worlds.initial);assert.deepEqual(validateChoiceWorldScope(worlds.save),scope);assert.equal(arm.saveValid,true);
 assert.equal(arm.coverage?.coverage,'complete');assert.equal(arm.coverage.steps,P.steps);assert.equal(arm.coverage.enabled,false);assert.deepEqual(arm.coverage.rows,[]);
 const ids=scope.actors.map(x=>x.actorId);
 for(const f of ['rows','snapshots','agents','choices','inquiryTransitions','recallTransitions'])assert.ok(Array.isArray(arm[f])&&arm[f].every(plain));
 assert.deepEqual(arm.agents.map(a=>a.id).sort(),ids);
 for(const a of arm.agents){physical(a);assert.ok(near(a.elapsed,P.seconds));assert.deepEqual(projection(a),projection(worlds.save.agents.find(x=>x.id===a.id)));}
 assert.equal(arm.snapshots.length,ids.length*(P.seconds+2));
 for(let i=0;i<arm.snapshots.length;i++){const r=arm.snapshots[i];assert.equal(r.actor,worlds.initial.agents[i%ids.length].id);assert.ok(near(r.at,Math.min(Math.floor(i/ids.length),P.seconds)));publicSnapshot(r);}
 for(const id of ids){const ss=arm.snapshots.filter(s=>s.actor===id);assert.deepEqual(ss.at(-1),ss.at(-2));const original=worlds.initial.agents.find(a=>a.id===id);for(const k of ['position','lifecycle','rng','stats'])assert.deepEqual(ss[0][k],original[k]);assert.deepEqual(ss[0].physiology,projection(original).physiology);const terminal=arm.agents.find(a=>a.id===id);for(const k of ['position','lifecycle','rng','stats'])assert.deepEqual(ss.at(-1)[k],terminal[k]);assert.deepEqual(ss.at(-1).physiology,projection(terminal).physiology);}
 for(const field of ['choices','inquiryTransitions']){const last=new Map();for(const r of arm[field]){assert.ok(ids.includes(r.actor)&&Number.isFinite(r.at)&&r.at>=0&&r.at<=P.seconds+1e-6&&r.at>=(last.get(r.actor)??0));last.set(r.actor,r.at);if(field==='choices'){for(const k of ['before','after','quotes'])assert.ok(Array.isArray(r[k]));assert.equal(r.before.length,r.after.length);assert.ok(Number.isSafeInteger(r.methods)&&r.methods>=0&&Number.isSafeInteger(r.pending)&&r.pending>=0);}else assert.ok(r.status===null||plain(r.status));}}
 assert.ok(plain(arm.activeOccupancySeconds));assert.deepEqual(Object.keys(arm.activeOccupancySeconds).sort(),ids);for(const counts of Object.values(arm.activeOccupancySeconds)){assert.ok(plain(counts));for(const n of Object.values(counts))assert.ok(Number.isFinite(n)&&n>=0);assert.ok(near(Object.values(counts).reduce((a,b)=>a+b,0),P.seconds));}
 const times=new Map();let globalTime=0;const next=new Map(ids.map(id=>[id,1]));for(const r of arm.rows){assert.ok(next.has(r.actor));assert.equal(r.id,next.get(r.actor));assert.ok(Number.isFinite(r.at)&&r.at>=0&&r.at<=P.seconds+1e-6);assert.ok(r.at>=(times.get(r.actor)??0)&&r.at>=globalTime);times.set(r.actor,r.at);globalTime=r.at;assert.ok(typeof r.type==='string'&&r.type.length>0&&plain(r.details));next.set(r.actor,r.id+1);}
 if(mode==='baseline')assert.deepEqual(arm.recallTransitions,[]);
 const seen=new Map(),admitted=new Map();for(const r of arm.recallTransitions){
  assert.ok(ids.includes(r.actor));assert.equal(r.worldId,scope.worldId);assert.equal(r.incarnation,scope.actors.find(a=>a.actorId===r.actor).incarnation);
  assert.ok(Number.isSafeInteger(r.tick)&&r.tick>=0&&r.tick<=P.steps&&Number.isFinite(r.at)&&r.at>=0&&r.at<=P.seconds+1e-6);
  assert.ok(near(r.at,r.tick*P.fixedStep));
  const prior=seen.get(r.actor);if(prior)assert.ok(r.tick>=prior.tick&&r.at>=prior.at);seen.set(r.actor,r);
  if(r.status===null)continue;assert.ok(plain(r.status)&&Number.isSafeInteger(r.status.admissions)&&r.status.admissions>=0&&r.status.admissions<=64&&Number.isSafeInteger(r.status.methods)&&r.status.methods>=0&&r.status.methods<=16&&Array.isArray(r.status.questions)&&r.status.questions.length<=16);
  assert.ok(r.status.admissions>=r.status.questions.length&&r.status.admissions>=(admitted.get(r.actor)??0));admitted.set(r.actor,r.status.admissions);
  const questions=new Set();for(const q of r.status.questions){assert.ok(plain(q)&&typeof q.sourceId==='string'&&/^object:[1-9][0-9]*$/.test(q.sourceId)&&!questions.has(q.sourceId));questions.add(q.sourceId);assert.ok(Number.isFinite(q.priorAt)&&q.priorAt>=0&&q.priorAt<q.at&&q.at<=r.at&&q.at-q.priorAt<=300);assert.equal(q.deadline,q.at+300);assert.ok(['ready','issued','pulling','detached','unavailable','retired'].includes(q.phase));}
 }
 return scope;
}
export function exposureMotifs(rows){
 const pulls=new Map(),motifs=[];for(const r of rows){
  const a=r.details?.action,o=r.details?.result,key=r.actor+'|'+a?.targetId;
  if(a?.type==='pull'){
   if(paid(r,'pull')&&o.ok===true&&o.code==='piece_detached'&&typeof o.materialId==='string'&&o.materialId!==a.targetId)pulls.set(key,r);else pulls.delete(key);
  }
  if(!paid(r,'grasp')||o.ok!==false||!failures.has(o.code))continue;
  const prior=pulls.get(key);if(prior&&prior.at<r.at&&r.at-prior.at<=300)motifs.push({actor:r.actor,sourceId:a.targetId,pullReceipt:prior.id,graspReceipt:r.id,priorAt:prior.at,at:r.at,classification:'potential-exposure-only'});
 }return motifs;
}
export function foodContext(rows,actor,sourceId,before,initial){
 const original=initial.agents.find(a=>a.id===actor),d=original?.discovery;
 const pristine=Array.isArray(d?.effects)&&d.effects.length===0&&Array.isArray(d?.experiments)&&d.experiments.length===0&&original?.physiology?.totals?.ingestedKcal===0;
 const relevant=rows.filter(r=>r.at<=before),own=relevant.filter(r=>r.actor===actor),chain=new Set([sourceId]);
 // Physical production belongs to the world, while ingestion/feedback belongs to the actor.
 const parents=new Map();let ambiguous=false;
 for(const r of relevant){const a=r.details?.action,o=r.details?.result;if(a?.type==='pull'&&o?.ok===true&&o.code==='piece_detached'&&typeof o.materialId==='string'){if(parents.has(o.materialId)&&parents.get(o.materialId)!==a.targetId)ambiguous=true;parents.set(o.materialId,a.targetId);}}
 for(const start of parents.keys()){const seen=new Set();let cursor=start;while(parents.has(cursor)){if(seen.has(cursor)){ambiguous=true;break;}seen.add(cursor);cursor=parents.get(cursor);}}
 let changed=true;while(changed){changed=false;for(const [child,parent]of parents)if(chain.has(parent)&&!chain.has(child)){chain.add(child);changed=true;}}
 // Any consumed
 // object outside the proven descendant chain is conservatively unknown, even
 // when some (but not all) parent links are retained. A queried material that
 // itself has a parent or lacks a unique initial plant/animal physical root
 // also cannot establish a source-rooted negative (no species inference).
 const ecology=initial.environment?.ecology;const roots=[...(Array.isArray(ecology?.plants)?ecology.plants:[]),...(Array.isArray(ecology?.animals)?ecology.animals:[])];
 if(parents.has(sourceId)||roots.filter(x=>x?.id===sourceId).length!==1)ambiguous=true;
 const unresolved=own.some(r=>{const a=r.details?.action,o=r.details?.result,f=r.details?.feedback;const target=o?.ingestionId?a?.targetId:['sustained','water relief'].includes(f?.effect)?f.objectId:null;return target&&!chain.has(target);});
 const evidence=own.filter(r=>{
  const a=r.details?.action,o=r.details?.result,f=r.details?.feedback;
  return (chain.has(a?.targetId)&&o?.ingestionId)||(chain.has(f?.objectId)&&['sustained','water relief'].includes(f.effect));
 });
 return {classification:ambiguous?'unknown-material-ancestry':evidence.length?'prior-ingestion-or-positive-chain-feedback':unresolved?'unknown-material-ancestry':pristine?'no-prior-ingestion-or-positive-chain-feedback-in-complete-trace':'unknown-initial-food-history',receiptIds:evidence.map(r=>r.id),chain:[...chain]};
}
export function analyzeMotorPair(baseline,candidate){
 validateArm(baseline,'baseline');validateArm(candidate,'candidate');assert.equal(baseline.harnessSha256,candidate.harnessSha256);assert.equal(baseline.initialComparableSha256,candidate.initialComparableSha256);
 const initial=JSON.parse(candidate.initialRaw);
 const questions=new Map();for(const r of candidate.recallTransitions)for(const q of r.status?.questions??[]){
  const key=JSON.stringify([r.actor,q.sourceId,q.at]);if(!questions.has(key))questions.set(key,{actor:r.actor,sourceId:q.sourceId,priorAt:q.priorAt,at:q.at,phases:[],foodContext:foodContext(candidate.rows,r.actor,q.sourceId,q.at,initial)});
  questions.get(key).phases.push({tick:r.tick,at:r.at,phase:q.phase});
 }
 const cases=[...questions.values()].map(q=>({...q,foodContextThroughFirstObservedPulling:q.phases.some(p=>p.phase==='pulling')?foodContext(candidate.rows,q.actor,q.sourceId,q.phases.find(p=>p.phase==='pulling').at,initial):{classification:'unknown-no-observed-canonical-pulling'},priorPullReceiptCandidates:candidate.rows.filter(r=>r.actor===q.actor&&r.at===q.priorAt&&paid(r,'pull')&&r.details.action.targetId===q.sourceId).map(r=>r.id),selectionNarrationCandidates:candidate.rows.filter(r=>r.actor===q.actor&&r.at>=q.at&&r.at<q.at+300&&r.type==='decision'&&r.details?.summary===narration).map(r=>r.id),paidPullCandidates:candidate.rows.filter(r=>r.actor===q.actor&&r.at>=q.at&&r.at<=q.at+300&&paid(r,'pull')&&r.details.action.targetId===q.sourceId).map(r=>({receiptId:r.id,at:r.at,code:r.details.result.code,ok:r.details.result.ok,materialId:r.details.result.materialId??null,paidSeconds:r.details.result.durationSeconds,effort:r.details.result.handling?.effort??null,riskCost:r.details.result.riskCost??null})),attribution:'independent review required; matching receipt alone is not canonical recall'}));
 const admissionCounts=Object.fromEntries(candidate.agents.map(a=>[a.id,Math.max(0,...candidate.recallTransitions.filter(r=>r.actor===a.id).map(r=>r.status?.admissions??0))]));
 return {admissionCounts,protocol:P.id,status:'integrity-passed-awaiting-independent-interpretation',seed:P.seed,seconds:P.seconds,baselinePotentialExposure:exposureMotifs(baseline.rows),candidatePotentialExposure:exposureMotifs(candidate.rows),candidateAdmissionCases:cases,normalizationPaths:NORMALIZED_PATHS,limitations:['No forced exposures; zero opportunity is not failed retrieval.','Public motifs cannot reconstruct private eligibility.','Latest-status observations may miss within-tick phases or scope retirement; zero observed questions does not prove zero admissions.','No-prior-food labels are trace evidence criteria, not claims about motivation; they use provenance, never species. Recheck through selection for later food evidence.','Costs/physical consequences and whole-body differences are not benefit or transfer claims.']};
}
