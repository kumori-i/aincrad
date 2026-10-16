import test from 'node:test';
import assert from 'node:assert/strict';
import {drawEcologyObject,groundColor} from '../src/art.js';
import {Renderer} from '../src/renderer.js';

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

test('renderer keys cached ground chunks by the saved ecology model',()=>{
  const original=globalThis.document;
  globalThis.document={createElement:()=>{
    const result={width:0,height:0};
    result.getContext=()=>({
      fillStyle:'',createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData(image){result.basePixels=image.data;},fillRect(){},
    });
    return result;
  }};
  try{
    const renderer=Object.create(Renderer.prototype);
    renderer.chunks=new Map();
    const oldState={environment:{ecology:{}}};
    const newState={environment:{ecology:{ecosystemModelVersion:1}}};
    assert.equal(renderer.ecologyModel(oldState),0);
    assert.equal(renderer.ecologyModel(newState),1);
    const legacy=renderer.chunk(-26,-19,renderer.ecologyModel(oldState));
    const connected=renderer.chunk(-26,-19,renderer.ecologyModel(newState));
    assert.notStrictEqual(legacy,connected);
    assert.notEqual(Buffer.compare(Buffer.from(legacy.basePixels),Buffer.from(connected.basePixels)),0);
    assert.strictEqual(renderer.chunk(-26,-19,0),legacy);
    assert.strictEqual(renderer.chunk(-26,-19,1),connected);
    assert.deepEqual([...renderer.chunks.keys()].sort(),['0:-26,-19','1:-26,-19']);
  }finally{
    if(original===undefined)delete globalThis.document;else globalThis.document=original;
  }
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
