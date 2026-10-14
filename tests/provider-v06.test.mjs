import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNpc} from '../src/npc-state.js';
import {bodySignals,sensedEnvironment} from '../src/interoception.js';
import {decisionObservation} from '../src/controller.js';
import {observeNpc} from '../src/npc.js';
import {createEnvironment} from '../src/environment.js';
const require=createRequire(import.meta.url);
const {validateObservation,parseDecision,ModelService}=require('../desktop/model-provider.cjs');
const observation=(id='aster')=>{const actor=createNpc({id,mode:'discovery'});return {mode:'discovery',identity:{id,name:id==='mira'?'Mira':'Aster'},condition:{scene:'valley',lifecycle:'AWAKE',position:{x:276,y:760},body:bodySignals(actor),senses:sensedEnvironment(actor),inventory:{objects:[{id:'object:17',appearance:{shape:'round',color:'red',texture:'smooth'},position:{x:278,y:760}}],capacity:3,flask:'empty'}},knownSources:[],knownShelters:[],knownTiles:[],discovery:{observations:[{id:'object:17',appearance:{shape:'round',color:'red',texture:'smooth'},position:{x:278,y:760},seenAt:6}],experiments:[{id:'experiment:1',at:7,primitive:'grasp',targetId:'object:17',ok:true,code:'grasped',durationSeconds:2}],effects:[],techniques:[],reports:[]},social:{peers:[],journal:[],notes:[],pendingQuestion:null}};};
const response=choice=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(choice)}}]}),{status:200});

test('discovery model observations carry sensory objects and executed evidence rather than a supplied food list',()=>{
  const output=validateObservation(observation());
  assert.equal(output.mode,'discovery');assert.deepEqual(output.condition.inventory.objects,observation().condition.inventory.objects);
  assert.equal(output.discovery.experiments[0].primitive,'grasp');assert.equal('knownFoods' in output,false);assert.equal('skills' in output,false);assert.equal('apples' in output.condition.inventory,false);
  for(const field of ['knownFoods','skills','procedureCandidates','procedureUse'])assert.throws(()=>validateObservation({...observation(),[field]:field==='procedureUse'?'Eat apples':[]}),/Supplied food\/procedure/);
  const legacyInventory=observation();legacyInventory.condition.inventory={apples:0,capacity:3,flask:'empty'};assert.throws(()=>validateObservation(legacyInventory),/discovery inventory/);
});

test('nested physiological stores and hidden ecological answers cannot cross the discovery bridge',()=>{
  for(const [key,value] of [['edible',true],['species','rabbit'],['diet','herbivore'],['nutrition',{kind:'food'}],['prey',true],['renewAt',120]]){
    const input=observation();input.discovery.observations[0][key]=value;
    assert.throws(()=>validateObservation(input),/ecological metadata|telemetry/);
  }
  for(const field of ['physiology','waterDeficit','stomach','awakeHours','sleepDepth','storedEnergyKcal','bodyCondition','massKg']){
    const input=observation();input.discovery.experiments[0].result={[field]:56};assert.throws(()=>validateObservation(input),/telemetry/);
  }
  const human=observation();human.discovery.reports=[{sourceId:'human',text:'You could try pulling a round red object, then sampling it.',status:'unverified',messageId:'message:1',proposed:[{type:'pull',objectId:'object:17'},{type:'sample',objectId:'object:17'}]}];
  assert.equal(validateObservation(human).discovery.reports[0].status,'unverified');
  assert.throws(()=>validateObservation({...observation(),discovery:{...observation().discovery,observations:Array(41).fill({id:'object:1'})}}),/observations/);
});

test('pretrained discovery model output cannot select experiments, food macros, procedures, peer recipes or plans',()=>{
  const rejected=[{action:{type:'sample',objectId:'object:17'}},{action:{type:'inspect_object',objectId:'object:17'}},{action:{type:'gather_food',foodId:'apple:trail'}},{action:{type:'eat'}},{action:{type:'move',target:{x:300,y:760}}},{action:{type:'sleep',seconds:12}},{action:{type:'say',targetId:'mira',text:'Eat the round red objects.'}},{action:{type:'write_note',title:'Recipe',text:'Eat the round red objects.'}},{action:{type:'read_note',noteId:'note:1'}},{skillId:'food-gather-eat'},{plan:{goal:'Get food',need:'survival',steps:[{type:'observe'},{type:'gather_food',foodId:'apple:trail'},{type:'eat'}],completion:'Full',interrupt:'Danger'}}];
  for(const choice of rejected)assert.throws(()=>parseDecision(JSON.stringify(choice),{mode:'discovery'}),/optional human-journal/);
  assert.deepEqual(parseDecision(JSON.stringify({action:{type:'journal_reply',replyTo:'message:1',text:'I am unsure what this object does.'}}),{mode:'discovery'}).action,{type:'journal_reply',replyTo:'message:1',text:'I am unsure what this object does.'});
  assert.equal(parseDecision(JSON.stringify({action:{type:'ask_human',text:'Can you help me understand this object?',topic:'object:17'}}),{mode:'discovery'}).action.type,'ask_human');
  // Existing worlds continue to use their old validated action bridge.
  assert.equal(parseDecision('{"action":{"type":"gather_food","foodId":"apple:trail"}}').action.type,'gather_food');
});

test('actual discovery HTTP fixture exposes only optional grounded journal language and rejects a physical answer',async()=>{
  const input=observation('mira');input.social.journal=[{id:'message:1',senderId:'human',recipientId:'mira',channel:'journal',text:'How is your experiment going?'}];
  let sent;
  const service=new ModelService({config:{enabled:true,model:'scripted-discovery-test-mock'},fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return response({action:{type:'journal_reply',replyTo:'message:1',text:'I grasped the object, but have not yet observed a bodily effect.'},reason:'Scripted fixture grounded in supplied experiment.'});}});
  assert.equal((await service.decide(input)).action.type,'journal_reply');
  const prompt=sent.messages[0].content,payload=JSON.parse(sent.messages[1].content);
  assert.match(prompt,/do not select physical actions/i);assert.match(prompt,/pretrained associations are not observations/i);assert.match(prompt,/human may never answer/i);
  assert.doesNotMatch(prompt,/gather_food|food-gather-eat|\"skillId\"/);assert.equal(payload.mode,'discovery');assert.equal(payload.discovery.effects.length,0);
  const hostile=new ModelService({config:{enabled:true,model:'scripted-discovery-test-mock'},fetchImpl:async()=>response({action:{type:'sample',objectId:'object:17'},reason:'Pretrained recipe supplied by test fixture.'})});
  await assert.rejects(hostile.decide(input),/optional human-journal/);assert.equal(hostile.status().pending,false);
});


test('the real discovery controller observation crosses the bridge without legacy recipes or exact body stores',()=>{
  const actor=createNpc({id:'aster',mode:'discovery'}),environment=createEnvironment(undefined,{mode:'discovery'});observeNpc(actor,environment);
  const actual=decisionObservation(actor),output=validateObservation(actual);
  assert.equal(output.mode,'discovery');assert.equal(output.condition.body.digestion,bodySignals(actor).digestion);assert.equal(output.condition.body.sleep,bodySignals(actor).sleep);
  assert.ok(output.discovery.observations.length>0);assert.deepEqual(output.discovery.experiments,[]);assert.deepEqual(output.discovery.techniques,[]);assert.equal('knownFoods' in output,false);assert.equal('skills' in output,false);assert.equal('actions' in output,false);assert.equal('apples' in output.condition.inventory,false);
  assert.equal('physiology' in output,false);assert.equal('nutrition' in (output.discovery.observations[0]??{}),false);
});
