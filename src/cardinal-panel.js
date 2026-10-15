import { clockTime } from './world.js';
import { CARDINAL_ACTUATORS } from './cardinal-config.js';
import { WORLD_RULE_LIMITS, getWorldRules } from './world-rules.js';

const $=id=>document.getElementById(id);
const names={plantGrowthMultiplier:'Plant regrowth',fruitYieldMultiplier:'Fruit production',animalForagingRangeMultiplier:'Animal search range',animalReproductionMultiplier:'Animal reproduction',temperatureOffsetC:'Temperature offset',rainfallMultiplier:'Rainfall',windMultiplier:'Wind strength',seasonLengthMultiplier:'Season length'};
const title=value=>String(value||'').replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const num=(value,digits=0)=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits}):'—';
const unit=(parameter,value)=>num(value,2)+(parameter==='temperatureOffsetC'?' °C':'×');
const when=seconds=>{if(!Number.isFinite(seconds))return'Waiting for observation';const time=clockTime(seconds);return`Day ${time.day} · ${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}`;};
function add(parent,tag,text,className=''){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
function entry(parent,heading,body,meta='',severity=''){
  const row=add(parent,'div','','cardinal-entry');if(severity)row.dataset.severity=severity;add(row,'p',heading);if(body)add(row,'p',body,'small');if(meta)add(row,'p',meta,'entry-meta');return row;
}
function fill(id,items,render,empty){const parent=$(id);parent.replaceChildren();if(!items.length)add(parent,'p',empty,'small');for(const item of items)render(parent,item);}
function readableFailure(result){return title(result?.code||result?.reason||'This command is not available right now.');}

/** Owner oversight uses privileged diagnostics; it does not feed inhabitants observations. */
export function createCardinalPanel({getState,getRuntime,save,notify,onVisibilityChange=()=>{}}){
  const panel=$('cardinal-panel');let visible=false,lastRefresh=-1,busy=false;
  const parameterControl=$('cardinal-parameter'),valueControl=$('cardinal-value');
  for(const parameter of Object.keys(CARDINAL_ACTUATORS)){
    const option=document.createElement('option');option.value=parameter;option.textContent=names[parameter]||title(parameter);parameterControl.append(option);
  }
  function chooseParameter(){const parameter=parameterControl.value,rule=WORLD_RULE_LIMITS[parameter],settings=getWorldRules(getState().environment);valueControl.min=rule.min;valueControl.max=rule.max;valueControl.step=CARDINAL_ACTUATORS[parameter].step;valueControl.value=settings[parameter];}
  parameterControl.addEventListener('change',chooseParameter);chooseParameter();
  function open(){if(visible)return;visible=true;panel.classList.remove('hidden');lastRefresh=-1;onVisibilityChange(true);update(performance.now()/1000);$('close-cardinal').focus({preventScroll:true});}
  function close(){if(!visible)return;visible=false;panel.classList.add('hidden');onVisibilityChange(false);$('world').focus({preventScroll:true});}
  function toggle(){if(visible)close();else open();}
  $('open-cardinal').addEventListener('click',toggle);$('close-cardinal').addEventListener('click',close);
  panel.addEventListener('keydown',event=>{
    if(event.code!=='Tab')return;
    const targets=[...panel.querySelectorAll('button,select,input,summary')].filter(node=>!node.disabled&&node.getClientRects().length),index=targets.indexOf(document.activeElement);
    if(!targets.length)return;event.preventDefault();targets[(index+(event.shiftKey?-1:1)+targets.length)%targets.length].focus();
  });
  async function command(action,message){
    if(busy)return;busy=true;
    try{const runtime=getRuntime();if(!runtime)throw new Error('Cardinal is unavailable in this expedition.');const result=await action(runtime);if(result===false||result?.ok===false){$('cardinal-command-status').textContent=readableFailure(result);notify(readableFailure(result));}else{save();$('cardinal-command-status').textContent=message;notify(message);}}
    catch(error){$('cardinal-command-status').textContent=String(error?.message||'The command could not be completed.');}
    finally{busy=false;lastRefresh=-1;update(performance.now()/1000);}
  }
  $('cardinal-mode').addEventListener('change',()=>command(runtime=>runtime.setMode($('cardinal-mode').value),'Cardinal’s oversight mode was updated.'));
  $('cardinal-rollback').addEventListener('click',()=>command(runtime=>runtime.rollbackLast(),'Cardinal reversed the last eligible world adjustment.'));
  $('cardinal-test').addEventListener('click',()=>{
    const parameter=parameterControl.value,value=Number(valueControl.value),rule=WORLD_RULE_LIMITS[parameter];
    if(!Number.isFinite(value)||value<rule.min||value>rule.max){$('cardinal-command-status').textContent=`Choose a value from ${rule.min} to ${rule.max}.`;valueControl.focus();return;}
    command(runtime=>runtime.requestExperiment({parameter,value},{reason:'A world adjustment proposed by the owner.'}),'World adjustment submitted for a copied-world experiment.');
  });
  function overview(metrics){
    const parent=$('cardinal-overview');parent.replaceChildren();
    if(!metrics){add(parent,'p','Cardinal is collecting its first world observation.','small');return;}
    const h=metrics.humans||{},a=metrics.animals||{},r=metrics.resources||{};
    for(const [value,label,detail]of[[`${num(h.healthMean)} / 100`,'Human health',`${num(h.count)} people · ${num(h.rescues)} rescues · ${num(h.learnedTechniques)} grounded techniques`],[num(a.count),'Living animals',Object.entries(a.species||{}).map(([species,count])=>`${num(count)} ${species}`).join(' · ')||'Population is being observed'],[`${num((r.biomassGrams||0)/1000,1)} kg`,'Plant biomass',`${num(r.fruitUnits)} fruit portions · finite world resources`]]){
      const stat=add(parent,'div','','cardinal-stat');add(stat,'b',value);add(stat,'span',label);add(stat,'p',detail);
    }
  }
  function update(now=performance.now()/1000){
    if(!visible||now-lastRefresh<.5)return;lastRefresh=now;
    const state=getState(),c=state.cardinal,runtime=getRuntime(),available=Boolean(c&&runtime),legacy=state.simulationMode!=='discovery';
    $('cardinal-availability').textContent=legacy?'This expedition retains legacy rules. Start a new expedition to enable Cardinal’s ecosystem experiments.':available?'':'Cardinal is waiting for the world runtime.';
    $('cardinal-mode').disabled=!available||legacy||busy;parameterControl.disabled=!available||legacy;valueControl.disabled=!available||legacy;
    if(c&&document.activeElement!==$('cardinal-mode'))$('cardinal-mode').value=c.mode==='auto'?'adaptive':c.mode||'adaptive';
    const pending=c?.pending,latest=c?.observations?.at(-1),lastExperiment=c?.experiments?.at(-1),lastChange=[...(c?.interventions||[])].reverse().find(item=>item.status==='applied');
    const status=c?.status?title(c.status):'Waiting for the world';
    $('cardinal-status').textContent=`${status} · ${when(latest?.at)}`;
    overview(latest);
    $('cardinal-experiment-summary').textContent=pending?'Comparing a proposed adjustment with an unchanged world across paired trials.':'No experiment is running. Cardinal retains the outcomes of completed comparisons.';
    $('cardinal-experiment-progress').value=pending?Math.max(0,Math.min(1,pending.progress||0)):0;
    $('cardinal-experiment-progress').classList.toggle('hidden',!pending);
    $('cardinal-experiment-result').textContent=lastExperiment?`${(lastExperiment.recommendation==='adopt'?'Accepted':lastExperiment.recommendation==='reject'?'Rejected':title(lastExperiment.recommendation||'Completed'))} · ${lastExperiment.reason||'Recorded comparison'}${Number.isFinite(lastExperiment.holdoutGain)?' · unseen-condition gain '+num(lastExperiment.holdoutGain*100,2)+'%':''}`:'A proposal becomes evidence only after its copied-world trials finish.';
    $('cardinal-rollback').disabled=!available||!lastChange||busy||Boolean(pending);
    $('cardinal-test').disabled=!available||legacy||busy||Boolean(pending)||c?.mode==='off';
    fill('cardinal-diagnoses',(c?.diagnoses||[]).slice(-6).reverse(),(parent,item)=>entry(parent,item.summary||title(item.code),typeof item.evidence==='string'?item.evidence:'',`${title(item.severity||'observation')} · ${when(item.at)}`,item.severity),'No concerning trend has been recorded yet.');
    fill('cardinal-proposals',(c?.proposals||[]).slice(-5).reverse(),(parent,item)=>entry(parent,`${names[item.parameter]||title(item.parameter)}: ${unit(item.parameter,item.from)} → ${unit(item.parameter,item.to)}`,item.reason||'',`${title(item.status||'proposed')} · ${when(item.at)}`),'Cardinal will form proposals after it has enough observations.');
    fill('cardinal-interventions',(c?.interventions||[]).slice(-6).reverse(),(parent,item)=>entry(parent,`${names[item.parameter]||title(item.parameter)}: ${unit(item.parameter,item.before)} → ${unit(item.parameter,item.after)}`,item.reason||'',`${item.status==='rolled_back'?'Reversed':title(item.status||'applied')} · ${when(item.at)}`),'No live world changes have been applied.');
    fill('cardinal-learning',(c?.learning||[]).slice(-8).reverse(),(parent,item)=>entry(parent,`${names[item.parameter]||title(item.parameter)} · ${item.direction>0?'increase':item.direction<0?'decrease':title(item.direction)}`,`${num(item.trials)} trials · ${num(item.accepted)} accepted · ${num(item.rejected)} rejected`,Number.isFinite(item.meanGain)?`Mean measured gain ${num(item.meanGain*100,2)}%`:''),'Cardinal has no learned experiment outcomes yet.');
    fill('cardinal-history',(c?.experiments||[]).slice(-6).reverse(),(parent,item)=>entry(parent,item.recommendation==='adopt'?'Accepted adjustment':item.recommendation==='reject'?'Rejected adjustment':title(item.recommendation||'Completed experiment'),item.reason||'',`${when(item.at)} · ${Array.isArray(item.pairs)?item.pairs.length:num(item.pairs)} paired trials`),'No paired-world experiments have completed.');
    const settings=$('cardinal-world-settings');settings.replaceChildren();const dl=add(settings,'dl','','cardinal-settings');
    for(const [parameter,value]of Object.entries(getWorldRules(state.environment))){add(dl,'dt',names[parameter]||title(parameter));add(dl,'dd',unit(parameter,value));}
  }
  return{open,close,toggle,update,get visible(){return visible;}};
}
