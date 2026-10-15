import { BIOLOGY_RULES as R, BIOLOGY_PROFILES, gameHours } from './biology-config.js';

const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const number=(n,fallback)=>Number.isFinite(n)?n:fallback;
const text=(value,max=80)=>typeof value==='string'?value.slice(0,max):null;
const actionId=value=>Number.isInteger(value)&&value>0?value:text(value);
const profileOf=value=>BIOLOGY_PROFILES[value]||BIOLOGY_PROFILES.human;
const sleepStates=['awake','onset','sleeping'];
const feedbackEffects=['sustained','water relief','discomfort','no noticeable change'];

/** Private stores own all exact values. Actor fields are compatibility projections. */
export function createPhysiology(profile='human',overrides={}){
  profile=Object.hasOwn(BIOLOGY_PROFILES,profile)?profile:'human';const p=profileOf(profile);
  const physiology={version:R.version,profile,clockHours:0,nextId:1,
    availableEnergyKcal:p.initialAvailableKcal,storedEnergyKcal:p.initialStoredKcal,
    waterDeficitMl:p.initialWaterDeficitMl,health:100,condition:100,stamina:100,fatigue:5,sleepPressure:10,
    hoursSinceMeal:p.initialHoursSinceMeal,awakeHours:0,starvationHours:0,circadianAlertness:0,
    sleep:{state:'awake',hours:0,remainingHours:0,depth:0,inertiaHours:0,wakeReason:null},
    stomach:[],feedback:[],outsideAssistance:{energyKcal:0,waterMl:0,count:0},
    totals:{ingestedKcal:0,ingestedWaterMl:0,absorbedKcal:0,absorbedWaterMl:0,metabolizedKcal:0,waterLostMl:0,discardedKcal:0,discardedWaterMl:0},
  };
  for(const key of ['availableEnergyKcal','storedEnergyKcal','waterDeficitMl','health','condition','stamina','fatigue','sleepPressure','hoursSinceMeal','awakeHours','starvationHours'])if(Number.isFinite(overrides[key]))physiology[key]=overrides[key];
  return validatePhysiology(physiology,{profile});
}

export function validatePhysiology(raw,{profile=raw?.profile||'human',elapsed=0}={}){
  profile=Object.hasOwn(BIOLOGY_PROFILES,profile)?profile:'human';const p=profileOf(profile);
  const f={version:R.version,profile,clockHours:clamp(number(raw?.clockHours,gameHours(elapsed)),0,24*100000),nextId:clamp(Math.floor(number(raw?.nextId,1)),1,1e9)};
  const ranges={availableEnergyKcal:[0,p.availableCapacityKcal,p.initialAvailableKcal],storedEnergyKcal:[0,p.storedCapacityKcal,p.initialStoredKcal],waterDeficitMl:[0,p.bodyWaterMl,p.initialWaterDeficitMl],health:[0,100,100],condition:[0,100,100],stamina:[0,100,100],fatigue:[0,100,5],sleepPressure:[0,100,10],hoursSinceMeal:[0,24*100000,p.initialHoursSinceMeal],awakeHours:[0,24*100000,0],starvationHours:[0,24*100000,0],circadianAlertness:[-1,1,0]};
  for(const [key,[min,max,fallback]]of Object.entries(ranges))f[key]=clamp(number(raw?.[key],fallback),min,max);
  f.sleep={state:sleepStates.includes(raw?.sleep?.state)?raw.sleep.state:'awake',hours:clamp(number(raw?.sleep?.hours,0),0,R.maximumSleepHours),remainingHours:clamp(number(raw?.sleep?.remainingHours,0),0,R.maximumSleepHours),depth:clamp(number(raw?.sleep?.depth,0),0,1),inertiaHours:clamp(number(raw?.sleep?.inertiaHours,0),0,2),wakeReason:text(raw?.sleep?.wakeReason)};
  let mass=0;f.stomach=[];
  for(const v of Array.isArray(raw?.stomach)?raw.stomach.slice(0,R.maxDigestiveInputs):[]){
    if(!v||!Number.isFinite(v.remainingMassGrams)||v.remainingMassGrams<0)continue;
    const savedOriginalMass=Math.max(0,number(v.originalMassGrams,v.remainingMassGrams));if(savedOriginalMass<=0)continue;
    let portion=Math.min(1,p.stomachCapacityGrams/savedOriginalMass),remainingMassGrams=Math.min(v.remainingMassGrams,savedOriginalMass)*portion;
    if(remainingMassGrams<=0)continue;
    portion*=Math.min(1,(p.stomachCapacityGrams-mass)/remainingMassGrams);remainingMassGrams=Math.min(v.remainingMassGrams,savedOriginalMass)*portion;if(remainingMassGrams<=0)continue;
    const savedOriginalKcal=clamp(number(v.originalKcal,v.remainingKcal||0),0,50000),savedOriginalWater=clamp(number(v.originalWaterMl,v.remainingWaterMl||0),0,20000);
    const savedRemainingKcal=clamp(number(v.remainingKcal,0),0,savedOriginalKcal),savedRemainingWater=clamp(number(v.remainingWaterMl,0),0,savedOriginalWater);
    const limitAbsorbed=(value,original,remaining)=>{const n=Math.max(0,number(value,0));return n+remaining<=original+1e-8?n:Math.max(0,original-remaining);};
    mass+=remainingMassGrams;f.stomach.push({id:text(v.id)||`ingestion:${f.nextId++}`,objectId:text(v.objectId),actionId:actionId(v.actionId),provenance:text(v.provenance)||'unknown',at:clamp(number(v.at,elapsed),0,3600*100000),
      remainingKcal:savedRemainingKcal*portion,remainingWaterMl:savedRemainingWater*portion,remainingMassGrams,
      originalKcal:savedOriginalKcal*portion,originalWaterMl:savedOriginalWater*portion,
      originalMassGrams:savedOriginalMass*portion,absorbedKcal:limitAbsorbed(v.absorbedKcal,savedOriginalKcal,savedRemainingKcal)*portion,absorbedWaterMl:limitAbsorbed(v.absorbedWaterMl,savedOriginalWater,savedRemainingWater)*portion,harm:clamp(number(v.harm,0),0,100),digestHours:clamp(number(v.digestHours,2),.05,24),elapsedHours:clamp(number(v.elapsedHours,0),0,24),toxicity:clamp(number(v.toxicity,0),0,1),feedbackSent:Boolean(v.feedbackSent),waterFeedbackSent:Boolean(v.waterFeedbackSent),sustenanceFeedbackSent:Boolean(v.sustenanceFeedbackSent)});
  }
  f.feedback=(Array.isArray(raw?.feedback)?raw.feedback:[]).slice(-R.maxFeedback).filter(v=>v&&feedbackEffects.includes(v.effect)).map(v=>({id:text(v.id)||`feedback:${f.nextId++}`,ingestionId:text(v.ingestionId),at:clamp(number(v.at,elapsed),0,3600*100000),objectId:text(v.objectId),actionId:actionId(v.actionId),provenance:text(v.provenance)||'unknown',effect:v.effect,hunger:v.hunger==='easing'?'easing':'unchanged',thirst:v.thirst==='easing'?'easing':'unchanged',energy:v.energy==='easing'?'easing':'unchanged',pain:['none','aching','hurting'].includes(v.pain)?v.pain:'none'}));
  f.outsideAssistance={energyKcal:clamp(number(raw?.outsideAssistance?.energyKcal,0),0,1e12),waterMl:clamp(number(raw?.outsideAssistance?.waterMl,0),0,1e12),count:clamp(Math.floor(number(raw?.outsideAssistance?.count,0)),0,1e9)};
  f.totals={};for(const key of ['ingestedKcal','ingestedWaterMl','absorbedKcal','absorbedWaterMl','metabolizedKcal','waterLostMl','discardedKcal','discardedWaterMl'])f.totals[key]=clamp(number(raw?.totals?.[key],0),0,1e12);
  return f;
}

const ensure=actor=>actor.physiology??=(createPhysiology(actor.species||'human'));
export function projectPhysiology(actor){
  const f=ensure(actor),p=profileOf(f.profile),deficitFraction=f.waterDeficitMl/(p.massKg*1000);
  actor.hydration=clamp(100-deficitFraction/.065*100,0,100);
  const fullness=f.stomach.reduce((sum,v)=>sum+v.remainingMassGrams,0)/p.stomachCapacityGrams;
  actor.nourishment=clamp(100-f.hoursSinceMeal*9+fullness*40,0,100);
  actor.energy=clamp(f.availableEnergyKcal/p.availableCapacityKcal*100*(.55+.45*f.condition/100),0,100);
  actor.stamina=f.stamina;actor.fatigue=f.fatigue;actor.sleepPressure=f.sleepPressure;actor.health=f.health;
  actor.thermal??={hot:0,cold:0,wetness:0};
  actor.bodyMode=f.sleep.state==='sleeping'?'sleeping':f.sleep.state==='onset'?'dozing':actor.active?.request?.type==='rest'?'resting':'awake';
  return actor;
}

export function isSleeping(actor){return actor?.physiology?actor.physiology.sleep?.state==='sleeping'||actor.physiology.sleep?.state==='onset':actor?.active?.request?.type==='sleep';}
export function beginSleep(actor,{hours=profileOf(ensure(actor).profile).sleepHours}={}){
  const f=ensure(actor);if(actor.lifecycle==='COLLAPSED'||f.health<=0)return{ok:false,code:'UNCONSCIOUS'};
  if(!Number.isFinite(hours)||hours<=0||hours>R.maximumSleepHours)return{ok:false,code:'INVALID_REQUEST'};
  f.sleep.state='onset';f.sleep.hours=0;f.sleep.remainingHours=hours;f.sleep.depth=0;f.sleep.wakeReason=null;actor.bodyMode='dozing';return{ok:true,code:'SLEEP_STARTED'};
}

/** Arousal uses limited stimuli; deep sleep and severe deprivation can prevent waking. */
export function wakePhysiology(actor,stimulus='distress'){
  const f=ensure(actor),s=f.sleep;if(s.state==='awake')return{woke:false,reason:'ALREADY_AWAKE'};
  const kind=typeof stimulus==='string'?stimulus:stimulus?.kind||'distress',strength=typeof stimulus==='object'?clamp(number(stimulus.intensity??stimulus.strength,1),0,1):1;
  const p=profileOf(f.profile),severe=f.health<8||f.waterDeficitMl/(p.massKg*1000)>.12;
  const threshold=kind==='sound'?.35+s.depth*.5:kind==='contact'?.15+s.depth*.3:0;
  if(strength<threshold||severe&&kind!=='attack')return{woke:false,reason:'NOT_AROUSED'};
  const slept=s.hours;s.state='awake';s.remainingHours=0;s.depth=0;s.wakeReason=String(kind).slice(0,80);
  s.inertiaHours=slept>=.15?R.sleepInertiaHours*(slept<1?1.4:1):0;
  if(slept>.1)f.awakeHours=0;projectPhysiology(actor);return{woke:true,reason:s.wakeReason};
}

export function harmPhysiology(actor,damage,provenance={}){
  if(!Number.isFinite(damage)||damage<=0)return{ok:false,code:'INVALID_DAMAGE'};
  const f=ensure(actor),actual=Math.min(f.health,clamp(damage,0,100));f.health-=actual;f.fatigue=clamp(f.fatigue+actual*.3,0,100);
  const wake=wakePhysiology(actor,{kind:provenance.stimulus==='contact'?'contact':'attack',intensity:1});projectPhysiology(actor);return{ok:true,damage:actual,...wake};
}

/** Swallowing transfers material to a finite gut. Absorption and evidence arrive later. */
export function canIngestMaterial(actor,material){
  const f=actor.physiology||createPhysiology(actor.species||'human'),p=profileOf(f.profile);if(isSleeping(actor)||f.health<=0||actor.lifecycle==='COLLAPSED')return{ok:false,code:'CANNOT_SWALLOW'};
  if(material?.nutrition)material={...material,...material.nutrition};
  if(!material||!Number.isFinite(material.massGrams)||material.massGrams<=0)return{ok:false,code:'INVALID_MATERIAL'};
  const mass=material.massGrams,occupied=f.stomach.reduce((sum,v)=>sum+v.remainingMassGrams,0);
  if(f.stomach.length>=R.maxDigestiveInputs||occupied+mass>p.stomachCapacityGrams)return{ok:false,code:'TOO_FULL'};
  return{ok:true,code:'CAN_SWALLOW'};
}

export function ingestMaterial(actor,material,provenance={}){
  const eligibility=canIngestMaterial(actor,material);if(!eligibility.ok)return eligibility;
  const f=ensure(actor);if(material?.nutrition)material={...material,...material.nutrition};const mass=material.massGrams;
  const kcal=clamp(number(material.energyKcal,0),0,50000),water=clamp(number(material.waterMl,0),0,20000),toxicity=clamp(number(material.toxicity??material.hazard,0),0,1);
  const id=`ingestion:${f.nextId++}`;f.stomach.push({id,objectId:text(provenance.objectId),actionId:actionId(provenance.actionId),provenance:text(provenance.source??provenance.provenance)||'interaction',at:number(provenance.at,number(actor.elapsed,0)),remainingKcal:kcal,remainingWaterMl:water,remainingMassGrams:mass,originalKcal:kcal,originalWaterMl:water,originalMassGrams:mass,absorbedKcal:0,absorbedWaterMl:0,harm:0,digestHours:clamp(number(material.digestHours,2),.05,24),elapsedHours:0,toxicity,feedbackSent:false,waterFeedbackSent:false,sustenanceFeedbackSent:false});
  f.totals.ingestedKcal+=kcal;f.totals.ingestedWaterMl+=water;
  return{ok:true,code:'SWALLOWED',ingestionId:id,delayed:true};
}

/** Water may be drunk from a validated physical container; it does not add calories. */
export function ingestWater(actor,waterMl,provenance={}){
  const f=ensure(actor);if(!Number.isFinite(waterMl)||waterMl<=0||isSleeping(actor))return{ok:false,code:'CANNOT_DRINK'};
  return ingestMaterial(actor,{massGrams:waterMl,waterMl,energyKcal:0,digestHours:.1},provenance);
}

export function exertPhysiology(actor,seconds,effort=1){
  if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(effort)||effort<=0)return;
  const f=ensure(actor),p=profileOf(f.profile),hours=gameHours(seconds),bounded=clamp(effort,0,5),cost=p.walkingKcalPerHour*bounded*hours,spent=Math.min(f.availableEnergyKcal,cost);
  f.availableEnergyKcal-=spent;f.totals.metabolizedKcal+=spent;f.waterDeficitMl=clamp(f.waterDeficitMl+p.effortWaterMlPerHour*bounded*hours,0,p.bodyWaterMl);f.totals.waterLostMl+=p.effortWaterMlPerHour*bounded*hours;
  f.stamina=clamp(f.stamina-45*bounded*hours,0,100);f.fatigue=clamp(f.fatigue+(4*bounded+(f.sleep.inertiaHours>0?3:0))*hours,0,100);projectPhysiology(actor);
  return seconds*bounded; // Performed motor work; only the engine may quantize this as felt exertion.
}

function digest(actor,hours){
  const f=ensure(actor),p=profileOf(f.profile);
  for(const item of f.stomach){
    const remainingTime=Math.max(.001,item.digestHours-item.elapsedHours),portion=Math.min(1,hours/remainingTime),kcal=item.remainingKcal*portion,water=item.remainingWaterMl*portion,mass=item.remainingMassGrams*portion;
    item.remainingKcal-=kcal;item.remainingWaterMl-=water;item.remainingMassGrams-=mass;item.elapsedHours+=hours;
    const space=p.availableCapacityKcal-f.availableEnergyKcal,available=Math.min(space,kcal),stored=Math.min(p.storedCapacityKcal-f.storedEnergyKcal,kcal-available);
    f.availableEnergyKcal+=available;f.storedEnergyKcal+=stored;f.totals.absorbedKcal+=available+stored;f.totals.discardedKcal+=Math.max(0,kcal-available-stored);item.absorbedKcal+=available+stored;
    const relieved=Math.min(f.waterDeficitMl,water);f.waterDeficitMl-=relieved;f.totals.absorbedWaterMl+=relieved;f.totals.discardedWaterMl+=water-relieved;item.absorbedWaterMl+=relieved;
    // Tiny tastes supply proportionally tiny nutrients rather than resetting a meal clock.
    if(kcal>0)f.hoursSinceMeal=Math.max(0,f.hoursSinceMeal-kcal/(p.basalKcalPerDay/24));
    if(item.toxicity>0){const harm=Math.min(f.health,item.toxicity*mass/Math.max(1,p.massKg)*.4);f.health-=harm;item.harm+=harm;}
    const helpful=item.absorbedKcal>=p.basalKcalPerDay*.001,wet=item.absorbedWaterMl>=p.waterMlPerDay*.002,harmful=item.harm>.01,finished=item.remainingMassGrams<.001&&item.remainingKcal<.001&&item.remainingWaterMl<.001;
    // Early water relief cannot suppress a later, actually absorbed energy effect.
    const effect=harmful&&!item.feedbackSent?'discomfort':!item.feedbackSent&&helpful&&!item.sustenanceFeedbackSent?'sustained':!item.feedbackSent&&wet&&!item.waterFeedbackSent?'water relief':finished&&!item.feedbackSent&&!item.waterFeedbackSent&&!item.sustenanceFeedbackSent?'no noticeable change':null;
    if(effect&&item.elapsedHours+1e-8>=Math.min(R.feedbackDelayHours,item.digestHours)){
      f.feedback.push({id:`feedback:${f.nextId++}`,ingestionId:item.id,at:number(actor.elapsed,0),objectId:item.objectId,actionId:item.actionId,provenance:item.provenance,effect,hunger:effect==='sustained'?'easing':'unchanged',thirst:wet?'easing':'unchanged',energy:effect==='sustained'?'easing':'unchanged',pain:effect==='discomfort'?(item.toxicity>.4?'hurting':'aching'):'none'});
      if(f.feedback.length>R.maxFeedback)f.feedback.splice(0,f.feedback.length-R.maxFeedback);
      if(effect==='sustained')item.sustenanceFeedbackSent=true;if(wet)item.waterFeedbackSent=true;if(effect==='discomfort'||effect==='no noticeable change')item.feedbackSent=true;
      actor.feelings??={};if(effect==='sustained'||effect==='water relief')actor.feelings.relief=Math.max(number(actor.feelings.relief,0),.2);
    }
  }
  f.stomach=f.stomach.filter(v=>{
    if(v.remainingMassGrams>.001||v.remainingKcal>.001||v.remainingWaterMl>.001)return true;
    // Bounded cleanup is a physical loss, not absorption. Preserve the tiny
    // unabsorbed remainder in the existing disposal ledger before removing it.
    f.totals.discardedKcal+=v.remainingKcal;f.totals.discardedWaterMl+=v.remainingWaterMl;
    return false;
  });
}

export function tickPhysiology(actor,dt,conditions={},options={}){
  if(!Number.isFinite(dt)||dt<=0)return{damage:0,woke:false,impaired:false};
  const f=ensure(actor),p=profileOf(f.profile),hours=gameHours(dt),before=f.health;let woke=false,wakeReason=null;
  // Use small game-time steps so accelerated time preserves absorption/arousal ordering.
  let left=hours;while(left>1e-10){const h=Math.min(left,.05);left-=h;f.clockHours+=h;f.hoursSinceMeal+=h;
    const sleeping=f.sleep.state==='sleeping',onset=f.sleep.state==='onset',resting=options.activity==='resting'||actor.active?.request?.type==='rest';
    const hour=number(conditions.hour,8);f.circadianAlertness=Math.cos((hour-15)/24*Math.PI*2);
    const basal=p.basalKcalPerDay/24*(sleeping?.85:1),required=basal*h;
    if(f.availableEnergyKcal<p.availableCapacityKcal*.4&&f.storedEnergyKcal>0){const mobilized=Math.min(f.storedEnergyKcal,p.mobilizeKcalPerHour*h);f.storedEnergyKcal-=mobilized;f.availableEnergyKcal=Math.min(p.availableCapacityKcal,f.availableEnergyKcal+mobilized);}
    const spent=Math.min(f.availableEnergyKcal,required);f.availableEnergyKcal-=spent;f.totals.metabolizedKcal+=spent;
    f.starvationHours=f.availableEnergyKcal<p.availableCapacityKcal*.15?f.starvationHours+h:Math.max(0,f.starvationHours-h*.2);
    const felt=number(conditions.feltTemperature,18),hot=Math.max(0,felt-26),cold=Math.max(0,14-felt),water=p.waterMlPerDay/24*(sleeping?.85:1)*(1+hot*.09)*h;
    f.waterDeficitMl=clamp(f.waterDeficitMl+water,0,p.bodyWaterMl);f.totals.waterLostMl+=water;
    actor.thermal??={hot:0,cold:0,wetness:0};const t=actor.thermal;
    t.wetness=clamp(number(t.wetness,0)+(conditions.raining&&!conditions.sheltered?R.wettingPerHour:-R.dryingPerHour*(conditions.sheltered?2:1))*h,0,100);
    t.hot=clamp(number(t.hot,0)+(hot?hot*R.hotStrainPerDegreeHour:-R.thermalRecoveryPerHour)*h,0,100);
    t.cold=clamp(number(t.cold,0)+(cold?cold*R.coldStrainPerDegreeHour:-R.thermalRecoveryPerHour)*h,0,100);
    digest(actor,h);
    const fraction=f.waterDeficitMl/(p.massKg*1000),fasting=f.hoursSinceMeal;
    if(fasting>48)f.condition=Math.max(0,f.condition-(fasting>168?.18:.1)*h);else if(f.availableEnergyKcal>p.availableCapacityKcal*.4)f.condition=Math.min(100,f.condition+.15*h);
    const dehydration=Math.max(0,(fraction-R.dehydrationDamageStartFraction)/.01)*.55;
    const starvation=(spent<required?(1-spent/Math.max(.001,required))*1.5:0)+Math.max(0,30-f.condition)/30*.5;
    const exposure=Math.max(0,Math.max(t.hot,t.cold)-80)/20*R.thermalDamagePerHour;
    f.health=clamp(f.health-(dehydration+starvation+exposure)*h,0,100);
    if(dehydration+starvation+exposure===0&&f.availableEnergyKcal>p.availableCapacityKcal*.35&&fraction<.02)f.health=Math.min(100,f.health+.04*h);
    if(sleeping){f.sleep.hours+=h;f.sleep.remainingHours=Math.max(0,f.sleep.remainingHours-h);f.sleep.depth=clamp(f.sleep.hours/.5,0,1);f.sleepPressure=Math.max(0,f.sleepPressure-R.sleepPressureRecoveryPerHour*h);f.fatigue=Math.max(0,f.fatigue-R.sleepFatigueRecoveryPerHour*h);f.stamina=Math.min(100,f.stamina+35*h);
      if(f.sleep.remainingHours<=0){const w=wakePhysiology(actor,'finished sleep');woke||=w.woke;wakeReason=w.reason;}
    }else{f.awakeHours+=h;f.sleepPressure=Math.min(100,f.sleepPressure+R.awakePressurePerHour*h);f.fatigue=clamp(f.fatigue+(resting?-R.restFatigueRecoveryPerHour:R.awakeFatiguePerHour)*h,0,100);f.stamina=Math.min(100,f.stamina+(resting?35:18)*h);f.sleep.inertiaHours=Math.max(0,f.sleep.inertiaHours-h);
      if(onset){f.sleep.hours+=h;f.sleep.remainingHours=Math.max(0,f.sleep.remainingHours-h);if(f.sleep.hours>=p.sleepOnsetHours){f.sleep.state='sleeping';f.sleep.hours=0;}}
    }
    if(isSleeping(actor)&&(fraction>=.045||f.availableEnergyKcal<p.availableCapacityKcal*.08||Math.max(t.hot,t.cold)>=65||f.health<35)){
      const w=wakePhysiology(actor,'distress');woke||=w.woke;if(w.woke)wakeReason='distress';
    }
  }
  actor.feelings??={};actor.feelings.relief=Math.max(0,number(actor.feelings.relief,0)-hours*.4);projectPhysiology(actor);
  return{damage:Math.max(0,before-f.health),woke,wakeReason,impaired:f.sleep.inertiaHours>0||f.sleepPressure>85||f.condition<70||f.waterDeficitMl/(p.massKg*1000)>.025};
}

export function relievePhysiology(actor,{energyKcal=R.rescueEnergyKcal,waterMl=R.rescueWaterMl}={}){
  const f=ensure(actor),p=profileOf(f.profile),energy=Math.min(clamp(number(energyKcal,0),0,50000),p.availableCapacityKcal-f.availableEnergyKcal),water=Math.min(clamp(number(waterMl,0),0,20000),f.waterDeficitMl);
  f.availableEnergyKcal+=energy;f.waterDeficitMl-=water;f.health=Math.max(f.health,65);f.stamina=Math.max(f.stamina,60);f.fatigue=Math.min(f.fatigue,65);f.sleepPressure=Math.min(f.sleepPressure,75);
  f.outsideAssistance.energyKcal+=energy;f.outsideAssistance.waterMl+=water;f.outsideAssistance.count++;f.sleep.state='awake';f.sleep.depth=0;f.sleep.remainingHours=0;projectPhysiology(actor);return{energyKcal:energy,waterMl:water};
}
