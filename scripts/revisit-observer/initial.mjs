import assert from 'node:assert/strict';
import {sha256} from './source.mjs';
// These UUID namespaces are equality bindings, never behavior inputs.
export const PATHS=Object.freeze(['worldLineage.instanceId','visualReference.worldId','characterMessages.worldId','playerLessons.worldId']);
export function comparableInitial(raw){
 const copy=structuredClone(raw),ns=copy.worldLineage?.instanceId;
 assert(typeof ns==='string'&&ns.length>0);
 for(const path of PATHS){const [owner,key]=path.split('.');assert.equal(copy[owner]?.[key],ns);copy[owner][key]='paired-world-namespace';}
 return sha256(JSON.stringify(copy));
}
