// Noncryptographic, domain-separated deterministic streams. The nonlinear seed
// AND output mix remove the former XOR-related linear xorshift bit coupling.
// This is supplied randomness infrastructure, not a learned ability or proof
// of statistical independence. Constants/formula are fixed before diagnostics.
// fmix32 provenance: aappleby/smhasher src/MurmurHash3.cpp (public-domain code).
export const REFERENCE_RANDOM_PURPOSES=Object.freeze({pair:1,target:2,order:3,choice:4,symbols:5});
export const REFERENCE_RANDOM_PROTOCOL='weyl-fmix32-v1';
const WEYL=0x9e3779b9;
const uint32=v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff;
function fmix32(h){
  h^=h>>>16;h=Math.imul(h,0x85ebca6b);
  h^=h>>>13;h=Math.imul(h,0xc2b2ae35);
  h^=h>>>16;return h>>>0;
}
export function createReferenceRandomStream({seed,purpose,identity=0}={}){
  if(!uint32(seed)||!uint32(identity)||typeof purpose!=='string'||!Object.hasOwn(REFERENCE_RANDOM_PURPOSES,purpose))
    throw new TypeError('Expected uint32 seed/identity and a fixed reference purpose');
  let state=fmix32(seed^fmix32(REFERENCE_RANDOM_PURPOSES[purpose])^fmix32(identity^WEYL));
  // Odd increment visits every uint32 state; zero needs no exceptional fallback.
  return ()=>{state=(state+WEYL)>>>0;return fmix32(state)/4294967296;};
}

export function createReferenceSymbolInventory({seed,identity=0}={}){
  const random=createReferenceRandomStream({seed,purpose:'symbols',identity});
  const inventory=Array.from({length:64},(_,i)=>i);
  for(let i=inventory.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[inventory[i],inventory[j]]=[inventory[j],inventory[i]];}
  return Object.freeze(inventory);
}
