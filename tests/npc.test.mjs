import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpc } from '../src/npc-state.js';
import { NPC_PRESETS, NPC_RULES, CONFIG, PONDS } from '../src/config.js';
import { canStandOutside, distance, objectsInRect } from '../src/world.js';
import { waterSource } from '../src/resources.js';
import { lineOfSight, tileKey } from '../src/perception.js';
import { knownRoute } from '../src/navigation.js';
import { observeNpc, tickNpc, requestNpcAction, collapseNpc, rescueNpc } from '../src/npc.js';
import { validateNpc, recordEvent } from '../src/npc-memory.js';
import { NpcController, LocalLearnerProvider, decisionObservation } from '../src/controller.js';
import { validateSave, writeSave, loadSave } from '../src/save.js';
import { freshState } from '../src/world.js';

const source=()=>{for(let i=2;i<12;i++){const s=waterSource(`river:east:${i}`);if(s)return s;}throw new Error('No test source');};
function nearSource(hydration=35){const n=createNpc({preset:'accelerated'}),s=source();n.position={x:s.x+8,y:s.y};n.hydration=hydration;observeNpc(n);return {n,s};}
function advance(n,seconds){for(let t=0;t<seconds;t+=.1)tickNpc(n,Math.min(.1,seconds-t));}
function memoryStorage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}

test('NPC starts with one identity, an empty flask, no source map and no learned procedures',()=>{const n=createNpc();assert.equal(n.id,'aster');assert.equal(n.flask.water,0);assert.deepEqual(n.memory.sources,{});assert.deepEqual(n.memory.skills,[]);assert.ok(canStandOutside(n.position.x,n.position.y));});
test('hydration follows simulation seconds independent of step frequency and time does not advance while paused',()=>{const a=createNpc(),b=createNpc();for(let i=0;i<600;i++)tickNpc(a,1/60);for(let i=0;i<40;i++)tickNpc(b,.25);assert.ok(Math.abs(a.hydration-b.hydration)<1e-8);assert.ok(Math.abs(a.hydration-(85-10*NPC_PRESETS.normal.depletionPerSecond))<1e-8);const h=a.hydration;tickNpc(a,0);tickNpc(a,NaN);assert.equal(a.hydration,h);});
test('flask collection changes contents but not hydration, and drinking consumes collected water',()=>{const {n,s}=nearSource();const initial=n.hydration;assert.equal(requestNpcAction(n,{type:'fill_flask',sourceId:s.id}).code,'COLLECTED');assert.equal(n.hydration,initial);assert.equal(n.flask.water,1);const r=requestNpcAction(n,{type:'drink'});assert.equal(r.code,'DRANK');assert.ok(n.hydration>initial);assert.ok(n.flask.water<1);assert.equal(n.stats.independentDrinks,1);assert.ok(n.hydration<=100);});
test('empty/full flask, full hydration, unknown sources and out-of-range actions fail with specific feedback',()=>{const {n,s}=nearSource();assert.equal(requestNpcAction(n,{type:'drink'}).code,'EMPTY_FLASK');assert.equal(requestNpcAction(n,{type:'fill_flask',sourceId:'river:east:100'}).code,'UNKNOWN_SOURCE');requestNpcAction(n,{type:'fill_flask',sourceId:s.id});assert.equal(requestNpcAction(n,{type:'fill_flask',sourceId:s.id}).code,'FLASK_FULL');n.hydration=100;assert.equal(requestNpcAction(n,{type:'drink'}).code,'ALREADY_HYDRATED');n.position={x:s.x+300,y:s.y};n.flask.water=0;assert.equal(requestNpcAction(n,{type:'fill_flask',sourceId:s.id}).code,'OUT_OF_REACH');});
test('unavailable sources are engine outcomes and stale resource knowledge is revised',()=>{const {n,s}=nearSource();const r=requestNpcAction(n,{type:'fill_flask',sourceId:s.id},{unavailableSources:[s.id]});assert.equal(r.code,'SOURCE_UNAVAILABLE');assert.equal(n.memory.sources[s.id].available,false);assert.equal(n.flask.water,0);});
test('movement cannot target hidden terrain and navigation consumes only known tiles',()=>{const n=createNpc();observeNpc(n);assert.equal(requestNpcAction(n,{type:'move',target:{x:15000,y:15000}}).code,'UNOBSERVED_TARGET');assert.equal(knownRoute({},n.position,{x:0,y:0}),null);const c=n.memory.cells[tileKey(n.position)];assert.ok(c?.walkable);});
test('local perception respects radius and tree occlusion; no full map or player private state is exposed',()=>{const n=createNpc();const obs=observeNpc(n);assert.ok(obs.sources.some(s=>s.id.startsWith('pond:spring:')));for(const cell of obs.cells)assert.ok(distance(n.position,cell)<=NPC_RULES.visionRadius+.01);const tree=objectsInRect(4000,3500,2000,2000)[0];assert.ok(tree);assert.equal(lineOfSight({x:tree.x-80,y:tree.y},{x:tree.x+80,y:tree.y}),false);const exposed=decisionObservation(n);assert.equal('player' in exposed,false);assert.equal('fullMap' in exposed,false);});
test('collapse cancels a bounded active action and occurs once',()=>{const n=createNpc();observeNpc(n);requestNpcAction(n,{type:'wait',seconds:5});n.hydration=.001;n.health=.001;tickNpc(n,.1);assert.equal(n.lifecycle,'COLLAPSED');assert.equal(n.active,null);assert.equal(n.stats.collapses,1);assert.equal(n.lastResult.code,'COLLAPSED');assert.equal(collapseNpc(n),false);tickNpc(n,.1);assert.equal(n.stats.collapses,1);assert.equal(requestNpcAction(n,{type:'move',target:{x:0,y:0}}).code,'UNCONSCIOUS');});
test('divine rescue is idempotent, gives no independent credit, preserves the flask and does not provide fast travel',()=>{const {n,s}=nearSource();recordEvent(n,'observation',{test:'retained'});requestNpcAction(n,{type:'fill_flask',sourceId:s.id});requestNpcAction(n,{type:'drink'});const skills=JSON.stringify(n.memory.skills),position={...n.position},water=n.flask.water,independent=n.stats.independentDrinks;collapseNpc(n);const id=n.collapseId;assert.equal(rescueNpc(n,id).ok,true);assert.equal(rescueNpc(n,id).ok,false);assert.deepEqual(n.position,position);assert.equal(n.flask.water,water);assert.equal(n.stats.independentDrinks,independent);assert.equal(n.stats.rescues,1);assert.equal(n.stats.lastRescuer,'divine');assert.equal(JSON.stringify(n.memory.skills),skills);assert.equal(n.id,'aster');assert.equal(n.lifecycle,'RECOVERING');assert.ok(n.memory.lessons.at(-1).verified.includes('not an independent'));});
test('collapse/recovery save restart retains timers, evidence, acquired skills and one corresponding rescue',()=>{const {n,s}=nearSource();requestNpcAction(n,{type:'fill_flask',sourceId:s.id});requestNpcAction(n,{type:'drink'});collapseNpc(n);advance(n,3);const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.lifecycle,'COLLAPSED');assert.equal(restored.id,n.id);assert.deepEqual(restored.memory.skills,n.memory.skills);advance(restored,5);assert.equal(restored.stats.rescues,1);assert.equal(restored.lifecycle,'RECOVERING');const again=validateNpc(JSON.parse(JSON.stringify(restored)));advance(again,3);assert.equal(again.lifecycle,'AWAKE');assert.equal(again.stats.rescues,1);assert.deepEqual(again.position,n.position);});
test('successful experience creates a candidate, changes later selection and transfers to a different starting position',()=>{const {n,s}=nearSource();requestNpcAction(n,{type:'fill_flask',sourceId:s.id});requestNpcAction(n,{type:'drink'});assert.equal(n.memory.skills[0].status,'candidate');n.hydration=40;n.flask.water=0;const c=new NpcController(n);for(let i=0;i<8;i++)c.tick(.1);assert.ok(n.skillRun);assert.equal(n.stats.skillUses,1);for(let i=0;i<30&&n.stats.independentDrinks<2;i++)c.tick(.1);assert.ok(n.stats.independentDrinks>=2);c.dispose();let other;for(let row=14;row<30;row++){const candidate=waterSource(`river:east:${row}`);if(candidate&&canStandOutside(candidate.x+8,candidate.y)){other=candidate;break;}}assert.ok(other);n.position={x:other.x+8,y:other.y};observeNpc(n);n.flask.water=0;n.hydration=40;requestNpcAction(n,{type:'fill_flask',sourceId:other.id});requestNpcAction(n,{type:'drink'});assert.equal(n.memory.skills[0].status,'validated');assert.ok(n.memory.skills[0].supportingExperience.length>=4);});
test('tiny top-ups, rescue water and repeated full-health drinking do not farm independent progress',()=>{const {n,s}=nearSource(99.9);requestNpcAction(n,{type:'fill_flask',sourceId:s.id});requestNpcAction(n,{type:'drink'});assert.equal(n.stats.independentDrinks,0);requestNpcAction(n,{type:'fill_flask',sourceId:s.id});assert.equal(n.stats.collections,1);for(let i=0;i<10;i++)requestNpcAction(n,{type:'drink'});assert.equal(n.stats.independentDrinks,0);});
test('interrupted saves cancel an unfinished action once on actual restart, and migrate exploration saves',()=>{const state=freshState(),store=memoryStorage();observeNpc(state.npc);requestNpcAction(state.npc,{type:'wait',seconds:5});assert.equal(writeSave(store,state),true);const restored=loadSave(store).state;assert.equal(restored.npc.active,null);assert.equal(restored.npc.memory.experience.filter(e=>e.details.result?.code==='RESTART_INTERRUPTED').length,1);writeSave(store,restored);assert.equal(loadSave(store).state.npc.memory.experience.filter(e=>e.details.result?.code==='RESTART_INTERRUPTED').length,1);const old=validateSave({version:1,scene:'valley',player:{x:5000,y:0},elapsed:99});assert.equal(old.elapsed,99);assert.equal(old.npc.id,'aster');});
test('saved procedures are restricted operations, source data are bounded, and malformed/executable skills are discarded',()=>{const n=createNpc();n.hydration=Infinity;n.memory.skills=[{id:'water-fill-drink',steps:[{type:'exec',command:'anything'},{type:'drink'}],supportingExperience:[1,2]}];n.memory.cells={'__proto__':{x:0,y:0},'999,999':{x:79920,y:79920,walkable:true}};const clean=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(clean.memory.skills.length,0);assert.equal(Object.keys(clean.memory.cells).length,0);assert.ok(Number.isFinite(clean.hydration));});
test('late model decisions after collapse are discarded rather than reviving or moving the NPC',async()=>{const n=createNpc();let resolve;const provider={kind:'local-model',label:'Scripted test mock',decide:()=>new Promise(r=>resolve=r),cancel(){}};const c=new NpcController(n,{provider});c.tick(.1);assert.ok(c.pending);const position={...n.position};collapseNpc(n);c.tick(.1);resolve({action:{type:'move',target:{x:0,y:0}},reason:'late test'});await new Promise(r=>setImmediate(r));assert.deepEqual(n.position,position);assert.equal(n.lifecycle,'COLLAPSED');assert.equal(n.stats.staleResponses,1);});
test('model service failures are recorded separately and do not invalidate acquired procedures',async()=>{const {n}=nearSource();n.learning=false;const provider={kind:'local-model',label:'Error-only test mock',decide:()=>Promise.reject(new Error('fixture timeout')),cancel(){}};const c=new NpcController(n,{provider});c.tick(.1);await new Promise(r=>setImmediate(r));assert.equal(n.stats.modelFailures,1);assert.equal(n.stats.invalidActions,0);assert.equal(n.memory.experience.at(-1).details.gameplayFailure,false);c.tick(.1);assert.ok(n.active||n.lastResult);});

test('a physically blocked observed route supplies failure evidence and the next plan avoids the failed edge',()=>{
  let pair;
  for(let y=3500;y<5600&&!pair;y+=80)for(let x=4000;x<6200&&!pair;x+=80){
    const a={x:Math.round(x/80)*80,y:Math.round(y/80)*80},b={x:a.x+80,y:a.y};
    if(!canStandOutside(a.x,a.y)||!canStandOutside(b.x,b.y)||!lineOfSight(a,b))continue;
    if(Array.from({length:7},(_,i)=>!canStandOutside(a.x+(i+1)*10,a.y)).some(Boolean))pair=[a,b];
  }
  assert.ok(pair,'A real narrow passage is required for this test');
  const n=createNpc();n.position={...pair[0]};observeNpc(n);
  assert.equal(requestNpcAction(n,{type:'move',target:pair[1]}).code,'STARTED');advance(n,4);
  assert.equal(n.lastResult.code,'ROUTE_BLOCKED');assert.equal(n.active,null);
  const edge=[tileKey(pair[0]),tileKey(pair[1])].sort().join('>');assert.ok(n.memory.blockedEdges[edge]);
  const revised=knownRoute(n.memory.cells,pair[0],pair[1],30,n.memory.blockedEdges,n.elapsed);
  assert.ok(revised);assert.notDeepEqual(revised[0],pair[1]);
});
test('a completed model response is queued until the next simulation tick, so inference cannot change a paused world',async()=>{
  const {n,s}=nearSource();requestNpcAction(n,{type:'fill_flask',sourceId:s.id});n.nextDecisionAt=0;
  const provider={kind:'local-model',label:'Explicit structured mock',decide:()=>Promise.resolve({action:{type:'drink'},reason:'scripted fixture'}),cancel(){}};
  const c=new NpcController(n,{provider});c.tick(.1);const hydration=n.hydration;
  await new Promise(r=>setImmediate(r));assert.equal(n.hydration,hydration);assert.ok(c.readyDecision);
  c.tick(.1);assert.ok(n.hydration>hydration);assert.equal(n.lastResult.code,'DRANK');
});

test('a distant interaction does not reveal current availability of a remembered resource',()=>{const {n,s}=nearSource();n.position={x:s.x+300,y:s.y};const result=requestNpcAction(n,{type:'fill_flask',sourceId:s.id},{unavailableSources:[s.id]});assert.equal(result.code,'OUT_OF_REACH');assert.equal(n.memory.sources[s.id].available,true);});
test('an unconscious NPC does not refresh its observed map or discover resources',()=>{const {n,s}=nearSource();const observedAt=n.memory.sources[s.id].observedAt;collapseNpc(n);advance(n,2);const result=observeNpc(n,{unavailableSources:[s.id]});assert.equal(result.sources.length,0);assert.equal(n.memory.sources[s.id].observedAt,observedAt);assert.equal(n.memory.sources[s.id].available,true);});

test('normal water reserve lasts seven minutes and low hydration produces warning before gradual damage',()=>{
  const n=createNpc();const untilZero=NPC_PRESETS.normal.initialHydration/NPC_PRESETS.normal.depletionPerSecond;
  assert.ok(untilZero>=300&&untilZero<=400);assert.ok(Math.abs(100/NPC_PRESETS.normal.depletionPerSecond-420)<1e-8);
  n.hydration=NPC_RULES.thirstWarning+.1;n.nourishment=100;advance(n,1);
  assert.equal(n.lifecycle,'AWAKE');assert.equal(n.health,100);assert.ok(n.memory.experience.some(e=>e.details.code==='THIRST_WARNING'));
  n.hydration=NPC_RULES.criticalHydration+.1;advance(n,1);assert.ok(n.memory.experience.some(e=>e.details.code==='CRITICAL_THIRST'));
  n.hydration=0;advance(n,1);assert.equal(n.lifecycle,'AWAKE');assert.ok(n.health<100);
});
test('accelerated needs use three times normal depletion while rescue provides another opportunity',()=>{
  const n=createNpc({preset:'accelerated'}),rules=NPC_PRESETS.accelerated;
  assert.ok(Math.abs(rules.depletionPerSecond-NPC_PRESETS.normal.depletionPerSecond*3)<1e-10);
  assert.ok(Math.abs(rules.nourishmentDepletionPerSecond-NPC_PRESETS.normal.nourishmentDepletionPerSecond*3)<1e-10);
  n.health=0;collapseNpc(n);rescueNpc(n);
  assert.ok(n.hydration/rules.depletionPerSecond>=90);assert.equal(n.flask.water,0);assert.equal(n.stats.independentDrinks,0);assert.ok(n.nourishment>0);
});
test('standing still does not inflate visit counts, and an empty-flask failure applies across thirst contexts',()=>{
  const n=createNpc();observeNpc(n);const key=tileKey(n.position),visits=n.memory.cells[key].visits;
  for(let i=0;i<10;i++)observeNpc(n);assert.equal(n.memory.cells[key].visits,visits);
  requestNpcAction(n,{type:'drink'});const provider=new LocalLearnerProvider();
  for(const hydration of [85,60,10]){n.hydration=hydration;for(let i=0;i<8;i++)assert.notEqual(provider.decide(n).action.type,'drink');}
});
test('a blocked snap inside a coarse tile chooses another observed entry instead of looping on that center',()=>{
  const cells={};for(let y=-1;y<=1;y++)for(let x=0;x<=2;x++){const key=`${x},${y}`;cells[key]={key,x:x*80,y:y*80,walkable:true};}
  const from={x:10,y:0},to={x:160,y:0},blocked={'0,0>0,0':{retryAfter:60}};
  const revised=knownRoute(cells,from,to,30,blocked,1);assert.ok(revised);assert.notDeepEqual(revised[0],{x:0,y:0});
  assert.deepEqual(knownRoute(cells,from,to,30,blocked,61)[0],{x:0,y:0});
});
test('failed water availability still allows frontier exploration rather than idle loops or repeated mapped targets',()=>{
  const unavailableSources=PONDS.flatMap(p=>Array.from({length:8},(_,i)=>`pond:${p.id}:${i}`));for(let row=-145;row<=145;row++)for(const side of ['west','east'])unavailableSources.push(`river:${side}:${row}`);for(let i=0;i<64;i++)unavailableSources.push(`lake:${i}`);
  for(const seed of [74193,3,11]){
    const n=createNpc({seed}),controller=new NpcController(n,{environment:{unavailableSources}}),initial=Object.keys(n.memory.cells).length,targets=[];
    for(let frame=0;frame<60/CONFIG.fixedStep;frame++){
      const before=n.lastResult?.eventId;controller.tick(CONFIG.fixedStep);
      if(n.lastResult?.eventId!==before&&n.lastResult?.action==='move'&&n.lastResult.code==='ARRIVED')targets.push(tileKey(n.position));
    }
    assert.ok(Object.keys(n.memory.cells).length>initial+80,`Seed ${seed} should expand actual observed territory.`);
    assert.ok(new Set(targets).size>=8,`Seed ${seed} should reach multiple distinct frontiers.`);
    assert.equal(targets.some((key,i)=>i>0&&key===targets[i-1]),false);
    assert.equal(n.stats.independentDrinks,0);assert.ok(n.memory.explorationCredit<=4);
  }
});
test('new exploration memory remains bounded and old NPC saves acquire it safely',()=>{
  const n=createNpc();observeNpc(n);n.memory.exploration.recentTargets=Array(100).fill(tileKey(n.position));
  const restored=validateNpc(JSON.parse(JSON.stringify(n)));assert.equal(restored.memory.exploration.recentTargets.length,12);
  assert.deepEqual(restored.memory.exploration.origin,n.position);
  delete n.memory.exploration;const old=validateNpc(JSON.parse(JSON.stringify(n)));assert.deepEqual(old.memory.exploration,{origin:null,lastVisited:null,recentTargets:[],heading:null});
  observeNpc(old);assert.deepEqual(old.memory.exploration.origin,old.position);
});
