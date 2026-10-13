const DEFAULTS=Object.freeze({enabled:false,endpoint:'http://127.0.0.1:11434/v1',model:'',timeoutMs:8000,maxCallsPerHour:60,maxTokens:450});
function validateConfig(raw={}){
  const u=new URL(raw.endpoint??DEFAULTS.endpoint);
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!/^\/v1\/?$/.test(u.pathname)||Number(u.port)<1024||Number(u.port)>65535)throw new Error('Use a loopback OpenAI-compatible endpoint, such as http://127.0.0.1:11434/v1.');
  const model=typeof raw.model==='string'?raw.model.trim().slice(0,120):'';
  if(raw.enabled===true&&!model)throw new Error('Choose the name of a model already installed on your local server.');
  const bounded=(v,d,min,max)=>Number.isInteger(v)?Math.max(min,Math.min(max,v)):d;
  return {enabled:raw.enabled===true,endpoint:u.toString().replace(/\/$/,''),model,timeoutMs:bounded(raw.timeoutMs,8000,1000,30000),maxCallsPerHour:bounded(raw.maxCallsPerHour,60,1,60),maxTokens:bounded(raw.maxTokens,450,64,1200)};
}
function validateObservation(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Buffer.byteLength(JSON.stringify(raw))>65536)throw new Error('Observation is missing or exceeds its size limit.');
  const c=raw.condition;
  if(!c||c.lifecycle!=='AWAKE'||!Number.isFinite(c.hydration)||c.hydration<0||c.hydration>100||!c.position||!Number.isFinite(c.position.x)||!Number.isFinite(c.position.y)||Math.abs(c.position.x)>24000||Math.abs(c.position.y)>24000)throw new Error('Invalid NPC condition.');
  for(const key of ['nourishment','health'])if(c[key]!==undefined&&(!Number.isFinite(c[key])||c[key]<0||c[key]>100))throw new Error('Invalid NPC '+key+'.');
  const arrays={};
  for(const [name,limit] of [['knownSources',12],['knownFoods',12],['knownShelters',12],['knownTiles',140],['recentExperience',10],['lessons',3],['skills',12],['procedureCandidates',12]]){
    const value=raw[name]??(['knownFoods','knownShelters','procedureCandidates'].includes(name)?[]:undefined);
    if(!Array.isArray(value)||value.length>limit)throw new Error('Invalid '+name+'.');arrays[name]=value;
  }
  const result=Object.fromEntries(['identity','objective','condition','observedAt','environment','feelings','physiologicalPriorities','knownExit','procedureUse','actionStatus','actions'].filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  return {...result,...arrays};
}
const ACTIONS=new Set(['observe','move','inspect','fill_flask','drink','gather_food','eat','enter_shelter','exit_shelter','wait']);
function references(value){
  const result={};
  for(const key of ['sourceId','foodId','shelterId'])if(value[key]!==undefined){
    if(typeof value[key]!=='string'||!value[key].length||value[key].length>70)throw new Error('Invalid action reference.');result[key]=value[key];
  }
  if(Object.keys(result).length>1)throw new Error('Choose one action target.');return result;
}
function parseDecision(content){
  if(typeof content!=='string'||content.length>16000)throw new Error('The model response is empty or too large.');
  const value=JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The model response must be a JSON object.');
  const reason=typeof value.reason==='string'?value.reason.slice(0,600):'Local model selected a bounded experiment.';
  if(value.skillId!==undefined){
    if(typeof value.skillId!=='string'||!value.skillId.length||value.skillId.length>80)throw new Error('Invalid procedure reference.');
    return {skillId:value.skillId,...references(value),reason};
  }
  if(!value.action||!ACTIONS.has(value.action.type))throw new Error('The model requested an unsupported action.');
  const a=value.action,action={type:a.type,...references(a)};
  if(a.target!==undefined){
    if(Object.keys(action).length>1||!Number.isFinite(a.target?.x)||!Number.isFinite(a.target?.y)||Math.abs(a.target.x)>=24000||Math.abs(a.target.y)>=24000)throw new Error('Invalid movement target.');
    action.target={x:a.target.x,y:a.target.y};
  }
  if(a.seconds!==undefined){if(!Number.isFinite(a.seconds)||a.seconds<.25||a.seconds>5)throw new Error('Invalid wait duration.');action.seconds=a.seconds;}
  if(a.duration!==undefined){if(!Number.isFinite(a.duration)||a.duration<=0||a.duration>12)throw new Error('Invalid action duration.');action.duration=a.duration;}
  return {action,reason};
}
async function boundedResponseText(response){
  if(!response.body?.getReader){const text=await response.text();if(text.length>131072)throw new Error('Local model response exceeds the size limit.');return text;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>131072){await reader.cancel();throw new Error('Local model response exceeds the size limit.');}text+=decoder.decode(value,{stream:true});}
  return text+decoder.decode();
}
class ModelService {
  constructor({config=DEFAULTS,fetchImpl=fetch,now=()=>Date.now()}={}){this.config=validateConfig(config);this.fetch=fetchImpl;this.now=now;this.pending=null;this.windowAt=this.now();this.calls=0;}
  configure(config){this.cancel();this.config=validateConfig(config);return this.status();}
  status(){return {...this.config,pending:Boolean(this.pending),callsThisHour:this.calls};}
  cancel(){this.pending?.abort();this.pending=null;return {cancelled:true};}
  async decide(raw){
    if(!this.config.enabled)throw new Error('No local model is configured.');
    const observation=validateObservation(raw);
    if(this.pending)throw new Error('A model decision is already in flight.');
    if(this.now()-this.windowAt>=3600000){this.windowAt=this.now();this.calls=0;}
    if(this.calls>=this.config.maxCallsPerHour)throw new Error('The local model call budget is exhausted for this hour.');
    const controller=new AbortController();this.pending=controller;this.calls++;
    const timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try{
      const response=await this.fetch(this.config.endpoint+'/chat/completions',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.config.model,temperature:.25,max_tokens:this.config.maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:'You control Aster, one embodied NPC in Aincrad. Sustain nourishment, hydration and health while managing actual heat/cold discomfort. Compare competing needs and observed travel costs; choose useful actions before conditions become critical. Use only the supplied local observations, body feelings, retrieved experience and acquired procedures. Food, water and shelter routines compete; none has unconditional priority. Do not invent resource locations, current availability, future weather or successful outcomes. The engine validates and executes all actions. Rescue is not an independent success. Propose one bounded experiment as {"action":{"type":"observe|move|inspect|fill_flask|drink|gather_food|eat|enter_shelter|exit_shelter|wait",...},"reason":"compact evidence-based reasoning"}, or select a supplied procedure as {"skillId":"known id","sourceId":"known water id","reason":"..."}. For food procedures use foodId instead of sourceId; for shelter procedures use shelterId. Choose exactly one matching reference. Return JSON only. You have no operating-system, filesystem, code-execution or rescue tool.'},{role:'user',content:JSON.stringify(observation)}]})});
      if(!response.ok)throw new Error(`Local model returned HTTP ${response.status}.`);
      if(Number(response.headers?.get?.('content-length')||0)>131072)throw new Error('Local model response exceeds the size limit.');
      const text=await boundedResponseText(response);
      const data=JSON.parse(text);return parseDecision(data.choices?.[0]?.message?.content);
    }catch(error){if(controller.signal.aborted)throw new Error('Local model request cancelled or timed out.');throw error;}
    finally{clearTimeout(timer);if(this.pending===controller)this.pending=null;}
  }
}
module.exports={DEFAULTS,validateConfig,validateObservation,parseDecision,ModelService};
