/** Fixed isolated Stage A measurement. Requires a reviewed frozen packet hash. */
import{readFile,writeFile,mkdir,stat}from'node:fs/promises';import{openSync,closeSync}from'node:fs';
import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';import{createRequire}from'node:module';import{cpus,totalmem,freemem,loadavg}from'node:os';
import{runOwned}from'./run-owned.mjs';
import{summarizeArm,compareArms}from'./summarize.mjs';import{verifyFrozenFiles}from'./verify-packet.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
if(!args['--packet']||!args['--sha256']||!args['--output'])throw Error('Use --packet=... --sha256=... --output=new-directory');
const packetPath=resolve(args['--packet']),raw=await readFile(packetPath);if(hash(raw)!==args['--sha256'])throw Error('Frozen packet hash mismatch');const packet=JSON.parse(raw),output=resolve(args['--output']);
if(process.getuid?.()===0)throw Error('Root execution unsupported: sandbox must remain enabled');
if(process.platform!=='linux')throw Error('This disposable native owner-group watchdog is currently Linux-only');
const electron=createRequire(resolve(root,'../aincrad/package.json'))('electron');
const verify=()=>verifyFrozenFiles(packet,root);
await verify();await mkdir(dirname(output),{recursive:true});await mkdir(output);
const census=[];for(const f of packet.fixtures)for(const session of [1,2])for(const arm of session===1?['baseline','worker']:['worker','baseline'])census.push({id:`${f.id}-s${session}-${arm}`,fixture:f.id,session,arm,status:'pending'});
const report={version:1,packetSha256:args['--sha256'],startedAt:new Date().toISOString(),host:{platform:process.platform,arch:process.arch,node:process.version,cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,totalMemoryBytes:totalmem(),freeMemoryBytes:freemem(),loadavg:loadavg()},census,comparisons:[],complete:false,error:null};
const persist=()=>writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');await persist();
async function armRun(row){await verify();const directory=resolve(output,row.id);await mkdir(directory);const f=packet.fixtures.find(f=>f.id===row.fixture),config={rendererRoot:packet.rendererRoot,allowedPaths:packet.allowedPaths,assets:packet.assets,output:directory,profile:resolve(directory,'profile'),trial:{fixture:f.id,session:row.session,arm:row.arm,pairs:f.pairs}};const configPath=resolve(directory,'config.json');await writeFile(configPath,JSON.stringify(config));
 const flags=[resolve(packet.rendererRoot,'prototype/save-stage-a/native-runner.cjs'),'--stage-a-config='+configPath];if(process.platform==='linux')flags.push('--ozone-platform=headless','--disable-gpu');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const fd=openSync(resolve(directory,'native.log'),'wx');
 try{const result=await runOwned(electron,flags,{cwd:root,env,stdio:['ignore',fd,fd]});row.supervisorStop=result.supervisorStop;row.cleanupError=result.cleanupError;row.ownedGroup=result.ownedGroup;return{code:result.code,signal:result.signal};}finally{closeSync(fd);}
}

try{for(const row of census){row.status='running';row.startedAt=new Date().toISOString();await persist();console.log('START '+row.id);const exit=await armRun(row);Object.assign(row,{exit,finishedAt:new Date().toISOString()});
 const dir=resolve(output,row.id);let rawResult;try{rawResult=await readFile(resolve(dir,'result.json'));row.resultSha256=hash(rawResult);row.resultBytes=rawResult.length;}catch{row.status='censored';throw Error('Arm final report absent: '+row.id);}
 const result=JSON.parse(rawResult);if(exit.code!==0||!result.completed||row.supervisorStop||row.cleanupError){row.status=result.resourceCensored||row.supervisorStop?'censored':'failed';row.error=result.error??{message:'Owned supervisor stop: '+row.supervisorStop};row.resourceCensored=!!(result.resourceCensored||row.supervisorStop);row.storageFailureEvidence=result.storageFailureEvidence??null;throw Error('Arm failed or censored: '+row.id);}
 const streamed=await readFile(resolve(dir,'samples.ndjson'),'utf8');const lines=streamed.trim().split('\n').map(x=>JSON.parse(x));if(JSON.stringify(lines)!==JSON.stringify(result.samples))throw Error('Streamed/final sample mismatch: '+row.id);row.sampleStreamSha256=hash(streamed);row.sampleCount=lines.length;
 row.summary=summarizeArm(result);row.status='completed';await persist();console.log('COMPLETE '+row.id);
 }
 await verify();report.complete=true;
}catch(error){report.error={message:String(error.message),stack:String(error.stack)};for(const row of census){if(row.status==='running'){row.status='failed';row.error=report.error;row.finishedAt=new Date().toISOString();}else if(row.status==='pending')row.status='blocked';}}
finally{try{await verify();report.postflight={passed:true};}catch(error){report.postflight={passed:false,error:String(error.message)};report.complete=false;report.gatesPassed=false;}report.comparisons=[];for(const f of packet.fixtures)for(const session of [1,2]){const base=census.find(r=>r.fixture===f.id&&r.session===session&&r.arm==='baseline'),worker=census.find(r=>r.fixture===f.id&&r.session===session&&r.arm==='worker');if(base?.status==='completed'&&worker?.status==='completed')report.comparisons.push(compareArms(base.summary,worker.summary));}report.gatesPassed=report.complete&&report.comparisons.length===8&&report.comparisons.every(c=>c.passed);report.finishedAt=new Date().toISOString();report.hostAfter={freeMemoryBytes:freemem(),loadavg:loadavg()};await persist();}
console.log(JSON.stringify({complete:report.complete,gatesPassed:report.gatesPassed,error:report.error,output},null,2));if(!report.complete)process.exitCode=1;
