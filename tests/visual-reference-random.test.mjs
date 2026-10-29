import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceRandomStream as stream,createReferenceSymbolInventory as inventory,REFERENCE_RANDOM_PURPOSES,REFERENCE_RANDOM_PROTOCOL} from '../src/visual-reference-random.js';
import {createVisualReferenceMemory} from '../src/visual-reference-memory.js';

// Declared before executing these guards: 4096 consecutive seeds plus these
// five boundary/high-bit values, 64 rounds. No outcome-based seed/mixer tuning.
const SEEDS=[...Array.from({length:4096},(_,i)=>i),0x80000000,0x7fffffff,0xffffffff,0xdeadbeef,0x12345678];
const ROUNDS=64,JOINT=[.15,.35],MARGINAL=[.35,.65];
const take=(random,n=128)=>Array.from({length:n},()=>random());
const bounded=(value,total,bounds,label)=>assert(value/total>=bounds[0]&&value/total<=bounds[1],`${label}: ${value}/${total}`);

test('fixed nonlinear reference streams reproduce uint32 boundaries without absorbing zero or shared consumption',()=>{
  assert.equal(REFERENCE_RANDOM_PROTOCOL,'weyl-fmix32-v1');
  for(const seed of [0,1,211,0x80000000,0xffffffff]){
    for(const purpose of Object.keys(REFERENCE_RANDOM_PURPOSES)){
      const expected=take(stream({seed,purpose})),actual=stream({seed,purpose});
      assert.equal(new Set(expected).size,expected.length);
      assert(expected.every(v=>v>=0&&v<1));
      for(const other of Object.keys(REFERENCE_RANDOM_PURPOSES))if(other!==purpose)take(stream({seed,purpose:other}),257);
      inventory({seed,identity:1});inventory({seed,identity:2});
      assert.deepEqual(take(actual),expected,'Other purposes and inventories cannot advance this stream');
    }
  }
  for(const bad of [-1,2**32,.5,NaN,Infinity,undefined]){
    assert.throws(()=>stream({seed:bad,purpose:'target'}),TypeError);
    if(bad!==undefined)assert.throws(()=>stream({seed:1,purpose:'target',identity:bad}),TypeError);
  }
  for(const purpose of ['other','__proto__',{},null,undefined])assert.throws(()=>stream({seed:1,purpose}),TypeError);
});

test('predeclared seed-grid counterbalances target/order jointly at each round, not only marginally',()=>{
  const counts=Array.from({length:ROUNDS},()=>({joint:[0,0,0,0],target:[0,0],order:[0,0],orderedTarget:[0,0]}));
  for(const seed of SEEDS){
    const target=stream({seed,purpose:'target'}),order=stream({seed,purpose:'order'});
    for(const row of counts){const t=Math.floor(target()*2),o=Math.floor(order()*2);row.joint[t*2+o]++;row.target[t]++;row.order[o]++;row.orderedTarget[t^o]++;}
  }
  for(let round=0;round<counts.length;round++){
    const row=counts[round];
    row.joint.forEach((n,i)=>bounded(n,SEEDS.length,JOINT,`round ${round} joint ${i}`));
    for(const key of ['target','order','orderedTarget'])row[key].forEach((n,i)=>bounded(n,SEEDS.length,MARGINAL,`round ${round} ${key} ${i}`));
  }
  // Negative-control algebra: the retired XOR-seeded linear generator fails
  // this exact ordered-position guard, despite individually uniform margins.
  const old=seed=>{let v=seed>>>0||1;return()=>{v^=v<<13;v^=v>>>17;v^=v<<5;return(v>>>0)/4294967296;};};
  const positions=new Set(SEEDS.map(seed=>Math.floor(old(seed^0x156a9)()*2)^Math.floor(old(seed^0x77112)()*2)));
  assert.equal(positions.size,1,'Regression must expose the original structural defect');
});

test('predeclared inventories are permutations with bounded first-position frequencies across actor identities',()=>{
  const counts=[Array(64).fill(0),Array(64).fill(0)];let equal=0;
  for(let seed=0;seed<4096;seed++){
    const rows=[1,2].map(identity=>inventory({seed,identity}));
    for(let i=0;i<2;i++){
      assert.equal(rows[i].length,64);assert.deepEqual([...rows[i]].sort((a,b)=>a-b),Array.from({length:64},(_,j)=>j));
      counts[i][rows[i][0]]++;
    }
    if(rows[0][0]===rows[1][0])equal++;
  }
  for(const row of counts)for(const n of row)assert(n>=8&&n<=192,`First-position frequency ${n}/4096`);
  bounded(equal,4096,[.001,.08],'Cross-identity first-position equality');
  // These broad checks do not establish independence of all permutation slots.
});

test('memory uses the same purpose and actor-identity inventory without preflight or snapshot consumption',()=>{
  for(const identity of [1,2]){
    const expected=inventory({seed:211,identity}),a=createVisualReferenceMemory({symbolSeed:211,symbolIdentity:identity});
    const pair=[Array(48).fill(0),Array(48).fill(.5)];
    for(let i=0;i<20;i++){a.planPair(pair);a.snapshot();take(stream({seed:211,purpose:'choice'}),31);}
    assert.deepEqual(a.commitPair(a.planPair(pair).plan).symbols,expected.slice(0,2));
  }
});

// Independent arbitrary-precision uint32 arithmetic, not self-comparison.
test('fixed formula agrees with independent BigInt arithmetic vectors',()=>{
  const mask=0xffffffffn,step=0x9e3779b9n;
  const mix=input=>{let x=input&mask;x^=x>>16n;x=(x*0x85ebca6bn)&mask;x^=x>>13n;x=(x*0xc2b2ae35n)&mask;return (x^(x>>16n))&mask;};
  for(const seed of [0,211,0xffffffff])for(const [purpose,code] of Object.entries(REFERENCE_RANDOM_PURPOSES))for(const identity of [0,1,2,0xffffffff]){
    let state=mix(BigInt(seed)^mix(BigInt(code))^mix(BigInt(identity)^step));
    const actual=stream({seed,purpose,identity});
    for(let draw=0;draw<64;draw++){state=(state+step)&mask;assert.equal(actual()*4294967296,Number(mix(state)),`${seed}/${purpose}/${identity}/${draw}`);}
  }
});
