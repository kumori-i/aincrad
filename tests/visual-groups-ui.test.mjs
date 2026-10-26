import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVisualGroups } from '../src/npc-panel.js';
class TextNode {
  constructor(){this.textContent='';this.children=[];this.dataset={};}
  append(node){this.children.push(node);}
  get text(){return [this.textContent,...this.children.map(n=>n.text)].join('\n');}
  set innerHTML(_){throw Error('Only literal text permitted');}
}
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const fixture=()=>({id:'aster',mode:'discovery',lifecycle:'AWAKE',scene:'valley',elapsed:4,discovery:{visualSamples:{version:1,ownerId:'aster',records:[1,2].map(id=>({objectId:`object:${id}`,scene:'valley',cues:{shape:'<img onerror=alert(1)>',color:'green',texture:'rough'},times:[1,3]}))}}});
function render(n){const old=globalThis.document;globalThis.document={createElement:()=>new TextNode()};try{const out=new TextNode();renderVisualGroups(out,n);return out;}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}}
test('visual groups UI is actor-local literal read-only uncertainty, not names or actions',()=>{
  const n=fixture(),before=structuredClone(n),out=render(freeze(n));assert.deepEqual(n,before);
  assert.match(out.text,/Tentative remembered similarity/);assert.match(out.text,/Supplied rule/);
  assert.match(out.text,/time-separated observations, not independent encounters/);
  assert.match(out.text,/<img onerror=alert\(1\)>/);assert.match(out.text,/Other properties unknown/);
  assert.match(out.text,/remembered only/);assert.match(out.text,/2 retained observations at 1, 3/);
  assert.equal(out.children.filter(x=>x.dataset.visualGroup!==undefined).length,1);
  assert.equal(render({id:'mira',elapsed:4,discovery:{}}).text.trim(),'');
});
test('rendering malformed/unsupported memory produces no similarity claim',()=>{
  const n=fixture();n.discovery.visualSamples.ownerId='mira';assert.equal(render(n).text.trim(),'');
  const one=fixture();one.discovery.visualSamples.records.pop();assert.equal(render(one).text.trim(),'');
});

test('distinct sub-centisecond support times remain distinguishable',()=>{
  const n=fixture();for(const row of n.discovery.visualSamples.records)row.times=[1,1.001];
  assert.match(render(n).text,/2 retained observations at 1, 1.001/);
});
