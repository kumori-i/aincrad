import {validateReferencePersistence} from './visual-reference-save.js';

// Owns the last completed private learner checkpoint after an optional-channel
// failure. No method advances learning or changes the world. A failed capture
// permanently blocks ordinary saves until the user explicitly resets the world.
export function createVisualReferenceSaveGate(){
  let blocked=false,retired=null,retained=null;
  const validate=exported=>validateReferencePersistence(exported?.worldLineage,exported?.visualReference);
  function retire(learner){
    try{
      if(!learner)throw new Error('Reference learner unavailable');
      retained=validate(learner.exportPersistence());
      retired=learner;
    }catch{
      blocked=true;retained=null;retired=null;
    }
    try{learner?.dispose();}catch{/* Optional channel is already detached. */}
    return !blocked;
  }
  function current(active){
    if(blocked)return {ok:false,persistence:null};
    try{
      if(active)return {ok:true,persistence:validate(active.exportPersistence())};
      if(!retired||!retained)throw new Error('Reference learner unavailable');
      const persistence=validate(retired.exportPersistence());
      if(JSON.stringify(persistence)!==JSON.stringify(retained))
        throw new Error('Retired learner changed after capture');
      return {ok:true,persistence};
    }catch{return {ok:false,persistence:null};}
  }
  return Object.freeze({retire,current,isBlocked:()=>blocked});
}
