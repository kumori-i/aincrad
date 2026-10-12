import { CONFIG, SPAWN, NPC_PRESETS } from './config.js';

/** Body, learned state and identity are data. Neither models nor artwork own them. */
export function createNpc({preset='normal', learning=true, seed=CONFIG.seed}={}) {
  const selected=NPC_PRESETS[preset] ? preset : 'normal';
  return {
    version:1, id:'aster', name:'Aster', scene:'valley', position:{x:SPAWN.x+160,y:SPAWN.y+40},
    elapsed:0, hydration:NPC_PRESETS[selected].initialHydration,
    flask:{capacity:1,water:0,provenance:null,fillEventId:null,creditedFillId:null},
    lifecycle:'AWAKE', lifecycleAt:0, epoch:0, collapseId:0, rescuedCollapseId:0,
    preset:selected, rescuePresentation:'divine', learning:Boolean(learning), seed:seed>>>0, rng:seed>>>0,
    navigationAnchor:null, active:null, skillRun:null, lastResult:null, nextDecisionAt:0, modelBudget:{since:0,calls:0},
    memory:{nextId:1,experience:[],cells:{},blockedEdges:{},sources:{},skills:[],values:{},lessons:[],trace:[],explorationCredit:0},
    stats:{independentDrinks:0,collections:0,collapses:0,rescues:0,invalidActions:0,repeatedInvalid:0,modelCalls:0,modelFailures:0,staleResponses:0,skillUses:0,firstWaterAt:null,lastRescuer:null},
    presentation:{rescueUntil:0,drinkUntil:0}, decision:'A new expedition: no remembered water sources or learned procedures.',
  };
}
