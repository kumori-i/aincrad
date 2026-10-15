/** Small observed-data exploration model. No physiology, ecology, or cost-table access. */
const OPERATIONS=['inspect_object','grasp','release','pull','sample','strike'];
const FATIGUE=['fresh','tired','weary','exhausted'];
export const EXERTION_LABELS=['light','moderate','strenuous'];
const MAX_RECORDS=96;
const finite=v=>Number.isFinite(v)&&v>=0;
const objectId=v=>typeof v==='string'&&/^object:\d{1,9}$/.test(v);
const integer=v=>Number.isInteger(v)&&v>=0;
export function createSelectionMemory(){return {version:1,choices:0,phase:0,rng:0,records:[],values:{}};}
function valuesFrom(records){
  const values={};
  for(const r of records){
    for(const key of [r.operation,`${r.operation}|${r.fatigue}`]){
      const v=values[key]||=( {count:0,seconds:0,squaredSeconds:0,exertionCount:0,exertionSum:0});v.count++;v.seconds+=r.durationSeconds;v.squaredSeconds+=r.durationSeconds*r.durationSeconds;
      const rank=EXERTION_LABELS.indexOf(r.exertion);if(rank>=0){v.exertionCount++;v.exertionSum+=rank+1;}
    }
  }
  return values;
}
function cleanRecord(r){
  if(!r||!Number.isInteger(r.actionId)||r.actionId<=0||!OPERATIONS.includes(r.operation)||!objectId(r.targetId)||!finite(r.at)||!finite(r.durationSeconds)||r.durationSeconds<=0||r.durationSeconds>30||!FATIGUE.includes(r.fatigue))return null;
  return {actionId:r.actionId,operation:r.operation,targetId:r.targetId,at:r.at,durationSeconds:r.durationSeconds,fatigue:r.fatigue,...(EXERTION_LABELS.includes(r.exertion)?{exertion:r.exertion}:{})};
}
export function recordSelectionWork(raw,action,result,event){
  const model=raw?.version===1&&Array.isArray(raw.records)?raw:createSelectionMemory();
  const r=cleanRecord({actionId:event.id,operation:action.type,targetId:action.targetId,at:event.at,durationSeconds:result.durationSeconds,fatigue:result.exertionContext,exertion:result.exertion});
  if(r&&!model.records.some(x=>x.actionId===r.actionId)){model.records.push(r);model.records=model.records.slice(-MAX_RECORDS);model.values=valuesFrom(model.records);}
  return model;
}
/** Rebuild all estimates from bounded records matching actual retained actions. */
export function validateSelectionMemory(raw,events=[],elapsed=Infinity){
  const model=createSelectionMemory();if(raw?.version!==1)return model;
  model.choices=integer(raw.choices)?Math.min(1e9,raw.choices):0;
  model.phase=integer(raw.phase)&&raw.phase<8?raw.phase:model.choices%8;
  model.rng=integer(raw.rng)&&raw.rng<=0xffffffff?raw.rng:0;
  const ids=new Set();
  for(const record of (Array.isArray(raw.records)?raw.records:[]).slice(-MAX_RECORDS)){
    const r=cleanRecord(record);if(!r||r.at>elapsed||ids.has(r.actionId))continue;
    const event=events.find(e=>e.id===r.actionId&&e.type==='action'),a=event?.details?.action,b=event?.details?.result;
    if(event?.at!==r.at||a?.type!==r.operation||a?.targetId!==r.targetId||b?.durationSeconds!==r.durationSeconds||b?.exertionContext!==r.fatigue||(EXERTION_LABELS.includes(b?.exertion)?b.exertion:undefined)!==r.exertion)continue;
    model.records.push(r);ids.add(r.actionId);
  }
  model.values=valuesFrom(model.records);return model;
}
/** Shared exact acquisition attribution; no appearance or present-world lookup. */
export function sampleAcquisition(experiments,sample){
  return experiments.filter(e=>e.ok&&e.materialId===sample.targetId&&e.id<sample.id).at(-1)||experiments.filter(e=>e.ok&&e.primitive==='grasp'&&e.targetId===sample.targetId&&e.id<sample.id).at(-1);
}
export function experiencedConsequences(experiments,effects,{foodLearning=true,elapsed=Infinity}={}){
  experiments=experiments.filter(e=>finite(e.at)&&e.at<=elapsed);
  const rows={},credited=new Set();
  const row=(operation,id)=>rows[`${id}|${operation}`]||=( {attempts:0,food:new Set(),water:new Set(),harm:new Set()});
  for(const e of experiments)row(e.primitive,e.targetId).attempts++;
  for(const effect of effects){
    if(!finite(effect.at)||effect.at>elapsed||!['sustained','water relief','discomfort'].includes(effect.effect))continue;
    const sample=experiments.find(e=>e.primitive==='sample'&&e.ok&&e.targetId===effect.objectId&&e.actionId===effect.actionId&&e.ingestionId&&e.ingestionId===effect.ingestionId&&effect.at>=e.at);if(!sample)continue;
    const channel=effect.effect==='discomfort'?'harm':effect.effect==='sustained'?'food':'water';if(channel!=='harm'&&!foodLearning)continue;
    const creditKey=`${sample.ingestionId}|${channel}`;if(credited.has(creditKey))continue;credited.add(creditKey);
    row('sample',sample.targetId)[channel].add(sample.actionId);
    const acquired=sampleAcquisition(experiments,sample);
    // Separate per-action association, capped once per acquisition/channel. This
    // does not add a second global reward or claim that acquisition nourished us.
    if(acquired&&acquired.at<=sample.at)row(acquired.primitive,acquired.targetId)[channel].add(acquired.actionId);
  }
  return Object.fromEntries(Object.entries(rows).map(([key,r])=>[key,{attempts:r.attempts,food:r.food.size,water:r.water.size,harm:r.harm.size}]));
}
function median(xs){if(!xs.length)return 1;const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];}
export function selectionScores(model,candidates,{fatigue='fresh',hunger='content',thirst='quenched',consequences={}}={}){
  const scale=Math.max(1,median(model.records.map(r=>r.durationSeconds))),total=Math.max(0,model.choices);
  return candidates.map(candidate=>{
    const a=candidate.action,context=model.values[`${a.type}|${fatigue}`],v=context?.count>=4?context:model.values[a.type];
    const seconds=v?.count?v.seconds/v.count:scale,effort=v?.exertionCount?v.exertionSum/v.exertionCount:0;
    const evidence=consequences[`${a.targetId}|${a.type}`]||{attempts:0,food:0,water:0,harm:0},n=Math.max(0,evidence.attempts),denominator=Math.max(1,n);
    const benefit=((hunger!=='content'?evidence.food:0)+(thirst!=='quenched'?evidence.water:0)-2*evidence.harm)/denominator;
    const uncertainty=Math.min(1,Math.sqrt(2*Math.log(2+total)/(1+n))),cost=1+seconds/scale+effort/3;
    return {...candidate,score:(benefit+.5*uncertainty)/cost,selection:{count:n,seconds,exertionRank:effort,benefit,uncertainty,cost}};
  });
}
export function chooseSelection(model,candidates,context,random=()=>{model.rng=(Math.imul(model.rng,1664525)+1013904223)>>>0;return model.rng/4294967296;}){
  if(!candidates.length)return null;const groupDraw=random(),tieDraw=random();const scored=selectionScores(model,candidates,context);model.choices=Math.min(1e9,model.choices+1);model.phase=((model.phase??model.choices-1)+1)%8;
  if(model.phase===0){
    const groups=OPERATIONS.map(type=>scored.filter(c=>c.action.type===type)).filter(x=>x.length),group=groups[Math.floor(groupDraw*groups.length)];
    const least=Math.min(...group.map(c=>c.selection.count)),under=group.filter(c=>c.selection.count===least);return under[Math.floor(tieDraw*under.length)];
  }
  const best=Math.max(...scored.map(c=>c.score)),ties=scored.filter(c=>Math.abs(c.score-best)<1e-12);return ties[Math.floor(tieDraw*ties.length)];
}

// Controls belong to the runtime/evaluator, never a save or model-written field.
// Baseline is the shipped default until the experiment establishes a benefit.
const policies=new WeakMap();
const copy=value=>JSON.parse(JSON.stringify(value));
export function configureSelection(npc,mode='baseline',{foodLearning=true}={}){
  mode=['baseline','learned','cold','frozen','shuffled'].includes(mode)?mode:'baseline';
  const entry={mode};
  if(['cold','frozen','shuffled'].includes(mode)){
    entry.model=mode==='cold'?createSelectionMemory():copy(npc.discovery?.selection||createSelectionMemory());
    entry.consequences=mode==='cold'?{}:experiencedConsequences(npc.discovery?.experiments||[],npc.discovery?.effects||[],{foodLearning,elapsed:npc.elapsed});
    if(mode==='shuffled'){
      // A fixed cyclic relabeling is an evaluator control, not fabricated
      // experience. The stored records and actual world are never rewritten.
      const mapping=Object.fromEntries(OPERATIONS.map((op,i)=>[op,OPERATIONS[(i+1)%OPERATIONS.length]]));
      entry.model.values=Object.fromEntries(Object.entries(entry.model.values).map(([key,value])=>{const [op,context]=key.split('|');return [[mapping[op],context].filter(Boolean).join('|'),value];}));
      entry.consequences=Object.fromEntries(Object.entries(entry.consequences).map(([key,value])=>{const [id,op]=key.split('|');return [`${id}|${mapping[op]}`,value];}));
    }
  }
  policies.set(npc,entry);
}
export function selectionUpdates(npc){return policies.get(npc)?.mode==='learned';}
export function selectionPolicy(npc,consequences,{foodLearning=true}={}){
  const entry=policies.get(npc);if(!entry||entry.mode==='baseline')return null;
  if(entry.mode==='learned')return {model:npc.discovery.selection||=(createSelectionMemory()),consequences};
  return {model:entry.model,consequences:foodLearning?entry.consequences:Object.fromEntries(Object.entries(entry.consequences).map(([key,value])=>[key,{...value,food:0,water:0}]))};
}
