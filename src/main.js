import { CONFIG, SPAWN, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { clamp, freshState, moveActor, nearestInteraction, clockTime, regionName, distance, canStand } from './world.js';
import { loadSave, writeSave, validateSave, saveProtectionReason } from './save.js';
import { Renderer } from './renderer.js';
import { PopulationRuntime } from './population.js';
import { bodySignals, sensedEnvironment } from './interoception.js';
import { createNpcPanel } from './npc-panel.js';
import { createCardinalPanel } from './cardinal-panel.js';
import { observeNpc } from './npc.js';
import { recordEvent } from './npc-memory.js';
import { tickEnvironment, environmentConditions, environmentHour } from './environment.js';
import { SimulationClock } from './simulation-clock.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['world','welcome','hud','begin','clock','day','region','location-detail','minimap','nav-label','interaction','toast','save-status','map-panel','atlas-map','map-title','map-hint','pause-panel','help-panel','waypoint-hud'].map(id=>[id,$(id)]));
let storage;
try { storage = window.localStorage; } catch { storage = { getItem(){return null;}, setItem(){throw new Error('Storage disabled');} }; }
const loaded = loadSave(storage);
let state = loaded.state;
const renderer = new Renderer(ui.world,state);
let population=new PopulationRuntime(state);
const selectedAgent=()=>population.getAgent(state.selectedAgentId)||state.npc;
const npcPanel=createNpcPanel({getNpc:selectedAgent,getAgents:()=>state.agents,getController:()=>population.controller(selectedAgent().id),getRuntime:()=>population,getCommunity:()=>state.community,selectAgent:id=>{if(!population.getAgent(id))return;state.selectedAgentId=id;renderer.followId=id;if(renderer.followNpc)renderer.snap(selectedAgent().position);save();},renderer,getEnvironment:()=>state.environment,save:()=>save(),notify});
const cardinalPanel=createCardinalPanel({getState:()=>state,getRuntime:()=>population.cardinal,save:()=>save(),notify,onVisibilityChange:visible=>{if(visible){closePanels(true);npcPanel.close();}}});
let started=false, paused=false, simulationSpeed=1, windowFocused=true, panel=null, pendingToast=null, saveBlocked=Boolean(loaded.error);
const keys=new Set(), anim={time:0,moving:false,facing:{x:0,y:1}};
let lastTime=performance.now()/1000, lastAutosave=0, lastHud=0, toastUntil=0, fps=60;
const simulationClock=new SimulationClock({step:CONFIG.fixedStep,onStep:fixedUpdate});
simulationClock.reset(lastTime);
if(loaded.exists)ui.begin.innerHTML='Continue your expedition <span>↗</span>';
if(loaded.error){pendingToast=loaded.error;ui['save-status'].textContent='Save protected';}

function notify(message,seconds=5){ui.toast.textContent=message;ui.toast.classList.remove('hidden');toastUntil=performance.now()/1000+seconds;}
function save(explicit=false){
  const protection=saveProtectionReason(state);
  if(protection){saveBlocked=true;ui['save-status'].textContent='Save protected';if(explicit)notify(protection,9);return false;}
  if(saveBlocked&&!explicit)return false;
  const ok=writeSave(storage,state);
  if(ok){saveBlocked=false;ui['save-status'].textContent='Saved locally';if(explicit)notify('Expedition saved on this computer.');}
  else {ui['save-status'].textContent='Save unavailable';if(explicit)notify('Local saving is unavailable. Your current session is still running.',7);}
  return ok;
}
function closePanels(keepCardinal=false){for(const name of ['map-panel','pause-panel','help-panel'])ui[name].classList.add('hidden');if(keepCardinal!==true)cardinalPanel.close();panel=null;keys.clear();ui.world.focus({preventScroll:true});}
function updateAtlas(){renderer.drawAtlas(ui['atlas-map'],state);const status=renderer.atlasStatus();$('atlas-zoom-label').textContent=`${status.zoom.toFixed(1)}×`;}
function openPanel(name){
  if(!started)return;
  closePanels();panel=name;ui[name+'-panel'].classList.remove('hidden');keys.clear();anim.moving=false;
  if(name==='map'){
    ui['map-title'].textContent='Crown Ridge & the lowlands';
    ui['map-hint'].textContent='Scroll to zoom · drag to pan · click to mark · right-click to clear';
    updateAtlas();
  }
  const dialog=ui[name+'-panel'];dialog.querySelector('button')?.focus();save();
}
function togglePanel(name){if(panel===name)closePanels();else openPanel(name);}
function togglePause(){paused=!paused;simulationClock.reset(performance.now()/1000);keys.clear();anim.moving=false;if(paused)openPanel('pause');else closePanels();}
function begin(){
  started=true;ui.welcome.classList.add('hidden');ui.hud.classList.remove('hidden');keys.clear();ui.world.focus();lastTime=performance.now()/1000;simulationClock.reset(lastTime);
  if(pendingToast){notify(pendingToast,9);pendingToast=null;}
  else if(!loaded.exists)notify('Welcome to the Trailhead. Press M for your field map, or H for controls.',6);
}
function interact(){
  const action=nearestInteraction(state.player,state.scene);if(!action)return;
  if(action.type==='enter'){
    state.scene=action.id;state.player={...CAVE_SPAWN};state.visitedCaves=[...new Set([...state.visitedCaves,action.id])];state.discoveries=[...new Set([...state.discoveries,action.id])];
    renderer.snap(state.player);notify(action.name+' — '+action.note,6);keys.clear();save();
  }else if(action.type==='exit'){
    const c=CAVES.find(c=>c.id===state.scene);
    state.scene='valley';state.player={x:c.x,y:c.y+95};renderer.snap(state.player);keys.clear();notify('Back beneath the open sky.');save();
  }else notify('The central trail runs east–west. Follow the river north to Stillwater Lake. Marked caverns lie beneath Crown Ridge, and Willow Refuge offers shelter near the starting pond. Press M to plan your route.',10);
}
function returnToCamp(){
  if(!window.confirm('Return to the Trailhead? Your discoveries and world time will be kept.'))return;
  state.scene='valley';state.player={...SPAWN};renderer.snap(state.player);closePanels();save();notify('Returned to the Trailhead.');
}
function newExpedition(){
  if(!window.confirm('Start a new expedition? This replaces your saved world, both characters’ memories, and conversations.'))return;
  const providerFactory=population.providerFactory;population.dispose();state=freshState();population=new PopulationRuntime(state,{providerFactory});renderer.followId=state.selectedAgentId;saveBlocked=false;paused=false;simulationClock.reset(performance.now()/1000);renderer.snap(state.player);closePanels();save();notify('A fresh discovery expedition. The valley awaits.');
}
ui.begin.addEventListener('click',begin);
$('watch-aster').addEventListener('click',()=>{begin();npcPanel.follow(true);npcPanel.toggle();});
$('open-npc').addEventListener('click',()=>cardinalPanel.close());
$('open-map').addEventListener('click',()=>togglePanel('map'));
$('close-map').addEventListener('click',closePanels);
$('help-button').addEventListener('click',()=>togglePanel('help'));
$('close-help').addEventListener('click',closePanels);
$('resume').addEventListener('click',()=>{paused=false;simulationClock.reset(performance.now()/1000);closePanels();});
const speedControl=$('simulation-speed');if(speedControl)speedControl.addEventListener('change',()=>{const speed=Number(speedControl.value);if([1,4,16,60].includes(speed)){simulationSpeed=speed;simulationClock.reset(performance.now()/1000);keys.clear();}});
$('save-button').addEventListener('click',()=>save(true));
$('return-camp').addEventListener('click',returnToCamp);
$('new-expedition').addEventListener('click',newExpedition);
const movementCodes=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();if(started)save(true);return;}
  if(e.code==='Tab'&&panel){
    // Keep keyboard focus inside an open dialog.
    const buttons=[...ui[panel+'-panel'].querySelectorAll('button')];
    if(buttons.length){const index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}return;
  }
  if(!started)return;
  if(e.code==='Escape'){e.preventDefault();if(!e.repeat)togglePause();return;}
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(e.code==='KeyN'){e.preventDefault();keys.clear();cardinalPanel.close();npcPanel.toggle();return;}
  if(e.code==='KeyC'){e.preventDefault();keys.clear();if(!paused)cardinalPanel.toggle();return;}
  if(movementCodes.has(e.code)){if(!e.ctrlKey&&!e.metaKey&&!e.altKey)e.preventDefault();if(!panel&&!cardinalPanel.visible&&!e.ctrlKey&&!e.metaKey&&!e.altKey)keys.add(e.code);return;}
  if(e.repeat)return;
  if(e.code==='KeyM'){e.preventDefault();togglePanel('map');}
  else if(e.code==='KeyH'){e.preventDefault();togglePanel('help');}
  else if(e.code==='KeyE'&&!panel&&!cardinalPanel.visible){e.preventDefault();interact();}
  else if(panel==='map'&&(e.code==='Equal'||e.code==='NumpadAdd')){e.preventDefault();renderer.atlasZoom(1.35);updateAtlas();}
  else if(panel==='map'&&(e.code==='Minus'||e.code==='NumpadSubtract')){e.preventDefault();renderer.atlasZoom(1/1.35);updateAtlas();}
  else if(!panel&&(e.code==='Equal'||e.code==='NumpadAdd'))renderer.targetZoom=clamp(renderer.targetZoom*1.12,.8,2.6);
  else if(!panel&&(e.code==='Minus'||e.code==='NumpadSubtract'))renderer.targetZoom=clamp(renderer.targetZoom/1.12,.8,2.6);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
ui.world.addEventListener('wheel',e=>{if(!started||panel||cardinalPanel.visible)return;e.preventDefault();renderer.targetZoom=clamp(renderer.targetZoom*Math.exp(-e.deltaY*.001),.8,2.6);},{passive:false});
window.addEventListener('resize',()=>renderer.resize());
function clearFocusInput(){keys.clear();anim.moving=false;if(started)save();}
window.addEventListener('blur',()=>{windowFocused=false;clearFocusInput();});
window.addEventListener('focus',()=>{windowFocused=true;keys.clear();});
window.aincradAgent?.onWindowActive?.(active=>{windowFocused=active;if(!active)clearFocusInput();else keys.clear();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearFocusInput();});
window.addEventListener('pagehide',()=>{if(started)save();});
window.addEventListener('beforeunload',()=>{if(started)save();});
const atlasCanvas=ui['atlas-map'];
const atlasEventPoint=e=>{const r=atlasCanvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*atlasCanvas.width,y:(e.clientY-r.top)/r.height*atlasCanvas.height};};
let atlasGesture=null,skipAtlasClick=false;
atlasCanvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;atlasGesture={id:e.pointerId,startX:e.clientX,startY:e.clientY,last:atlasEventPoint(e),moved:false};atlasCanvas.setPointerCapture(e.pointerId);});
atlasCanvas.addEventListener('pointermove',e=>{if(!atlasGesture||atlasGesture.id!==e.pointerId)return;if(!atlasGesture.moved&&Math.hypot(e.clientX-atlasGesture.startX,e.clientY-atlasGesture.startY)<5)return;atlasGesture.moved=true;const p=atlasEventPoint(e);renderer.atlasPan(p.x-atlasGesture.last.x,p.y-atlasGesture.last.y);atlasGesture.last=p;updateAtlas();});
atlasCanvas.addEventListener('pointerup',e=>{if(!atlasGesture||atlasGesture.id!==e.pointerId)return;skipAtlasClick=atlasGesture.moved;atlasGesture=null;if(atlasCanvas.hasPointerCapture(e.pointerId))atlasCanvas.releasePointerCapture(e.pointerId);});
atlasCanvas.addEventListener('pointercancel',()=>{atlasGesture=null;skipAtlasClick=true;});
atlasCanvas.addEventListener('wheel',e=>{e.preventDefault();const p=atlasEventPoint(e);renderer.atlasZoom(Math.exp(-e.deltaY*.0015),p.x,p.y);updateAtlas();},{passive:false});
for(const [id,factor]of [['atlas-zoom-in',1.35],['atlas-zoom-out',1/1.35]])$(id).addEventListener('click',()=>{renderer.atlasZoom(factor);updateAtlas();});
$('atlas-fit').addEventListener('click',()=>{renderer.atlasFit();updateAtlas();});
for(const id of ['you','aster','mira'])$('atlas-center-'+id).addEventListener('click',()=>{renderer.atlasCenter(id,state);updateAtlas();});
atlasCanvas.addEventListener('click',e=>{
  if(skipAtlasClick){skipAtlasClick=false;return;}
  const point=atlasEventPoint(e),marker=renderer.atlasMarkerAt(point.x,point.y);
  if(marker){renderer.atlasCenter(marker,state);updateAtlas();return;}
  const p=renderer.atlasPoint(point.x,point.y);
  if(!p)return;state.waypoint=p;renderer.drawAtlas(ui['atlas-map'],state);save();
});
ui['atlas-map'].addEventListener('contextmenu',e=>{e.preventDefault();state.waypoint=null;renderer.drawAtlas(ui['atlas-map'],state);save();});
function fixedUpdate(dt){
  let dx=panel||cardinalPanel.visible||!windowFocused?0:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  let dy=panel||cardinalPanel.visible||!windowFocused?0:(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
  const travelled=moveActor(state.player,dx,dy,dt,keys.has('ShiftLeft')||keys.has('ShiftRight'),state.scene);
  anim.moving=travelled>.01;
  if(dx||dy){const n=Math.hypot(dx,dy);anim.facing={x:dx/n,y:dy/n};}
  state.elapsed+=dt;state.distance+=travelled;
  const epochs=new Map(state.agents.map(n=>[n.id,n.epoch]));population.tick(dt);
  let changed=false;for(const n of state.agents)if(n.epoch!==epochs.get(n.id)){changed=true;if(n.lifecycle==='RECOVERING')notify(n.rescuePresentation==='quiet'?`${n.name} has received care and is recovering.`:`A warm light gathers around ${n.name}. A benevolent presence is helping her recover.`,7);else if(n.lifecycle==='COLLAPSED')notify(`${n.name} has collapsed from ${n.collapseCause||'severe deprivation'}. Her experience will be retained.`,6);}
  if(changed)save();
}
function updateHud(now){
  if(now-lastHud<.15)return;lastHud=now;
  $('expedition-mode').textContent=state.simulationMode==='discovery'?'DISCOVERY':'LEGACY';
  const c=clockTime(state.elapsed),hour=environmentHour(state.environment),minute=Math.floor(hour*60);c.hour=Math.floor(minute/60);c.minute=minute%60;ui.clock.textContent=`${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`;ui.day.textContent='DAY '+String(c.day).padStart(2,'0');
  const following=renderer.followNpc,subject=renderer.viewSubject(state),viewedScene=renderer.viewScene(state),viewedAgent=population.getAgent(renderer.followId)||selectedAgent();
  ui.region.textContent=regionName(subject.x,subject.y,viewedScene);
  const conditions=environmentConditions(state.environment,{position:subject,scene:viewedScene,thermal:following?viewedAgent.thermal:undefined});
  const sensed=sensedEnvironment({sensation:conditions});
  $('world-weather').textContent=`${sensed.shelter==='sheltered'?'Sheltered':sensed.weather} · ${sensed.warmth} · ${sensed.wind}${state.environment.settings.hourOverride!==null||state.environment.settings.weatherOverride!==null?' · TEST':''}`;
  $('location-kicker').textContent=following?`${viewedAgent.name.toUpperCase()}’S JOURNEY`:'YOUR FOOTSTEPS, YOUR STORY';
  ui['location-detail'].textContent=`${following?'Following '+viewedAgent.name:viewedScene==='valley'?'Crown Ridge Valley':'Beneath Crown Ridge'} · ${state.visitedCaves.length} / ${CAVES.length} caverns explored`;
  ui['nav-label'].textContent=viewedScene==='valley'?'THE VALLEY':'UNDER THE RIDGE';
  const action=nearestInteraction(state.player,state.scene);
  ui.interaction.classList.toggle('hidden',!action||Boolean(panel)||following);
  if(action)ui.interaction.querySelector('span').textContent=action.type==='enter'?'Enter '+action.name:action.name;
  if(state.scene==='valley'){
    for(const l of LANDMARKS)if(!state.discoveries.includes(l.id)&&distance(l,state.player)<(l.kind==='cave'?350:1000)){state.discoveries.push(l.id);notify('Discovered · '+l.name);}
  }
  const wp=state.waypoint;
  ui['waypoint-hud'].classList.toggle('hidden',!wp||viewedScene!=='valley');
  if(wp&&viewedScene==='valley'){
    const seconds=distance(wp,subject)/CONFIG.walkSpeed;
    if(seconds<.7){state.waypoint=null;notify('You reached your waypoint.');}
    else{const a=Math.atan2(wp.y-subject.y,wp.x-subject.x),dirs=['→','↘','↓','↙','←','↖','↑','↗'];const dir=dirs[(Math.round(a/(Math.PI/4))+8)%8];ui['waypoint-hud'].textContent=`${dir} Waypoint · ~${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')} direct walk`;}
  }
  if(now>toastUntil)ui.toast.classList.add('hidden');
}
function loop(ms){
  const now=ms/1000,dt=clamp(now-lastTime,0,.25);lastTime=now;fps=fps*.95+(dt>0?1/dt:60)*.05;
  if(started&&!paused)anim.time+=dt;
  else{anim.moving=false;if(!started)anim.time+=dt;}
  renderer.render(state,anim,dt,started);
  if(started){npcPanel.update(now);cardinalPanel.update(now);renderer.drawMini(ui.minimap,state,now);updateHud(now);if(panel==='map'&&now-(loop.lastAtlas||0)>.1){loop.lastAtlas=now;updateAtlas();}if(now-lastAutosave>10){lastAutosave=now;save();}}
  requestAnimationFrame(loop);
}
window.addEventListener('error',e=>{ $('fatal-message').textContent=e.message||'An unexpected runtime error occurred.';$('fatal').classList.remove('hidden'); });
window.addEventListener('unhandledrejection',e=>{ $('fatal-message').textContent=String(e.reason?.message||e.reason||'An unexpected error occurred.');$('fatal').classList.remove('hidden'); });
requestAnimationFrame(loop);
setInterval(()=>{simulationClock.advance(performance.now()/1000,{running:started&&!paused,speed:simulationSpeed});if(started&&!paused)population.workCardinal(8);if(started&&performance.now()/1000-lastAutosave>10){lastAutosave=performance.now()/1000;save();}},1000/60);
// Local test hooks are absent in normal play. They expose game state only, never OS access.
if(new URLSearchParams(location.search).has('test') || window.__AINCRAD_TEST__ === true){
  window.__aincrad={
    snapshot:()=>structuredClone(state),
    metrics:()=>({fps,cache:renderer.chunks.size,zoom:renderer.zoom,panel,started,paused,simulationSpeed,windowFocused,interaction:nearestInteraction(state.player,state.scene)}),
    teleport:(x,y,scene='valley')=>{if(scene!=='valley'&&!CAVES.some(c=>c.id===scene))return false;if(!canStand(x,y,scene))return false;state.scene=scene;state.player={x,y};renderer.snap(state.player);return true;},
    step:(seconds,dx=0,dy=0)=>{for(let t=0;t<seconds;t+=CONFIG.fixedStep){const dt=Math.min(CONFIG.fixedStep,seconds-t);state.distance+=moveActor(state.player,dx,dy,dt,false,state.scene);state.elapsed+=dt;population.tick(dt);}},
    start:begin,interact,save:()=>save(true),reset:()=>{population.dispose();state=freshState();population=new PopulationRuntime(state);renderer.followId=state.selectedAgentId;renderer.snap(state.player);},
    npc:(id=state.selectedAgentId)=>structuredClone(population.getAgent(id)),
    agents:()=>structuredClone(state.agents),conversation:()=>structuredClone(state.community),
    cardinal:()=>structuredClone(state.cardinal),
    cardinalMode:mode=>population.setCardinalMode(mode),
    cardinalWork:(calls=1)=>{for(let i=0;i<Math.min(100,Math.max(0,Math.floor(calls)));i++)population.workCardinal(8);return structuredClone(state.cardinal);},
    testCardinalTiming:settings=>{const runtime=population.cardinal;if(!runtime)return false;for(const key of ['observationSeconds','minHistorySeconds','experimentIntervalSeconds','experimentHorizonSeconds','monitoringSeconds'])if(Number.isFinite(settings?.[key])&&settings[key]>=.25&&settings[key]<=3600)runtime.config[key]=settings[key];runtime.diagnose('DEVELOPER_TIMING_FIXTURE','info','Native verification uses explicitly shortened Cardinal scheduling and copied-world horizons; biological rates are unchanged.');return true;},
    atlas:()=>({status:renderer.atlasStatus(),markers:structuredClone(renderer.atlasMarkers||[])}),
    postMessage:(text,to='all',replyTo=null)=>population.social.postUserMessage(text,{to,replyTo}),
    npcAction:(id,action)=>population.controller(id)?.perform(action),
    testPlan:(id,plan)=>{const n=population.getAgent(id);if(!n)return false;population.cancel(id);n.active=null;n.skillRun=null;recordEvent(n,'debug',{setting:'test plan',provenance:'native QA fixture'});population.controller(id).applyDecision({plan,provider:'native QA fixture',reason:'A bounded persistence fixture.'});return n.cognition.plan?.status==='active';},
    npcStep:(seconds)=>{for(let t=0;t<seconds;t+=CONFIG.fixedStep){const dt=Math.min(CONFIG.fixedStep,seconds-t);state.elapsed+=dt;population.tick(dt);}},
    npcTeleport:(x,y,scene='valley',id=state.selectedAgentId)=>{const n=population.getAgent(id);if(!n||scene!=='valley'&&!CAVES.some(c=>c.id===scene)||!canStand(x,y,scene))return false;n.position={x,y};n.scene=scene;n.epoch++;n.active=null;n.skillRun=null;population.cancel(id);recordEvent(n,'debug',{setting:'position',value:{x,y},provenance:'debug'});observeNpc(n,state.environment);return true;},
    light:(elapsed)=>{state.elapsed=clamp(elapsed,0,3600*1000);state.environment.elapsed=state.elapsed;tickEnvironment(state.environment,1e-9);},
    environment:()=>structuredClone(state.environment),
    worldSettings:(settings)=>{state.environment.settings.hourOverride=Number.isFinite(settings.hourOverride)&&settings.hourOverride>=0&&settings.hourOverride<24?settings.hourOverride:null;state.environment.settings.weatherOverride=['clear','cloudy','rainy','windy'].includes(settings.weatherOverride)?settings.weatherOverride:null;population.cancel();for(const n of state.agents)recordEvent(n,'debug',{setting:'world conditions',value:state.environment.settings,provenance:'debug'});},
  };
}
