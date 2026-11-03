import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePlayerLessonOptions} from '../src/player-lesson-options.js';

function pickerFixture() {
  const picker={options:[],value:'',mutations:0};
  picker.ownerDocument={createElement(){return {value:'',textContent:'',remove(){
    picker.options.splice(picker.options.indexOf(this),1);picker.mutations++;
  }};}};
  picker.insertBefore=(option,before)=>{
    const old=picker.options.indexOf(option);if(old>=0)picker.options.splice(old,1);
    picker.options.splice(before?picker.options.indexOf(before):picker.options.length,0,option);
    picker.mutations++;
  };
  return picker;
}
const row=(id='object:671',distance=48,details='ripe')=>({targetId:id,distance,appearance:{details}});

test('picker updates same-source labels in place without changing native selection',()=>{
  const picker=pickerFixture();reconcilePlayerLessonOptions(picker,[row()]);
  picker.value='object:671';const option=picker.options[1],mutations=picker.mutations;
  reconcilePlayerLessonOptions(picker,[row('object:671',240,'bare')]);
  assert.equal(picker.options[1],option);assert.equal(option.textContent,'Bare · 240 away');
  assert.equal(picker.value,'object:671');assert.equal(picker.mutations,mutations);
  reconcilePlayerLessonOptions(picker,[row('object:671',240,'bare')]);
  assert.equal(picker.mutations,mutations);
});
test('picker preserves surviving option identity and retires only removed physical selections',()=>{
  const picker=pickerFixture();reconcilePlayerLessonOptions(picker,[row(),row('object:677')]);
  picker.value='object:671';const option=picker.options[1];
  reconcilePlayerLessonOptions(picker,[row('object:677'),row()]);
  assert.equal(picker.options[2],option);assert.equal(picker.value,'object:671');
  reconcilePlayerLessonOptions(picker,[row('object:677')]);
  assert.equal(picker.value,'');assert.equal(picker.options.length,2);
  reconcilePlayerLessonOptions(picker,[]);
  assert.equal(picker.options.length,1);assert.equal(picker.options[0].textContent,'No visible source nearby');
});

test('real HUD refresh retains picker options during native focus transitions and paid work',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const source=await readFile(new URL('../src/ozark-world-main.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function updatePlayerLessonControls() {'),
    source.indexOf('function startPlayerLesson() {'));
  const picker=pickerFixture(),word={value:'nava'},say={},panel={classList:{contains:()=>true}};
  const elements={'player-lesson-target':picker,'player-lesson-word':word,'player-lesson-say':say,'npc-panel':panel};
  let active=null;
  const context={$:id=>elements[id],foodControlsAvailable:(requireFocus=true)=>!requireFocus||context.windowFocused,
    playerLessonController:{snapshot:()=>({active}),visibleOptions:()=>[row()]},
    playerFoodController:{snapshot:()=>({active:null})},reconcilePlayerLessonOptions,
    windowFocused:true,started:true,paused:false,panel:null,resetHeld:false,resetRetired:false,
    loaded:{blocked:false},referenceFixtureOwner:null,text:()=>{}};
  runInNewContext(body+';this.refresh=updatePlayerLessonControls;',context);
  context.refresh();picker.value='object:671';const option=picker.options[1];
  context.windowFocused=false;context.refresh();
  assert.equal(picker.value,'object:671');assert.equal(picker.options[1],option);
  assert.equal(picker.disabled,false,'Native popup focus must not disable its own select');
  assert.equal(say.disabled,true,'An unfocused window still cannot start paid work');
  context.windowFocused=true;context.refresh();assert.equal(say.disabled,false);
  active={seconds:1.8,worked:.5};context.refresh();
  assert.equal(picker.disabled,true);assert.equal(picker.value,'object:671');
  assert.equal(picker.options[1],option);
});
