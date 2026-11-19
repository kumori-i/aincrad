// Engineering comparison only. Never import into a scientific runner or runtime.
import assert from 'node:assert/strict';
export function normalizeActorChangeMemory(copy,world,label='paired-fixture-world'){
 const memory=copy?.discovery?.changeMemory;if(memory===undefined)return copy;
 const actor=world.agents?.find(a=>a.id===copy.id),lineage=world.worldLineage?.agents?.filter(a=>a.agentId===copy.id);
 assert.ok(actor&&copy!==actor,'Only a detached actor comparison copy may be normalized');
 assert.equal(lineage?.length,1);assert.equal(memory.ownerId,copy.id);
 assert.equal(memory.worldId,world.worldLineage.instanceId,'Change memory must belong to its actual fixture world');
 assert.equal(memory.incarnation,lineage[0].serial,'Change memory must belong to its actual actor incarnation');
 assert.notEqual(memory,actor.discovery?.changeMemory,'Never mutate live memory');
 memory.worldId=label;return copy;
}
export function normalizeWorldChangeMemory(copy,world,label='paired-fixture-world'){
 assert.notEqual(copy,world,'Only a detached world comparison copy may be normalized');
 // These are the only actor locations in the real world/save envelope. Preserve
 // the optional historical npc alias, including a separately serialized alias.
 for(const actor of new Set([...(copy.agents??[]),...(copy.npc?[copy.npc]:[])]))normalizeActorChangeMemory(actor,world,label);
 return copy;
}
