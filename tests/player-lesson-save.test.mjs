import test from 'node:test';
import assert from 'node:assert/strict';
import {createOzarkWorldGeometry} from '../src/ozark-world-geometry.js';
import {createOzarkState, loadOzarkSave, writeOzarkSave,
  OZARK_SAVE_KEY} from '../src/ozark-save.js';
import {createFreshPlayerLessons, learnPlayerLesson,
  validatePlayerLessons} from '../src/player-lesson-bank.js';
import {createPlayerLessonController} from '../src/player-lesson-action.js';
import {CONFIG} from '../src/config.js';

const geometry=createOzarkWorldGeometry();
const crop=value=>Array(48).fill(value);
function storage() {
  const entries=new Map();let writes=0;
  return {getItem:key=>entries.get(key)??null,
    setItem(key,value){writes++;entries.set(key,value);},writes:()=>writes};
}
function saved() {
  const disk=storage(),state=createOzarkState(geometry,{communicationSeed:211});
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  return {disk,state,bytes:disk.getItem(OZARK_SAVE_KEY)};
}

test('fresh and reset worlds hold separate empty individual banks',()=>{
  const a=createOzarkState(geometry,{communicationSeed:211});
  const b=createOzarkState(geometry,{communicationSeed:211});
  assert.equal(a.features.playerLessons,1);
  assert.deepEqual(a.playerLessons,
    createFreshPlayerLessons(a.worldLineage));
  assert.deepEqual(a.playerLessons.agents.map(row=>row.examples),[[],[]]);
  assert.notEqual(a.playerLessons.worldId,b.playerLessons.worldId);
  assert.notStrictEqual(a.playerLessons,b.playerLessons);
});

test('completed numeric examples round-trip in their own bank without action authority',()=>{
  const {disk,state}=saved();
  const owner=state.worldLineage.agents[0];
  const learned=learnPlayerLesson(state.playerLessons,{agentId:owner.agentId,
    serial:owner.serial,word:'nava',features:crop(.35)});
  state.playerLessons=learned.bank;
  const before=structuredClone(state.playerLessons);
  assert.equal(writeOzarkSave(disk,state,geometry),true);
  assert.deepEqual(state.playerLessons,before,'Saving does not update the bank');
  const raw=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
  assert.deepEqual(raw.playerLessons,before);
  assert.deepEqual(Object.keys(raw.playerLessons),['version','worldId','agents']);
  assert.deepEqual(raw.playerLessons.agents[1].examples,[]);
  assert.equal(JSON.stringify(raw.playerLessons).includes('pending'),false);
  assert.equal(JSON.stringify(raw.playerLessons).includes('object:'),false);
  const opened=loadOzarkSave(disk,geometry);
  assert.equal(opened.blocked,false,opened.error);
  assert.deepEqual(opened.state.playerLessons,before);
  assert.equal(writeOzarkSave(disk,opened.state,geometry),true);
  assert.deepEqual(JSON.parse(disk.getItem(OZARK_SAVE_KEY)).playerLessons,before);
});

test('older exact five, four and three feature saves migrate empty banks in memory only',()=>{
  for(const level of [5,4,3]){
    const {disk,state,bytes}=saved();
    const legacy=JSON.parse(bytes);
    delete legacy.features.playerLessons;
    delete legacy.playerLessons;
    if(level<=4){delete legacy.features.playerFood;delete legacy.playerFood;}
    if(level<=3){
      delete legacy.features.characterMessages;
      delete legacy.worldLineage;delete legacy.visualReference;
      delete legacy.characterMessages;
    }
    const old=JSON.stringify(legacy);
    disk.setItem(OZARK_SAVE_KEY,old);
    const beforeWrites=disk.writes();
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,false,`${level}: ${opened.error}`);
    assert.equal(disk.writes(),beforeWrites,`${level}: load must never write`);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),old,`${level}: preserve occupied bytes`);
    assert.equal(opened.state.features.playerLessons,1);
    assert.deepEqual(opened.state.playerLessons,
      createFreshPlayerLessons(opened.state.worldLineage));
    if(level>=4)assert.deepEqual(opened.state.worldLineage,state.worldLineage);
    if(level===5)assert.deepEqual(opened.state.playerFood,state.playerFood);
    assert.equal(writeOzarkSave(disk,opened.state,geometry),true,`${level}: current write`);
    assert.equal(loadOzarkSave(disk,geometry).blocked,false,`${level}: reopen`);
  }
});

test('marker and bank are both mandatory for current writes; incomplete data protects occupied bytes',()=>{
  const {disk,state,bytes}=saved();
  const raw=JSON.parse(bytes);
  const corruptions=[
    q=>{delete q.playerLessons;},
    q=>{delete q.features.playerLessons;},
    q=>{q.features.playerLessons=2;},
    q=>{q.playerLessons.version=2;},
    q=>{q.playerLessons.worldId=(q.playerLessons.worldId[0]==='f'?'e':'f')+
      q.playerLessons.worldId.slice(1);},
    q=>{q.playerLessons.agents[0].serial++;},
    q=>{q.playerLessons.agents[0].agentId='mira';},
    q=>{q.playerLessons.agents.push(structuredClone(q.playerLessons.agents[0]));},
    q=>{q.playerLessons.pending={word:'nava'};},
    q=>{q.playerLessons.agents[0].examples=[{word:'nava',features:crop(.2),objectId:'object:1'}];},
    q=>{q.playerLessons.agents[0].examples=[{word:'nava',features:crop(NaN)}];},
    q=>{q.playerLessons.agents[0].examples=[{word:'nava',features:crop(1.2)}];},
    q=>{q.playerLessons.agents[0].examples=Array.from({length:65},()=>
      ({word:'nava',features:crop(.2)}));},
  ];
  for(const [index,corrupt] of corruptions.entries()){
    const candidate=structuredClone(raw);
    corrupt(candidate);
    const changed=JSON.stringify(candidate);
    assert.notEqual(changed,bytes,`mutation ${index} must change bytes`);
    disk.setItem(OZARK_SAVE_KEY,changed);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,true,`mutation ${index} was accepted`);
    assert.equal(opened.state,null);
    assert.equal(writeOzarkSave(disk,state,geometry),false);
    assert.equal(disk.getItem(OZARK_SAVE_KEY),changed,
      `mutation ${index} must not replace occupied bytes`);
  }
});

test('a valid bank from another world cannot be copied into this save',()=>{
  const {disk,bytes}=saved();
  const other=createOzarkState(geometry,{communicationSeed:211});
  const raw=JSON.parse(bytes);
  raw.playerLessons=other.playerLessons;
  assert.throws(()=>validatePlayerLessons(raw.playerLessons,raw.worldLineage),
    /world binding/);
  const foreign=JSON.stringify(raw);
  disk.setItem(OZARK_SAVE_KEY,foreign);
  const opened=loadOzarkSave(disk,geometry);
  assert.equal(opened.blocked,true);
  assert.equal(disk.getItem(OZARK_SAVE_KEY),foreign);
});

test('a partly paid point saves no pending lesson or authority across reopen',()=>{
  const {disk,state}=saved();
  const tree=state.environment.ecology.plants.find(row=>row.kind==='apple_tree'&&
    row.stage==='ripe'&&geometry.canOccupy(row.position.x+48,row.position.y,
      CONFIG.playerRadius)&&geometry.lineOfSight(
      {x:row.position.x+48,y:row.position.y},row.position));
  assert.ok(tree,'A fixed seed has an accessible existing apple tree');
  state.player={x:tree.position.x+48,y:tree.position.y};
  state.agents[0].position={...state.player};
  const controller=createPlayerLessonController({state,geometry,
    pixelSensor:{captureVisible(){assert.fail('An incomplete point cannot crop');}},
    getLineage:()=>state.worldLineage,
    onLessons(){assert.fail('An incomplete point cannot teach');}});
  try{
    assert.equal(controller.visibleOptions().some(row=>row.targetId===tree.id),true);
    assert.equal(controller.start('nava',tree.id).ok,true);
    state.elapsed+=CONFIG.fixedStep;
    state.environment.elapsed=state.environment.ecology.elapsed=state.elapsed;
    for(const actor of state.agents)actor.elapsed=state.elapsed;
    assert.equal(controller.tickPaid(CONFIG.fixedStep),null);
    assert.ok(controller.snapshot().active.worked>0);
    assert.equal(controller.observePaidStep(),null);
    assert.equal(writeOzarkSave(disk,state,geometry),true);
    const raw=JSON.parse(disk.getItem(OZARK_SAVE_KEY));
    assert.deepEqual(raw.playerLessons.agents.map(row=>row.examples),[[],[]]);
    assert.equal(JSON.stringify(raw.playerLessons).includes('pending'),false);
    assert.equal(JSON.stringify(raw.playerLessons).includes('nava'),false);
    const opened=loadOzarkSave(disk,geometry);
    assert.equal(opened.blocked,false,opened.error);
    assert.deepEqual(opened.state.playerLessons.agents.map(row=>row.examples),[[],[]]);
    const reopened=createPlayerLessonController({state:opened.state,geometry,
      pixelSensor:{captureVisible(){assert.fail('Reopen cannot resume an old point');}},
      getLineage:()=>opened.state.worldLineage,onLessons(){assert.fail('Reopen cannot teach');}});
    assert.equal(reopened.snapshot().active,null);
    assert.equal(reopened.observePaidStep(),null);
    reopened.dispose();
  }finally{controller.dispose();}
});
