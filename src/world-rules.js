/** Cardinal's bounded, data-only world actuators. These never alter a human mind or body. */
export const WORLD_RULE_LIMITS = Object.freeze({
  plantGrowthMultiplier: Object.freeze({default:1,min:.25,max:3}),
  fruitYieldMultiplier: Object.freeze({default:1,min:.25,max:3}),
  animalForagingRangeMultiplier: Object.freeze({default:1,min:.5,max:2}),
  animalReproductionMultiplier: Object.freeze({default:1,min:0,max:2}),
  temperatureOffsetC: Object.freeze({default:0,min:-6,max:6}),
  rainfallMultiplier: Object.freeze({default:1,min:0,max:2.5}),
  windMultiplier: Object.freeze({default:1,min:.25,max:2}),
  seasonLengthMultiplier: Object.freeze({default:1,min:.5,max:2}),
});
const own = (object,key) => Object.prototype.hasOwnProperty.call(object||{},key);
export function createWorldRules(){return{version:1,revision:0,values:Object.fromEntries(Object.entries(WORLD_RULE_LIMITS).map(([key,rule])=>[key,rule.default]))};}
/** Unknown fields are discarded; an unsupported version must be protected by save restoration. */
export function validateWorldRules(raw){
  const out=createWorldRules();if(raw?.version!==1)return out;
  out.revision=Number.isSafeInteger(raw.revision)&&raw.revision>=0?Math.min(1e9,raw.revision):0;
  for(const [key,rule]of Object.entries(WORLD_RULE_LIMITS))if(Number.isFinite(raw.values?.[key]))out.values[key]=Math.max(rule.min,Math.min(rule.max,raw.values[key]));
  return out;
}
export function getWorldRule(environment,key){
  const rule=own(WORLD_RULE_LIMITS,key)?WORLD_RULE_LIMITS[key]:null;if(!rule)return undefined;
  const value=environment?.worldRules?.version===1?environment.worldRules.values?.[key]:undefined;
  return Number.isFinite(value)?Math.max(rule.min,Math.min(rule.max,value)):rule.default;
}
export function getWorldRules(environment){return Object.freeze(Object.fromEntries(Object.keys(WORLD_RULE_LIMITS).map(key=>[key,getWorldRule(environment,key)])));}
/** A patch is committed atomically, with optimistic revision checking for copied-world experiments. */
export function applyWorldRules(environment,patch,{expectedRevision}={}){
  const current=validateWorldRules(environment?.worldRules),before={...current.values};
  const reject=code=>({ok:false,code,before,after:{...before},changes:[],revision:current.revision});
  if(!environment||typeof environment!=='object'||Array.isArray(environment))return reject('INVALID_ENVIRONMENT');
  if(environment.worldRules&&environment.worldRules.version!==1)return reject('UNSUPPORTED_WORLD_RULES');
  if(expectedRevision!==undefined&&expectedRevision!==current.revision)return reject('WORLD_RULE_REVISION_CHANGED');
  if(!patch||typeof patch!=='object'||Array.isArray(patch))return reject('INVALID_WORLD_RULE_PATCH');
  let entries;
  if(own(patch,'parameter')||own(patch,'value')){
    if(Object.keys(patch).some(k=>!['parameter','value'].includes(k))||typeof patch.parameter!=='string'||!own(patch,'value'))return reject('INVALID_WORLD_RULE_PATCH');
    entries=[[patch.parameter,patch.value]];
  }else entries=Object.entries(patch);
  if(!entries.length)return reject('EMPTY_WORLD_RULE_PATCH');
  for(const [key,value]of entries){
    const rule=own(WORLD_RULE_LIMITS,key)?WORLD_RULE_LIMITS[key]:null;
    if(!rule||!Number.isFinite(value)||value<rule.min||value>rule.max)return reject('INVALID_WORLD_RULE_VALUE');
  }
  const changes=entries.filter(([key,value])=>before[key]!==value).map(([parameter,to])=>({parameter,from:before[parameter],to}));
  if(!changes.length)return{ok:true,code:'WORLD_RULES_UNCHANGED',before,after:{...before},changes,revision:current.revision};
  if(current.revision>=1e9)return reject('WORLD_RULE_REVISION_LIMIT');
  environment.worldRules={version:1,revision:current.revision+1,values:{...before,...Object.fromEntries(entries)}};
  return{ok:true,code:'WORLD_RULES_APPLIED',before,after:{...environment.worldRules.values},changes,revision:environment.worldRules.revision};
}
