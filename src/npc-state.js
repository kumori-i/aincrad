import { CONFIG, STARTER_NPC_SPAWN, NPC_PRESETS, NPC_RULES } from './config.js';

/** Body, learned state and identity are data. Neither models nor artwork own them. */
export function createNpc({preset='normal', learning=true, seed=CONFIG.seed}={}) {
  const selected=NPC_PRESETS[preset] ? preset : 'normal';
  return {
    version:2, id:'aster', name:'Aster', scene:'valley', position:{...STARTER_NPC_SPAWN},
    elapsed:0, hydration:NPC_PRESETS[selected].initialHydration, nourishment:NPC_PRESETS[selected].initialNourishment, health:100,
    thermal:{hot:0,cold:0,wetness:0}, sensation:{hour:8,weather:'clear',temperature:18,airTemperature:18,feltTemperature:18,wind:0,raining:false,sheltered:false,shade:false},
    feelings:{hunger:1-NPC_PRESETS[selected].initialNourishment/100,thirst:1-NPC_PRESETS[selected].initialHydration/100,heat:0,cold:0,discomfort:Math.max((1-NPC_PRESETS[selected].initialNourishment/100)*.85,(1-NPC_PRESETS[selected].initialHydration/100)*.8),distress:0,comfort:1-Math.max((1-NPC_PRESETS[selected].initialNourishment/100)*.85,(1-NPC_PRESETS[selected].initialHydration/100)*.8),relief:0},
    inventory:{apples:[],capacity:NPC_RULES.foodCapacity},riskCost:0,bodyFeedback:{since:0,cost:0},collapseCause:null,
    flask:{capacity:1,water:0,provenance:null,fillEventId:null,creditedFillId:null},
    lifecycle:'AWAKE', lifecycleAt:0, epoch:0, collapseId:0, rescuedCollapseId:0,
    preset:selected, rescuePresentation:'divine', learning:Boolean(learning), seed:seed>>>0, rng:seed>>>0,
    navigationAnchor:null, active:null, skillRun:null, lastResult:null, nextDecisionAt:0, modelBudget:{since:0,calls:0},
    memory:{nextId:1,experience:[],cells:{},caveCells:{},caveExits:{},blockedEdges:{},caveEdges:{},sources:{},foods:{},shelters:{},skills:[],values:{},features:{},effects:{},lessons:[],trace:[],explorationCredit:0,exploration:{origin:null,lastVisited:null,recentTargets:[],heading:null}},
    stats:{independentDrinks:0,independentMeals:0,gatherings:0,collections:0,warningSeconds:0,criticalSeconds:0,injuries:0,collapses:0,rescues:0,invalidActions:0,repeatedInvalid:0,modelCalls:0,modelFailures:0,staleResponses:0,skillUses:0,firstWaterAt:null,firstFoodAt:null,lastRescuer:null},
    presentation:{rescueUntil:0,drinkUntil:0,eatUntil:0}, decision:'A new expedition: no remembered water sources or learned procedures.',
  };
}
