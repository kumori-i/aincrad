import { CONFIG, SPAWN, CAVES, CAVE_SPAWN, LANDMARKS } from './config.js';
import { clamp, freshState, moveActor, nearestInteraction, clockTime, regionName, distance, canStand } from './world.js';
import { loadSave, writeSave, validateSave } from './save.js';
import { Renderer } from './renderer.js';
import { NpcController } from './controller.js';
import { createNpcPanel } from './npc-panel.js';
import { observeNpc } from './npc.js';
import { recordEvent } from './npc-memory.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['world','welcome','hud','begin','clock','day','region','location-detail','minimap','nav-label','interaction','toast','save-status','map-panel','atlas-map','map-title','map-hint','pause-panel','help-panel','waypoint-hud'].map(id=>[id,$(id)]));
let storage;
try { storage = window.localStorage; } catch { storage = { getItem(){return null;}, setItem(){throw new Error('Storage disabled');} }; }
const loaded = loadSave(storage);
let state = loaded.state;
const renderer = new Renderer(ui.world,state);
let npcController=new NpcController(state.npc);
const npcPanel=createNpcPanel({getNpc:()=>state.npc,getController:()=>npcController,renderer,save:()=>save(),notify});
let started=false, panel=null, pendingToast=null, saveBlocked=Boolean(loaded.error);
const keys=new Set(), anim={time:0,moving:false,facing:{x:0,y:1}};
let lastTime=performance.now()/1000, accumulator=0, lastAutosave=0, lastHud=0, toastUntil=0, fps=60;
if(loaded.exists)ui.begin.innerHTML='Continue your expedition <span>↗</span>';
if(loaded.error)pendingToast=loaded.error;

function notify(message,seconds=5){ui.toast.textContent=message;ui.toast.classList.remove('hidden');toastUntil=performance.now()/1000+seconds;}
function save(explicit=false){
  if(saveBlocked&&!explicit)return false;
  const ok=writeSave(storage,state);
  if(ok){saveBlocked=false;ui['save-status'].textContent='Saved locally';if(explicit)notify('Expedition saved on this computer.');}
  else {ui['save-status'].textContent='Save unavailable';if(explicit)notify('Local saving is unavailable. Your current session is still running.',7);}
  return ok;
}
function closePanels(){for(const name of ['map-panel','pause-panel','help-panel'])ui[name].classList.add('hidden');panel=null;keys.clear();accumulator=0;ui.world.focus({preventScroll:true});}
function openPanel(name){
  if(!started)return;
  closePanels();panel=name;ui[name+'-panel'].classList.remove('hidden');keys.clear();anim.moving=false;
  if(name==='map'){
    ui['map-title'].textContent=state.scene==='valley'?'Crown Ridge & the lowlands':CAVES.find(c=>c.id===state.scene)?.name||'Cavern';
    ui['map-hint'].textContent=state.scene==='valley'?'Click to set a waypoint · right-click to clear':'The stairs lead back to the valley';
    renderer.drawAtlas(ui['atlas-map'],state);
  }
  const dialog=ui[name+'-panel'];dialog.querySelector('button')?.focus();save();
}
function togglePanel(name){if(panel===name)closePanels();else openPanel(name);}
function begin(){
  started=true;ui.welcome.classList.add('hidden');ui.hud.classList.remove('hidden');keys.clear();ui.world.focus();lastTime=performance.now()/1000;accumulator=0;
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
  }else notify('The central trail runs east–west. Follow the river north to Stillwater Lake. Three marked caverns lie beneath Crown Ridge. Press M to plan your route.',10);
}
function returnToCamp(){
  if(!window.confirm('Return to the Trailhead? Your discoveries and world time will be kept.'))return;
  state.scene='valley';state.player={...SPAWN};renderer.snap(state.player);closePanels();save();notify('Returned to the Trailhead.');
}
function newExpedition(){
  if(!window.confirm('Start a new expedition? This replaces your saved position, discoveries, world time, and Aster’s memory.'))return;
  const provider=npcController.provider;npcController.dispose();state=freshState();npcController=new NpcController(state.npc,{provider});saveBlocked=false;renderer.snap(state.player);closePanels();save();notify('A fresh beginning. The valley awaits.');
}
ui.begin.addEventListener('click',begin);
$('open-map').addEventListener('click',()=>togglePanel('map'));
$('close-map').addEventListener('click',closePanels);
$('help-button').addEventListener('click',()=>togglePanel('help'));
$('close-help').addEventListener('click',closePanels);
$('pause-button').addEventListener('click',()=>togglePanel('pause'));
$('resume').addEventListener('click',closePanels);
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
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(e.code==='KeyN'){e.preventDefault();keys.clear();npcPanel.toggle();return;}
  if(movementCodes.has(e.code)){if(!e.ctrlKey&&!e.metaKey&&!e.altKey)e.preventDefault();if(!panel&&!e.ctrlKey&&!e.metaKey&&!e.altKey)keys.add(e.code);return;}
  if(e.repeat)return;
  if(e.code==='KeyM'){e.preventDefault();togglePanel('map');}
  else if(e.code==='KeyH'){e.preventDefault();togglePanel('help');}
  else if(e.code==='Escape'){e.preventDefault();if(panel)closePanels();else openPanel('pause');}
  else if(e.code==='KeyE'&&!panel){e.preventDefault();interact();}
  else if(!panel&&(e.code==='Equal'||e.code==='NumpadAdd'))renderer.targetZoom=clamp(renderer.targetZoom*1.12,.8,2.6);
  else if(!panel&&(e.code==='Minus'||e.code==='NumpadSubtract'))renderer.targetZoom=clamp(renderer.targetZoom/1.12,.8,2.6);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
ui.world.addEventListener('wheel',e=>{if(!started||panel)return;e.preventDefault();renderer.targetZoom=clamp(renderer.targetZoom*Math.exp(-e.deltaY*.001),.8,2.6);},{passive:false});
window.addEventListener('resize',()=>renderer.resize());
function pauseForFocusLoss(){keys.clear();if(started&&!panel)openPanel('pause');if(started)save();}
window.addEventListener('blur',pauseForFocusLoss);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseForFocusLoss();});
window.addEventListener('pagehide',()=>{if(started)save();});
window.addEventListener('beforeunload',()=>{if(started)save();});
ui['atlas-map'].addEventListener('click',e=>{
  if(state.scene!=='valley')return;
  const r=ui['atlas-map'].getBoundingClientRect();
  const p=renderer.atlasPoint((e.clientX-r.left)/r.width*ui['atlas-map'].width,(e.clientY-r.top)/r.height*ui['atlas-map'].height);
  if(!p)return;state.waypoint=p;renderer.drawAtlas(ui['atlas-map'],state);save();
});
ui['atlas-map'].addEventListener('contextmenu',e=>{e.preventDefault();state.waypoint=null;renderer.drawAtlas(ui['atlas-map'],state);save();});
function fixedUpdate(dt){
  let dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  let dy=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
  const travelled=moveActor(state.player,dx,dy,dt,keys.has('ShiftLeft')||keys.has('ShiftRight'),state.scene);
  anim.moving=travelled>.01;
  if(dx||dy){const n=Math.hypot(dx,dy);anim.facing={x:dx/n,y:dy/n};}
  state.elapsed+=dt;state.distance+=travelled;
  const previousEpoch=state.npc.epoch;npcController.tick(dt);if(state.npc.epoch!==previousEpoch){save();if(state.npc.lifecycle==='RECOVERING')notify(state.npc.rescuePresentation==='quiet'?'Aster has received water and is recovering.':'A warm light gathers around Aster. A benevolent presence has supplied water.',7);else if(state.npc.lifecycle==='COLLAPSED')notify('Aster has collapsed from dehydration. Its experience will be retained.',6);}
}
function updateHud(now){
  if(now-lastHud<.15)return;lastHud=now;
  const c=clockTime(state.elapsed);ui.clock.textContent=`${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`;ui.day.textContent='DAY '+String(c.day).padStart(2,'0');
  ui.region.textContent=regionName(state.player.x,state.player.y,state.scene);
  ui['location-detail'].textContent=`${state.scene==='valley'?'Crown Ridge Valley':'Beneath Crown Ridge'} · ${state.visitedCaves.length} / 3 caverns explored`;
  ui['nav-label'].textContent=state.scene==='valley'?'THE VALLEY':'UNDER THE RIDGE';
  const action=nearestInteraction(state.player,state.scene);
  ui.interaction.classList.toggle('hidden',!action||Boolean(panel));
  if(action)ui.interaction.querySelector('span').textContent=action.type==='enter'?'Enter '+action.name:action.name;
  if(state.scene==='valley'){
    for(const l of LANDMARKS)if(!state.discoveries.includes(l.id)&&distance(l,state.player)<(l.kind==='cave'?350:1000)){state.discoveries.push(l.id);notify('Discovered · '+l.name);}
  }
  const wp=state.waypoint;
  ui['waypoint-hud'].classList.toggle('hidden',!wp||state.scene!=='valley');
  if(wp&&state.scene==='valley'){
    const seconds=distance(wp,state.player)/CONFIG.walkSpeed;
    if(seconds<.7){state.waypoint=null;notify('You reached your waypoint.');}
    else{const a=Math.atan2(wp.y-state.player.y,wp.x-state.player.x),dirs=['→','↘','↓','↙','←','↖','↑','↗'];const dir=dirs[(Math.round(a/(Math.PI/4))+8)%8];ui['waypoint-hud'].textContent=`${dir} Waypoint · ~${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')} direct walk`;}
  }
  if(now>toastUntil)ui.toast.classList.add('hidden');
}
function loop(ms){
  const now=ms/1000,dt=clamp(now-lastTime,0,.25);lastTime=now;fps=fps*.95+(dt>0?1/dt:60)*.05;
  if(started&&!panel&&!document.hidden){accumulator+=dt;while(accumulator>=CONFIG.fixedStep){fixedUpdate(CONFIG.fixedStep);accumulator-=CONFIG.fixedStep;}anim.time+=dt;}
  else{anim.moving=false;accumulator=0;if(!started)anim.time+=dt;}
  renderer.render(state,anim,dt,started);
  if(started){npcPanel.update(now);renderer.drawMini(ui.minimap,state,now);updateHud(now);if(now-lastAutosave>10){lastAutosave=now;save();}}
  requestAnimationFrame(loop);
}
window.addEventListener('error',e=>{ $('fatal-message').textContent=e.message||'An unexpected runtime error occurred.';$('fatal').classList.remove('hidden'); });
window.addEventListener('unhandledrejection',e=>{ $('fatal-message').textContent=String(e.reason?.message||e.reason||'An unexpected error occurred.');$('fatal').classList.remove('hidden'); });
requestAnimationFrame(loop);
// Local test hooks are absent in normal play. They expose game state only, never OS access.
if(new URLSearchParams(location.search).has('test') || window.__AINCRAD_TEST__ === true){
  window.__aincrad={
    snapshot:()=>structuredClone(state),
    metrics:()=>({fps,cache:renderer.chunks.size,zoom:renderer.zoom,panel,started,interaction:nearestInteraction(state.player,state.scene)}),
    teleport:(x,y,scene='valley')=>{if(scene!=='valley'&&!CAVES.some(c=>c.id===scene))return false;if(!canStand(x,y,scene))return false;state.scene=scene;state.player={x,y};renderer.snap(state.player);return true;},
    step:(seconds,dx=0,dy=0)=>{for(let t=0;t<seconds;t+=CONFIG.fixedStep){const dt=Math.min(CONFIG.fixedStep,seconds-t);state.distance+=moveActor(state.player,dx,dy,dt,false,state.scene);state.elapsed+=dt;}},
    start:begin,interact,save:()=>save(true),reset:()=>{npcController.dispose();state=freshState();npcController=new NpcController(state.npc);renderer.snap(state.player);},
    npc:()=>structuredClone(state.npc),
    npcStep:(seconds)=>{for(let t=0;t<seconds;t+=CONFIG.fixedStep)npcController.tick(Math.min(CONFIG.fixedStep,seconds-t));},
    npcTeleport:(x,y)=>{if(!canStand(x,y,'valley'))return false;state.npc.position={x,y};state.npc.active=null;state.npc.skillRun=null;npcController.cancel();recordEvent(state.npc,'debug',{setting:'position',value:{x,y},provenance:'debug'});observeNpc(state.npc);return true;},
    light:(elapsed)=>{state.elapsed=clamp(elapsed,0,3600*1000);},
  };
}
