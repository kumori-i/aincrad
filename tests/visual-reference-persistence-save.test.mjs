import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState,loadOzarkSave,writeOzarkSave,getOzarkSaveFailure,OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createReferenceRandomStream,createReferenceSymbolInventory} from '../src/visual-reference-random.js';
import {VISUAL_REFERENCE_MEMORY_LIMITS} from '../src/visual-reference-memory.js';
import {validateCharacterPersistence} from '../src/visual-reference-save.js';
import {attachVisualReferenceLearning} from '../src/visual-reference-attachment.js';
import {markVisualReferenceAttached} from '../src/visual-reference-save-registration.js';
import {CONFIG} from '../src/config.js';

const geometry=createOzarkWorldGeometry();
const flat=value=>Array(48).fill(value);
function storage(){
  const items=new Map();
  return {getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value)};
}
function learned(state){
  const persistence={worldLineage:structuredClone(state.worldLineage),
    visualReference:structuredClone(state.visualReference),
    characterMessages:structuredClone(state.characterMessages)};
  const section=persistence.visualReference,owner=section.learners[0],listener=section.learners[1];
  const inventory=createReferenceSymbolInventory({seed:section.seed,identity:owner.serial});
  owner.anchors=[{symbol:inventory[0],features:flat(.1)},{symbol:inventory[1],features:flat(.8)}];
  listener.partners=[{agentId:owner.agentId,serial:owner.serial,entries:[
    {symbol:inventory[0],examples:[flat(.12),flat(.45)],support:3,conflicted:false},
  ]}];
  section.random={pair:0,target:0xffffffff,order:42,choice:0x9e3779b9};
  return persistence;
}
function changeAssignedAnchorSymbol(row){
  const anchor=row.visualReference.learners[0].anchors[0];
  const original=anchor.symbol;
  anchor.symbol=(original+1)%VISUAL_REFERENCE_MEMORY_LIMITS.symbols;
  assert.notEqual(anchor.symbol,original,'The replacement stays in range and changes the assigned symbol');
}
function changePartnerSymbolToUnretainedAnchor(row){
  const listener=row.visualReference.learners[1],partner=listener.partners[0];
  const owner=row.visualReference.learners.find(learner=>learner.agentId===partner.agentId);
  assert(owner,'The partner entry has a retained owner');
  const retained=new Set(owner.anchors.map(anchor=>anchor.symbol));
  const symbol=Array.from({length:VISUAL_REFERENCE_MEMORY_LIMITS.symbols},(_,index)=>index)
    .find(candidate=>!retained.has(candidate));
  assert(Number.isInteger(symbol),'An in-range unretained symbol exists');
  const entry=partner.entries[0],original=entry.symbol;
  assert(retained.has(original),'The original entry is grounded in a retained anchor');
  entry.symbol=symbol;
  assert.notEqual(entry.symbol,original,'The replacement removes the entry\'s anchor grounding');
}
function differentWorldId(id){return (id[0]==='0'?'1':'0')+id.slice(1);}

test('unique world lineage and strict complete learner data survive exact schema-12 save/reopen',()=>{
  const disk=storage(),state=createOzarkState(geometry),other=createOzarkState(geometry);
  assert.notEqual(state.worldLineage.instanceId,other.worldLineage.instanceId);
  assert.deepEqual(other.visualReference.learners.map(row=>[row.anchors.length,row.partners.length]),[[0,0],[0,0]]);
  const referencePersistence=learned(state),before=structuredClone(state);
  assert.deepEqual(validateCharacterPersistence(referencePersistence),referencePersistence);
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence}),true);
  assert.deepEqual(state,before,'A save cannot mutate live world or learner state');
  const raw=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.deepEqual({worldLineage:raw.worldLineage,visualReference:raw.visualReference,
    characterMessages:raw.characterMessages},referencePersistence);
  assert.equal(raw.agents[0].active,null);
  const reopened=loadOzarkSave(disk,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.deepEqual({worldLineage:reopened.state.worldLineage,visualReference:reopened.state.visualReference,
    characterMessages:reopened.state.characterMessages},referencePersistence);
});

test('only completely absent extension migrates old schema-12 bytes to blank individual memories',()=>{
  const disk=storage(),state=createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const previous=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  delete previous.worldLineage;delete previous.visualReference;delete previous.characterMessages;
  previous.features={plantLifecycle:1,finiteAquatic:2,worldStructures:1};
  const oldBytes=JSON.stringify(previous);disk.setItem(OZARK_SAVE_KEY,oldBytes);
  const reopened=loadOzarkSave(disk,geometry);
  assert.equal(reopened.blocked,false,reopened.error);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),oldBytes,'Loading never edits the occupied slot');
  assert.deepEqual(reopened.state.features,
    {plantLifecycle:1,finiteAquatic:2,worldStructures:1,characterMessages:2});
  assert.notEqual(reopened.state.worldLineage.instanceId,state.worldLineage.instanceId);
  assert.deepEqual(reopened.state.visualReference.learners.map(row=>[row.anchors.length,row.partners.length]),[[0,0],[0,0]]);
  assert.equal(reopened.state.characterMessages.version,2);
  assert.equal(writeOzarkSave(disk,reopened.state,geometry),true);
  assert.equal(loadOzarkSave(disk,geometry).blocked,false);
});

test('duplicate raw JSON keys, including escaped aliases, protect exact current-world bytes',()=>{
  const disk=storage(),state=createOzarkState(geometry);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const good=disk.getItem(OZARK_SAVE_KEY);
  const duplicates=[
    good.replace('"worldLineage":','"worldLineage":{},"worldLineage":'),
    good.replace('"visualReference":{','"visualReference":{"version":9,'),
    good.replace('"visualReference":{','"visualReference":{"\\u0076ersion":9,'),
    good.replace('"learners":[{','"learners":[{"agentId":"other",'),
  ];
  for(const [index,bytes] of duplicates.entries()){
    assert.notEqual(bytes,good,`duplicate fixture ${index} changed raw bytes`);
    assert.doesNotThrow(()=>JSON.parse(bytes),`fixture ${index} is otherwise valid JSON`);
    disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true,`duplicate fixture ${index}`);
    assert.match(opened.error,/duplicate JSON field name/);
    assert.equal(writeOzarkSave(disk,state,geometry),false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes,`duplicate fixture ${index} remains exact`);
  }
});

test('quoted JSON-like contents are not keys and the historical v1 slot remains unread',()=>{
  const disk=storage(),historical='{"field":1,"field":2}',state=createOzarkState(geometry);
  state.agents[0].decision='Saw "worldLineage":{"version":1} in a sign';
  disk.setItem(CONFIG.saveKey,historical);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  const bytes=disk.getItem(OZARK_SAVE_KEY);
  assert.match(bytes,/Saw \\"worldLineage\\"/);
  const opened=loadOzarkSave(disk,geometry);
  assert.equal(opened.blocked,false,opened.error);
  assert.equal(opened.state.agents[0].decision,state.agents[0].decision);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes);
  assert.equal(disk.getItem(CONFIG.saveKey),historical);
});

test('malformed, partial, unsupported and cross-world learner bytes protect the occupied save',()=>{
  const disk=storage(),state=createOzarkState(geometry,{communicationSeed:2}),extension=learned(state);
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:extension}),true);
  const originalBytes=disk.getItem(OZARK_SAVE_KEY),original=JSON.parse(originalBytes);
  assert.equal(original.visualReference.learners[0].anchors[0].symbol,63,
    'Declared seed 2 exercises the former hardcoded-symbol no-op boundary');
  assert.equal(original.visualReference.learners[1].partners[0].entries[0].symbol,63);
  const mutations=[
    row=>{delete row.visualReference;},
    row=>{delete row.worldLineage;},
    row=>{delete row.characterMessages;},
    row=>{row.worldLineage.version=1;},
    row=>{row.characterMessages=null;},
    row=>{row.characterMessages.version=3;},
    row=>{row.characterMessages.protocol='unsupported-sequence-rng';},
    row=>{row.characterMessages.worldId=differentWorldId(row.characterMessages.worldId);},
    row=>{row.characterMessages.random.pair=-1;},
    row=>{delete row.characterMessages.random.order;},
    row=>{row.characterMessages.learners[0].serial++;},
    row=>{row.characterMessages.learners[0].sender.model.Wx.pop();},
    row=>{row.characterMessages.learners[0].sender.model.Wx[0]=NaN;},
    row=>{row.characterMessages.learners[0].sender.baseline=2;},
    row=>{row.characterMessages.learners[0].sender.revision=1;},
    row=>{row.characterMessages.learners[0].sender.pendingTrajectory={tokens:[0]};},
    row=>{row.characterMessages.learners[1].partners[0].serial++;},
    row=>{row.characterMessages.learners[1].partners[0].listener.demonstrations=1;},
    row=>{row.characterMessages.learners[1].partners[0].listener.examples=Array(129).fill({});},
    row=>{row.characterMessages.learners[1].partners[0].listener.gradient=[0];},
    row=>{row.visualReference.version=2;},
    row=>{row.visualReference.protocol='future-inventory';},
    row=>{row.visualReference.unrecognized=true;},
    row=>{row.worldLineage.unrecognized=true;},
    row=>{row.worldLineage.agents[0].serial=row.worldLineage.agents[1].serial;},
    row=>{row.worldLineage.nextSerial=1;},
    row=>{row.visualReference.worldId=differentWorldId(row.visualReference.worldId);},
    row=>{row.visualReference.learners[1].serial++;},
    row=>{delete row.visualReference.learners[0].serial;},
    row=>{row.visualReference.random.choice=-1;},
    changeAssignedAnchorSymbol,
    row=>{row.visualReference.learners[0].anchors[0].features[0]=NaN;},
    row=>{row.visualReference.learners[1].partners[0].serial++;},
    row=>{row.visualReference.learners[1].partners[0].entries[0].support=1;},
    row=>{row.visualReference.learners[1].partners[0].entries[0].examples.push(flat(.14));},
    changePartnerSymbolToUnretainedAnchor,
    row=>{row.visualReference.learners[1].partners[0].entries[0].conflicted=true;},
    row=>{row.visualReference.learners[0].anchors=Array(17).fill(row.visualReference.learners[0].anchors[0]);},
    row=>{row.visualReference.learners[1].partners[0].entries.push(structuredClone(row.visualReference.learners[1].partners[0].entries[0]));},
  ];
  for(const [index,mutate] of mutations.entries()){
    const damaged=structuredClone(original);mutate(damaged);
    const bytes=JSON.stringify(damaged);
    assert.notEqual(bytes,originalBytes,`mutation ${index} must alter the occupied bytes`);
    disk.setItem(OZARK_SAVE_KEY,bytes);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true,`mutation ${index}`);
    assert.equal(opened.state,null);
    assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:extension}),false,`mutation ${index}`);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),bytes,`mutation ${index}`);
  }
  const oversized=JSON.stringify({...original,padding:'x'.repeat(16*1024*1024)});
  disk.setItem(OZARK_SAVE_KEY,oversized);
  assert.equal(loadOzarkSave(disk,geometry).blocked,true);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),oversized);
});

test('in-range symbol corruption stays distinct at the maximum and an ordinary explicit seed',()=>{
  for(const [seed,firstSymbol] of [[2,63],[211,43]]){
    const original=learned(createOzarkState(geometry,{communicationSeed:seed}));
    assert.equal(original.visualReference.learners[0].anchors[0].symbol,firstSymbol);
    assert.deepEqual(validateCharacterPersistence(original),original);
    for(const [mutate,expectedError] of [
      [changeAssignedAnchorSymbol,/assigned symbol inventory/],
      [changePartnerSymbolToUnretainedAnchor,/partner symbol evidence/],
    ]){
      const damaged=structuredClone(original);mutate(damaged);
      assert.notDeepEqual(damaged,original,'The explicit-seed corruption must change the payload');
      assert.throws(()=>validateCharacterPersistence(damaged),expectedError);
    }
  }
});

test('only an exactly absent v2 section may migrate; present partial data cannot be made fresh',()=>{
  const state=createOzarkState(geometry),legacy={worldLineage:{...structuredClone(state.worldLineage),version:1},
    visualReference:structuredClone(state.visualReference)};
  const before=JSON.stringify(legacy),migrated=validateCharacterPersistence(legacy,{allowV1Migration:true});
  assert.equal(JSON.stringify(legacy),before,'Pure migration cannot edit v1 evidence');
  assert.deepEqual({...migrated.worldLineage,version:1},legacy.worldLineage);
  assert.deepEqual(migrated.visualReference,legacy.visualReference);
  assert.equal(migrated.characterMessages.version,2);
  assert.throws(()=>validateCharacterPersistence(legacy),TypeError);
  for(const partial of [undefined,null,{}, {version:2}])
    assert.throws(()=>validateCharacterPersistence({...legacy,characterMessages:partial},
      {allowV1Migration:true}),TypeError);
});

test('an export cannot hide invalid in-memory learner data or change world scope',()=>{
  const state=createOzarkState(geometry),disk=storage(),extension=learned(state);
  state.visualReference.learners[0].anchors=[{symbol:999,features:flat(0)}];
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:extension}),false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
  state.visualReference=structuredClone(createOzarkState(geometry).visualReference);
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:extension}),false,'An export cannot bind another world');
  assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
});

test('a current export cannot hide a live v1 pair under the current feature marker',()=>{
  const state=createOzarkState(geometry),disk=storage(),current=learned(state);
  state.worldLineage.version=1;
  delete state.characterMessages;
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:current}),false);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
});

for(const replacement of ['actor','discovery','physiology'])
  test(`${replacement} replacement saves a new blank incarnation and retires incoming links`,()=>{
    const disk=storage(),state=createOzarkState(geometry),original=learned(state);
    state.visualReference=original.visualReference;
    const attachment=attachVisualReferenceLearning({state,pixelSensor:{capture(){throw Error('No pixel capture on sync/export');},dispose(){}}});
    const oldExport=attachment.exportPersistence();
    const replaced=state.agents[0];
    if(replacement==='actor'){
      state.agents[0]=structuredClone(replaced);
      state.npc=state.agents[0]; // Keep the existing live historical alias coherent.
    }else replaced[replacement]=structuredClone(replaced[replacement]);
    assert.throws(()=>attachment.exportPersistence(),/reconciliation/,
      'Saving between replacement and normal runtime sync must refuse stale memory');
    assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:oldExport}),false);
    assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
    assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
    attachment.beforeTick();
    const current=attachment.exportPersistence();
    assert.equal(current.worldLineage.agents[0].serial,3);
    assert.equal(current.worldLineage.nextSerial,4);
    assert.deepEqual(current.visualReference.learners[0].anchors,[]);
    assert.deepEqual(current.visualReference.learners[1].partners,[]);
    assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:oldExport}),false,
      'Copied stamps cannot make an old export current after reconciliation');
    assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
    assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
    assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:current}),true);
    const reopened=loadOzarkSave(disk,geometry);
    assert.equal(reopened.blocked,false,reopened.error);
    assert.deepEqual(reopened.state.worldLineage,current.worldLineage);
    assert.deepEqual(reopened.state.visualReference,current.visualReference);
    attachment.dispose();
  });

test('a live attached world refuses a direct write without its current learner export',()=>{
  const state=createOzarkState(geometry),disk=storage();
  const attachment=attachVisualReferenceLearning({state,pixelSensor:{capture(){throw Error('No save-time pixels');},dispose(){}}});
  assert.equal(writeOzarkSave(disk,state,geometry),false);
  assert.equal(getOzarkSaveFailure(state),'reference-export-required');
  assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:attachment.exportPersistence()}),true);
  assert.equal(loadOzarkSave(disk,geometry).blocked,false);
  attachment.dispose();
});

test('the direct writer rejects another world and stale legacy or character exports',()=>{
  const state=createOzarkState(geometry),other=createOzarkState(geometry),disk=storage();
  const current=structuredClone({worldLineage:state.worldLineage,visualReference:state.visualReference,
    characterMessages:state.characterMessages});
  markVisualReferenceAttached(state,()=>structuredClone(current));
  const cached=structuredClone(current),before=structuredClone(state);
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:{worldLineage:other.worldLineage,
    visualReference:other.visualReference,characterMessages:other.characterMessages}}),false);
  assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
  const choice=createReferenceRandomStream({seed:current.visualReference.seed,purpose:'choice',
    state:current.visualReference.random.choice});
  choice();current.visualReference.random.choice=choice.state();
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:cached}),false);
  assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
  for(const change of [
    value=>{value.characterMessages.learners[0].sender.model.Wx[0]+=.001;},
    value=>{value.characterMessages.learners[1].partners[0].listener.replayState++;},
    value=>{value.characterMessages.random.pair++;},
  ]){
    const stale=structuredClone(current);
    change(current);
    assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:stale}),false,
      'A cached export cannot hide a new character-model or random-state change');
    assert.equal(getOzarkSaveFailure(state),'reference-export-stale');
  }
  assert.equal(disk.getItem(OZARK_SAVE_KEY),null);
  assert.deepEqual(state,before,'Failed export checks cannot mutate the world or identity');
  assert.equal(writeOzarkSave(disk,state,geometry,{referencePersistence:current}),true);
  assert.equal(loadOzarkSave(disk,geometry).state.visualReference.random.choice,current.visualReference.random.choice);
  assert.deepEqual(loadOzarkSave(disk,geometry).state.characterMessages,current.characterMessages);
});
