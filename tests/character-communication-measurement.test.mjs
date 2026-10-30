import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_MEASUREMENT_LIMITS,createCharacterCommunicationMeasurement,
} from '../src/character-communication-measurement.js';

const keys=[
  'optionalChecks','feasibleOpportunities','emissions','paidInspectionStarts',
  'paidInspectionCompletions','paidInspectionOutcomeUnavailable',
  'paidReplyStarts','paidReplyCompletions','paidReplyOutcomeUnavailable',
  'canonicalDemonstrations','criticCorrect',
  'validListenerDemonstrations','ambiguousListenerLabels','rejectedListenerLabels',
  'listenerReplayUses','listenerOptimizerSteps','visualMatches','visualMismatches',
  'senderUpdates','originalCensors','responseCensors',
];

test('fixed session counters have distinct denominators and saturate without overflow',()=>{
  assert.deepEqual(CHARACTER_MEASUREMENT_LIMITS,
    {eventRows:256,censorReasons:64,counter:2147483647});
  const measurement=createCharacterCommunicationMeasurement();
  const initial=measurement.snapshot();
  assert.deepEqual(Object.keys(initial.counts),keys);
  assert(keys.every(key=>initial.counts[key]===0));
  assert.equal(measurement.count('optionalChecks',3),true);
  assert.equal(measurement.count('feasibleOpportunities'),true);
  assert.equal(measurement.count('emissions'),true);
  assert.equal(measurement.count('paidInspectionStarts'),true);
  assert.equal(measurement.count('paidInspectionCompletions'),true);
  assert.equal(measurement.count('paidInspectionOutcomeUnavailable'),true);
  assert.equal(measurement.count('paidReplyStarts'),true);
  assert.equal(measurement.count('paidReplyCompletions'),true);
  assert.equal(measurement.count('paidReplyOutcomeUnavailable'),true);
  assert.equal(measurement.count('canonicalDemonstrations'),true);
  assert.equal(measurement.count('validListenerDemonstrations'),true);
  assert.equal(measurement.count('listenerReplayUses',3),true);
  assert.equal(measurement.count('listenerOptimizerSteps'),true);
  const counts=measurement.snapshot().counts;
  assert.equal(counts.optionalChecks,3);
  assert.equal(counts.feasibleOpportunities,1);
  assert.equal(counts.paidInspectionOutcomeUnavailable,1);
  assert.equal(counts.paidReplyOutcomeUnavailable,1);
  assert.equal(counts.criticCorrect,0,'A demonstration is not assumed correct');
  assert.equal(counts.listenerReplayUses,3);
  assert.equal(counts.listenerOptimizerSteps,1);
  for(const [key,amount]of [['unknown',1],['emissions',-1],['emissions',1.5],['emissions',NaN]])
    assert.equal(measurement.count(key,amount),false);
  assert.deepEqual(measurement.snapshot().counts,counts,'Invalid diagnostics do not change denominators');
  assert.equal(measurement.count('criticCorrect',CHARACTER_MEASUREMENT_LIMITS.counter),true);
  assert.equal(measurement.snapshot().saturated,false);
  measurement.count('criticCorrect');
  const saturated=measurement.snapshot();
  assert.equal(saturated.counts.criticCorrect,CHARACTER_MEASUREMENT_LIMITS.counter);
  assert.equal(saturated.saturated,true,'Attempted overflow is disclosed');
});

test('censor reasons are bounded independently from original and response totals',()=>{
  const measurement=createCharacterCommunicationMeasurement({censorReasons:2});
  assert.equal(measurement.censor('other','choice','timeout'),false);
  assert.equal(measurement.censor('original','choice','timeout'),true);
  assert.equal(measurement.censor('original','choice','timeout'),true);
  assert.equal(measurement.censor('response','responding','body-priority'),true);
  assert.equal(measurement.censor('response','responding','response-not-observed'),true);
  const first=measurement.snapshot();
  assert.deepEqual(first.counts.originalCensors,2);
  assert.deepEqual(first.counts.responseCensors,2);
  assert.deepEqual(first.reasons,[
    {kind:'original',stage:'choice',reason:'timeout',count:2},
    {kind:'response',stage:'responding',reason:'body-priority',count:1},
  ]);
  assert.equal(first.reasonOverflow,1,'New reasons beyond the cap remain counted');
  first.reasons[0].count=900;
  assert.equal(measurement.snapshot().reasons[0].count,2,'Reason snapshots are defensive copies');
  assert.equal(measurement.censor('original','a'.repeat(100),'hidden object:99'),true);
  assert.equal(measurement.snapshot().reasonOverflow,2,
    'Unbounded or non-code reasons cannot grow the retained map');
});

test('retained event references update in place but snapshots expose only bounded diagnostic copies',()=>{
  const measurement=createCharacterCommunicationMeasurement({eventRows:2});
  const body={sender:{lifecycle:'AWAKE',hunger:'hungry',thirst:'dry mouth',energy:'low',
    pain:'aching',overall:'uncomfortable',urgent:false,collapses:1,meals:2,drinks:3,
    privateObjectId:'tree:1'},receiver:{lifecycle:'AWAKE',hunger:'content',urgent:true}};
  const event={id:1,emittedAt:4.5,senderObservedAt:4.5,receiverObservedAt:4.5,
    senderId:'aster',receiverId:'mira',message:'lvfvty',action:'inspect_object',
    choiceMode:'uniform-untrained',choiceReason:'uniform-untrained',status:'choice',selectedActionId:71,
    referenceCorrect:false,listenerUpdate:false,senderUpdate:false,
    bodyAtEmission:body,senderPixels:[1,2],receiverPixels:[3,4],
    targetId:'tree:1',demonstratedObjectId:'tree:2',messageHandle:{secret:true},
    orderedOwnFeatures:[[.1],[.9]]};
  assert.equal(measurement.retain(event),true);
  assert.equal(measurement.retain(event),false,'One live event cannot occupy two rows');
  const attachedRows=measurement.rows;
  assert.equal(measurement.rows,attachedRows,'The attachment keeps one live journal array');
  event.status='observed';event.correction='own-view-demonstration';
  event.listenerReplayUses=3;
  event.indicationActionId=72;event.demonstrationObservedAt=7.5;
  event.bodyAtDemonstration=body;
  const first=measurement.snapshot(),row=first.events[0];
  assert.equal(first.eventsRetained,1);
  assert.equal(row.message,'lvfvty');assert.equal(row.status,'observed');
  assert.equal(row.action,'inspect_object');assert.equal(row.choiceReason,'uniform-untrained');
  assert.equal(row.listenerReplayUses,3);
  assert.equal(row.referenceCorrect,false,'A wrong paid choice remains a critic result');
  assert.equal(row.indicationActionId,72);
  assert.deepEqual(row.bodyAtEmission.sender,{lifecycle:'AWAKE',hunger:'hungry',
    thirst:'dry mouth',energy:'low',pain:'aching',overall:'uncomfortable',urgent:false,
    collapses:1,meals:2,drinks:3});
  for(const forbidden of ['senderPixels','receiverPixels','targetId','demonstratedObjectId',
    'messageHandle','orderedOwnFeatures'])assert.equal(Object.hasOwn(row,forbidden),false);
  assert.equal(Object.hasOwn(row.bodyAtEmission.sender,'privateObjectId'),false);
  row.bodyAtEmission.sender.hunger='forged';row.status='forged';first.counts.emissions=99;
  assert.equal(measurement.snapshot().events[0].bodyAtEmission.sender.hunger,'hungry');
  assert.equal(measurement.snapshot().events[0].status,'observed');
  assert.equal(measurement.snapshot().counts.emissions,0);
  const second={id:2,senderId:'mira',receiverId:'aster',message:'a',status:'choice'};
  const third={id:3,senderId:'aster',receiverId:'mira',message:'ab',status:'choice'};
  measurement.retain(second);measurement.retain(third);
  assert.equal(measurement.rows,attachedRows,'FIFO retention keeps the journal array identity');
  assert.deepEqual(measurement.snapshot().events.map(item=>item.id),[2,3]);
  assert.equal(measurement.snapshot().eventsEvicted,1);
  assert.equal(measurement.retire(new Set(['mira'])),2);
  assert.equal(measurement.snapshot().eventsRetained,0);
  assert.equal(measurement.snapshot().eventsRetired,2);
  assert.equal(measurement.snapshot().eventsEvicted,1,'Identity retirement is distinct from FIFO eviction');
  assert.equal(measurement.retire(new Set(['mira'])),0);
});

test('malformed inputs and caps fail closed without RNG or retained event growth',()=>{
  for(const options of [{eventRows:0},{eventRows:257},{censorReasons:0},
    {censorReasons:65},{eventRows:1.5},{censorReasons:NaN}])
    assert.throws(()=>createCharacterCommunicationMeasurement(options),RangeError);
  const measurement=createCharacterCommunicationMeasurement({eventRows:3,censorReasons:3});
  assert.equal(measurement.retain(null),false);
  assert.equal(measurement.retain([]),false);
  assert.equal(measurement.retire(['aster']),0);
  const malformed={id:-1,senderId:'A'.repeat(100),receiverId:'mira',
    message:'secret apple tree',status:'x'.repeat(100),
    bodyAtEnd:{sender:{hunger:'x'.repeat(100),collapses:-1,urgent:'yes'}}};
  measurement.retain(malformed);
  const row=measurement.snapshot().events[0];
  assert.equal(row.id,null);assert.equal(row.senderId,null);
  assert.equal(row.message,null);assert.equal(row.status,null);
  assert.equal(row.bodyAtEnd.sender.hunger,null);
  assert.equal(row.bodyAtEnd.sender.collapses,null);
  assert.equal(row.bodyAtEnd.sender.urgent,null);
  assert.deepEqual(measurement.snapshot(),measurement.snapshot(),
    'Repeated passive projections are deterministic and do not advance measurement');
});
