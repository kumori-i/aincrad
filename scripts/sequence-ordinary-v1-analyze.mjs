// Read-only integrity and exposure organizer; never reconstructs private authority.
import assert from 'node:assert/strict';
import {SEQUENCE_ORDINARY_V1 as DEFAULT} from './sequence-ordinary-v1-protocol.mjs';
import {validateChoiceWorldScope} from './choice-diagnostic-v2-collector.mjs';
import {sha256,comparableHash,NORMALIZED_PATHS} from './producer-retest-ci-namespace.mjs';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
import {frozenSeed} from './sequence-ordinary-v1-evidence.mjs';
const narration='My own earlier handling of a new piece from this same source had a physical result. I can test that next operation again; usefulness is unknown.';
function paid(r,type){const a=r?.details?.action,o=r?.details?.result;return r?.type==='action'&&a?.type===type&&typeof a.targetId==='string'&&Number.isFinite(o?.durationSeconds)&&o.durationSeconds>0&&o.handling?.source==='experienced'&&o.handling.activeActionSeconds===o.durationSeconds;}
const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<1e-6;
const physiologyKeys=['availableEnergyKcal','storedEnergyKcal','waterDeficitMl','health','condition','stamina','fatigue','sleepPressure'];
const bodyKeys=['hunger','thirst','thermal','energy','stamina','fatigue','sleepiness','pain','wetness','overall','activity','digestion','sleep','relief'];
function numbers(o){assert.ok(plain(o)&&Object.keys(o).length>0);for(const v of Object.values(o))assert.ok(Number.isFinite(v));}
function physical(o){assert.ok(plain(o.position)&&Number.isFinite(o.position.x)&&Number.isFinite(o.position.y));assert.ok(['AWAKE','COLLAPSED','RECOVERING'].includes(o.lifecycle));assert.ok(plain(o.physiology));for(const k of physiologyKeys)assert.ok(Number.isFinite(o.physiology[k]));numbers(o.physiology.totals);assert.ok(plain(o.physiology.outsideAssistance));for(const v of Object.values(o.physiology.outsideAssistance))assert.ok(Number.isFinite(v));assert.ok(plain(o.stats));assert.ok(Number.isSafeInteger(o.rng));}
function publicSnapshot(s){physical(s);assert.ok(plain(s.body));for(const k of bodyKeys)assert.ok(typeof s.body[k]==='string'&&s.body[k].length>0);for(const k of ['run','cycle','active'])assert.ok(s[k]===null||plain(s[k]));assert.ok(s.runSourceId===null||typeof s.runSourceId==='string');}
function projection(a){return {id:a.id,elapsed:a.elapsed,epoch:a.epoch,stats:a.stats,position:a.position,lifecycle:a.lifecycle,rng:a.rng,physiology:Object.fromEntries([...physiologyKeys,'totals','outsideAssistance'].map(k=>[k,a.physiology[k]]))};}
export function validateArm(arm,mode,P=DEFAULT){
 assert.ok(plain(arm));assert.equal(arm.protocol,P.id);assert.equal(arm.mode,mode);assert.equal(arm.seed,frozenSeed(arm.pair,P));assert.equal(arm.seconds,P.seconds);assert.equal(arm.completedSteps,P.steps);assert.equal(arm.status,'completed');assert.equal(arm.failure,null);
 assert.equal(arm.source,P[mode+'Source']);assert.equal(arm.sourceAfter,arm.source);assert.match(arm.harnessSha256??'',/^[a-f0-9]{64}$/);assert.deepEqual(arm.normalizationPaths,NORMALIZED_PATHS);
 const worlds={};for(const f of ['initial','save']){assert.equal(typeof arm[f+'Raw'],'string');assert.equal(sha256(arm[f+'Raw']),arm[f+'Sha256']);worlds[f]=JSON.parse(arm[f+'Raw']);assert.equal(comparableHash(worlds[f]),arm[f+'ComparableSha256']);}
 for(const [name,time]of [['initial',0],['save',P.seconds]]){assert.ok(near(worlds[name].elapsed,time));for(const a of worlds[name].agents)assert.ok(near(a.elapsed,time));}
 const scope=validateChoiceWorldScope(worlds.initial);assert.deepEqual(validateChoiceWorldScope(worlds.save),scope);assert.equal(arm.saveValid,true);
 assert.equal(arm.coverage?.coverage,'complete');assert.equal(arm.coverage.steps,P.steps);assert.deepEqual(arm.coverage.scope,scope);assert.deepEqual(arm.coverage.epochTransitions,arm.epochTransitions);
 const ids=scope.actors.map(x=>x.actorId);
 for(const f of ['rows','snapshots','agents','choices','inquiryTransitions','sequenceTransitions','sequenceStatuses','epochTransitions'])assert.ok(Array.isArray(arm[f])&&arm[f].every(plain));
 assert.deepEqual(arm.agents.map(a=>a.id).sort(),ids);
 for(const a of arm.agents){physical(a);assert.ok(near(a.elapsed,P.seconds));assert.deepEqual(projection(a),projection(worlds.save.agents.find(x=>x.id===a.id)));}
 assert.equal(arm.snapshots.length,ids.length*(P.seconds+2));
 for(let i=0;i<arm.snapshots.length;i++){const r=arm.snapshots[i];assert.equal(r.actor,worlds.initial.agents[i%ids.length].id);assert.ok(near(r.at,Math.min(Math.floor(i/ids.length),P.seconds)));publicSnapshot(r);}
 for(const id of ids){const ss=arm.snapshots.filter(s=>s.actor===id);assert.deepEqual(ss.at(-1),ss.at(-2));const original=worlds.initial.agents.find(a=>a.id===id);for(const k of ['position','lifecycle','epoch','rng','stats'])assert.deepEqual(ss[0][k],original[k]);assert.deepEqual(ss[0].physiology,projection(original).physiology);const terminal=arm.agents.find(a=>a.id===id);for(const k of ['position','lifecycle','epoch','rng','stats'])assert.deepEqual(ss.at(-1)[k],terminal[k]);assert.deepEqual(ss.at(-1).physiology,projection(terminal).physiology);}
 for(const field of ['choices','inquiryTransitions']){const last=new Map();for(const r of arm[field]){assert.ok(ids.includes(r.actor)&&Number.isFinite(r.at)&&r.at>=0&&r.at<=P.seconds+1e-6&&r.at>=(last.get(r.actor)??0));last.set(r.actor,r.at);if(field==='choices'){for(const k of ['before','after','quotes'])assert.ok(Array.isArray(r[k]));assert.equal(r.before.length,r.after.length);assert.ok(Number.isSafeInteger(r.methods)&&r.methods>=0&&Number.isSafeInteger(r.pending)&&r.pending>=0);}else assert.ok(r.status===null||plain(r.status));}}
 assert.ok(plain(arm.activeOccupancySeconds));assert.deepEqual(Object.keys(arm.activeOccupancySeconds).sort(),ids);for(const counts of Object.values(arm.activeOccupancySeconds)){assert.ok(plain(counts));for(const n of Object.values(counts))assert.ok(Number.isFinite(n)&&n>=0);assert.ok(near(Object.values(counts).reduce((a,b)=>a+b,0),P.seconds));}
 const times=new Map();let globalTime=0;const next=new Map(ids.map(id=>[id,1]));for(const r of arm.rows){assert.ok(next.has(r.actor));assert.equal(r.id,next.get(r.actor));assert.ok(Number.isFinite(r.at)&&r.at>=0&&r.at<=P.seconds+1e-6);assert.ok(r.at>=(times.get(r.actor)??0)&&r.at>=globalTime);times.set(r.actor,r.at);globalTime=r.at;assert.ok(typeof r.type==='string'&&r.type.length>0&&plain(r.details));if(r.type==='action'){assert.ok(plain(r.details.action)&&typeof r.details.action.type==='string'&&r.details.action.type.length>0&&plain(r.details.result)&&typeof r.details.result.ok==='boolean');const a=r.details.action,o=r.details.result;if(a.targetId!==undefined)assert.match(a.targetId,/^object:[1-9][0-9]*$/);if(o.durationSeconds!==undefined)assert.ok(Number.isFinite(o.durationSeconds)&&o.durationSeconds>=0);if(o.handling!==undefined)assert.ok(plain(o.handling)&&o.handling.source==='experienced'&&Number.isFinite(o.handling.activeActionSeconds)&&o.handling.activeActionSeconds>=0);}if(r.type==='decision')assert.equal(typeof r.details.summary,'string');next.set(r.actor,r.id+1);}
 // Retention may preserve older proofs rather than a suffix. Bind every retained
 // record and the terminal serial independently to the full raw collector stream.
 for(const a of arm.agents){
  const saved=worlds.save.agents.find(x=>x.id===a.id),initial=worlds.initial.agents.find(x=>x.id===a.id);
  for(const actor of [a,saved,initial])assert.ok(plain(actor.memory)&&positive(actor.memory.nextId)&&Array.isArray(actor.memory.experience));
  assert.equal(a.memory.nextId,next.get(a.id));assert.equal(saved.memory.nextId,a.memory.nextId);assert.deepEqual(saved.memory.experience,a.memory.experience);
  const raw=new Map(arm.rows.filter(r=>r.actor===a.id).map(({actor,...r})=>[r.id,r]));
  for(const actor of [initial,a]){let prior=0;for(const row of actor.memory.experience){assert.ok(plain(row)&&positive(row.id)&&row.id>prior&&row.id<actor.memory.nextId);assert.deepEqual(row,raw.get(row.id));prior=row.id;}}
  assert.ok(initial.memory.nextId<=a.memory.nextId);if(a.memory.nextId>1)assert.ok(a.memory.experience.some(r=>r.id===a.memory.nextId-1));
 }
 assert.ok(plain(arm.sequenceReadCounts));assert.deepEqual(Object.keys(arm.sequenceReadCounts).sort(),ids);for(const id of ids){assert.equal(arm.sequenceReadCounts[id],mode==='candidate'?P.steps+2:0);if(mode==='candidate'){const frames=arm.sequenceTransitions.filter(r=>r.actor===id);assert.ok(frames.length>=2);assert.equal(frames[0].tick,0);assert.equal(frames.at(-1).tick,P.steps);}}
 if(mode==='baseline')assert.deepEqual(arm.sequenceTransitions,[]);
 const statusMap=new Map();for(const item of arm.sequenceStatuses){assert.deepEqual(Object.keys(item).sort(),['hash','status']);assert.match(item.hash,/^[a-f0-9]{64}$/);assert.equal(item.hash,sha256(JSON.stringify(item.status)));assert.ok(!statusMap.has(item.hash));statusMap.set(item.hash,item.status);}
 const actorRows=new Map(ids.map(id=>[id,[]])),actorEpochs=new Map(ids.map(id=>[id,[]])),rowsByTime=new Map();for(const row of arm.rows){actorRows.get(row.actor).push(row);const key=JSON.stringify([row.actor,row.at]);if(!rowsByTime.has(key))rowsByTime.set(key,[]);rowsByTime.get(key).push(row);}for(const row of arm.epochTransitions){assert.ok(actorEpochs.has(row.actor));actorEpochs.get(row.actor).push(row);}
 const latestAt=(rows,at,key='at')=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][key]<=at)lo=mid+1;else hi=mid;}return rows[lo-1];};
 const epoch=new Map(worlds.initial.agents.map(a=>[a.id,a.epoch])),epochTicks=new Map();
 for(const r of arm.epochTransitions){assert.ok(ids.includes(r.actor)&&Number.isSafeInteger(r.tick)&&r.tick>0&&r.tick<=P.steps&&near(r.at,r.tick*P.fixedStep));assert.equal(r.worldId,scope.worldId);assert.equal(r.incarnation,scope.actors.find(a=>a.actorId===r.actor).incarnation);assert.equal(r.priorEpoch,epoch.get(r.actor));assert.ok(Number.isSafeInteger(r.epoch)&&r.epoch>r.priorEpoch&&r.tick>(epochTicks.get(r.actor)??0));for(const k of ['priorBody','body']){assert.ok(plain(r[k]));for(const b of bodyKeys)assert.equal(typeof r[k][b],'string');}for(const k of ['priorLifecycle','lifecycle'])assert.ok(['AWAKE','COLLAPSED','RECOVERING'].includes(r[k]));epoch.set(r.actor,r.epoch);epochTicks.set(r.actor,r.tick);}
 for(const a of arm.agents)assert.equal(a.epoch,epoch.get(a.id));
 for(const snap of arm.snapshots){const prior=latestAt(actorEpochs.get(snap.actor),snap.at+1e-8),initial=worlds.initial.agents.find(a=>a.id===snap.actor);assert.equal(snap.epoch,prior?.epoch??initial.epoch);assert.equal(snap.lifecycle,prior?.lifecycle??initial.lifecycle);}
 const seen=new Map(),terminalDuplicates=new Set(),admitted=new Map(),validatedStatuses=new Set(),usedStatuses=new Set();for(const r of arm.sequenceTransitions){
  assert.ok(ids.includes(r.actor));assert.equal(r.worldId,scope.worldId);assert.equal(r.incarnation,scope.actors.find(a=>a.actorId===r.actor).incarnation);assert.ok(Number.isSafeInteger(r.tick)&&r.tick>=0&&r.tick<=P.steps&&near(r.at,r.tick*P.fixedStep));
  const currentEpoch=latestAt(actorEpochs.get(r.actor),r.tick,'tick')?.epoch??worlds.initial.agents.find(x=>x.id===r.actor).epoch;assert.equal(r.epoch,currentEpoch);
  assert.ok(Number.isSafeInteger(r.receiptSerial)&&r.receiptSerial>=0);const serial=latestAt(actorRows.get(r.actor),r.at+1e-8)?.id??0;assert.equal(r.receiptSerial,serial);
  const prior=seen.get(r.actor);if(prior){assert.ok(r.tick>=prior.tick);if(r.tick===prior.tick){assert.equal(r.tick,P.steps);assert.ok(!terminalDuplicates.has(r.actor));terminalDuplicates.add(r.actor);}}seen.set(r.actor,r);
  assert.ok(plain(r.body));for(const b of bodyKeys)assert.equal(typeof r.body[b],'string');assert.ok(r.activeRequest===null||plain(r.activeRequest));
  if(r.activeRequest===null){assert.equal(r.activeStartedAt,null);assert.equal(r.activePaidSeconds,null);}else{
   assert.ok(typeof r.activeRequest.type==='string'&&r.activeRequest.type.length>0);
   assert.ok(Number.isFinite(r.activeStartedAt)&&r.activeStartedAt>=0&&r.activeStartedAt<=r.at);
   assert.ok(r.activePaidSeconds===null||Number.isFinite(r.activePaidSeconds)&&r.activePaidSeconds>=0&&r.activePaidSeconds<=r.at-r.activeStartedAt+P.fixedStep+1e-6);
  }
  assert.ok(statusMap.has(r.statusHash));usedStatuses.add(r.statusHash);const st=statusMap.get(r.statusHash);if(st===null)continue;assert.ok(plain(st)&&Number.isSafeInteger(st.admissions)&&st.admissions>=0&&st.admissions<=64&&Number.isSafeInteger(st.methods)&&st.methods>=0&&st.methods<=16&&Array.isArray(st.episodes)&&st.episodes.length<=64);
  assert.ok(st.admissions>=(admitted.get(r.actor)??0));admitted.set(r.actor,st.admissions);
  if(st.question?.phase==='working'){
   assert.ok(r.activeRequest&&r.activeRequest.type===st.question.type&&r.activeRequest.targetId===st.question.outputId);
   assert.ok(Number.isFinite(r.activeStartedAt)&&r.activeStartedAt>=st.question.at&&r.activeStartedAt<=r.at&&Number.isFinite(r.activePaidSeconds)&&r.activePaidSeconds>=0&&r.activePaidSeconds<=r.at-r.activeStartedAt+P.fixedStep+1e-6);
  }
  // Temporal invariants are checked on every occurrence, including cached blobs.
  for(const e of st.episodes)assert.ok(Number.isFinite(e.nextAt)&&e.nextAt<=r.at);
  if(st.question!==null)assert.ok(Number.isFinite(st.question?.at)&&st.question.at<=r.at);
  const statusKey=JSON.stringify([r.actor,r.epoch,r.statusHash]);if(validatedStatuses.has(statusKey))continue;validatedStatuses.add(statusKey);
  for(const e of st.episodes){assert.ok(plain(e));for(const k of ['sourceId','outputId'])assert.match(e[k]??'',/^object:[1-9][0-9]*$/);for(const k of ['firstType','firstCode','type','code','outputCues','context','firstEffort','nextEffort'])assert.equal(typeof e[k],'string');assert.equal(typeof e.uncertain,'boolean');assert.equal(typeof e.interposed,'boolean');assert.ok(Number.isFinite(e.firstAt)&&e.firstAt>=0&&Number.isFinite(e.nextAt)&&e.nextAt>=e.firstAt&&e.nextAt<=r.at&&Number.isFinite(e.seconds)&&e.seconds>=0);assert.equal(e.costCoverage,'A-and-next-handling-only');if(!e.uncertain){assert.equal(e.interposed,false);assert.ok(e.nextAt>e.firstAt&&e.nextAt-e.firstAt<=30);const first=(rowsByTime.get(JSON.stringify([r.actor,e.firstAt]))??[]).filter(x=>paid(x,e.firstType)&&x.details.action.targetId===e.sourceId&&x.details.result.code===e.firstCode&&(x.details.result.materialId??x.details.result.resultObjectId)===e.outputId);const next=(rowsByTime.get(JSON.stringify([r.actor,e.nextAt]))??[]).filter(x=>paid(x,e.type)&&x.details.action.targetId===e.outputId&&x.details.result.code===e.code);assert.equal(first.length,1);assert.equal(next.length,1);assert.equal(first[0].details.result.ok,true);assert.equal(next[0].details.result.ok,true);assert.ok(near(e.seconds,first[0].details.result.durationSeconds+next[0].details.result.durationSeconds));}}
  const q=st.question;if(q!==null){assert.ok(plain(q)&&st.admissions>=1);for(const k of ['sourceId','outputId'])assert.match(q[k]??'',/^object:[1-9][0-9]*$/);assert.ok(['grasp','pull','strike','release'].includes(q.type));assert.ok(Number.isFinite(q.at)&&q.at>=0&&q.at<=r.at);assert.equal(q.deadline,q.at+30);assert.ok(['ready','issued','working','completed','unavailable','retired'].includes(q.phase));}
 }
 assert.equal(usedStatuses.size,statusMap.size);return scope;
}
// Public raw motifs are possible encounters only; private continuity is not reconstructed.
export function potentialEpisodes(rows){
 const pending=new Map(),out=[];
 for(const r of rows){if(r.type!=='action')continue;const a=r.details.action,o=r.details.result,prior=pending.get(r.actor);pending.delete(r.actor);
  if(prior&&paid(r,a?.type)&&a.targetId===prior.outputId)out.push({actor:r.actor,sourceId:prior.sourceId,outputId:prior.outputId,A:prior.receiptId,B:r.id,code:o.code,ok:o.ok,classification:'potential-public-episode-not-private-eligibility'});
  const id=o?.materialId??o?.resultObjectId;if(paid(r,a?.type)&&o.ok===true&&typeof id==='string'&&id!==a.targetId)pending.set(r.actor,{sourceId:a.targetId,outputId:id,receiptId:r.id});
 }return out;
}
export function analyzeSequencePair(baseline,candidate,P=DEFAULT){
 validateArm(baseline,'baseline',P);validateArm(candidate,'candidate',P);assert.equal(baseline.pair,candidate.pair);assert.equal(baseline.seed,candidate.seed);assert.equal(baseline.initialComparableSha256,candidate.initialComparableSha256);assert.equal(baseline.harnessSha256,candidate.harnessSha256);
 const episodes=new Map(),questions=new Map(),statuses=new Map(candidate.sequenceStatuses.map(x=>[x.hash,x.status])),processed=new Set();
 for(const r of candidate.sequenceTransitions){const status=statuses.get(r.statusHash),stamp=JSON.stringify([r.actor,r.epoch,r.statusHash]);if(!processed.has(stamp)){processed.add(stamp);for(const e of status?.episodes??[]){const key=JSON.stringify([r.actor,r.incarnation,r.epoch,e.sourceId,e.outputId,e.firstAt,e.nextAt]);episodes.set(key,{actor:r.actor,incarnation:r.incarnation,epoch:r.epoch,...e});}}
  const q=status?.question;if(!q)continue;const key=JSON.stringify([r.actor,r.incarnation,r.epoch,q.sourceId,q.outputId,q.at]);if(!questions.has(key))questions.set(key,{actor:r.actor,incarnation:r.incarnation,epoch:r.epoch,...q,observations:[]});questions.get(key).observations.push({...r,phase:q.phase});
 }
 const cases=[...questions.values()].map(q=>({...q,selectionNarrationCandidates:candidate.rows.filter(r=>r.actor===q.actor&&r.type==='decision'&&r.at>=q.at&&r.at<=q.deadline&&r.details.summary===narration).map(r=>r.id),paidCompletionCandidates:candidate.rows.filter(r=>r.actor===q.actor&&r.at>=q.at&&r.at<=q.deadline&&paid(r,q.type)&&r.details.action.targetId===q.outputId).map(r=>({receiptId:r.id,at:r.at,...r.details.result})),attribution:'independent review must bind observed working phase, original decision and exact paid result; later matching actions are not proof'}));
 return {protocol:P.id,pair:candidate.pair,seed:candidate.seed,seconds:P.seconds,status:'integrity-passed-awaiting-independent-interpretation',baselinePotentialEpisodes:potentialEpisodes(baseline.rows),candidatePotentialEpisodes:potentialEpisodes(candidate.rows),observedEpisodes:[...episodes.values()],observedQuestions:cases,bodyAndOccupancy:{baseline:{agents:baseline.agents,occupancy:baseline.activeOccupancySeconds},candidate:{agents:candidate.agents,occupancy:candidate.activeOccupancySeconds}},limitations:['No forced exposures; zero observed learning/choice is valid.','Missing private phases and within-tick changes remain unknown, not inferred negatives.','Public motifs do not prove private eligibility, observed change is not usefulness.','Epoch changes break private continuity; collapse/recovery and body deterioration are retained outcomes.','Body differences are contextual, not causally attributed benefit; no hunting/transfer claim.']};
}
