import test from 'node:test';
import assert from 'node:assert/strict';
import { createOzarkWorldGeometry } from '../src/ozark-world-geometry.js';
import { createOzarkState, OZARK_SAVE_KEY, writeOzarkSave, getOzarkSaveFailure } from '../src/ozark-save.js';
const geometry = createOzarkWorldGeometry();
function fixture(){
  const state=createOzarkState(geometry),values=new Map([['unrelated','keep']]);let writes=0;
  return {state,values,get writes(){return writes;},
    getItem:key=>values.get(key)??null,
    setItem(key,value){writes++;values.set(key,value);}};
}
function failed(f,code){
  assert.equal(writeOzarkSave(f,f.state,geometry),false);
  assert.equal(getOzarkSaveFailure(f.state),code);
  assert.equal(f.values.get('unrelated'),'keep');
}

test('untracked states fail closed and diagnostics never make a state writable',()=>{
  const f=fixture();
  for(const state of [{},null,undefined,1,'private data']){
    assert.equal(writeOzarkSave(f,state,geometry),false);
    assert.equal(getOzarkSaveFailure(state),'untracked-state');
  }
  assert.equal(f.writes,0);
});

test('stored-byte changes and storage access errors are distinct and never write',()=>{
  const changed=fixture();changed.values.set(OZARK_SAVE_KEY,'private journal');
  failed(changed,'stored-value-changed');assert.equal(changed.writes,0);
  const inaccessible=fixture();inaccessible.getItem=()=>{throw new Error('private storage detail');};
  failed(inaccessible,'storage-read');assert.equal(inaccessible.writes,0);
});

test('invalid live state reports validation without repairing or replacing it',()=>{
  const f=fixture();f.state.elapsed=-1;
  failed(f,'live-validation');assert.equal(f.writes,0);assert.equal(f.state.elapsed,-1);
});

test('serialization exception and size limit report fixed distinct codes',()=>{
  const stringify=JSON.stringify;
  try{
    const broken=fixture();
    const isDisk=value=>value?.version===12&&value.geometryIdentity&&value.community&&value.agents&&!Object.hasOwn(value,'npc');
    JSON.stringify=(value,...args)=>{if(isDisk(value))throw new Error('private serialization detail');return stringify(value,...args);};
    failed(broken,'serialization');assert.equal(broken.writes,0);
    const oversized=fixture();JSON.stringify=(value,...args)=>isDisk(value)?'x'.repeat(16*1024*1024+1):stringify(value,...args);
    failed(oversized,'save-too-large');assert.equal(oversized.writes,0);
  }finally{JSON.stringify=stringify;}
});

test('quota and other writes are distinguished without claiming original bytes survived',()=>{
  const quota=fixture();quota.setItem=()=>{throw new DOMException('private quota detail','QuotaExceededError');};
  failed(quota,'quota-write');
  const write=fixture();write.setItem=(key,value)=>{write.values.set(key,value);throw new Error('committed but acknowledgment failed');};
  failed(write,'storage-write');assert.equal(typeof write.values.get(OZARK_SAVE_KEY),'string');
  const hostile=fixture();hostile.setItem=()=>{throw {get name(){throw new Error('secret');}};};
  failed(hostile,'storage-write');
});

test('readback throws and mismatches are verification failures and do not advance save expectation',()=>{
  for(const throws of [false,true]){
    const f=fixture(),getItem=f.getItem;let reads=0;
    f.getItem=key=>{if(++reads>1){if(throws)throw new Error('private readback detail');return 'unexpected bytes';}return getItem(key);};
    failed(f,'readback-verification');assert.equal(f.writes,1);
    f.getItem=getItem;
    failed(f,'stored-value-changed');assert.equal(f.writes,1,'Unverified write must not grant a newer expected value');
  }
});

test('failure codes are per state, success clears only its own code and preserves ordinary expected-byte rules',()=>{
  const f=fixture(),other=fixture();
  assert.equal(getOzarkSaveFailure(f.state),null);
  f.state.elapsed=-1;failed(f,'live-validation');
  other.state.elapsed=-1;failed(other,'live-validation');
  f.state.elapsed=0;
  assert.equal(writeOzarkSave(f,f.state,geometry),true);assert.equal(getOzarkSaveFailure(f.state),null);
  assert.equal(getOzarkSaveFailure(other.state),'live-validation');
  assert.equal(writeOzarkSave(f,f.state,geometry),true);assert.equal(getOzarkSaveFailure(f.state),null);
  assert.equal(f.writes,2);
});
