import test from 'node:test';
import assert from 'node:assert/strict';
import {drawEcologyObject,groundColor} from '../src/art.js';


test('historical ground colors keep the original default model',()=>{
  // Recorded from the reviewed base before the connected model was introduced.
  for(const [x,y,baseColor] of [
    [480,160,[99,163,107]],[-5280,3680,[168,173,108]],
    [-160,-11680,[132,158,136]],[-11840,6080,[72,121,64]],
    [-3280,-22480,[52,133,165]],
  ]){
    assert.deepEqual(groundColor(x,y),baseColor);
    assert.deepEqual(groundColor(x,y,false,0),baseColor);
    assert.deepEqual(groundColor(x,y,true),groundColor(x,y,true,0));
  }
  assert.deepEqual(groundColor(880,272,true),[154,200,147]);
  assert.notDeepEqual(groundColor(-16400,-11600,false,0),groundColor(-16400,-11600,false,1));
});



test('only projected dry vegetation uses the dry sprite palette',()=>{
  const paint=object=>{
    const colors=[];
    const g={fillStyle:'',save(){},restore(){},translate(){},scale(){},fillRect(){colors.push(this.fillStyle);}};
    drawEcologyObject(g,{kind:'grass',x:0,y:0,biomassRatio:.8,...object},0);
    return colors;
  };
  assert.ok(paint({}).includes('#85af4b'));
  assert.deepEqual(paint({}),paint({moistureRatio:1}));
  assert.ok(paint({moistureRatio:.1}).includes('#a69e58'));
  assert.ok(!paint({moistureRatio:.1}).includes('#85af4b'));
});
