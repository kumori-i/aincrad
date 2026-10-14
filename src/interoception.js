import { NPC_RULES, BODY_RULES } from './config.js';

const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const reserve=(value,labels)=>value>70?labels[0]:value>45?labels[1]:value>20?labels[2]:value>0?labels[3]:labels[4];
const warmth=temperature=>temperature>NPC_RULES.comfortMaximum?'hot':temperature>22?'warm':temperature<NPC_RULES.comfortMinimum?(temperature<10?'cold':'cool'):'comfortable';

/** Bodily awareness is qualitative. These sensations are not a second copy of the body stores. */
export function bodySignals(npc){
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
  return npc.hydration<=BODY_RULES.restInterruptReserve||npc.nourishment<=BODY_RULES.restInterruptReserve||Math.max(npc.thermal.hot,npc.thermal.cold)>=BODY_RULES.restInterruptThermal||npc.health<=BODY_RULES.restInterruptHealth;
}
