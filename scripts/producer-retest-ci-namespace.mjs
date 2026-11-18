import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const NORMALIZED_PATHS=Object.freeze(['worldLineage.instanceId','visualReference.worldId','characterMessages.worldId','playerLessons.worldId']);
export function namespaceComparable(value){
 const id=value?.worldLineage?.instanceId;
 assert.match(id??'',/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 const copy=structuredClone(value);
 for(const path of NORMALIZED_PATHS){const [section,field]=path.split('.');assert.equal(value[section]?.[field],id,path);copy[section][field]='comparison-only-world-namespace';}
 return copy;
}
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const comparableHash=value=>sha256(JSON.stringify(namespaceComparable(value)));
