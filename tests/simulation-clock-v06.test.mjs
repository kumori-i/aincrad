import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulationClock} from '../src/simulation-clock.js';

test('elapsed simulation advances without a paint, visibility or focus event',()=>{
  let elapsed=0;const clock=new SimulationClock({onStep:dt=>elapsed+=dt});
  clock.advance(10,{running:true});clock.advance(11.5,{running:true});
  assert.ok(Math.abs(elapsed-1.5)<1e-9);
  clock.advance(12,{running:true});assert.ok(Math.abs(elapsed-2)<1e-9);
});
test('explicit pause discards paused time and resume does not fast-forward it',()=>{
  let elapsed=0;const clock=new SimulationClock({onStep:dt=>elapsed+=dt});
  clock.advance(0,{running:true});clock.advance(1,{running:true});
  clock.advance(20,{running:false});clock.advance(50,{running:false});
  clock.advance(70,{running:true});assert.ok(Math.abs(elapsed-1)<1e-9);
  clock.advance(71,{running:true});assert.ok(Math.abs(elapsed-2)<1e-9);
});
test('speed advances the same fixed physical steps and a work limit retains outstanding time',()=>{
  let elapsed=0;const steps=[],clock=new SimulationClock({maxSteps:120,onStep:dt=>{elapsed+=dt;steps.push(dt);}});
  clock.advance(0,{running:true});assert.equal(clock.advance(1,{running:true,speed:4}),120);
  assert.ok(Math.abs(elapsed-2)<1e-9);clock.advance(1,{running:true,speed:4});assert.ok(Math.abs(elapsed-4)<1e-9);
  assert.ok(steps.every(dt=>dt===1/60));
  clock.advance(2,{running:true,speed:999});assert.ok(Math.abs(elapsed-5)<1e-9);
});
