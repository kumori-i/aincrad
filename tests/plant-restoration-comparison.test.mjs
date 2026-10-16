import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleRestorationError} from '../src/plant-lifecycle-state.js';
// Previous strict comparison is a test oracle for the allocation-only rewrite.
function original(raw,canonical){
 const compare=(a,b,path)=>{
  if(path.match(/^ecology\.animals\[\d+\]\.actionHours$/))return null;
  if(b===null||typeof b!=='object')return a===b?null:`Changed physical field ${path}`;
  if(!a||typeof a!=='object'||Array.isArray(a)!==Array.isArray(b))return `Missing physical field ${path}`;
  if(Array.isArray(b)){
   if(a.length!==b.length)return `Changed physical count ${path}`;
   for(let i=0;i<b.length;i++){const error=compare(a[i],b[i],`${path}[${i}]`);if(error)return error;}
  }else for(const key of Object.keys(b)){const error=compare(a[key],b[key],`${path}.${key}`);if(error)return error;}
  return null;
 };
 return compare(raw,canonical,'ecology');
}
test('lazy strict physical comparison exactly matches the prior rejection oracle',()=>{
 const canonical={animals:[{actionHours:0,position:{x:10,y:20},physiology:{energy:1},other:{actionHours:2}},{actionHours:0}],plants:[{position:{x:1,y:2},stock:0}],materials:[{mass:2,heldBy:null}],ledger:{photosynthesis:0},nested:{animals:[{actionHours:3}]}};
 const edits=[r=>{},r=>r.animals[0].actionHours=19,r=>r.animals[0].position.x++,r=>r.animals[0].other.actionHours++,r=>r.nested.animals[0].actionHours++,r=>r.animals.pop(),r=>r.plants[0].position=null,r=>r.materials[0].heldBy='aster',r=>delete r.materials,r=>r.ledger.photosynthesis=NaN,r=>r.ledger.photosynthesis=-0,r=>r.animals={},r=>r.extra={text:'ignored'},r=>r.animals[0].extra='ignored',r=>r.plants[0].stock=Infinity,r=>r.plants[0].position={x:1,y:2,z:{extra:true}}];
 for(const edit of edits){const raw=structuredClone(canonical);edit(raw);assert.equal(lifecycleRestorationError(raw,canonical),original(raw,canonical));}
 assert.equal(lifecycleRestorationError(canonical,canonical),null);
 const aliased={ledger:{invalid:NaN}};assert.equal(lifecycleRestorationError(aliased,aliased),original(aliased,aliased));
});
