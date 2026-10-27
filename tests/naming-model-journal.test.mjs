import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNpc} from '../src/npc-state.js';
import {rememberDiscoveryObservation} from '../src/discovery.js';
import {decisionObservation} from '../src/controller.js';
import {namingProposal,beginNamingProposal,acceptNamingProposal} from '../src/category-names.js';
const {validateObservation,ModelService,parseDecision}=createRequire(import.meta.url)('../desktop/model-provider.cjs');
const cues={shape:'tuft with narrow blades',color:'green',texture:'fibrous'};
const physical=n=>structuredClone({effects:n.discovery.effects,experiments:n.discovery.experiments,techniques:n.discovery.techniques,inventory:n.inventory,physiology:n.physiology});
function fixture(){
  const n=createNpc({mode:'discovery'});
  const sample=(at,appearance=cues)=>{n.elapsed=at;rememberDiscoveryObservation(n,[675,669,672].map(id=>({id:`object:${id}`,appearance,scene:n.scene,position:{...n.position},observedAt:at})),{visualSample:true});};
  sample(0);sample(1);
  const request=namingProposal(n);assert.ok(request);assert.equal(beginNamingProposal(n,request),true);
  assert.equal(acceptNamingProposal(n,request,{token:'velari',model:'scripted-journal-naming-mock'}),true);
  return {n,sample};
}

test('model journal context projects current personal names for supplied observations without rewriting earlier evidence',()=>{
  const {n,sample}=fixture(),before=physical(n),lexicon=structuredClone(n.categoryNames);
  const input=decisionObservation(n);
  assert.deepEqual(input.objectNames.map(r=>r.objectId).sort(),['object:669','object:672','object:675']);
  for(const row of input.objectNames)assert.deepEqual(row,{objectId:row.objectId,token:'velari',speakerId:'aster',source:'model-category',at:1});
  const accepted=validateObservation(input);assert.deepEqual(accepted.objectNames,input.objectNames);
  accepted.objectNames[0].token='changed';assert.equal(input.objectNames[0].token,'velari','model view is detached');
  assert.deepEqual(physical(n),before);assert.deepEqual(n.categoryNames,lexicon);
  delete n.discovery.observations['object:675'];assert.equal(decisionObservation(n).objectNames.some(r=>r.objectId==='object:675'),false,'no name for an omitted observed instance');
  sample(2,{...cues,color:'brown'});assert.deepEqual(decisionObservation(n).objectNames,[],'changed cues retract the current projected name');
});

test('scripted HTTP journal request receives current names, precise identities and uncertainty instructions, not extra action permission',async()=>{
  const {n}=fixture(),before=physical(n);let sent;
  const service=new ModelService({config:{enabled:true,model:'scripted-journal-mock'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({action:{type:'journal_reply',text:'I call these velari (object:675, object:669, object:672); appearance alone is uncertain.'}})}}]}));}});
  const result=await service.decide(decisionObservation(n));assert.equal(result.action.type,'journal_reply');
  const received=JSON.parse(sent.messages[1].content);assert.equal(received.objectNames.length,3);assert.equal(received.objectNames[0].token,'velari');
  assert.match(sent.messages[0].content,/use that supplied word with its exact objectId/);
  assert.match(sent.messages[0].content,/not retroactive evidence/);assert.match(sent.messages[0].content,/transfers no food benefit, safety, experience or action authority/);
  assert.match(sent.messages[0].content,/Do not invent missing names/);assert.deepEqual(physical(n),before);
  assert.throws(()=>parseDecision(JSON.stringify({action:{type:'sample',targetId:'object:675'}}),{mode:'discovery'}),/human-journal/);
});

test('optional journal name context is backward-compatible but rejects unknown objects, mixed identities, hidden fields and malformed rows',()=>{
  const {n}=fixture(),good=decisionObservation(n),old=structuredClone(good);delete old.objectNames;
  assert.equal(Object.hasOwn(validateObservation(old),'objectNames'),false);
  for(const mutate of [
    x=>x.objectNames=null,x=>x.objectNames=Array(41).fill(x.objectNames[0]),x=>x.objectNames.push({...x.objectNames[0]}),
    x=>x.objectNames[0].objectId='object:999999',x=>x.objectNames[0].objectId='object:0',x=>x.objectNames[0].token='two words',
    x=>x.objectNames[0].token='constructor',x=>x.objectNames[0].token='x'.repeat(17),x=>x.objectNames[0].speakerId='human',
    x=>x.objectNames[0].speakerId='mira',x=>x.objectNames[0].source='heard-category',x=>x.objectNames[0].source='verified-species',
    x=>x.objectNames[0].at=2,x=>x.objectNames[0].at=-1,x=>x.objectNames[0].at=Infinity,x=>delete x.objectNames[0].at,
    x=>x.objectNames[0].species='hidden',x=>x.objectNames[0].safe=true,x=>x.objectNames[0].action={type:'sample'},
    x=>x.objectNames[0].model='unrequested',x=>x.objectNames[0].cues=cues,x=>delete x.observedAt,
  ]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateObservation(bad));}
  const heard=structuredClone(good);heard.objectNames[0].speakerId='mira';heard.objectNames[0].source='heard-category';assert.deepEqual(validateObservation(heard).objectNames,heard.objectNames);
  const individual=structuredClone(good);individual.objectNames[0].source='individual';assert.deepEqual(validateObservation(individual).objectNames,individual.objectNames);
  const legacy=decisionObservation(createNpc());legacy.objectNames=[];assert.throws(()=>validateObservation(legacy),/discovery mode/);
});
