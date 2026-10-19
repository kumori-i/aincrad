/** Lossless restoration metadata for a standard-JSON native actor projection. */
import assert from 'node:assert/strict';
export function restorationFor(actor){
 const specials=[],aliases=[],keyOrders=[],seen=new Map();
 const walk=(value,path)=>{
   if(value===undefined){specials.push({path,kind:'undefined'});return;}
   if(typeof value==='number'){
     if(Object.is(value,-0))specials.push({path,kind:'negative-zero'});
     else if(!Number.isFinite(value))specials.push({path,kind:Number.isNaN(value)?'nan':value===Infinity?'positive-infinity':'negative-infinity'});
     return;
   }
   if(value===null||typeof value!=='object'){assert.ok(['string','boolean','number'].includes(typeof value)||value===null);return;}
   assert.ok(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype,'Native actor must contain only JSON-like containers');
   if(seen.has(value)){aliases.push({path,to:seen.get(value)});return;}
   seen.set(value,path);
   assert.ok(Reflect.ownKeys(value).every(key=>typeof key==='string'),'No symbol keys');
   const keys=Object.keys(value);
   if(!Array.isArray(value)&&keys.some(key=>value[key]===undefined))keyOrders.push({path,keys});
   for(const key of keys)walk(value[key],[...path,key]);
 };
 walk(actor,[]);return {version:1,specials,aliases,keyOrders};
}
export function restoreNativeActor(jsonActor,metadata){
 assert.equal(metadata.version,1);let actor=structuredClone(jsonActor);
 const get=path=>path.reduce((value,key)=>value[key],actor);
 const set=(path,value)=>{if(path.length)get(path.slice(0,-1))[path.at(-1)]=value;else actor=value;};
 for(const {path,kind} of metadata.specials){
   const values={'undefined':undefined,'negative-zero':-0,'nan':NaN,'positive-infinity':Infinity,'negative-infinity':-Infinity};
   assert.ok(Object.hasOwn(values,kind));set(path,values[kind]);
 }
 for(const {path,keys} of [...metadata.keyOrders].sort((a,b)=>b.path.length-a.path.length)){
   const object=get(path);set(path,Object.fromEntries(keys.map(key=>[key,object[key]])));
 }
 for(const {path,to} of metadata.aliases)set(path,get(to));
 return actor;
}
