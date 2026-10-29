// Strict data-only schema for each individual's private visual associations.
// World/actor lineage lives outside the learner section, then is repeated by
// the learner and every partner link. Neither identity is a learner feature.
import { createReferenceSymbolInventory, initialReferenceRandomStates, REFERENCE_RANDOM_PROTOCOL } from './visual-reference-random.js';
import { VISUAL_REFERENCE_MEMORY_LIMITS } from './visual-reference-memory.js';

const IDS=Object.freeze(['aster','mira']);
const UINT32=0xffffffff;
const NEXT_SERIAL_LIMIT=0x100000000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exact=(value,keys)=>plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const exactArray=value=>Array.isArray(value)&&Reflect.ownKeys(value).length===value.length+1&&
  Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const uint32=value=>integer(value,0,UINT32);
const invalid=reason=>{throw new TypeError(`Invalid visual reference persistence: ${reason}`);};
const sameId=(value,id)=>value?.agentId===id;
const distance=(a,b)=>Math.sqrt(a.reduce((sum,value,index)=>sum+(value-b[index])**2,0)/a.length);

function copyFeatures(value){
  if(!exactArray(value)||value.length!==VISUAL_REFERENCE_MEMORY_LIMITS.features||
    value.some(v=>!Number.isFinite(v)||v<0||v>1))invalid('feature vector');
  return value.slice();
}

export function createFreshReferencePersistence(seed=211){
  if(!uint32(seed))invalid('symbol seed');
  // getRandomValues is available for the sandboxed desktop asset origin even
  // where randomUUID is restricted to secure contexts. This never uses a
  // policy or communication stream.
  if(typeof globalThis.crypto?.getRandomValues!=='function')invalid('secure world identity unavailable');
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0'));
  const instanceId=`${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
  if(!UUID.test(instanceId))invalid('generated world identity');
  const agents=IDS.map((agentId,index)=>({agentId,serial:index+1}));
  return {worldLineage:{version:1,instanceId,nextSerial:3,agents},
    visualReference:{version:1,worldId:instanceId,protocol:REFERENCE_RANDOM_PROTOCOL,seed,random:initialReferenceRandomStates(seed),
      learners:agents.map(({agentId,serial})=>({agentId,serial,anchors:[],partners:[]}))}};
}

export function validateReferencePersistence(worldLineage,visualReference){
  if(!exact(worldLineage,['version','instanceId','nextSerial','agents'])||worldLineage.version!==1||
    typeof worldLineage.instanceId!=='string'||!UUID.test(worldLineage.instanceId)||
    !integer(worldLineage.nextSerial,3,NEXT_SERIAL_LIMIT)||
    !exactArray(worldLineage.agents)||worldLineage.agents.length!==IDS.length)invalid('world lineage');
  const agents=worldLineage.agents.map((row,index)=>{
    if(!exact(row,['agentId','serial'])||!sameId(row,IDS[index])||!integer(row.serial,1,UINT32)||
      row.serial>=worldLineage.nextSerial)invalid('actor incarnation');
    return {agentId:row.agentId,serial:row.serial};
  });
  if(agents[0].serial===agents[1].serial)invalid('duplicate actor incarnation');
  if(!exact(visualReference,['version','worldId','protocol','seed','random','learners'])||
    visualReference.version!==1||visualReference.worldId!==worldLineage.instanceId||
    visualReference.protocol!==REFERENCE_RANDOM_PROTOCOL||
    !uint32(visualReference.seed)||
    !exact(visualReference.random,['pair','target','order','choice'])||
    ['pair','target','order','choice'].some(key=>!uint32(visualReference.random[key]))||
    !exactArray(visualReference.learners)||visualReference.learners.length!==IDS.length)
    invalid('learner section or world binding');
  const anchorSymbols=new Map();
  const learners=visualReference.learners.map((row,index)=>{
    const actor=agents[index];
    if(!exact(row,['agentId','serial','anchors','partners'])||!sameId(row,actor.agentId)||
      row.serial!==actor.serial||!exactArray(row.anchors)||
      row.anchors.length===1||
      row.anchors.length>VISUAL_REFERENCE_MEMORY_LIMITS.anchors||
      !exactArray(row.partners)||row.partners.length>IDS.length-1)invalid('learner owner');
    const inventory=createReferenceSymbolInventory({seed:visualReference.seed,identity:actor.serial});
    const anchors=row.anchors.map((anchor,i)=>{
      if(!exact(anchor,['symbol','features'])||!integer(anchor.symbol,0,VISUAL_REFERENCE_MEMORY_LIMITS.symbols-1)||
        anchor.symbol!==inventory[i])invalid('assigned symbol inventory');
      return {symbol:anchor.symbol,features:copyFeatures(anchor.features)};
    });
    for(let i=0;i<anchors.length;i++)for(let j=0;j<i;j++)
      if(distance(anchors[i].features,anchors[j].features)<=VISUAL_REFERENCE_MEMORY_LIMITS.novel)
        invalid('ambiguous retained anchors');
    anchorSymbols.set(actor.agentId,new Set(anchors.map(anchor=>anchor.symbol)));
    return {agentId:actor.agentId,serial:actor.serial,anchors,partners:row.partners};
  });
  const normalized=learners.map(row=>{
    const partners=row.partners.map(partner=>{
      if(!exact(partner,['agentId','serial','entries'])||partner.agentId===row.agentId||
        !IDS.includes(partner.agentId)||partner.serial!==agents.find(a=>a.agentId===partner.agentId)?.serial||
        !exactArray(partner.entries)||partner.entries.length<1||
        partner.entries.length>VISUAL_REFERENCE_MEMORY_LIMITS.anchors)invalid('partner incarnation or entries');
      const symbols=new Set();
      const entries=partner.entries.map(entry=>{
        if(!exact(entry,['symbol','examples','support','conflicted'])||
          !integer(entry.symbol,0,VISUAL_REFERENCE_MEMORY_LIMITS.symbols-1)||symbols.has(entry.symbol)||
          !anchorSymbols.get(partner.agentId).has(entry.symbol)||
          !exactArray(entry.examples)||entry.examples.length<1||
          entry.examples.length>VISUAL_REFERENCE_MEMORY_LIMITS.examples||
          !integer(entry.support,entry.examples.length,Number.MAX_SAFE_INTEGER)||
          typeof entry.conflicted!=='boolean'||
          entry.conflicted&&entry.examples.length!==VISUAL_REFERENCE_MEMORY_LIMITS.examples)
          invalid('partner symbol evidence');
        symbols.add(entry.symbol);
        const examples=entry.examples.map(copyFeatures);
        for(let i=0;i<examples.length;i++)for(let j=0;j<i;j++)
          if(distance(examples[i],examples[j])<=VISUAL_REFERENCE_MEMORY_LIMITS.novel)
            invalid('ambiguous partner examples');
        return {symbol:entry.symbol,examples,support:entry.support,conflicted:entry.conflicted};
      });
      return {agentId:partner.agentId,serial:partner.serial,entries};
    });
    if(new Set(partners.map(partner=>partner.agentId)).size!==partners.length)invalid('duplicate partner');
    return {agentId:row.agentId,serial:row.serial,anchors:row.anchors,partners};
  });
  return {worldLineage:{version:1,instanceId:worldLineage.instanceId,nextSerial:worldLineage.nextSerial,agents},
    visualReference:{version:1,worldId:visualReference.worldId,protocol:visualReference.protocol,seed:visualReference.seed,
      random:{pair:visualReference.random.pair,target:visualReference.random.target,
        order:visualReference.random.order,choice:visualReference.random.choice},learners:normalized}};
}
