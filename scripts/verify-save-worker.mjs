/** Isolated native worker security/cost probe; never migrates a user's save. */
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildApplication} from './build.mjs';
const arm=process.argv.find(a=>a.startsWith('--arm='))?.slice(6)||'mixed';if(!['mixed','worker-localstorage','worker-idb'].includes(arm))throw Error('Invalid measurement arm');
const root=fileURLToPath(new URL('..',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'aincrad-save-worker-')),out=resolve(root,`test-results/save-worker-${arm}.json`);
const built=await buildApplication();await mkdir(resolve(root,'test-results'),{recursive:true});
// The static probe is installed only into this disposable generated build. It
// is never a production worker command or a privileged IPC capability.
const probe=`import {prepareSave} from './save.js';
self.onmessage=async({data})=>{try{
if(data.type==='security'){
let evalBlocked=false,fetchBlocked=false,nestedBlocked=false;
try{eval('1+1');}catch{evalBlocked=true;}
try{await fetch(new URL('./config.js',import.meta.url));}catch{fetchBlocked=true;}
try{const child=new Worker(new URL('./config.js',import.meta.url),{type:'module'});await new Promise(resolve=>{child.onerror=event=>{event.preventDefault();nestedBlocked=true;resolve();};setTimeout(resolve,100);});child.terminate();}catch{nestedBlocked=true;}
self.postMessage({type:'security',evalBlocked,fetchBlocked,nestedBlocked,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined',imported:typeof prepareSave==='function'});return;
}
if(data.type!=='measure')throw Error('Unknown probe request');
const start=performance.now(),text=prepareSave(data.state),prepareMs=performance.now()-start;
const open=indexedDB.open('aincrad-worker-measurement-only',1),db=await new Promise((resolve,reject)=>{open.onupgradeneeded=()=>open.result.createObjectStore('snapshots');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
const txStart=performance.now();let putCallMs,durability;
await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite',{durability:'strict'});durability=tx.durability;tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('Aborted'));tx.onerror=()=>reject(tx.error);const p=performance.now();tx.objectStore('snapshots').put(text,'current');putCallMs=performance.now()-p;});
const transactionMs=performance.now()-txStart;db.close();self.postMessage({type:'measured',id:data.id,prepareMs,putCallMs,transactionMs,durability,bytes:new TextEncoder().encode(text).byteLength});
}catch(error){self.postMessage({type:'failure',message:String(error.message).slice(0,300)});}};`;
const probePath='src/save-security-probe.js';await writeFile(join(built.renderer,probePath),probe);
const manifestPath=join(built.renderer,'asset-manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.files.push({path:probePath,sha256:createHash('sha256').update(probe).digest('hex')});await writeFile(manifestPath,JSON.stringify(manifest));
const harness=join(dir,'runner.cjs');await writeFile(harness,`
const{app}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');const root=${JSON.stringify(root)},out=${JSON.stringify(out)};let done=false;const timeout=setTimeout(()=>app.exit(1),180000);
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{if(done)return;done=true;try{
for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('Boolean(window.__aincrad)'))break;await new Promise(r=>setTimeout(r,50));}
const result=await win.webContents.executeJavaScript(\`(async()=>{
const assert=(v,m)=>{if(!v)throw Error(m);};
const{requestNpcAction,tickNpc}=await import('./src/npc.js'),{freshState}=await import('./src/world.js');
const{CONFIG}=await import('./src/config.js'),{prepareSave}=await import('./src/save.js'),{createSavePreparer}=await import('./src/save-preparation.js'),{createTemporalLedger,beginTemporalDecision}=await import('./src/temporal-ledger.js'),{trainTemporalReturns}=await import('./src/temporal-returns.js'),{BUILD_SOURCE_FINGERPRINT}=await import('./src/build-info.js');
const state=window.__aincrad.snapshot();state.cardinal.mode='off';const memory=createTemporalLedger();let at=0;
for(let i=0;i<20000;i++){beginTemporalDecision(memory,{at:at++,context:{appearance:{shape:'observed '+i}},action:{type:'wait'}});if(memory.open.unknownContext)break;}
for(let i=0;i<513;i++)beginTemporalDecision(memory,{at:at++,context:{appearance:{shape:'observed '+i}},action:{type:'wait'}});trainTemporalReturns(memory.model);
state.elapsed=state.environment.elapsed=at;for(const n of state.agents)n.elapsed=at;
const client=createSavePreparer(),probe=new Worker(new URL('./src/save-security-probe.js',location.href),{type:'module'});
const ask=(data)=>new Promise((resolve,reject)=>{probe.onmessage=event=>event.data.type==='failure'?reject(Error(event.data.message)):resolve(event.data);probe.onerror=event=>{event.preventDefault();reject(Error('Probe worker failed'));};probe.postMessage(data);});
const security=await ask({type:'security'});for(const key of ['evalBlocked','fetchBlocked','nestedBlocked','nodeAbsent','imported'])assert(security[key],key+' failed');assert(typeof window.require==='undefined','Renderer Node leak');
const frameWindow=async run=>{let active=true,last=0,gaps=[];const frame=()=>{if(!active)return;const now=performance.now();gaps.push(now-last);last=now;requestAnimationFrame(frame);};await new Promise(r=>requestAnimationFrame(r));last=performance.now();requestAnimationFrame(frame);const result=await run();await new Promise(r=>requestAnimationFrame(r));active=false;return{...result,frameGapsMs:gaps,maxFrameGapMs:Math.max(0,...gaps)};};
const rows=[],arm=${JSON.stringify(arm)};if(arm==='worker-localstorage')probe.terminate();
const idle=await frameWindow(()=>new Promise(r=>setTimeout(()=>r({}),1000)));
for(const actors of (arm==='mixed'?[0,1,2]:[2])){
for(let i=0;i<2;i++){delete state.agents[i].discovery.temporal;if(i<actors)state.agents[i].discovery.temporal=structuredClone(memory);}state.npc=state.agents[0];
const expected=prepareSave(state);
for(let repeat=0;repeat<(arm==='mixed'?3:6);repeat++){
await new Promise(r=>setTimeout(r,1000));
let prepared,worker=null,localStorageCommit=null,workerIdb=null;
if(arm!=='worker-idb'){worker=await frameWindow(async()=>{const start=performance.now(),promise=client.prepare(state,{epoch:actors+1}),dispatchMs=performance.now()-start;state.elapsed++;prepared=await promise;state.elapsed--;return{dispatchMs,roundTripMs:performance.now()-start,prepareMs:prepared.prepareMs};});
assert(prepared.text===expected,'Pure worker canonical mismatch after live mutation');
localStorageCommit=await frameWindow(async()=>{const start=performance.now();localStorage.setItem(CONFIG.saveKey,prepared.text);return{setItemMs:performance.now()-start};});
}
if(arm!=='worker-localstorage'){workerIdb=await frameWindow(async()=>{const start=performance.now(),promise=ask({type:'measure',id:actors*3+repeat+1,state}),dispatchMs=performance.now()-start;const result=await promise;return{...result,dispatchMs,roundTripMs:performance.now()-start};});
if(arm==='mixed'||repeat===5){const persisted=await new Promise((resolve,reject)=>{const open=indexedDB.open('aincrad-worker-measurement-only',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('snapshots','readonly'),req=tx.objectStore('snapshots').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();};open.onerror=()=>reject(open.error);});assert(persisted===expected,'Worker IDB canonical mismatch');}
}
rows.push({actors,repeat,bytes:prepared?.bytes??workerIdb.bytes,worker,localStorageCommit,workerIdb});
}
}
const parityCases=[];
const active=window.__aincrad.snapshot();assert(requestNpcAction(active.npc,{type:'wait',seconds:5},active.environment).ok,'Actual wait start failed');tickNpc(active.npc,1/60,active.environment);active.elapsed=active.environment.elapsed=active.npc.elapsed;active.agents[1].elapsed=active.elapsed;assert(active.npc.active,'Active wait absent');
for(const [name,candidate] of [['active',active],['legacy',freshState({mode:'legacy'})]]){const expected=prepareSave(candidate),result=await client.prepare(candidate);assert(result.text===expected,name+' worker mismatch');parityCases.push(name);}
for(const [name,candidate,code] of [['unsupported',{...state,version:999},'UNSUPPORTED_SAVE'],['damaged-temporal',(()=>{const broken=structuredClone(state);broken.agents[0].discovery.temporal.contextKeys=[];return broken;})(),'PREPARE_FAILED']]){let rejected=false;try{await client.prepare(candidate);}catch(e){rejected=e.code===code;}assert(rejected,name+' was not rejected');parityCases.push(name);}
let protectedRejected=false;try{await client.prepare(state,{blocked:true});}catch(e){protectedRejected=e.code==='PROTECTED';}assert(protectedRejected,'Protection not enforced');client.dispose();probe.terminate();
return{sourceFingerprint:BUILD_SOURCE_FINGERPRINT,isolatedProfile:true,actualElectron:true,arm,idle,security,parityCases,protectedRejected,scope:'Mixed: three samples per case. Isolated arms: six two-actor samples with one-second idle gaps and final IDB readback. Production pure worker tested; worker-owned IDB is a disposable static probe only. Application save path unchanged. Welcome renderer runs without simulation/Cardinal advancement during measurements. Synthetic saturated copies, no migration/close/laptop/responsiveness claim.',rows};})()\`);
await fs.writeFile(out,JSON.stringify(result,null,2));console.log('PASS: pure worker canonical parity, coherent snapshot, CSP enforcement, and isolated worker-IDB measurements.');clearTimeout(timeout);app.quit();}catch(e){console.error(e);clearTimeout(timeout);app.exit(1);}}));require(path.join(root,'dist/desktop/main.cjs'));
`);
const electron=createRequire(import.meta.url)('electron'),flags=[harness,'--test',`--test-profile=${join(dir,'profile')}`];if(process.platform==='linux')flags.push('--ozone-platform=headless','--disable-gpu');if(process.getuid?.()===0)flags.push('--no-sandbox');const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
try{const code=await new Promise((r,j)=>{const p=spawn(electron,flags,{cwd:root,env,stdio:'inherit'});p.on('error',j);p.on('exit',r);});if(code)throw Error('Native worker probe failed '+code);}finally{await buildApplication();}
