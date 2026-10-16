/** Headless experimental adapter. Never instantiated by the desktop application. */
import { PopulationRuntime } from '../../src/population.js';
import { tickNpc, observeNpc, requestNpcAction, cancelNpcAction } from '../../src/npc.js';
import { recordEvent } from '../../src/npc-memory.js';
import { cognitiveAction, updateCognition } from '../../src/cognition.js';
import { discoveryDecision, processDiscoveryFeedback, contactEscape } from '../../src/discovery.js';
import { bodySignals, sensedEnvironment } from '../../src/interoception.js';
import { isSleeping } from '../../src/biology.js';
import { DISCOVERY_RULES } from '../../src/discovery-config.js';
import { createTemporalLedger, beginTemporalDecision, advanceTemporalClock, completeTemporalDecision, recordTemporalFeedback } from '../../src/temporal-ledger.js';
import { trainTemporalReturns } from '../../src/temporal-returns.js';
import { applyTemporalCapacity } from '../../src/temporal-capacity.js';
import { createFiniteSelector, proposeFiniteChoice, commitFiniteChoice, finiteChoiceContext, completeFiniteFocus, interruptFiniteFocus } from './finite-temporal-policy.mjs';

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MODES = new Map([['online','online'],['no-bootstrap','immediate'],['frozen-zero','frozen'],['legacy-test','frozen']]);
const sourceNumber = e => typeof e.id === 'string' && /^feedback:[1-9]\d{0,9}$/.test(e.id) ? Number(e.id.slice(9)) : null;
export function finitePublicView(npc) {
 return {at:npc.elapsed,scene:npc.scene,position:{...npc.position},reach:DISCOVERY_RULES.reach,
  held:[...npc.inventory.items],body:bodySignals(npc),senses:sensedEnvironment(npc),
  objects:Object.values(npc.discovery.observations).map(o=>({id:o.id,scene:o.scene,position:{...o.position},appearance:{...o.appearance},
   ...(o.motion===undefined?{}:{motion:o.motion}),...(o.count===undefined?{}:{count:o.count}),observedAt:o.observedAt}))};
}
/** Owns one copied-world actor, with original shared ecology/harm/wake behavior. */
export class FiniteTemporalDriver {
 constructor(state,{arm='online',selectorSeed=1729,selector=null,driver=null,pendingDisposition=null,sink=null,automatic=true,now=()=>performance.now()}={}) {
  if(!MODES.has(arm)||state.simulationMode!=='discovery'||state.agents?.length!==1)throw new TypeError('Invalid finite experiment');
  this.state=state;this.npc=state.agents[0];this.arm=arm;this.automatic=automatic;this.now=now;this.sink=sink;this.diagnosticError=null;
  this.timings={decisions:[],construction:[],combined:[],sensors:[]};this.submissions=0;this.outcomes=0;this.unsubmitted=0;
  const n=this.npc;n.discovery.temporal??=createTemporalLedger({capacityProfile:'finite-temporal-v1'});applyTemporalCapacity(n.discovery.temporal,'finite-temporal-v1');
  this.selector=selector||createFiniteSelector(selectorSeed);this.pending=driver?.pending?copy(driver.pending):null;
  // Reopening binds runtime services without spending a new sensory observation.
  // Constructor perception/cognition only touches copied actor/community data;
  // restore that canonical checkpoint before any tick/decision can see it.
  const restoredActor=driver?copy(n):null,restoredCommunity=driver?copy(state.community):null;
  this.runtime=new PopulationRuntime(state,{cardinal:false,discoveryFoodLearning:false});
  if(restoredActor){for(const key of Object.keys(n))delete n[key];Object.assign(n,restoredActor);state.community=restoredCommunity;applyTemporalCapacity(n.discovery.temporal,'finite-temporal-v1');}
  this.controller=this.runtime.controller(n.id);this.controller.social=null; // No dialogue/LLM/human suggestions in any arm.
  this.runtime.social={observe(){},tick(){}};
  if(driver){this.controller.senseAt=driver.senseAt;this.controller.epoch=driver.epoch;}
  if(pendingDisposition?.status==='interrupted'){
   const m=n.discovery.temporal,seq=pendingDisposition.seq;
   if(m.open?.seq===seq)m.open=null;
   m.historyCensored=true;m.model.historyCensored=true;this.pending=null;interruptFiniteFocus(this.selector);
  }
  this.controller.tick=dt=>this.tickActor(dt);
  if(pendingDisposition?.status==='pending')this.captureCompletion();
 }
 emit(event){if(!this.sink||this.diagnosticError)return;try{this.sink(copy(event));}catch(error){this.diagnosticError=String(error?.message||error).slice(0,240);this.sink=null;}}
 timing(kind,value){const a=this.timings[kind];a.push(value);if(a.length>4096)a.shift();}
 get memory(){return this.npc.discovery.temporal;}
 checkpointDriver(){return {senseAt:this.controller.senseAt,epoch:this.controller.epoch,pending:copy(this.pending)};}
 captureCompletion(){
  const n=this.npc,p=this.pending,r=n.lastResult;if(!p||n.active||!r||r.eventId<=p.previousEventId)return;
  if(r.action!==p.action.type||r.at!==n.elapsed)throw new Error('Unmatched authoritative finite completion');
  // The canonical learner receipt is independent of ordinary history rotation.
  // If the short history still contains the event, also verify its full request.
  const event=n.memory.experience.find(e=>e.type==='action'&&e.id===r.eventId);
  if(event&&!same(event.details.action,p.action))throw new Error('Finite completion request changed');
  if(!completeTemporalDecision(this.memory,{seq:p.seq,at:n.elapsed,actionId:r.eventId,result:r}))throw new Error('Finite completion admission failed');
  const receipt=this.memory.receipts.find(x=>x.seq===p.seq);completeFiniteFocus(this.selector,receipt,finitePublicView(n));
  this.outcomes++;this.emit({type:'outcome',at:n.elapsed,seq:p.seq,action:p.action,actionId:r.eventId,result:r});this.pending=null;
 }
 captureFeedback(){
  const n=this.npc,m=this.memory;
  for(const event of n.physiology.feedback){const seq=sourceNumber(event);if(seq!==null&&seq<=m.feedbackCursor)continue;
   if(event.at!==n.elapsed)throw new Error('Finite sensor missed biological event time');
   const admitted=recordTemporalFeedback(m,event,{now:n.elapsed});this.emit({type:'feedback',at:n.elapsed,admitted,event});
  }
 }
 submit(raw,{proposal=null,opportunity=null,context=null,reason='',need='understanding',interruption=false}={}){
  const n=this.npc,m=this.memory,c=this.controller,at=n.elapsed,epoch=n.epoch;
  if(n.active||n.lifecycle!=='AWAKE'||isSleeping(n)||!interruption&&n.elapsed<n.nextDecisionAt){this.unsubmitted++;return false;}
  if(this.pending)throw new Error('Previous finite submission has no completion');
  const action=cognitiveAction(n,raw);if(!action)throw new Error('Finite proposal failed common action normalization');
  if(proposal&&(proposal.at!==at||proposal.nextSeq!==m.nextSeq||opportunity?.at!==at||opportunity.epoch!==epoch||opportunity.rngBefore!==n.rng||!same(action,proposal.selected.action)))throw new Error('Stale finite submission');
  const view=finitePublicView(n),actualContext=context||finiteChoiceContext(view,m,{action},null),beforeId=n.lastResult?.eventId||0;
  const result=requestNpcAction(n,action,this.state.environment);
  if(n.elapsed!==at)throw new Error('Submission advanced the physical clock');
  const started=n.active&&n.active.startedAt===at&&same(n.active.request,action);
  const immediate=!n.active&&n.lastResult?.eventId>beforeId&&n.lastResult.at===at&&n.lastResult.action===action.type;
  if(!started&&!immediate){this.unsubmitted++;if(['ACTION_BUSY','ASLEEP','UNCONSCIOUS'].includes(result?.code))return false;throw new Error('No authoritative finite submission');}
  if(n.epoch!==epoch&&!['enter_shelter','exit_shelter'].includes(action.type))throw new Error('Unexpected submission epoch change');
  if(proposal){commitFiniteChoice(this.selector,proposal);n.rng=opportunity.rngAfter;}else interruptFiniteFocus(this.selector);
  const seq=beginTemporalDecision(m,{at,context:actualContext,action});
  this.pending={seq,action:copy(action),previousEventId:beforeId};this.submissions++;
  this.emit({type:'submission',at,seq,action,need,reason,ordinary:Boolean(proposal),
   ...(proposal?{choice:{selectedIndex:proposal.selected.index,context:proposal.selected.context,key:proposal.selected.key,known:proposal.selected.known,utility:proposal.selected.utility,exploring:proposal.exploring,candidates:proposal.candidates}}:{})});
  this.captureCompletion();
  trainTemporalReturns(m.model,{mode:MODES.get(this.arm)});
  // Scene changes are authoritative outcomes, not stale pre-submission proposals.
  if(n.epoch!==c.epoch){c.cancel();c.epoch=n.epoch;n.discovery.run=null;interruptFiniteFocus(this.selector);}
  return true;
 }
 tickActor(dt){
  const n=this.npc,c=this.controller;if(c.disposed)return;
  tickNpc(n,dt,this.state.environment);
  const sensorStart=this.now();advanceTemporalClock(this.memory,n.elapsed);
  // Native tick order: delayed biology first, then active-action completion.
  this.captureFeedback();this.captureCompletion();
  if(n.epoch!==c.epoch){c.cancel();c.epoch=n.epoch;n.discovery.run=null;interruptFiniteFocus(this.selector);}
  this.timing('sensors',this.now()-sensorStart);
  if(isSleeping(n)||n.lifecycle!=='AWAKE')return;
  processDiscoveryFeedback(n,{foodLearning:false,recordEffect:effect=>recordEvent(n,'condition',{code:'DISCOVERY_EFFECT',feedback:effect})});
  if(n.elapsed-c.senseAt>=1){observeNpc(n,this.state.environment);updateCognition(n);c.senseAt=n.elapsed;}
  if(!this.automatic)return;
  const contact=contactEscape(n);
  if(contact&&n.active&&n.active.goal!=='escape-contact'&&n.active.startedAt<n.memory.experience.find(e=>e.id===contact.eventId)?.at){
   const start=this.now();
   cancelNpcAction(n,'CONTACT_ESCAPE');this.captureCompletion();n.discovery.run=null;n.decision='Pain from experienced contact interrupted my activity.';
   this.submit(contact.action,{need:'safety',reason:n.decision,interruption:true});this.timing('decisions',this.now()-start);
   if(n.active)n.active.goal='escape-contact';return;
  }
  if(n.active||n.elapsed<n.nextDecisionAt)return;
  const constructionStart=this.now(),decision=discoveryDecision(n,{foodLearning:false,ordinaryProposal:this.arm!=='legacy-test'});
  const constructionMs=this.now()-constructionStart;this.timing('construction',constructionMs);
  const addedStart=this.now();
  if(decision.ordinary){
   const view=finitePublicView(n),proposal=proposeFiniteChoice(view,this.memory,this.selector,decision.ordinary);
   n.decision='I am testing an available action using predicted experienced consequences and bounded exploration.';
   recordEvent(n,'decision',{provider:'discovery-learner',summary:n.decision});
   this.submit(proposal.selected.action,{proposal,opportunity:decision.ordinary,context:proposal.selected.context,reason:n.decision});
  }else{
   n.decision=decision.reason;recordEvent(n,'decision',{provider:'discovery-learner',summary:decision.reason});
   this.submit(decision.action,{reason:decision.reason,need:decision.need});
   if(contact&&n.active&&decision.need==='safety')n.active.goal='escape-contact';
  }
  const addedMs=this.now()-addedStart;this.timing('decisions',addedMs);this.timing('combined',addedMs+constructionMs);
 }
 step(dt=1/60){if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new TypeError('Invalid finite physical step');this.state.elapsed+=dt;this.runtime.tick(dt);if(this.diagnosticError)throw new Error(`Finite diagnostic sink failed: ${this.diagnosticError}`);}
 dispose(){this.runtime.dispose();}
}
