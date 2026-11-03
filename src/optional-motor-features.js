import { DISCOVERY_RULES } from './discovery-config.js';
import { optionalMotorProbability } from './optional-motor-core.js';

// A numeric view of an already admitted optional body operation. The target ID
// only locates this actor's own observation/trial; it is never a model feature.
export const OPTIONAL_MOTOR_TYPES=Object.freeze([
  'inspect_object','grasp','release','pull','sample','strike','catch',
]);
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const unit=v=>Math.max(0,Math.min(1,v));

export function optionalMotorFeatures(actor,choice){
  const action=choice?.action,kind=OPTIONAL_MOTOR_TYPES.indexOf(action?.type);
  if(kind<0||typeof action?.targetId!=='string'||!/^object:\d{1,9}$/.test(action.targetId)||
    !finitePoint(actor?.position)||
    !Number.isFinite(actor?.elapsed))return null;
  const observed=actor.discovery?.observations?.[action.targetId];
  const held=actor.inventory?.items?.includes(action.targetId)===true;
  const age=actor.elapsed-observed?.observedAt;
  if(!finitePoint(observed?.position)||!Number.isFinite(age)||age<0||age>=8||
    observed.scene!==actor.scene&&!held)return null;
  const trial=actor.discovery?.trials?.[`${action.targetId}|${action.type}`];
  const attempts=trial?.attempts??0,failures=trial?.failures??0;
  if(!Number.isFinite(attempts)||!Number.isFinite(failures)||attempts<0||failures<0||
    failures>attempts)return null;
  const distance=held?0:Math.hypot(actor.position.x-observed.position.x,
    actor.position.y-observed.position.y);
  const features=new Float64Array(12);
  features[kind]=1;
  features[7]=unit(distance/DISCOVERY_RULES.reach);
  features[8]=unit(age/8);
  features[9]=unit(Math.log1p(attempts)/Math.log(17));
  features[10]=attempts?unit(failures/attempts):0;
  features[11]=held?1:0;
  return features;
}

// Prototype only. The caller must supply the exact admitted optional list;
// this never validates an action or creates a physical permission. No normal
// runtime calls it. A cold or oversized list falls back to the authored rule.
export function rankOptionalMotorChoices(actor,choices,model,examples){
  if(!Array.isArray(choices)||!choices.length||choices.length>64||
    !Number.isInteger(examples)||examples<4)return null;
  try{
    let index=null,best=-Infinity;
    for(let i=0;i<choices.length;i++){
      const features=optionalMotorFeatures(actor,choices[i]);
      if(!features)continue;
      const probability=optionalMotorProbability(model,features);
      if(probability>best){index=i;best=probability;}
    }
    return index;
  }catch{return null;}
}
