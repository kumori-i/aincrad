import { CONFIG, NPC_RULES, BODY_RULES, CAVES } from './config.js';
import { distance, canStand } from './world.js';
import { tileKey, rememberedCells, rememberedEdges } from './perception.js';
import { knownRoute } from './navigation.js';
import { bodySignals, sensedEnvironment } from './interoception.js';

export const DRIVE_NAMES=['survival','safety','belonging','competence','understanding','creativity','purpose','contribution'];
const text=(value,max=240)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max):'';
const number=(value,fallback=0,max=1e10)=>Number.isFinite(value)?Math.max(0,Math.min(max,value)):fallback;
const point=value=>value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&Math.abs(value.x)<=24000&&Math.abs(value.y)<=24000?{x:value.x,y:value.y}:null;
const PHYSICAL=new Set(['observe','move','inspect','fill_flask','drink','gather_food','eat','enter_shelter','exit_shelter','wait','rest','sleep','inspect_object','grasp','release','pull','sample','strike']);
const SOCIAL=new Set(['say','ask_human','journal_reply','write_note','read_note']);

/** Motives, claims and intentions are persistent data, never executable instructions. */
export function createCognition(){return {version:1,nextId:1,bornAt:0,beliefs:[],predictions:[],drives:{},plan:null,history:[],travel:{samples:0,secondsPerUnit:1/CONFIG.walkSpeed},lastEventId:0,lastUpdateAt:-1,lastKnowledgeAt:0,lastPlanAt:-30,lastNoteAt:0,questions:[],knowledgeGained:0,home:null,search:{startedAt:null,returning:false},shelterState:{enteredAt:null,departureUntil:0,lastOutside:null}};}
function cognition(npc){return npc.cognition||=(createCognition());}
function evidence(source,at,extra={}){return {source,at:number(at),...extra};}
function retainEvidence(belief,item){belief.evidence=[...(belief.evidence||[]),item].slice(-6);}
function addBelief(npc,values){const c=cognition(npc),belief={id:`belief:${npc.id}:${c.nextId++}`,updatedAt:npc.elapsed,confidence:'tentative',status:'unverified',evidence:[],...values};c.beliefs.push(belief);if(c.beliefs.length>64)c.beliefs.splice(0,c.beliefs.length-64);return belief;}

/** A report is useful testimony, not a discovered coordinate or verified fact. */
export function recordClaim(npc,claim,{sourceId='human',at=npc.elapsed,channel='journal',messageId=null}={}){
  if(!claim||typeof claim!=='object')return null;
  const c=cognition(npc),subject=text(claim.subject||claim.resourceId||'A reported idea',100),content=text(claim.text||claim.claim,300);
  if(!content)return null;
  const old=c.beliefs.find(b=>b.source==='reported'&&b.subject===subject&&b.text===content&&b.evidence.some(e=>e.sourceId===sourceId));if(old)return old;
  return addBelief(npc,{subject,kind:['resource','route','climate','general'].includes(claim.kind)?claim.kind:'general',text:content,source:'reported',status:'unverified',resourceId:text(claim.resourceId,70)||null,...(typeof claim.available==='boolean'?{available:claim.available}:{}),...(point(claim.position)?{position:point(claim.position)}:{}),evidence:[evidence('reported',at,{sourceId:text(sourceId,70),channel:text(channel,30),messageId:text(messageId,80)||null})]});
}
function observeBelief(npc,table,item){
  const c=cognition(npc),subject=`${table}:${item.id}`,available=item.available!==false;
  let old=c.beliefs.find(b=>b.source==='observed'&&b.subject===subject);
  const content=table==='foods'?`${item.name}: ${Number.isInteger(item.stock)?item.stock:'some'} apples were visible.`:table==='sources'?`${item.name}: water ${available?'was accessible':'was unavailable'} when observed.`:`${item.name}: I observed a shelter entrance.`;
  if(!old){old=addBelief(npc,{subject,resourceId:item.id,kind:'resource',text:content,source:'observed',status:'verified',confidence:'grounded',available,position:{x:item.x,y:item.y},stock:table==='foods'?number(item.stock,0,10):undefined,evidence:[evidence('observed',item.observedAt,{resourceId:item.id})]});c.knowledgeGained++;c.lastKnowledgeAt=npc.elapsed;}
  if(old.observedAt!==item.observedAt){
    if(table==='foods'&&old.stock===0&&item.stock>0){const interval=item.observedAt-(old.emptyAt??old.updatedAt),id=`renewal:${item.id}`;let prediction=c.predictions.find(p=>p.subject===id);if(!prediction){prediction={subject:id,expectation:'Apples may return after a period of time; the exact timing remains uncertain.',confidence:'tentative',sourceBeliefIds:[old.id],checks:0,contradictions:0,observedIntervals:[]};c.predictions.push(prediction);}prediction.observedIntervals=[...prediction.observedIntervals,Math.round(interval)].slice(-6);prediction.checks++;prediction.confidence=prediction.checks>=3?'supported':'tentative';if(!c.beliefs.some(b=>b.subject===id&&b.source==='inferred'))addBelief(npc,{subject:id,kind:'general',text:prediction.expectation,source:'inferred',confidence:'tentative',status:'unverified',evidence:[evidence('inferred',npc.elapsed,{resourceId:item.id})]});}
    if(table==='foods'&&item.stock===0&&old.stock!==0)old.emptyAt=item.observedAt;
    Object.assign(old,{text:content,available,stock:table==='foods'?number(item.stock,0,10):undefined,observedAt:item.observedAt,updatedAt:npc.elapsed});retainEvidence(old,evidence('observed',item.observedAt,{resourceId:item.id}));
  }
  for(const report of c.beliefs.filter(b=>b.source==='reported'&&b.resourceId===item.id&&b.status==='unverified'&&item.observedAt>b.updatedAt)){
    if(typeof report.available!=='boolean')continue;
    const agrees=report.available===available;report.status=agrees?'corroborated':'contradicted';report.confidence=agrees?'supported':'revised';report.updatedAt=npc.elapsed;retainEvidence(report,evidence('observed',item.observedAt,{resourceId:item.id,agrees}));
  }
}
export function signalUrgencies(npc){
  const b=bodySignals(npc),s=sensedEnvironment(npc);
  const index=(value,list)=>Math.max(0,list.indexOf(value));
  const water=[0,.6,2.4,6,15][index(b.thirst,['quenched','dry mouth','thirsty','parched','desperate thirst'])];
  const food=[0,.7,2.8,7.5,17][index(b.hunger,['content','peckish','hungry','ravenous','faint with hunger'])];
  const thermal=b.thermal.startsWith('dangerously')?15:['overheated','shivering'].includes(b.thermal)?6:['warm','cool','hot','cold'].includes(b.thermal)?1.8:['hot','cold'].includes(s.warmth)?1.2:0;
  const rest=Math.max([0,1,3.5,8][index(b.energy,['steady','waning','low','depleted'])],[0,.5,2.8,6][index(b.fatigue,['fresh','tired','weary','exhausted'])],[0,1,3.5,8][index(b.sleepiness,['alert','drowsy','sleepy','struggling to stay awake'])],[0,.3,2,7][index(b.stamina,['easy breathing','breathing hard','winded','exhausted'])]);
  return {water,food,thermal,rest};
}
function tension(value){return value>=8?'urgent':value>=4?'strong':value>=1.5?'present':'quiet';}
export function updateCognition(npc){
  const c=cognition(npc);c.search||={startedAt:null,returning:false};c.shelterState||={enteredAt:null,departureUntil:0,lastOutside:null};if(npc.elapsed-c.lastUpdateAt<.9)return c;c.lastUpdateAt=npc.elapsed;
  if(npc.scene==='valley'){const senses=sensedEnvironment(npc);c.shelterState.lastOutside={warmth:senses.warmth,timeOfDay:senses.timeOfDay,weather:senses.weather,at:npc.elapsed};}
  if(!c.home&&Object.values(npc.memory.sources||{}).length)c.home={scene:'valley',position:{...npc.position},sourceId:Object.values(npc.memory.sources)[0].id};
  for(const table of npc.mode==='discovery'?['sources','shelters']:['sources','foods','shelters'])for(const item of Object.values(npc.memory[table]||{}))observeBelief(npc,table,item);
  for(const event of npc.memory.experience.filter(e=>e.id>c.lastEventId)){
    const result=event.details?.result,action=event.details?.action;
    if(result?.ok&&action?.type==='enter_shelter')c.shelterState.enteredAt=event.at;
    if(result?.ok&&action?.type==='exit_shelter'){c.shelterState.departureUntil=event.at+45;c.shelterState.enteredAt=null;}
    if(action?.type==='move'&&result?.ok&&result.distance>30){const seconds=result.durationSeconds;if(seconds>0&&seconds<60){c.travel.samples++;c.travel.secondsPerUnit+=(seconds/result.distance-c.travel.secondsPerUnit)*.2;}}
    if(result?.novelCells>0){c.knowledgeGained+=result.novelCells;c.lastKnowledgeAt=npc.elapsed;}
  }c.lastEventId=Math.max(c.lastEventId,...npc.memory.experience.map(e=>e.id));
  c.predictions=c.predictions.slice(-16);
  const heard=npc.social?.heard||[];for(const message of heard.filter(m=>m.senderId===npc.id&&m.kind==='question')){let q=c.questions.find(q=>q.messageId===message.id);if(!q){q={messageId:message.id,topic:'world',text:message.text,at:message.at,status:'unanswered'};c.questions.push(q);}if(heard.some(reply=>reply.senderId==='human'&&reply.replyTo===message.id))q.status='answered';}c.questions=c.questions.slice(-8);
  const priorities=signalUrgencies(npc),maximum=Math.max(...Object.values(priorities)),social=npc.social||{},contact=number(social.lastContactAt,c.bornAt),failures=npc.memory.experience.slice(-12).filter(e=>e.details?.result?.ok===false).length;
  const safe=maximum<4;
  c.drives={survival:{tension:tension(maximum),reason:'My bodily sensations ask for food, water, comfort and rest.'},safety:{tension:tension((npc.mode==='discovery'?(npc.discovery?.techniques?.length?0:2):npc.inventory?.apples.length<2?2:0)+(npc.flask.water<=.00001?2:0)),reason:'Remembered relief and a way home can make a trip safer.'},belonging:{tension:tension(safe?Math.min(5,(npc.elapsed-contact)/55):.4),reason:'Contact is welcome, but nobody is obliged to answer.'},competence:{tension:tension(failures*.8),reason:failures?'Recent unsuccessful actions leave something to improve.':'Useful routines can become more reliable.'},understanding:{tension:tension(safe?Math.min(5,(npc.elapsed-c.lastKnowledgeAt)/20):.3),reason:'Unexplained places and uncertain claims invite investigation.'},creativity:{tension:tension(safe&&c.knowledgeGained>0?Math.min(3,(npc.elapsed-c.lastNoteAt)/90):0),reason:'A field note can preserve a discovery.'},purpose:{tension:c.plan?.status==='active'?'present':'quiet',reason:c.plan?.goal||'A longer intention can connect individual actions.'},contribution:{tension:safe&&c.beliefs.some(b=>b.source==='observed')?'present':'quiet',reason:'Grounded discoveries can be shared without pretending certainty.'}};
  return c;
}
export function cognitiveObservation(npc){const c=updateCognition(npc);return {drives:DRIVE_NAMES.map(name=>({name,...c.drives[name]})),beliefs:c.beliefs.slice(-16).map(({id,subject,kind,text,status,confidence,evidence})=>({id,subject,kind,text,status,confidence,evidence})),predictions:c.predictions.slice(-6).map(({subject,expectation,confidence,sourceBeliefIds,checks,contradictions})=>({subject,expectation,confidence,sourceBeliefIds,checks,contradictions})),goal:c.plan?.status==='active'?c.plan.goal:null,plan:c.plan?{id:c.plan.id,goal:c.plan.goal,need:c.plan.need,status:c.plan.status,stepsFinished:c.plan.stepsFinished===true,goalVerified:c.plan.goalVerified===true,cursor:c.plan.cursor,steps:c.plan.steps,completion:c.plan.completion,interrupt:c.plan.interrupt,budget:c.plan.budget,returnRoute:c.plan.returnRoute}:null,questions:c.questions.slice(-4),knowledgeSummary:`I retain ${c.beliefs.filter(b=>b.source==='observed').length} grounded beliefs and ${c.beliefs.filter(b=>b.status==='unverified').length} unverified reports.`};}

/** Validate against discovered data, never consult undiscovered world resources. */
export function cognitiveAction(npc,raw,{restoring=false}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!PHYSICAL.has(raw.type)&&!SOCIAL.has(raw.type))return null;const out={type:raw.type};
  if(npc.mode==='discovery'){
    if(['gather_food','eat'].includes(raw.type)||raw.foodId!==undefined)return null;
    if(['inspect_object','grasp','release','pull','sample','strike'].includes(raw.type))return typeof raw.targetId==='string'&&/^object:\d{1,9}$/.test(raw.targetId)&&(npc.discovery?.observations?.[raw.targetId]||npc.inventory?.items?.includes(raw.targetId))?{type:raw.type,targetId:raw.targetId}:null;
  }else if(['inspect_object','grasp','release','pull','sample','strike'].includes(raw.type))return null;
  const refs=['sourceId','foodId','shelterId'].filter(key=>raw[key]!==undefined);if(refs.length>1)return null;
  for(const key of refs){const table=key==='sourceId'?'sources':key==='foodId'?'foods':'shelters';if(typeof raw[key]!=='string'||!npc.memory[table]?.[raw[key]])return null;out[key]=raw[key];}
  if(raw.type==='move'&&!refs.length){const p=point(raw.target),cells=rememberedCells(npc);if(!p||!cells[tileKey(p)]?.walkable)return null;out.target=p;}
  if(raw.type==='fill_flask'&&!out.sourceId||raw.type==='gather_food'&&!out.foodId||raw.type==='enter_shelter'&&!out.shelterId||raw.type==='inspect'&&!refs.length)return null;
  if(['wait','rest','sleep'].includes(raw.type)){const seconds=raw.seconds??(raw.type==='wait'?1:8),maximum=raw.type==='wait'?5:npc.mode==='discovery'?CONFIG.dayRealSeconds/2:12;if(!Number.isFinite(seconds)||seconds<.25||seconds>maximum)return null;out.seconds=seconds;}
  if(raw.type==='say'){if(!['aster','mira'].includes(raw.targetId)||raw.targetId===npc.id)return null;out.targetId=raw.targetId;out.text=text(raw.text,420);if(!out.text)return null;}
  if(raw.type==='journal_reply'){out.text=text(raw.text,600);if(!out.text)return null;if(raw.replyTo!==undefined){out.replyTo=text(raw.replyTo,80);if(!out.replyTo)return null;}}
  if(raw.type==='ask_human'){out.text=text(raw.text,420);out.topic=text(raw.topic,100)||'world';if(!out.text)return null;}
  if(raw.type==='write_note'){out.title=text(raw.title,80);out.text=text(raw.text,600);out.beliefIds=(Array.isArray(raw.beliefIds)?raw.beliefIds:[]).filter(id=>npc.cognition?.beliefs.some(b=>b.id===id)).slice(0,4);if(!out.title||!out.text)return null;}
  if(raw.type==='read_note'){out.noteId=text(raw.noteId,80);if(!out.noteId)return null;}
  if(raw.duration!==undefined){if(!Number.isFinite(raw.duration)||raw.duration<=0||raw.duration>NPC_RULES.maxActionSeconds)return null;out.duration=raw.duration;}
  return out;
}
/** Walking forecasts use sensed exertion and measured trips, never private reserve percentages. */
export function estimatedWalkingSpeed(npc){
  const signals=bodySignals(npc),slowed=['winded','exhausted'].includes(signals.stamina)||signals.fatigue==='exhausted'||signals.energy==='depleted';
  const prior=CONFIG.walkSpeed*(slowed?BODY_RULES.exhaustedWalkMultiplier:1),learned=1/(cognition(npc).travel.secondsPerUnit||1/CONFIG.walkSpeed);
  return Math.min(prior,learned);
}
function routeSeconds(npc,route){let previous=npc.position,total=0;for(const p of route){total+=distance(previous,p);previous=p;}return total/estimatedWalkingSpeed(npc);}
function planArchive(npc,plan,status,reason){const c=cognition(npc);plan.status=status;plan.stepsFinished=plan.cursor>=plan.steps.length;plan.goalVerified=status==='completed'&&plan.verification!=='model';plan.outcome=text(reason,180);c.history.push({id:plan.id,goal:plan.goal,status,at:npc.elapsed,reason:plan.outcome});c.history=c.history.slice(-12);}
export function cancelPlan(npc,reason='Conditions changed'){const plan=cognition(npc).plan;if(plan?.status==='active')planArchive(npc,plan,'interrupted',reason);}
export function adoptPlan(npc,raw,{supplied=false}={}){
  const c=cognition(npc);if(!raw||!Array.isArray(raw.steps)||raw.steps.length<3||raw.steps.length>6||!DRIVE_NAMES.includes(raw.need)||!text(raw.goal,160))return null;
  const steps=raw.steps.map(a=>cognitiveAction(npc,a));if(steps.some(a=>!a))return null;
  const cells=rememberedCells(npc),lastTarget=steps.filter(a=>a.type==='move'&&a.target).map(a=>a.target).sort((a,b)=>distance(b,npc.position)-distance(a,npc.position))[0]||npc.position;
  const route=knownRoute(cells,lastTarget,npc.position,30,rememberedEdges(npc),npc.elapsed);if(!route&&raw.need==='understanding')return null;
  const returnSeconds=route?routeSeconds({...npc,position:lastTarget},route):0,maxSeconds=Math.min(90,Math.max(15,steps.reduce((sum,a)=>sum+(a.seconds||a.duration||(a.type==='move'?8:1)),0)+returnSeconds+12));
  c.plan={id:`plan:${npc.id}:${c.nextId++}`,goal:text(raw.goal,160),need:raw.need,steps,completion:text(raw.completion,160)||'Finish the listed actions and check what changed.',interrupt:text(raw.interrupt,160)||'Interrupt if bodily sensations become urgent, the route fails, or the travel budget expires.',status:'active',cursor:0,awaiting:false,lastEventId:0,startedAt:npc.elapsed,origin:{scene:npc.scene,position:{...npc.position}},budget:{returnSeconds:Math.ceil(returnSeconds),maxSeconds,remainingSeconds:maxSeconds},returnRoute:{scene:npc.scene,points:(route||[]).slice(-12).map(p=>({x:p.x,y:p.y}))},startingKnowledge:c.knowledgeGained,verification:supplied&&['prepare','explore'].includes(raw.verification)?raw.verification:'model'};c.lastPlanAt=npc.elapsed;return c.plan;
}
export function progressPlan(npc){
  const c=cognition(npc),p=c.plan;if(p?.status!=='active')return null;p.budget.remainingSeconds=Math.max(0,p.budget.maxSeconds-(npc.elapsed-p.startedAt));
  if(npc.lifecycle!=='AWAKE'){cancelPlan(npc,'Consciousness or recovery interrupted the intention.');return null;}
  if(p.awaiting){if(!npc.lastResult||npc.lastResult.eventId<=p.lastEventId)return null;if(npc.lastResult.action!==p.steps[p.cursor]?.type){cancelPlan(npc,'An unrelated action replaced the expected step.');return null;}if(!npc.lastResult.ok){cancelPlan(npc,`A real action failed: ${npc.lastResult.code}.`);return null;}p.cursor++;p.awaiting=false;}
  if(p.cursor>=p.steps.length){
    if(p.verification==='prepare'){const ready=npc.flask.water>0&&(npc.inventory?.apples.length||0)>=2;planArchive(npc,p,ready?'completed':'interrupted',ready?'Food and water are physically present in my carried supplies.':'The steps finished, but my intended supplies were not actually present.');}
    else if(p.verification==='explore'){const returned=npc.scene===p.origin.scene&&distance(npc.position,p.origin.position)<80,gained=c.knowledgeGained>p.startingKnowledge;planArchive(npc,p,returned&&gained?'completed':'interrupted',returned&&gained?'I observed new terrain and physically returned to the starting place.':'The exploration or return postcondition was not established.');}
    else planArchive(npc,p,'completed','The listed actions finished; the broader goal still requires verification.');return null;}
  if(p.budget.remainingSeconds<=0){cancelPlan(npc,'The bounded trip budget expired.');return null;}
  const action=cognitiveAction(npc,p.steps[p.cursor]);if(!action){cancelPlan(npc,'A step no longer matches locally known affordances.');return null;}
  p.awaiting=true;p.lastEventId=npc.lastResult?.eventId||0;return action;
}
/** Every search remains connected to remembered supplies, including searches without food knowledge. */
export function searchBounds(npc){
  const c=cognition(npc),knownFood=Object.values(npc.memory.foods||{}).length>0,provisioned=(npc.inventory?.apples.length||0)>0&&npc.flask.water>0;
  return {home:c.home?.position||npc.memory.exploration.origin||npc.position,radius:knownFood?(provisioned?3500:2750):1000,seconds:knownFood?45:25};
}
export function searchReturn(npc){
  if(npc.scene!=='valley')return null;const c=cognition(npc);c.search||={startedAt:null,returning:false};const bounds=searchBounds(npc),d=distance(npc.position,bounds.home),noFood=!Object.keys(npc.memory.foods||{}).length;
  if(d<180){c.search.returning=false;c.search.startedAt=null;return null;}
  if(c.search.startedAt===null)c.search.startedAt=npc.elapsed;
  if(d>bounds.radius||noFood&&npc.elapsed-c.search.startedAt>bounds.seconds)c.search.returning=true;
  if(!c.search.returning)return null;
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),direct=knownRoute(cells,npc.position,bounds.home,30,edges,npc.elapsed,npc.navigationAnchor);if(direct&&routeSeconds(npc,direct)<=NPC_RULES.maxActionSeconds-.75)return {type:'move',target:{...bounds.home}};
  const nodes=Object.values(cells).filter(cell=>cell.walkable&&distance(cell,npc.position)>80&&distance(cell,npc.position)<600&&distance(cell,bounds.home)<d-60).sort((a,b)=>distance(a,bounds.home)-distance(b,bounds.home));
  const next=nodes.find(cell=>{const route=knownRoute(cells,npc.position,cell,30,edges,npc.elapsed,npc.navigationAnchor);return route&&routeSeconds(npc,route)<=NPC_RULES.maxActionSeconds-.75;});return next?{type:'move',target:{x:next.x,y:next.y}}:null;
}
export function explorationFrontier(npc){
  const cells=rememberedCells(npc),edges=rememberedEdges(npc),c=cognition(npc),bounds=searchBounds(npc);
  const reports=c.beliefs.filter(b=>b.source==='reported'&&b.status==='unverified'&&b.position&&b.available!==false);
  const candidates=Object.values(cells).filter(cell=>cell.walkable&&distance(cell,npc.position)>140&&distance(cell,npc.position)<900&&(npc.scene!=='valley'||distance(cell,bounds.home)<bounds.radius)).map(cell=>{let unknown=0;const [x,y]=cell.key.split(',').map(Number);for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(dx*dx+dy*dy<=9&&!cells[`${x+dx},${y+dy}`])unknown++;const reportProgress=reports.reduce((value,report)=>Math.max(value,(distance(npc.position,report.position)-distance(cell,report.position))*.02),0);return {cell,unknown,score:unknown+reportProgress+(cell.terrain==='trail'?3:0)-(cell.visits||0)*4-(npc.memory.exploration.recentTargets.includes(`${npc.scene}:${cell.key}`)?15:0)};}).sort((a,b)=>b.score-a.score);
  for(const candidate of candidates.slice(0,24)){if(!candidate.unknown)continue;const out=knownRoute(cells,npc.position,candidate.cell,30,edges,npc.elapsed,npc.navigationAnchor),back=knownRoute(cells,candidate.cell,npc.position,30,edges,npc.elapsed);if(!out||!back)continue;const seconds=routeSeconds(npc,out)+routeSeconds({...npc,position:candidate.cell},back);if(seconds>18)continue;return {target:{x:candidate.cell.x,y:candidate.cell.y},unknown:candidate.unknown,travelSeconds:Math.ceil(seconds),returnRoute:back};}return null;
}
export function localPlan(npc){
  if(npc.mode==='discovery')return null;
  const c=updateCognition(npc),u=signalUrgencies(npc);if(searchReturn(npc))return null;if(c.plan?.status==='active'||npc.scene!=='valley'||Math.max(...Object.values(u))>=3.5||npc.elapsed-c.lastPlanAt<10)return null;
  const frontier=explorationFrontier(npc);if(!frontier)return null;
  const supplies=npc.inventory?.apples.length||0,steps=[];
  if(npc.flask.water<=.00001){const source=Object.values(npc.memory.sources||{}).filter(s=>s.available!==false&&(s.retryAfter||0)<=npc.elapsed&&distance(s,npc.position)<900).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];if(!source)return null;if(distance(source,npc.position)>NPC_RULES.collectionRange)steps.push({type:'move',sourceId:source.id});steps.push({type:'fill_flask',sourceId:source.id});}
  if(supplies<2){const food=Object.values(npc.memory.foods||{}).filter(f=>f.available!==false&&(f.retryAfter||0)<=npc.elapsed&&f.stock>=2-supplies&&distance(f,npc.position)<900).sort((a,b)=>distance(a,npc.position)-distance(b,npc.position))[0];if(!food)return null;if(distance(food,npc.position)>NPC_RULES.collectionRange)steps.push({type:'move',foodId:food.id});for(let i=supplies;i<2;i++)steps.push({type:'gather_food',foodId:food.id});}
  if(steps.length){steps.push({type:'observe'});while(steps.length<3)steps.push({type:'observe'});return {goal:'Prepare carried food and water before investigating an unfamiliar trail.',verification:'prepare',need:'safety',steps:steps.slice(0,6),completion:'Carry water and useful food reserves.',interrupt:'Stop preparation if urgent bodily sensations need immediate relief.'};}
  if(!['steady','waning'].includes(bodySignals(npc).energy)||bodySignals(npc).sleepiness!=='alert')return null;
  return {goal:'Investigate an unknown edge of my remembered route and return with observations.',verification:'explore',need:'understanding',steps:[{type:'move',target:frontier.target},{type:'observe'},{type:'move',target:{...npc.position}}],completion:'Inspect new terrain and return to my starting place.',interrupt:'Return or seek relief if my body becomes distressed, conditions worsen, or a route fails.'};
}
export function validateCognition(raw,npc){
  const c=createCognition();if(!raw||raw.version!==1)return c;c.nextId=Math.max(1,Math.floor(number(raw.nextId,1,1e8)));
  c.beliefs=(Array.isArray(raw.beliefs)?raw.beliefs:[]).slice(-64).filter(b=>typeof b?.id==='string'&&['observed','inferred','reported'].includes(b.source)).map(b=>({id:text(b.id,80),subject:text(b.subject,100),kind:['resource','route','climate','general'].includes(b.kind)?b.kind:'general',text:text(b.text,300),source:b.source,status:['verified','unverified','corroborated','contradicted'].includes(b.status)?b.status:'unverified',confidence:['tentative','grounded','supported','revised'].includes(b.confidence)?b.confidence:'tentative',resourceId:text(b.resourceId,70)||null,...(typeof b.available==='boolean'?{available:b.available}:{}),...(point(b.position)?{position:point(b.position)}:{}),...(Number.isInteger(b.stock)?{stock:number(b.stock,0,10)}:{}),observedAt:number(b.observedAt),updatedAt:number(b.updatedAt),emptyAt:number(b.emptyAt),evidence:(Array.isArray(b.evidence)?b.evidence:[]).filter(e=>['observed','inferred','reported'].includes(e?.source)).slice(-6).map(e=>({source:e.source,at:number(e.at),sourceId:text(e.sourceId,70),resourceId:text(e.resourceId,70),channel:text(e.channel,30),messageId:text(e.messageId,80),...(typeof e.agrees==='boolean'?{agrees:e.agrees}:{})}))}));
  // Forged observed beliefs cannot create discovered resources or routes.
  c.beliefs=c.beliefs.filter(b=>b.source!=='observed'||!b.resourceId||['sources','foods','shelters'].some(table=>npc.memory[table]?.[b.resourceId]));
  c.predictions=(Array.isArray(raw.predictions)?raw.predictions:[]).slice(-16).filter(p=>p&&typeof p.subject==='string').map(p=>({subject:text(p.subject,100),expectation:text(p.expectation,240),confidence:['tentative','supported','revised'].includes(p.confidence)?p.confidence:'tentative',sourceBeliefIds:(Array.isArray(p.sourceBeliefIds)?p.sourceBeliefIds:[]).filter(id=>c.beliefs.some(b=>b.id===id)).slice(-6),checks:number(p.checks,0,1000),contradictions:number(p.contradictions,0,1000),observedIntervals:(Array.isArray(p.observedIntervals)?p.observedIntervals:[]).filter(Number.isFinite).slice(-6).map(v=>number(v,0,3600))}));
  for(const name of ['bornAt','lastEventId','lastKnowledgeAt','lastNoteAt','knowledgeGained'])c[name]=number(raw[name],c[name]);c.lastPlanAt=Number.isFinite(raw.lastPlanAt)?Math.max(-30,Math.min(npc.elapsed,raw.lastPlanAt)):-30;c.questions=(Array.isArray(raw.questions)?raw.questions:[]).slice(-8).map(q=>({messageId:text(q.messageId,80),topic:text(q.topic,100),text:text(q.text,420),at:number(q.at),status:q.status==='answered'?'answered':'unanswered'}));
  c.history=(Array.isArray(raw.history)?raw.history:[]).slice(-12).map(h=>({id:text(h.id,80),goal:text(h.goal,160),status:['completed','interrupted'].includes(h.status)?h.status:'interrupted',at:number(h.at),reason:text(h.reason,180)}));
  c.travel={samples:number(raw.travel?.samples,0,1e6),secondsPerUnit:Math.max(.004,Math.min(.025,number(raw.travel?.secondsPerUnit,1/CONFIG.walkSpeed)))};
  if(raw.home?.scene==='valley'&&point(raw.home.position)&&npc.memory.sources?.[raw.home.sourceId])c.home={scene:'valley',position:point(raw.home.position),sourceId:raw.home.sourceId};
  c.search={startedAt:raw.search?.startedAt===null?null:number(raw.search?.startedAt,npc.elapsed),returning:raw.search?.returning===true};const outside=raw.shelterState?.lastOutside;c.shelterState={enteredAt:raw.shelterState?.enteredAt===null?null:number(raw.shelterState?.enteredAt,npc.elapsed),departureUntil:Math.min(npc.elapsed+45,number(raw.shelterState?.departureUntil)),lastOutside:outside&&['comfortable','warm','hot','cool','cold'].includes(outside.warmth)?{warmth:outside.warmth,timeOfDay:text(outside.timeOfDay,30),weather:text(outside.weather,20),at:Math.min(npc.elapsed,number(outside.at))}:null};
  const old=npc.cognition,nextId=c.nextId,lastPlanAt=c.lastPlanAt;npc.cognition=c;
  if(raw.plan&&Array.isArray(raw.plan.steps)){
    const p=adoptPlan(npc,raw.plan,{supplied:['prepare','explore'].includes(raw.plan.verification)});
    if(p){
      p.id=text(raw.plan.id,80)||p.id;p.cursor=Math.min(p.steps.length,Math.floor(number(raw.plan.cursor)));p.startedAt=Math.min(npc.elapsed,number(raw.plan.startedAt,npc.elapsed));p.awaiting=false;p.startingKnowledge=number(raw.plan.startingKnowledge,c.knowledgeGained);p.status=['active','completed','interrupted'].includes(raw.plan.status)?raw.plan.status:'interrupted';
      const origin=raw.plan.origin,scenes=['valley',...CAVES.map(cave=>cave.id)],originPoint=point(origin?.position);
      if(originPoint&&scenes.includes(origin?.scene)&&canStand(originPoint.x,originPoint.y,origin.scene))p.origin={scene:origin.scene,position:originPoint};else if(p.verification==='explore'){p.status='interrupted';p.outcome='The saved starting place was not valid.';}
      const savedRoute=raw.plan.returnRoute,routeScene=savedRoute?.scene;
      if(scenes.includes(routeScene)&&Array.isArray(savedRoute.points))p.returnRoute={scene:routeScene,points:savedRoute.points.slice(0,12).map(point).filter(value=>value&&canStand(value.x,value.y,routeScene))};
      const maxSeconds=Math.max(15,number(raw.plan.budget?.maxSeconds,p.budget.maxSeconds,90));p.budget={returnSeconds:number(raw.plan.budget?.returnSeconds,p.budget.returnSeconds,60),maxSeconds,remainingSeconds:Math.max(0,maxSeconds-(npc.elapsed-p.startedAt))};
      p.stepsFinished=p.cursor>=p.steps.length;p.goalVerified=raw.plan.goalVerified===true&&p.status==='completed'&&p.verification!=='model';p.outcome=text(raw.plan.outcome,180)||p.outcome;
      if(raw.plan.awaiting)p.outcome='An unfinished physical action must be retried after restart; the original intention and return place remain.';
    }
  }
  c.nextId=nextId;c.lastPlanAt=lastPlanAt;npc.cognition=old;return c;
}
