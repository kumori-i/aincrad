import test from 'node:test';
import assert from 'node:assert/strict';
import {groundColor, makeGroundChunk} from '../src/art.js';
import {habitatConditions} from '../src/ecology-regions.js';
import {terrain} from '../src/world.js';

const habitats=[
  {kind:'dry_meadow',type:'meadow',x:-5280,y:3680,motif:'#bdb77b'},
  {kind:'cool_upland',type:'meadow',x:-160,y:-11680,motif:'#526f68'},
  {kind:'riparian',type:'meadow',x:480,y:160,motif:'#3f8055'},
  {kind:'woodland',type:'forest',x:-11840,y:6080,motif:'#345c32'},
];

test('whole-valley atlas distinguishes the four existing habitats with map-scale texture',()=>{
  const signatures=new Set();
  for(const site of habitats){
    assert.equal(terrain(site.x,site.y),site.type);
    assert.equal(habitatConditions(site).kind,site.kind);
    signatures.add(groundColor(site.x,site.y,true).join(','));
    let sameHabitat=0,marked=0;
    for(let dy=-480;dy<=480;dy+=16)for(let dx=-480;dx<=480;dx+=16){
      const x=site.x+dx,y=site.y+dy;
      if(terrain(x,y)!==site.type||habitatConditions({x,y}).kind!==site.kind)continue;
      sameHabitat++;
      if(groundColor(x,y,true).join(',')!==groundColor(x,y).join(','))marked++;
    }
    assert.ok(sameHabitat>=800,`${site.kind} sample includes a visible land area`);
    assert.ok(marked>=8,`${site.kind} has atlas marks beyond its ground palette`);
    assert.ok(marked/sameHabitat<.08,`${site.kind} atlas marks must be sparse, not whole colored cells`);
  }
  assert.equal(signatures.size,habitats.length);
});

test('water, shore, trail, bridge and scree keep their own map priority',()=>{
  for(const [type,x,y] of [
    ['water',-3280,-22480],['shallows',-3320,-22480],['shore',-3400,-22480],
    ['trail',7160,-22480],['bridge',-1800,-12640],['scree',-12120,-22480],
  ]){
    assert.equal(terrain(x,y),type);
    assert.deepEqual(groundColor(x,y,true),groundColor(x,y),`${type} must not acquire land-habitat marks`);
  }
});

test('ground chunks render distinct dry grass, upland stone, wet reeds and woodland undergrowth',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>{
    const out={width:0,height:0};
    const g={colors:new Map(),fillStyle:'',createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
      putImageData(image){out.basePixels=image.data;},
      fillRect(){this.colors.set(this.fillStyle,(this.colors.get(this.fillStyle)||0)+1);}};
    out.getContext=()=>g;out.context=g;return out;
  }};
  try{
    for(const site of habitats){
      const chunk=makeGroundChunk(Math.floor(site.x/640),Math.floor(site.y/640),640);
      assert.equal(chunk.width,320);assert.equal(chunk.height,320);
      assert.equal(chunk.basePixels.length,320*320*4);
      assert.ok((chunk.context.colors.get(site.motif)||0)>=20,`${site.kind} motif is drawn repeatedly on the ground`);
    }
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
