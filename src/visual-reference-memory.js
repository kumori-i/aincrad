// Supplied retained-exemplar association rules, not learned visual abstractions.
// The owner supplies ONLY its own observed features. Canonical demonstration
// authority belongs to the attachment; this module knows no object IDs or critic.
import {createReferenceSymbolInventory} from './visual-reference-random.js';
export const VISUAL_REFERENCE_MEMORY_LIMITS=Object.freeze({features:48,anchors:16,symbols:64,examples:4,match:.04,margin:.02,novel:.08});
const L=VISUAL_REFERENCE_MEMORY_LIMITS;
function features(value){
  if(!Array.isArray(value)||value.length!==L.features)return null;
  const copy=Array.from(value);
  return copy.every(v=>Number.isFinite(v)&&v>=0&&v<=1)?Object.freeze(copy):null;
}
function pair(value){if(!Array.isArray(value)||value.length!==2)return null;const copied=Array.from(value,features);return copied.every(Boolean)?copied:null;}
function distance(a,b){let sum=0;for(let i=0;i<L.features;i++)sum+=(a[i]-b[i])**2;return Math.sqrt(sum/L.features);}
function unique(distances){
  const matching=distances.map((d,i)=>d<=L.match?i:-1).filter(i=>i>=0);
  if(matching.length!==1)return null;
  const index=matching[0],runner=Math.min(...distances.filter((_,i)=>i!==index));
  return runner>=distances[index]+L.margin?index:null;
}
function token(value){return !!value&&typeof value==='object';}
function symbol(value){return Number.isInteger(value)&&value>=0&&value<L.symbols;}
function exactKeys(value,keys){return token(value)&&!Array.isArray(value)&&
  Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function serial(value){return Number.isInteger(value)&&value>=1&&value<=0xffffffff;}
function peer(value){return exactKeys(value,['agentId','serial'])&&
  typeof value.agentId==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value.agentId)&&serial(value.serial);}
const increment=value=>Math.min(Number.MAX_SAFE_INTEGER,value+1);

export function createVisualReferenceMemory({symbolSeed=1,symbolIdentity=0}={}){
  if(!Number.isInteger(symbolSeed)||symbolSeed<0||symbolSeed>0xffffffff)throw new TypeError('Expected uint32 symbol seed');
  const inventory=createReferenceSymbolInventory({seed:symbolSeed,identity:symbolIdentity}),anchors=[],plans=new WeakMap(),partners=new Map();
  let allowed=new Set(),revision=0,restored=false;
  function planPair(input){
    const own=pair(input);if(!own)return {ok:false,reason:'invalid-features'};
    const prospective=anchors.slice(),assigned=[];
    for(const f of own){
      const distances=prospective.map(a=>distance(f,a.features)),match=unique(distances);
      if(match!==null){assigned.push(prospective[match].symbol);continue;}
      if(distances.some(d=>d<=L.novel))return {ok:false,reason:'ambiguous-anchor'};
      if(prospective.length>=L.anchors)return {ok:false,reason:'anchor-capacity'};
      const anchor=Object.freeze({symbol:inventory[prospective.length],features:f});
      prospective.push(anchor);assigned.push(anchor.symbol);
    }
    if(assigned[0]===assigned[1])return {ok:false,reason:'same-symbol'};
    // Prospective additions must not destroy either earlier unique match.
    for(let i=0;i<own.length;i++){
      const match=unique(prospective.map(a=>distance(own[i],a.features)));
      if(match===null||prospective[match].symbol!==assigned[i])return {ok:false,reason:'ambiguous-prospective-anchor'};
    }
    const plan=Object.freeze({});
    plans.set(plan,{revision,additions:prospective.slice(anchors.length),symbols:Object.freeze(assigned.slice())});
    return {ok:true,reason:'feasible',plan};
  }
  function commitPair(plan){
    const record=token(plan)?plans.get(plan):null;
    if(!record)return {ok:false,reason:'unknown-plan'};
    plans.delete(plan); // Failed/stale attempts consume authority too.
    if(record.revision!==revision)return {ok:false,reason:'stale-plan'};
    anchors.push(...record.additions);revision++;
    return {ok:true,reason:'committed',symbols:record.symbols.slice(),allocated:record.additions.length};
  }
  function reconcilePartners(current){
    const next=new Set(current);
    if([...next].some(p=>!token(p)))throw new TypeError('Current partner identities must be opaque objects');
    for(const p of partners.keys())if(!next.has(p))partners.delete(p);
    allowed=next;
  }
  function retirePartner(partner){allowed.delete(partner);return partners.delete(partner);}
  function choose(partner,message,input){
    const own=pair(input);
    if(!own||!symbol(message))return {index:null,reason:'invalid-input',distances:[]};
    if(!allowed.has(partner))return {index:null,reason:'unknown-partner',distances:[]};
    const entry=partners.get(partner)?.get(message);
    if(!entry)return {index:null,reason:'unknown-symbol',distances:[]};
    if(entry.conflicted)return {index:null,reason:'conflicted',distances:[]};
    const distances=own.map(f=>Math.min(...entry.examples.map(e=>distance(f,e))));
    const index=unique(distances);
    return {index,reason:index===null?'ambiguous':'unique-match',distances};
  }
  function observe(partner,message,input){
    const own=features(input);
    const result=(outcome,added=false,support=false,conflicted=false)=>({outcome,added,support,conflicted});
    if(!own||!symbol(message))return result('invalid-input');
    if(!allowed.has(partner))return result('unknown-partner');
    let entries=partners.get(partner),entry=entries?.get(message);
    if(entry?.conflicted)return result('already-conflicted',false,false,true);
    if(!entry){
      if(!entries){entries=new Map();partners.set(partner,entries);}
      entries.set(message,{examples:[own],support:1,conflicted:false});
      return result('new-exemplar',true);
    }
    const distances=entry.examples.map(e=>distance(own,e));
    if(distances.some(d=>d<=L.match)){entry.support=increment(entry.support);return result('support',false,true);}
    if(distances.some(d=>d<=L.novel))return result('gray-zone');
    if(entry.examples.length>=L.examples){entry.conflicted=true;return result('capacity-conflict',false,false,true);}
    entry.examples.push(own);entry.support=increment(entry.support);return result('new-exemplar',true);
  }
  function snapshot(){
    // Diagnostic slots have no semantic meaning; no live partner token escapes.
    const rows=[...partners.values()].map((entries,slot)=>({slot,entries:[...entries].map(([symbol,e])=>({symbol,examples:e.examples.map(f=>f.slice()),support:e.support,conflicted:e.conflicted}))}));
    return {anchors:anchors.map(a=>({symbol:a.symbol,features:a.features.slice()})),partners:rows,
      counts:{anchors:anchors.length,partners:rows.length,entries:rows.reduce((n,p)=>n+p.entries.length,0),examples:rows.reduce((n,p)=>n+p.entries.reduce((m,e)=>m+e.examples.length,0),0),conflicts:rows.reduce((n,p)=>n+p.entries.filter(e=>e.conflicted).length,0)}};
  }
  function exportPersistence(describePartner){
    if(typeof describePartner!=='function')throw new TypeError('A partner identity reader is required');
    const seen=new Set(),rows=[];
    for(const [partner,entries]of partners){
      const identity=describePartner(partner);
      if(!peer(identity)||seen.has(`${identity.agentId}:${identity.serial}`))throw new TypeError('Unbound reference partner');
      seen.add(`${identity.agentId}:${identity.serial}`);
      rows.push({agentId:identity.agentId,serial:identity.serial,entries:[...entries].map(([message,e])=>
        ({symbol:message,examples:e.examples.map(example=>example.slice()),support:e.support,conflicted:e.conflicted}))});
    }
    return {anchors:anchors.map(anchor=>({symbol:anchor.symbol,features:anchor.features.slice()})),partners:rows};
  }
  function restorePersistence(data,resolvePartner){
    if(restored||anchors.length||partners.size||typeof resolvePartner!=='function'||
        !exactKeys(data,['anchors','partners'])||!Array.isArray(data.anchors)||
        !Array.isArray(data.partners)||data.anchors.length>L.anchors||data.partners.length>L.symbols)
      throw new TypeError('Invalid reference memory restoration');
    const importedAnchors=[],importedPartners=new Map(),seenPeers=new Set();
    for(const [index,row]of data.anchors.entries()){
      const own=exactKeys(row,['symbol','features'])?features(row.features):null;
      if(!own||row.symbol!==inventory[index]||importedAnchors.some(a=>distance(a.features,own)<=L.novel))
        throw new TypeError('Invalid reference anchors');
      importedAnchors.push(Object.freeze({symbol:row.symbol,features:own}));
    }
    if(importedAnchors.length===1)throw new TypeError('A single reference anchor cannot be committed');
    for(const row of data.partners){
      if(!exactKeys(row,['agentId','serial','entries'])||!peer({agentId:row.agentId,serial:row.serial})||
          !Array.isArray(row.entries)||row.entries.length<1||row.entries.length>L.symbols)
        throw new TypeError('Invalid reference partner');
      const key=`${row.agentId}:${row.serial}`;
      if(seenPeers.has(key))throw new TypeError('Duplicate reference partner');
      seenPeers.add(key);
      const partner=resolvePartner(row.agentId,row.serial);
      if(!token(partner)||!allowed.has(partner)||importedPartners.has(partner))
        throw new TypeError('Unknown reference partner');
      const entries=new Map();
      for(const entry of row.entries){
        if(!exactKeys(entry,['symbol','examples','support','conflicted'])||!symbol(entry.symbol)||
            entries.has(entry.symbol)||!Array.isArray(entry.examples)||entry.examples.length<1||
            entry.examples.length>L.examples||!Number.isSafeInteger(entry.support)||
            entry.support<entry.examples.length||typeof entry.conflicted!=='boolean'||
            entry.conflicted&&entry.examples.length!==L.examples)
          throw new TypeError('Invalid reference evidence');
        const examples=[];
        for(const raw of entry.examples){
          const own=features(raw);
          if(!own||examples.some(example=>distance(example,own)<=L.novel))
            throw new TypeError('Invalid reference exemplar');
          examples.push(own);
        }
        entries.set(entry.symbol,{examples,support:entry.support,conflicted:entry.conflicted});
      }
      importedPartners.set(partner,entries);
    }
    anchors.push(...importedAnchors);
    for(const [partner,entries]of importedPartners)partners.set(partner,entries);
    revision++;restored=true; // Plans created before restoration cannot commit later.
  }
  return Object.freeze({planPair,commitPair,reconcilePartners,choose,observe,retirePartner,snapshot,
    exportPersistence,restorePersistence});
}
