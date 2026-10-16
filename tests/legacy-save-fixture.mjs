// Test-only historical fixture conversion. A current envelope with new metadata
// is intentionally not a legitimate historical save.
export function legacyEcology(e){
 if(!e)return e;
 delete e.lifecycle;
 for(const p of e.plants??[])for(const key of ['lifecycleStage','structureMassGrams','structureKcal','structureWaterMl','recruitedAt','parentMaterialId'])delete p[key];
 for(const m of e.materials??[])for(const key of ['seedOpportunity','nextGerminationAt'])delete m[key];
 return e;
}
export function legacySave(state,version=6){state.version=version;delete state.features;legacyEcology(state.environment?.ecology);return state;}
