import { NPC_RULES } from './config.js';
import { changeNpcPreset, demonstrateCollapse } from './npc.js';
import { DesktopModelProvider, LocalLearnerProvider } from './controller.js';
import { recordEvent } from './npc-memory.js';

const $=id=>document.getElementById(id);
function add(parent,tag,text,className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
export function createNpcPanel({getNpc,getController,renderer,save,notify}){
  const panel=$('npc-panel'),bridge=window.aincradAgent;
  let visible=false,lastRefresh=-1,lastEvidence=-1;
  function close(){visible=false;renderer.inspectorOpen=false;panel.classList.add('hidden');$('world').focus();}
  function toggle(){visible=!visible;renderer.inspectorOpen=visible;panel.classList.toggle('hidden',!visible);if(visible){lastRefresh=-1;update(performance.now()/1000);$('close-npc').focus();}else $('world').focus();}
  $('open-npc').addEventListener('click',toggle);$('close-npc').addEventListener('click',close);
  $('follow-npc').addEventListener('click',()=>{renderer.followNpc=!renderer.followNpc;$('follow-npc').textContent=renderer.followNpc?'Follow your avatar':'Follow Aster';$('world').focus();});
  $('npc-preset').addEventListener('change',()=>{changeNpcPreset(getNpc(),$('npc-preset').value);save();});
  $('npc-rescue-presentation').addEventListener('change',()=>{const n=getNpc();n.rescuePresentation=$('npc-rescue-presentation').value==='quiet'?'quiet':'divine';recordEvent(n,'debug',{setting:'rescue presentation',value:n.rescuePresentation,provenance:'debug'});save();});
  $('npc-learning').addEventListener('change',()=>{const n=getNpc();n.learning=$('npc-learning').checked;n.skillRun=null;getController().cancel();recordEvent(n,'debug',{setting:'persistent learning',value:n.learning,provenance:'debug'});save();});
  $('npc-demonstrate').addEventListener('click',()=>{if(demonstrateCollapse(getNpc())){save();notify('Developer demonstration: dehydration was applied. Rescue will retain Aster’s identity and experience.');}else notify('Aster is already unconscious or recovering.');});
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
    g.fillStyle='#101f24';g.fillRect(0,0,size,size);
    for(const c of Object.values(n.memory.cells)){
      const x=(c.x-n.position.x+half)*scale,y=(c.y-n.position.y+half)*scale;
      if(x<-20||y<-20||x>size||y>size)continue;
      g.fillStyle=c.walkable?'#506e53':c.terrain==='water'||c.terrain==='shallows'?'#436b7a':'#514f46';
      g.globalAlpha=n.elapsed-c.observedAt>60?.45:.9;g.fillRect(x-8,y-8,NPC_RULES.tileSize*scale-1,NPC_RULES.tileSize*scale-1);
    }
    g.globalAlpha=1;
    for(const s of Object.values(n.memory.sources)){
      const x=(s.x-n.position.x+half)*scale,y=(s.y-n.position.y+half)*scale;
      g.fillStyle=s.available?'#83d1e9':'#d3846e';g.beginPath();g.arc(x,y,3,0,Math.PI*2);g.fill();
    }
    g.fillStyle='#fff0c1';g.beginPath();g.arc(size/2,size/2,4,0,Math.PI*2);g.fill();
  }
  function update(now){
    const n=getNpc();$('npc-short').textContent=`Aster · ${n.lifecycle.toLowerCase()} · ${Math.round(n.hydration)}% water`;
    if(!visible||now-lastRefresh<.5)return;lastRefresh=now;
    $('npc-lifecycle').textContent=n.lifecycle;$('npc-hydration').value=n.hydration;$('npc-hydration-value').textContent=`${n.hydration.toFixed(1)} / 100`;
    $('npc-flask').textContent=`${Math.round(n.flask.water*100)}% · ${n.flask.provenance||'empty'}`;
    $('npc-current').textContent=n.skillRun?`Procedure: ${n.skillRun.id} (${n.skillRun.cursor+1})`:n.active?`Action: ${n.active.request.type}`:getController().pending?'Waiting for local inference':'Choosing an experiment';
    $('npc-controller').textContent=getController().provider.label;
    $('npc-decision').textContent=n.decision;
    $('npc-counts').textContent=`${n.stats.independentDrinks} independent drinks · ${n.stats.collapses} collapses · ${n.stats.rescues} rescues`;
    $('npc-rescuer').textContent=`Last rescuer: ${n.stats.lastRescuer||'none'}. Rescue is not independent success.`;
    $('npc-preset').value=n.preset;$('npc-rescue-presentation').value=n.rescuePresentation;$('npc-learning').checked=n.learning;
    const sources=$('npc-sources');sources.replaceChildren();
    const known=Object.values(n.memory.sources).sort((a,b)=>b.observedAt-a.observedAt).slice(0,8);
    if(!known.length)add(sources,'li','No water sources observed yet.');
    for(const source of known)add(sources,'li',`${source.id} · ${source.available?'observed available':'unavailable'} · ${Math.floor(n.elapsed-source.observedAt)}s old`);
    drawMap(n);
    if(lastEvidence===n.memory.nextId)return;lastEvidence=n.memory.nextId;
    const skills=$('npc-skills');skills.replaceChildren();
    if(!n.memory.skills.length)add(skills,'p','No acquired procedures. Aster begins with an empty library.','small');
    for(const skill of n.memory.skills){
      const details=document.createElement('details');skills.append(details);
      add(details,'summary',`${skill.name} · ${skill.status} (${skill.successes} successes / ${skill.failures} failures)`);
      add(details,'p',skill.steps.map(step=>`${step.type}${step.sourceId?'(sourceId)':''}`).join(' → '),'small');
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
    const lesson=n.memory.lessons.at(-1);$('npc-lesson').textContent=lesson?`${lesson.verified} ${lesson.hypothesis}`:'No collapse lesson yet. Facts and hypotheses are kept separate.';
  }
  return {toggle,close,update};
}
