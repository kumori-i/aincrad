import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { presentCombinedFoodUi } from '../scripts/combined-food-native-fixture.mjs';

// DOM event contract only, not a rendered/native acceptance test. The ordinary
// checkbox handler invalidates the panel but does not project values itself;
// an inert native test route has no periodic panel update. Her day and selection
// events perform synchronous read-only projection. RAF never advances this world.
function fixture({checked=false,staleProjection=false,source=presentCombinedFoodUi.toString()}={}) {
  const state={elapsed:85.4,selectedAgentId:'aster',agents:[
    {id:'aster',nourishment:64.78888888888902,energy:38.2,fatigue:9.4,sleepPressure:11.1},
    {id:'mira',nourishment:0,energy:0,fatigue:5.1,sleepPressure:11.1},
  ]};
  const original=structuredClone(state),bytes=JSON.stringify(state),events=[],nodes=new Map();let hidden=true;
  const add=(id,props={})=>{const n={textContent:'',...props};nodes.set(id,n);return n;};
  const checkbox=add('#npc-numeric-debug',{checked,closest:()=>details,click(){this.checked=!this.checked;events.push({kind:'numeric-change',checked:this.checked});}});
  const details={open:false};
  function update(kind){events.push({kind,checked:checkbox.checked,actor:state.selectedAgentId});if(!checkbox.checked)return;
    const n=state.agents.find(n=>n.id===state.selectedAgentId);
    nodes.get('#npc-nourishment-value').textContent=staleProjection?'99.9 / 100':n.nourishment.toFixed(1)+' / 100';
    for(const [id,key] of [['energy','energy'],['fatigue','fatigue'],['sleep','sleepPressure']])nodes.get('#npc-'+id+'-debug').textContent=n[key].toFixed(1);
  }
  add('#npc-panel',{classList:{contains:()=>hidden}});
  add('#open-npc',{click(){hidden=false;update('open');}});
  add('#npc-tab-character',{click(){update('character-tab');}});
  add('#npc-select',{value:'aster',dispatchEvent(){state.selectedAgentId=this.value;update('selection-change');}});
  add('#npc-nourishment',{previousElementSibling:{textContent:'Food satisfaction',title:'Appetite satisfaction, not stored energy or calorie coverage.'}});
  for(const id of ['nourishment-value','energy-debug','fatigue-debug','sleep-debug'])add('#npc-'+id);
  add('#npc-condition',{scrollIntoView(){events.push({kind:'scroll'});}});
  const context={document:{querySelector:id=>nodes.get(id)},localStorage:{getItem:()=>bytes},
    window:{__ozarkWorld:{fullSnapshot:()=>structuredClone(state),snapshot:()=>({started:false}),start(){throw Error('Must not start simulation');},step(){throw Error('Must not tick simulation');}}},
    requestAnimationFrame:callback=>queueMicrotask(()=>{events.push({kind:'animation-frame'});callback();}),Event:class{constructor(type){this.type=type;}},structuredClone};
  const present=vm.runInNewContext('('+source+')',context);
  return {state,original,bytes,events,nodes,present,expected:{actorId:'aster',elapsed:state.elapsed}};
}

for(const checked of [false,true])test(`serialized inert presenter explicitly refreshes ${checked?'enabled':'newly enabled'} diagnostics without simulation`,async()=>{
  const f=fixture({checked}),out=await f.present(f.expected);
  assert.equal(out.foodSatisfaction,'64.8 / 100');assert.equal(out.readOnly,true);
  assert.ok(f.events.some(e=>e.kind==='character-tab'&&e.checked));
  if(!checked){const enabled=f.events.findIndex(e=>e.kind==='numeric-change');assert.ok(f.events.findIndex((e,i)=>i>enabled&&e.kind==='character-tab'&&e.checked)>enabled);}
  assert.equal(f.events.filter(e=>e.kind==='animation-frame').length,2);
  assert.deepEqual(f.state,f.original);assert.equal(JSON.stringify(f.state),f.bytes);
});

test('serialized inert presenter supports water-only selection and restoring the whole-food actor',async()=>{
  const f=fixture();await f.present(f.expected);
  const water=await f.present({...f.expected,actorId:'mira'});assert.equal(water.foodSatisfaction,'0.0 / 100');assert.equal(f.state.selectedAgentId,'mira');
  const whole=await f.present(f.expected);assert.equal(whole.foodSatisfaction,'64.8 / 100');assert.deepEqual(f.state,f.original);
});

test('missing post-checkbox refresh reproduces empty inert diagnostics; frame waits are not a substitute',async()=>{
  const refresh="  // The inert native route does not run periodic panel updates. Refresh through\n  // the ordinary read-only tab event after enabling exact numeric diagnostics.\n  get('#npc-tab-character').click();\n";
  const source=presentCombinedFoodUi.toString();assert.ok(source.includes(refresh));
  const f=fixture({source:source.replace(refresh,'')});
  await assert.rejects(f.present(f.expected),/Rendered projection mismatch: actual ""; expected "64\.8 \/ 100"/);
  assert.deepEqual(f.state,f.original);
});

test('explicit refresh does not relax projection accuracy and reports actual versus expected text',async()=>{
  const f=fixture({staleProjection:true});
  await assert.rejects(f.present(f.expected),/Rendered projection mismatch: actual "99\.9 \/ 100"; expected "64\.8 \/ 100"/);
  assert.deepEqual(f.state,f.original);
});
