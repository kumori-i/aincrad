import { BIOLOGY_PROFILES, gameHours } from './biology-config.js';
import { exertPhysiology } from './biology.js';

// Opt-in human discovery NPC work only. Animal exertion and player movement
// deliberately retain their existing abstractions.
export function npcEffortCost(seconds, effort=1) {
  return Number.isFinite(seconds)&&seconds>0&&Number.isFinite(effort)&&effort>0?
    BIOLOGY_PROFILES.human.walkingKcalPerHour*gameHours(seconds)*Math.min(5,effort):0;
}
export function fundNpcEffort(npc, seconds, effort=1, exert=exertPhysiology) {
  const none={paidSeconds:0,paidKcal:0};
  const f=npc?.physiology,cost=npcEffortCost(seconds,effort);
  if(npc?.mode!=='discovery'||f?.profile!=='human'||!cost||typeof exert!=='function')return none;
  const before=f.availableEnergyKcal,total=f.totals.metabolizedKcal;
  if(!Number.isFinite(before)||before<=0)return none;
  const paidSeconds=seconds*Math.min(1,before/cost),expected=npcEffortCost(paidSeconds,effort);
  // Existing test hooks may cancel/reenter/throw. They see only affordable work;
  // a returned value is not a payment witness, and throws certify no progress.
  exert(npc,paidSeconds,effort);
  if(npc.physiology!==f)return none;
  const debit=before-f.availableEnergyKcal,recorded=f.totals.metabolizedKcal-total;
  if(!Number.isFinite(debit)||!Number.isFinite(recorded)||debit<=0||recorded<=0||
      Math.abs(debit-expected)>Math.min(1e-8,expected*1e-7)||Math.abs(recorded-expected)>Math.min(1e-8,expected*1e-7))return none;
  return {paidSeconds,paidKcal:debit};
}
export function npcWorkAllowance(seconds,effort) {
  return Math.min(90,2*seconds+npcEffortCost(seconds,effort)/.2);
}

// Run ownership is runtime-only. A copied request/save cannot inherit it.
const runRequests=new WeakMap(),admittedRuns=new WeakMap();
export function markNpcRunTravel(npc,request) {
  if(request&&npc.discovery?.run)runRequests.set(request,{npc,run:npc.discovery.run});
  return request;
}
export function forwardNpcRunTravel(npc,raw,request) {
  const owned=runRequests.get(raw);
  if(owned?.npc===npc&&owned.run===npc.discovery?.run)runRequests.set(request,owned);
}
export function captureNpcRunDeadline(npc,request,active,{travel=false}={}) {
  const run=npc.discovery?.run;
  const owned=travel?runRequests.get(request)?.npc===npc&&runRequests.get(request)?.run===run:
    run?.awaiting&&run.expectedType===request.type&&run.expectedId===request.targetId;
  if(!owned||!Number.isFinite(run?.startedAt)||run.startedAt>npc.elapsed)return Infinity;
  const deadline=run.startedAt+90;
  admittedRuns.set(active,{npc,run,deadline});
  return deadline;
}
export function expireNpcRun(npc,active,elapsed=npc.elapsed) {
  const owned=admittedRuns.get(active);
  if(owned?.npc===npc&&npc.discovery?.run===owned.run&&elapsed>=owned.deadline)npc.discovery.run=null;
}
