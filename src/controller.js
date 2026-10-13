import { NPC_RULES } from './config.js';
import { distance } from './world.js';
import { tileKey, tilePoint } from './perception.js';
import { knownRoute } from './navigation.js';
import { observeNpc, requestNpcAction, tickNpc } from './npc.js';
import { policyContext, actionCategory, recordEvent } from './npc-memory.js';

function random(npc){npc.rng=(Math.imul(npc.rng,1664525)+1013904223)>>>0;return npc.rng/4294967296;}
export function decisionObservation(npc){
  const available=Object.values(npc.memory.sources).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,12);
  const cells=Object.values(npc.memory.cells).filter(c=>distance(c,npc.position)<=NPC_RULES.visionRadius+80).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position)).slice(0,48);
  return {
    identity:{id:npc.id,name:npc.name},objective:'Remain conscious and become independently capable of obtaining water.',
    condition:{hydration:npc.hydration,lifecycle:npc.lifecycle,flask:{water:npc.flask.water,capacity:npc.flask.capacity},position:{...npc.position}},
    observedAt:npc.elapsed,knownSources:available.map(s=>({...s,distance:Math.round(distance(s,npc.position))})),
    knownTiles:cells.map(c=>({x:c.x,y:c.y,walkable:c.walkable,terrain:c.terrain,observedAt:c.observedAt})),
    recentExperience:npc.learning?npc.memory.experience.slice(-6):[],
    lessons:npc.learning?npc.memory.lessons.slice(-3):[],
    skills:npc.learning?npc.memory.skills.filter(s=>s.status!=='retired').map(s=>({id:s.id,status:s.status,preconditions:s.preconditions,steps:s.steps,successes:s.successes,failures:s.failures,supportingExperience:s.supportingExperience.slice(-9)})):[],
    actionStatus:npc.active?{type:npc.active.request.type,remaining:Math.max(0,npc.active.expiresAt-npc.elapsed)}:null,
    actions:{observe:{},move:{target:'An observed traversable tile {x,y}, or sourceId from knownSources; at most 12 seconds.'},inspect:{sourceId:'known source'},fill_flask:{sourceId:'known source; collection range 80'},drink:{},wait:{seconds:'0.25 to 5'}},
  };
}
/** A real, small tabular learner. It is not a language model or a scripted mock. */
export class LocalLearnerProvider {
  constructor(){this.kind='local-learner';this.label='Offline experiential learner';}
  decide(npc){
    const choices=[{type:'observe'},{type:'wait',seconds:1}];
    const failures=npc.learning?npc.memory.experience.filter(e=>e.type==='action'&&!e.details.result?.ok):[];
    // Basic action affordances avoid futile repeated commands; they do not supply a route or sequence.
    const emptyWasTested=failures.some(e=>e.details.result?.code==='EMPTY_FLASK');
    if(npc.flask.water<=.00001&&!emptyWasTested||npc.flask.water>.00001&&100-npc.hydration>=NPC_RULES.meaningfulHydrationGain)choices.push({type:'drink'});
    const anchor=npc.navigationAnchor&&npc.memory.cells[npc.navigationAnchor]?.walkable&&distance(npc.position,tilePoint(npc.navigationAnchor))<160?npc.navigationAnchor:null;
    const exploration=npc.memory.exploration;
    const cells=Object.values(npc.memory.cells).filter(c=>c.walkable&&distance(c,npc.position)>120&&distance(c,npc.position)<370).map(cell=>{
      // Estimate potential information from gaps in the remembered map, never hidden terrain.
      let unknown=0;const step=NPC_RULES.tileSize;
      for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(dx*dx+dy*dy<=16&&!npc.memory.cells[`${Math.round(cell.x/step)+dx},${Math.round(cell.y/step)+dy}`])unknown++;
      const d=distance(cell,npc.position),heading=exploration.heading;
      const forward=heading?((cell.x-npc.position.x)*heading.x+(cell.y-npc.position.y)*heading.y)/d:0;
      // Expand the nearby search before committing to a long one-way expedition.
      const expedition=exploration.origin?distance(cell,exploration.origin):0;
      const score=unknown*.055+d*.001+(forward*.18)-expedition*.0025-(cell.visits||0)*.8-(exploration.recentTargets.includes(cell.key)?2.5:0)+random(npc)*.3;
      return {cell,score,unknown};
    }).sort((a,b)=>b.score-a.score);
    const frontier=cells.filter(candidate=>candidate.unknown>0).find(candidate=>knownRoute(npc.memory.cells,npc.position,candidate.cell,30,npc.memory.blockedEdges,npc.elapsed,anchor));
    if(frontier)choices.push({type:'move',target:{x:frontier.cell.x,y:frontier.cell.y}});
    const sources=Object.values(npc.memory.sources).filter(s=>s.available&&(s.retryAfter||0)<=npc.elapsed).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position));
    if(sources.length){
      // Keep resource actions parameterized by actually discovered sources.
      if(npc.flask.water<=.00001&&distance(sources[0],npc.position)<=NPC_RULES.collectionRange)choices.push({type:'fill_flask',sourceId:sources[0].id});
      if(sources[0].observedAt<npc.elapsed-5&&distance(sources[0],npc.position)<=NPC_RULES.visionRadius)choices.push({type:'inspect',sourceId:sources[0].id});
      if(distance(sources[0],npc.position)>NPC_RULES.collectionRange&&npc.flask.water<=.00001)choices.push({type:'move',sourceId:sources[0].id});
    }
    const context=policyContext(npc),risk=1+Math.min(npc.stats.collapses,3)*.15;
    const ranked=choices.map(action=>{
      const value=npc.learning?npc.memory.values[`${context}::${actionCategory(action)}`]:null;
      const urgency=1-npc.hydration/100;
      const idlePenalty=['observe','wait'].includes(action.type)?(.5+urgency):0;
      const explorationBonus=action.type==='move'&&!action.sourceId&&frontier?.unknown?Math.min(.8,frontier.unknown*.025)*Math.max(.2,npc.hydration/75):0;
      const score=(value?.value||0)*risk+2/Math.sqrt(1+(value?.attempts||0))+explorationBonus-idlePenalty+random(npc)*.22;
      return {action,score,value};
    }).sort((a,b)=>b.score-a.score);
    const selected=random(npc)<(npc.hydration<NPC_RULES.criticalHydration ? .025 : .07)?ranked[Math.floor(random(npc)*ranked.length)]:ranked[0];
    const explorationReason=selected.action.type==='move'&&!selected.action.sourceId?' The target is an observed frontier; recently visited targets are deprioritized.':'';
    return {action:selected.action,reason:(selected.value?`Experience-weighted experiment: ${actionCategory(selected.action)} (${selected.value.attempts} previous outcomes).`:`Untried bounded experiment: ${actionCategory(selected.action)}.`)+explorationReason,provider:this.kind};
  }
}
export class DesktopModelProvider {
  constructor(bridge,label='Configured local model'){this.bridge=bridge;this.kind='local-model';this.label=label;}
  decide(npc){return this.bridge.decide(decisionObservation(npc));}
  cancel(){Promise.resolve(this.bridge.cancel()).catch(()=>{});}
}
export class NpcController {
  constructor(npc,{provider=new LocalLearnerProvider(),environment={}}={}){
    this.npc=npc;this.provider=provider;this.fallback=new LocalLearnerProvider();this.environment=environment;
    this.pending=null;this.readyDecision=null;this.generation=0;this.epoch=npc.epoch;this.senseAt=-1;this.failures=0;this.cooldownUntil=0;this.disposed=false;
    observeNpc(npc,environment);
  }
  setProvider(provider){this.cancel();this.provider=provider;this.failures=0;this.cooldownUntil=0;this.npc.nextDecisionAt=this.npc.elapsed;}
  cancel(){this.generation++;this.pending=null;this.readyDecision=null;this.provider.cancel?.();}
  dispose(){this.disposed=true;this.cancel();}
  selectSkill(){
    const n=this.npc;if(!n.learning||n.flask.water>.00001||n.hydration>=100-NPC_RULES.meaningfulHydrationGain)return null;
    const candidates=n.memory.skills.filter(s=>s.status!=='retired').sort((a,b)=>((b.successes/(1+b.failures))+(b.status==='validated'?2:0))-((a.successes/(1+a.failures))+(a.status==='validated'?2:0)));
    for(const skill of candidates){
      const sources=Object.values(n.memory.sources).filter(s=>s.available&&(s.retryAfter||0)<=n.elapsed&&(!skill.preconditions.inRange||distance(n.position,s)<=NPC_RULES.collectionRange)).sort((a,b)=>distance(a,n.position)-distance(b,n.position));
      if(sources.length)return {skill,sourceId:sources[0].id};
    }
    return null;
  }
  startSkill(skill,sourceId){
    const n=this.npc,source=n.memory.sources[sourceId];
    if(!n.learning||!skill||skill.status==='retired'||!source?.available||n.flask.water>.00001||n.hydration>=100-NPC_RULES.meaningfulHydrationGain||skill.preconditions.inRange&&distance(n.position,source)>NPC_RULES.collectionRange)return false;
    n.skillRun={id:skill.id,sourceId,cursor:0,awaiting:false,lastEventId:0,startedAt:n.elapsed,independentBefore:n.stats.independentDrinks};
    n.stats.skillUses++;n.decision=`Reusing ${skill.status} procedure “${skill.name}”, supported by events ${skill.supportingExperience.slice(-3).join(', ')}.`;
    recordEvent(n,'decision',{kind:'learned skill',skillId:skill.id,sourceId,supportingExperience:skill.supportingExperience.slice(-6)});return true;
  }
  progressSkill(){
    const n=this.npc,run=n.skillRun;if(!run)return;
    const skill=n.memory.skills.find(s=>s.id===run.id);
    if(!skill||n.elapsed-run.startedAt>NPC_RULES.maxSkillSeconds){n.skillRun=null;recordEvent(n,'skill',{skillId:run.id,outcome:'PROCEDURE_TIMEOUT'});return;}
    if(n.active)return;
    if(run.awaiting){
      if(!n.lastResult||n.lastResult.eventId<=run.lastEventId)return;
      if(!n.lastResult.ok){
        skill.failures++;if(skill.failures>=3&&skill.failures>skill.successes)skill.status='retired';
        recordEvent(n,'skill',{skillId:run.id,outcome:n.lastResult.code,eventId:n.lastResult.eventId});n.skillRun=null;return;
      }
      run.cursor++;run.awaiting=false;
    }
    if(run.cursor>=skill.steps.length){
      recordEvent(n,'skill',{skillId:run.id,outcome:n.stats.independentDrinks>run.independentBefore?'INDEPENDENT_SUCCESS':'NO_INDEPENDENT_GAIN'});n.skillRun=null;return;
    }
    const step=skill.steps[run.cursor],request={type:step.type,...(step.sourceId?{sourceId:run.sourceId}:{})};
    run.lastEventId=n.lastResult?.eventId||0;run.awaiting=true;requestNpcAction(n,request,this.environment);
  }
  applyDecision(decision){
    const n=this.npc;
    if(!decision||typeof decision!=='object')throw new Error('Model returned no structured decision.');
    n.decision=String(decision.reason||'A bounded action was selected.').slice(0,600);
    recordEvent(n,'decision',{provider:this.provider.kind,summary:n.decision});
    if(decision.skillId){const skill=n.memory.skills.find(s=>s.id===decision.skillId);if(this.startSkill(skill,decision.sourceId))return;}
    requestNpcAction(n,decision.action,this.environment);
  }
  decide(){
    const n=this.npc;
    const skill=this.selectSkill();if(skill&&this.startSkill(skill.skill,skill.sourceId))return;
    if(this.provider.kind==='local-learner'){this.applyDecision(this.provider.decide(n));return;}
    if(!n.modelBudget)n.modelBudget={since:n.elapsed,calls:0};
    if(n.elapsed-n.modelBudget.since>=3600)n.modelBudget={since:n.elapsed,calls:0};
    if(n.modelBudget.calls>=NPC_RULES.maxModelCallsPerHour||n.elapsed<this.cooldownUntil){
      n.decision='Local model budget/backoff active; the offline experiential learner is continuing.';
      requestNpcAction(n,this.fallback.decide(n).action,this.environment);return;
    }
    const generation=this.generation,epoch=n.epoch,condition=policyContext(n);
    n.modelBudget.calls++;n.stats.modelCalls++;this.pending={at:n.elapsed};
    let call;
    try{call=this.provider.decide(n);}catch(error){call=Promise.reject(error);}
    Promise.resolve(call).then(decision=>{
      if(this.disposed)return;
      if(generation!==this.generation||epoch!==n.epoch||n.lifecycle!=='AWAKE'||n.active||policyContext(n)!==condition){n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});return;}
      this.pending=null;this.failures=0;this.readyDecision={decision,generation,epoch,condition};
    }).catch(error=>{
      if(this.disposed||generation!==this.generation)return;
      this.pending=null;n.stats.modelFailures++;this.failures++;this.cooldownUntil=n.elapsed+(this.failures>=2?30:5);
      recordEvent(n,'provider',{code:'MODEL_SERVICE_FAILURE',message:String(error.message||error).slice(0,400),gameplayFailure:false});
      n.decision='Model service unavailable. The offline experiential learner will continue after backoff.';
    }).finally(()=>{if(generation===this.generation)this.pending=null;});
  }
  tick(dt){
    if(this.disposed)return;
    const n=this.npc;tickNpc(n,dt,this.environment);
    if(n.epoch!==this.epoch){this.cancel();this.epoch=n.epoch;}
    if(n.elapsed-this.senseAt>=1){observeNpc(n,this.environment);this.senseAt=n.elapsed;}
    if(n.lifecycle!=='AWAKE'||n.active||this.pending)return;
    if(this.readyDecision){const ready=this.readyDecision;this.readyDecision=null;if(ready.generation===this.generation&&ready.epoch===n.epoch&&ready.condition===policyContext(n))this.applyDecision(ready.decision);else{n.stats.staleResponses++;recordEvent(n,'provider',{code:'STALE_RESPONSE',gameplayFailure:false});}return;}
    if(n.skillRun){this.progressSkill();return;}
    if(n.elapsed>=n.nextDecisionAt)this.decide();
  }
}
