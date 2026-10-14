import { NPC_RULES, BODY_RULES } from './config.js';
import { BIOLOGY_PROFILES } from './biology-config.js';
import { isSleeping } from './biology.js';

const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const reserve=(value,labels)=>value>70?labels[0]:value>45?labels[1]:value>20?labels[2]:value>0?labels[3]:labels[4];
const warmth=temperature=>temperature>NPC_RULES.comfortMaximum?'hot':temperature>22?'warm':temperature<NPC_RULES.comfortMinimum?(temperature<10?'cold':'cool'):'comfortable';

/** Bodily awareness is qualitative. These sensations are not a second copy of the body stores. */
export function bodySignals(npc){
  if(npc.mode==='discovery'&&npc.physiology)return discoveryBodySignals(npc);
  const sensation=npc.sensation||{},thermal=npc.thermal||{},energy=finite(npc.energy,BODY_RULES.initialEnergy),stamina=finite(npc.stamina,BODY_RULES.initialStamina),fatigue=finite(npc.fatigue,BODY_RULES.initialFatigue),sleepPressure=finite(npc.sleepPressure,BODY_RULES.initialSleepPressure);
  const hot=finite(thermal.hot,0),cold=finite(thermal.cold,0),wet=finite(thermal.wetness,0),health=finite(npc.health,100),nourishment=finite(npc.nourishment,85),hydration=finite(npc.hydration,85);
  const urgent=nourishment<=NPC_RULES.criticalNourishment||hydration<=NPC_RULES.criticalHydration||Math.max(hot,cold)>=NPC_RULES.criticalThermal||health<=BODY_RULES.restInterruptHealth;
  const overall=npc.lifecycle==='COLLAPSED'?'unconscious':npc.lifecycle==='RECOVERING'?'recovering':urgent?'urgent':finite(npc.feelings?.distress,0)>.45?'distressed':finite(npc.feelings?.discomfort,0)>.3||fatigue>50||sleepPressure>60?'uncomfortable':'settled';
  const activity=npc.lifecycle!=='AWAKE'?'awake':npc.active?.request.type==='sleep'?'sleeping':npc.active?.request.type==='rest'?'resting':npc.active?.request.type==='move'?'walking':'awake';
  return {
    hunger:reserve(nourishment,['content','peckish','hungry','ravenous','faint with hunger']),
    thirst:reserve(hydration,['quenched','dry mouth','thirsty','parched','desperate thirst']),
    thermal:Math.max(hot,cold)>=NPC_RULES.criticalThermal?(hot>=cold?'dangerously hot':'dangerously cold'):Math.max(hot,cold)>=NPC_RULES.thermalWarning?(hot>=cold?'overheated':'shivering'):warmth(finite(sensation.feltTemperature,18)),
    energy:energy>65?'steady':energy>35?'waning':energy>15?'low':'depleted',
    stamina:stamina>60?'easy breathing':stamina>30?'breathing hard':stamina>10?'winded':'exhausted',
    fatigue:fatigue<25?'fresh':fatigue<50?'tired':fatigue<75?'weary':'exhausted',
    sleepiness:sleepPressure<30?'alert':sleepPressure<60?'drowsy':sleepPressure<80?'sleepy':'struggling to stay awake',
    pain:health>90?'none':health>70?'aching':health>40?'hurting':'severe',
    wetness:wet<10?'dry':wet<40?'damp':wet<75?'wet':'soaked',overall,activity,
    relief:finite(npc.feelings?.relief,0)>.45?'relieved':finite(npc.feelings?.relief,0)>.08?'easing':'none',
  };
}

function discoveryBodySignals(npc){
  const f=npc.physiology,p=BIOLOGY_PROFILES[f.profile]||BIOLOGY_PROFILES.human,t=npc.thermal||{},s=npc.sensation||{},deficit=f.waterDeficitMl/(p.massKg*1000);
  const gut=f.stomach.reduce((sum,item)=>sum+item.remainingMassGrams,0)/p.stomachCapacityGrams,fast=f.hoursSinceMeal;
  const hunger=gut>.3?'content':fast<4?'content':fast<7?'peckish':fast<16?'hungry':f.availableEnergyKcal>p.availableCapacityKcal*.1?'ravenous':'faint with hunger';
  const thirst=deficit<.005?'quenched':deficit<.012?'dry mouth':deficit<.025?'thirsty':deficit<.045?'parched':'desperate thirst';
  const urgent=deficit>=.045||f.health<=25||Math.max(t.hot||0,t.cold||0)>=80||f.availableEnergyKcal<=p.availableCapacityKcal*.08;
  const unconscious=npc.lifecycle==='COLLAPSED'||f.health<=0,groggy=f.sleep.inertiaHours>0,sleepiness=clampPressure(f.sleepPressure-(f.circadianAlertness||0)*12);
  const overall=unconscious?'unconscious':npc.lifecycle==='RECOVERING'?'recovering':urgent?'urgent':f.fatigue>75||f.sleepPressure>85?'distressed':fast>7||deficit>.012||Math.max(t.hot||0,t.cold||0)>40||f.fatigue>50?'uncomfortable':'settled';
  return{
    hunger,thirst,thermal:Math.max(t.hot||0,t.cold||0)>=80?((t.hot||0)>=(t.cold||0)?'dangerously hot':'dangerously cold'):Math.max(t.hot||0,t.cold||0)>=40?((t.hot||0)>=(t.cold||0)?'overheated':'shivering'):warmth(finite(s.feltTemperature,18)),
    energy:npc.energy>65?'steady':npc.energy>35?'waning':npc.energy>15?'low':'depleted',stamina:f.stamina>60?'easy breathing':f.stamina>30?'breathing hard':f.stamina>10?'winded':'exhausted',
    fatigue:f.fatigue<25?'fresh':f.fatigue<50?'tired':f.fatigue<75?'weary':'exhausted',sleepiness:groggy?'groggy':sleepiness<30?'alert':sleepiness<60?'drowsy':sleepiness<80?'sleepy':'struggling to stay awake',
    pain:f.health>90?'none':f.health>70?'aching':f.health>40?'hurting':'severe',wetness:finite(t.wetness,0)<10?'dry':t.wetness<40?'damp':t.wetness<75?'wet':'soaked',overall,
    activity:unconscious?'awake':f.sleep.state==='onset'?'dozing':isSleeping(npc)?'sleeping':npc.active?.request.type==='rest'?'resting':npc.active?.request.type==='move'?'walking':'awake',
    digestion:gut<.01?'empty':gut<.5?'settled':gut<.85?'full':'overfull',sleep:f.sleep.state==='onset'?'dozing':f.sleep.state==='sleeping'?(f.sleep.depth>.5?'deep sleep':'light sleep'):groggy?'groggy':'awake',
    relief:finite(npc.feelings?.relief,0)>.45?'relieved':finite(npc.feelings?.relief,0)>.08?'easing':'none',
  };
}
const clampPressure=value=>Math.max(0,Math.min(100,value));

/** A character experiences weather and time of day, without a thermometer or clock readout. */
export function sensedEnvironment(npc){
  const sensed=npc.sensation||{},hour=finite(sensed.hour,8),wind=finite(sensed.wind,0);
  return {
    timeOfDay:hour<5||hour>=21?'night':hour<7?'dawn':hour<12?'morning':hour<17?'afternoon':'evening',
    weather:['clear','cloudy','rainy','windy'].includes(sensed.weather)?sensed.weather:'clear',
    warmth:warmth(finite(sensed.feltTemperature,18)),wind:wind<.5?'calm':wind<2?'breezy':'gusty',
    shelter:sensed.sheltered?'sheltered':'open air',shade:sensed.shade?'shaded':'exposed',precipitation:sensed.raining?'rain':'none',
  };
}

/** The physical engine can wake an agent before sleep makes deprivation or exposure dangerous. */
export function restUnsafe(npc){
  if(npc.mode==='discovery'&&npc.physiology){const f=npc.physiology,p=BIOLOGY_PROFILES[f.profile]||BIOLOGY_PROFILES.human;return f.waterDeficitMl/(p.massKg*1000)>=.045||f.availableEnergyKcal<=p.availableCapacityKcal*.08||Math.max(npc.thermal.hot,npc.thermal.cold)>=65||f.health<=25;}
  return npc.hydration<=BODY_RULES.restInterruptReserve||npc.nourishment<=BODY_RULES.restInterruptReserve||Math.max(npc.thermal.hot,npc.thermal.cold)>=BODY_RULES.restInterruptThermal||npc.health<=BODY_RULES.restInterruptHealth;
}
