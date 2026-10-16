/** Owner-only supervisor for the fixed headless diagnostic. No game imports. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const WATCHDOG = Object.freeze({ armOrStartupMs:315000, graceMs:15000, pollMs:1000 });
export const HEADLESS_SCHEDULE=Object.freeze(['online','no-bootstrap','frozen-zero'].map(arm=>Object.freeze({id:`headless-diagnostic-v1-approach1-seed1729-${arm}`,arm})));
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
/** Monotonic deadlines: polling/unchanged reports cannot extend a running arm. */
export function watchdogState(previous,at,currentArm=null){
 if(!Number.isFinite(at)||at<0||currentArm!==null&&typeof currentArm!=='string')throw new TypeError('Invalid watchdog observation');
 if(previous&&at<previous.lastAt)throw new TypeError('Watchdog clock moved backward');
 const changed=!previous||previous.arm!==currentArm;
 const beganAt=changed?at:previous.beganAt;
 return {arm:currentArm,beganAt,lastAt:at,deadlineAt:beganAt+WATCHDOG.armOrStartupMs,
  expired:at>=beganAt+WATCHDOG.armOrStartupMs,reason:currentArm?'active-arm deadline':'startup/no-current-arm deadline'};
}
export function parseWatchdogOptions(argv){
 const out={};for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];
  if(!['--preflight','--output'].includes(key)||!value||value.startsWith('--')||out[key.slice(2)])throw new Error('Only unique --preflight FILE --output NEW_DIRECTORY are accepted');
  out[key.slice(2)]=resolve(value);
 }
 if(!out.preflight||!out.output)throw new Error('--preflight and --output are required');return out;
}
/** Escalation survives diagnostic-write failure; signals only the supplied owned child. */
export function armChildStop(child,isFinished,persist,{graceMs=WATCHDOG.graceMs,onHardKill=()=>{},onWriteError=()=>{}}={}){
 child.kill('SIGTERM');
 const timer=setTimeout(()=>{if(!isFinished()){try{onHardKill();}finally{child.kill('SIGKILL');}}},graceMs);
 const recorded=Promise.resolve().then(persist).catch(error=>{try{onWriteError(error);}catch{}});
 return {timer,recorded};
}
export async function guardChildSetup(child,closed,setup){
 try{return await setup();}catch(error){child.kill('SIGKILL');await closed;throw error;}
}
async function preservedFile(path){
 try{const bytes=await readFile(path);return {path,available:true,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')};}
 catch(error){return {path,available:false,error:error.code||String(error.message).slice(0,100)};}
}
export async function preservedCensus(output){
 const path=resolve(output,'report.json'),reportFile=await preservedFile(path);let report=null;
 if(reportFile.available){try{report=JSON.parse(await readFile(path,'utf8'));}catch(error){reportFile.parseError=String(error.message).slice(0,180);}}
 const scheduled=[];
 for(const job of HEADLESS_SCHEDULE){
  const row=report?.trials?.find(r=>r.id===job.id),trace=await preservedFile(resolve(output,`${job.id}.owner.jsonl`)),stopState=await preservedFile(resolve(output,`${job.id}.stop.json`));
  const attempted=Boolean(row?.startedAt||trace.available||stopState.available);
  scheduled.push({...job,rawStatus:row?.status??null,classification:row?.status==='completed'?'completed':attempted?'censored':'blocked',trace,stopState});
 }
 return {report:reportFile,scheduled,metricsReconstructed:false};
}
export async function main(argv=process.argv.slice(2)){
 const options=parseWatchdogOptions(argv),statusPath=`${options.output}.supervisor.json`,start=performance.now();
 const status={schemaVersion:1,kind:'finite-headless-process-supervisor',protocol:'headless-diagnostic-v1',startedAt:new Date().toISOString(),
  limits:WATCHDOG,options,supervisorSource:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  child:null,scheduled:HEADLESS_SCHEDULE.map(job=>({...job,classification:'pending',finalStateAvailable:false})),observations:[],trigger:null,status:'starting',finalStateReconstructed:false,retries:0};
 // Exclusive sidecar protects earlier run evidence. The evaluator creates its own
 // NEW_DIRECTORY; the supervisor never edits its report, trace or physical state.
 await writeFile(statusPath,JSON.stringify(status,null,2)+'\n',{flag:'wx',mode:0o600});
 let writes=Promise.resolve();
 const persist=()=>{const bytes=JSON.stringify(status,null,2)+'\n';writes=writes.then(async()=>{await writeFile(`${statusPath}.next`,bytes,{mode:0o600});await rename(`${statusPath}.next`,statusPath);});return writes;};
 const child=spawn(process.execPath,[resolve(ROOT,'scripts/evaluate-finite-temporal.mjs'),'--stage','headless-diagnostic-v1','--preflight',options.preflight,'--output',options.output],{cwd:ROOT,stdio:'inherit'});
 const closed=new Promise(resolve=>{child.once('error',error=>resolve({error:String(error.message)}));child.once('close',(code,signal)=>resolve({code,signal}));});
 status.child={pid:child.pid};status.status='running';
 let finished=false,polling=false,watch=watchdogState(null,performance.now()-start),grace=null;
 const trigger=async reason=>{
  if(status.trigger||finished)return;
  status.trigger={reason,monotonicMs:performance.now()-start,arm:watch.arm,signal:'SIGTERM'};
  const stopping=armChildStop(child,()=>finished,persist,{
   onHardKill:()=>{status.trigger.hardKill=true;status.trigger.hardKillAtMs=performance.now()-start;},
   onWriteError:error=>{status.persistenceError=String(error.message).slice(0,240);process.stderr.write(`Supervisor status persistence failed: ${status.persistenceError}\n`);}
  });grace=stopping.timer;await stopping.recorded;
 };
 const external=()=>{trigger('supervisor interrupted').catch(()=>child.kill('SIGTERM'));};
 process.once('SIGINT',external);process.once('SIGTERM',external);
 const timer=setInterval(async()=>{
  if(finished||status.trigger)return;
  watch=watchdogState(watch,performance.now()-start,watch.arm);
  if(watch.expired){trigger(watch.reason).catch(()=>child.kill('SIGKILL'));return;}
  if(polling)return;polling=true;
  try{
   let arm=watch.arm;
   try{const report=JSON.parse(await readFile(resolve(options.output,'report.json'),'utf8'));
    arm=report.trials?.find(row=>row.status==='running')?.id??null;
   }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
   const next=watchdogState(watch,performance.now()-start,arm);
   if(next.arm!==watch.arm){status.observations.push({atMs:next.lastAt,arm:next.arm});watch=next;await persist();}else watch=next;
   if(watch.expired)await trigger(watch.reason);
  }catch(error){await trigger(`supervisor error: ${String(error.message).slice(0,180)}`);}finally{polling=false;}
 },WATCHDOG.pollMs);
 let setupError=null;
 try{await guardChildSetup(child,closed,persist);}catch(error){setupError=error;}
 const outcome=await closed;
 finished=true;clearInterval(timer);if(grace)clearTimeout(grace);process.removeListener('SIGINT',external);process.removeListener('SIGTERM',external);
 // Wait for any bounded in-flight sidecar write before the final status replace.
 while(polling)await new Promise(resolve=>setTimeout(resolve,10));
 status.status=status.trigger?'censored-process':outcome.code===0?'finished':'failed';status.outcome=outcome;
 status.finishedAt=new Date().toISOString();status.wallMs=performance.now()-start;status.preserved=await preservedCensus(options.output);
 if(setupError)throw setupError;
 await persist();process.exitCode=status.trigger?3:outcome.code??1;
 return status;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
