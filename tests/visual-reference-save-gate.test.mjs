import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkState} from '../src/ozark-save.js';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createReferenceSymbolInventory} from '../src/visual-reference-random.js';
import {createVisualReferenceSaveGate} from '../src/visual-reference-save-gate.js';

const geometry=createOzarkWorldGeometry();
function learned(){
  const state=createOzarkState(geometry),data=structuredClone({worldLineage:state.worldLineage,visualReference:state.visualReference});
  const sender=data.visualReference.learners[0],receiver=data.visualReference.learners[1];
  const symbols=createReferenceSymbolInventory({seed:data.visualReference.seed,identity:sender.serial});
  sender.anchors=[{symbol:symbols[0],features:Array(48).fill(.1)},{symbol:symbols[1],features:Array(48).fill(.8)}];
  receiver.partners=[{agentId:sender.agentId,serial:sender.serial,entries:[
    {symbol:symbols[0],examples:[Array(48).fill(.12)],support:1,conflicted:false},
  ]}];
  return data;
}

test('optional channel retirement captures the latest completed correction before disposal',()=>{
  const gate=createVisualReferenceSaveGate(),data=learned(),order=[];
  const learner={exportPersistence(){order.push('export');return structuredClone(data);},dispose(){order.push('dispose');}};
  const previous=gate.current(learner);
  assert.equal(previous.ok,true);
  assert.equal(previous.persistence.visualReference.learners[1].partners[0].entries[0].support,1);
  data.visualReference.learners[1].partners[0].entries[0].support=2;
  assert.equal(gate.retire(learner),true);
  assert.deepEqual(order.slice(-2),['export','dispose']);
  assert.equal(gate.current(null).ok,true);
  assert.equal(gate.current(null).persistence.visualReference.learners[1].partners[0].entries[0].support,2);
  assert.equal(gate.isBlocked(),false);
  assert.equal(gate.current(null).persistence.visualReference.learners[1].partners[0].entries[0].support,2,
    'Repeated save reads cannot consume a correction');
});

test('unsafe retirement blocks every later ordinary export, including an old checkpoint',()=>{
  const gate=createVisualReferenceSaveGate(),data=learned();
  assert.equal(gate.current({exportPersistence:()=>structuredClone(data)}).ok,true);
  let disposed=false;
  assert.equal(gate.retire({exportPersistence(){throw Error('unreconciled replacement');},dispose(){disposed=true;}}),false);
  assert.equal(disposed,true);
  assert.equal(gate.isBlocked(),true);
  assert.deepEqual(gate.current({exportPersistence:()=>structuredClone(data)}),{ok:false,persistence:null});
  assert.deepEqual(gate.current(null),{ok:false,persistence:null});
});

test('an active stale export may recover only after normal runtime reconciliation',()=>{
  const gate=createVisualReferenceSaveGate(),data=learned();let stale=true;
  const learner={exportPersistence(){if(stale)throw Error('stale actor');return structuredClone(data);}};
  assert.equal(gate.current(learner).ok,false);
  assert.equal(gate.isBlocked(),false);
  stale=false;
  assert.equal(gate.current(learner).ok,true);
});

test('retired learner mutation or changed identity cannot silently rewrite retained memory',()=>{
  const gate=createVisualReferenceSaveGate(),data=learned();
  const learner={exportPersistence:()=>structuredClone(data),dispose(){}};
  assert.equal(gate.retire(learner),true);
  data.visualReference.random.choice++;
  assert.equal(gate.current(null).ok,false);
  data.visualReference.random.choice--;
  data.worldLineage.agents[0].serial=999;
  assert.equal(gate.current(null).ok,false);
});
