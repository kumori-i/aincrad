import { NPC_RULES, NPC_PRESETS } from './config.js';
import { changeNpcPreset, demonstrateCollapse } from './npc.js';
import { DesktopModelProvider, LocalLearnerProvider } from './controller.js';
import { recordEvent } from './npc-memory.js';
import { rememberedCells } from './perception.js';
import { environmentConditions, WEATHER_KINDS } from './environment.js';

const $=id=>document.getElementById(id);
function add(parent,tag,text,className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
export function createNpcPanel({getNpc,getController,renderer,getEnvironment,save,notify}){
  const panel=$('npc-panel'),bridge=window.aincradAgent;
  let visible=false,lastRefresh=-1,lastEvidence=-1;
  function close(){visible=false;renderer.inspectorOpen=false;$('app').dataset.inspecting='false';panel.classList.add('hidden');$('world').focus();}
  function toggle(){visible=!visible;renderer.inspectorOpen=visible;$('app').dataset.inspecting=String(visible);panel.classList.toggle('hidden',!visible);if(visible){lastRefresh=-1;update(performance.now()/1000);$('close-npc').focus();}else $('world').focus();}
  $('open-npc').addEventListener('click',toggle);$('npc-short').addEventListener('click',toggle);$('close-npc').addEventListener('click',close);
  function follow(enabled){renderer.followNpc=enabled;$('follow-npc').textContent=enabled?'Follow your avatar':'Follow Aster';if(enabled)renderer.snap(getNpc().position);$('world').focus();}
  $('follow-npc').addEventListener('click',()=>follow(!renderer.followNpc));
  $('npc-preset').addEventListener('change',()=>{changeNpcPreset(getNpc(),$('npc-preset').value);save();});
  $('npc-rescue-presentation').addEventListener('change',()=>{const n=getNpc();n.rescuePresentation=$('npc-rescue-presentation').value==='quiet'?'quiet':'divine';recordEvent(n,'debug',{setting:'rescue presentation',value:n.rescuePresentation,provenance:'debug'});save();});
  $('npc-learning').addEventListener('change',()=>{const n=getNpc();n.learning=$('npc-learning').checked;n.skillRun=null;getController().cancel();recordEvent(n,'debug',{setting:'persistent learning',value:n.learning,provenance:'debug'});save();});
  $('npc-demonstrate').addEventListener('click',()=>{if(demonstrateCollapse(getNpc())){save();notify('Developer demonstration: collapse was applied. Rescue will retain Aster’s identity and experience.');}else notify('Aster is already unconscious or recovering.');});
  function configureWorld(){
    const env=getEnvironment(),hour=$('world-hour').value,weather=$('world-weather-control').value;
    env.settings.hourOverride=hour==='auto'?null:Number(hour);
    env.settings.weatherOverride=WEATHER_KINDS.includes(weather)?weather:null;
    getController().cancel();
    recordEvent(getNpc(),'debug',{setting:'world conditions',value:{...env.settings},provenance:'debug'});save();
    notify('Test conditions changed. Body effects still advance only while the world is running.');
  }
  $('world-hour').addEventListener('change',configureWorld);$('world-weather-control').addEventListener('change',configureWorld);
  async function configure(enabled){
    try{
      if(!bridge)throw new Error('Local model planning is available in the desktop application.');
      getController().cancel();
      const config=await bridge.configure({enabled,endpoint:enabled?$('npc-endpoint').value:'http://127.0.0.1:11434/v1',model:enabled?$('npc-model').value:''});
      getController().setProvider(enabled?new DesktopModelProvider(bridge,config.model):new LocalLearnerProvider());
      $('model-status').textContent=enabled?'Configured. The next decision will contact your local model.':'Offline experiential learner active.';save();
    }catch(error){$('model-status').textContent=error.message;}
  }
  $('connect-model').addEventListener('click',()=>configure(true));$('offline-controller').addEventListener('click',()=>configure(false));
  if(bridge){bridge.status().then(status=>{
    $('npc-endpoint').value=status.endpoint;$('npc-model').value=status.model;
    if(status.enabled)getController().setProvider(new DesktopModelProvider(bridge,status.model));
  }).catch(error=>{$('model-status').textContent=error.message;});}
  else{$('connect-model').disabled=true;$('offline-controller').disabled=true;$('model-status').textContent='Offline experiential learner. Local model settings are available in the desktop app.';}
  function drawMap(n){
    const canvas=$('npc-map'),g=canvas.getContext('2d'),size=canvas.width,half=720,scale=size/(half*2);
    g.fillStyle='#24372d';g.fillRect(0,0,size,size);
    for(const c of Object.values(rememberedCells(n))){
      const x=(c.x-n.position.x+half)*scale,y=(c.y-n.position.y+half)*scale;
      if(x<-20||y<-20||x>size||y>size)continue;
      g.fillStyle=c.walkable?'#7c9b4a':c.terrain==='water'||c.terrain==='shallows'?'#4799aa':'#805932';
      g.globalAlpha=n.elapsed-c.observedAt>60?.45:.9;g.fillRect(x-8,y-8,NPC_RULES.tileSize*scale-1,NPC_RULES.tileSize*scale-1);
    }
    g.globalAlpha=1;
    const points=n.scene==='valley'?[...Object.values(n.memory.sources).map(s=>({...s,color:s.available?'#83d1e9':'#d3846e'})),...Object.values(n.memory.foods).map(s=>({...s,color:s.available?'#df7750':'#886d4c'})),...Object.values(n.memory.shelters).map(s=>({...s,color:'#e6bc58'}))]:[];
    for(const s of points){
      const x=(s.x-n.position.x+half)*scale,y=(s.y-n.position.y+half)*scale;
      if(x<0||y<0||x>size||y>size)continue;g.fillStyle=s.color;g.fillRect(Math.round(x)-2,Math.round(y)-2,5,5);
    }
    g.fillStyle='#fff0c1';g.beginPath();g.arc(size/2,size/2,4,0,Math.PI*2);g.fill();
  }
  function update(now){
    if(now-lastRefresh<.5)return;lastRefresh=now;
    const n=getNpc(),pace=NPC_PRESETS[n.preset]||NPC_PRESETS.normal,env=getEnvironment();
    const strain=Math.max(n.thermal.hot,n.thermal.cold);
    const condition=n.lifecycle==='COLLAPSED'?'collapsed':n.lifecycle==='RECOVERING'?'recovering':n.hydration<=NPC_RULES.criticalHydration||n.nourishment<=NPC_RULES.criticalNourishment||strain>=NPC_RULES.criticalThermal||n.health<=25?'critical':n.hydration<=NPC_RULES.thirstWarning||n.nourishment<=NPC_RULES.hungerWarning||strain>=NPC_RULES.thermalWarning?'thirsty':'healthy';
    const duration=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
    const foodSeconds=n.nourishment/pace.nourishmentDepletionPerSecond,waterSeconds=n.hydration/pace.depletionPerSecond;
    const remaining=n.lifecycle==='COLLAPSED'?Math.max(0,Math.ceil(pace.rescueDelay-(n.elapsed-n.lifecycleAt))):Math.max(0,Math.ceil(pace.recoverySeconds-(n.elapsed-n.lifecycleAt)));
    const survival=n.lifecycle==='AWAKE'?`Base reserves: food ${duration(foodSeconds)} · water ${duration(waterSeconds)}`:n.lifecycle==='COLLAPSED'?`Rescue in ${remaining}s · memory retained`:`Recovering · ${remaining}s · memory retained`;
    $('npc-short').dataset.condition=condition;$('npc-condition').dataset.condition=condition;
    const stateLabel=n.lifecycle==='AWAKE'?(condition==='critical'?'distressed':condition==='thirsty'?'uncomfortable':'awake'):n.lifecycle.toLowerCase();
    $('npc-short').textContent=`Aster · ${stateLabel}\nFood ${Math.round(n.nourishment)}% · water ${Math.round(n.hydration)}% · health ${Math.round(n.health)}%`;
    $('npc-survival').textContent=survival+' · unpaused time; heat increases water use';
    if(!visible)return;
    $('npc-lifecycle').textContent=n.lifecycle;$('npc-hydration').value=n.hydration;$('npc-hydration-value').textContent=`${n.hydration.toFixed(0)} / 100`;
    $('npc-nourishment').value=n.nourishment;$('npc-nourishment-value').textContent=`${n.nourishment.toFixed(0)} / 100`;
    $('npc-health').value=n.health;$('npc-health-value').textContent=`${n.health.toFixed(0)} / 100`;
    $('npc-heat').textContent=`${Math.round(n.thermal.hot)} / 100`;$('npc-cold').textContent=`${Math.round(n.thermal.cold)} / 100`;
    $('npc-flask').textContent=`${Math.round(n.flask.water*100)}% · ${n.flask.provenance||'empty'}`;
    $('npc-apples').textContent=`${n.inventory.apples.length} / ${n.inventory.capacity}`;
    const f=n.feelings,pct=value=>Math.round(Math.max(0,Math.min(1,value||0))*100);
    const descriptions=[['hungry',f.hunger],['thirsty',f.thirst],['hot',f.heat],['cold',f.cold]].filter(([,v])=>v>=.25).sort((a,b)=>b[1]-a[1]);
    const feeling=f.distress>=.4?'Distressed':f.relief>=.2?'Relieved':descriptions.length?'Uncomfortable':'Comfortable';
    $('npc-feelings').textContent=`${feeling}${descriptions.length?' · '+descriptions.map(([name,v])=>`${name} ${pct(v)}%`).join(' · '):''}. Distress ${pct(f.distress)}% · relief ${pct(f.relief)}%.`;
    const sensed=environmentConditions(env,n);
    $('npc-environment').textContent=`${n.scene==='valley'?'Outside':n.scene} · ${sensed.sheltered?'sheltered':sensed.weather} · feels ${sensed.feltTemperature.toFixed(1)}°C · wet ${Math.round(n.thermal.wetness)}%${sensed.shade?' · shaded':''}`;
    $('npc-current').textContent=n.skillRun?`Procedure: ${n.skillRun.id} (${n.skillRun.cursor+1})`:n.active?`Action: ${n.active.request.type}`:getController().pending?'Waiting for local inference':'Choosing an experiment';
    $('npc-controller').textContent=getController().provider.label;
    $('npc-decision').textContent=n.decision;
    $('npc-counts').textContent=`${n.stats.independentMeals} meals · ${n.stats.independentDrinks} independent drinks · ${n.stats.collapses} collapses · ${n.stats.rescues} rescues. Critical time: ${Math.round(n.stats.criticalSeconds)}s.`;
    $('npc-rescuer').textContent=`Last rescuer: ${n.stats.lastRescuer||'none'}. Rescue is not independent success.`;
    $('world-hour').value=env.settings.hourOverride===null?'auto':String(env.settings.hourOverride);$('world-weather-control').value=env.settings.weatherOverride||'auto';
    $('npc-preset').value=n.preset;$('npc-rescue-presentation').value=n.rescuePresentation;$('npc-learning').checked=n.learning;
    const sources=$('npc-sources');sources.replaceChildren();
    const known=Object.values(n.memory.sources).sort((a,b)=>b.observedAt-a.observedAt).slice(0,8);
    if(!known.length)add(sources,'li','No water sources observed yet.');
    for(const source of known)add(sources,'li',`${source.id} · ${source.available?'observed available':'unavailable'} · ${Math.floor(n.elapsed-source.observedAt)}s old`);
    const foods=$('npc-foods');foods.replaceChildren();const knownFoods=Object.values(n.memory.foods).sort((a,b)=>b.observedAt-a.observedAt).slice(0,8);
    if(!knownFoods.length)add(foods,'li','No food patches discovered yet.');
    for(const food of knownFoods)add(foods,'li',`${food.name||food.id} · last seen ${food.stock??'?'} apples · ${Math.floor(n.elapsed-food.observedAt)}s old`);
    const shelters=$('npc-shelters');shelters.replaceChildren();const knownShelters=Object.values(n.memory.shelters).slice(0,6);
    if(!knownShelters.length)add(shelters,'li','No shelter entrances discovered yet.');
    for(const shelter of knownShelters)add(shelters,'li',`${shelter.name||shelter.id} · ${shelter.experiencedTemperature!==undefined?`experienced ${Number(shelter.experiencedTemperature).toFixed(0)}°C`:'interior not experienced'}`);
    drawMap(n);
    if(lastEvidence===n.memory.nextId)return;lastEvidence=n.memory.nextId;
    const skills=$('npc-skills');skills.replaceChildren();
    if(!n.memory.skills.length)add(skills,'p','No acquired procedures. Aster begins with an empty library.','small');
    for(const skill of n.memory.skills){
      const details=document.createElement('details');skills.append(details);
      add(details,'summary',`${skill.name} · ${skill.status} (${skill.successes} successes / ${skill.failures} failures)`);
      add(details,'p',skill.steps.map(step=>`${step.type}${step.sourceId?'(sourceId)':step.foodId?'(foodId)':step.shelterId?'(shelterId)':''}`).join(' → '),'small');
      add(details,'p','Evidence: '+skill.supportingExperience.join(', '),'small');
      for(const id of skill.supportingExperience.slice(-3)){const event=n.memory.experience.find(e=>e.id===id);if(event)add(details,'pre',JSON.stringify(event,null,2));}
      add(details,'p',skill.status==='validated'?'Repeated success under changed starting conditions; reliability is limited to tested conditions.':'One successful sequence creates a candidate, not a universally reliable routine.','small');
    }
    const history=$('npc-history');history.replaceChildren();
    for(const event of n.memory.experience.slice(-14).reverse()){
      const details=document.createElement('details');history.append(details);
      const d=event.details;add(details,'summary',`#${event.id} · ${Math.floor(event.at)}s · ${event.type} · ${d.result?.code||d.code||d.provenance||d.skillId||''}`);
      add(details,'pre',JSON.stringify(d,null,2));
    }
    const lesson=n.memory.lessons.at(-1);$('npc-lesson').textContent=lesson?`${lesson.verified} ${lesson.hypothesis}`:'Learning uses actual body costs and action outcomes before collapse. Facts and hypotheses stay separate.';
  }
  return {toggle,close,update,follow};
}
