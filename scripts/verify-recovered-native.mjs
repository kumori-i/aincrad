/** Native recovered-copy QA on disposable Electron profiles.
 * Usage: node scripts/verify-recovered-native.mjs --ci-synthetic [--keep]
 *   or: node scripts/verify-recovered-native.mjs --historical-config=<absolute JSON> [--faults] [--keep]
 *   or: node scripts/verify-recovered-native.mjs --receiptless-current [--keep]
 * Historical mode reads only the copied, hash-verified evidence named by the
 * ignored local config. The test-only Electron main probe has finite actions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApplication } from './build.mjs';
import { prepareLegacyPendingMigration } from '../src/save.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const syntheticMode=process.argv.includes('--ci-synthetic');
const receiptlessMode=process.argv.includes('--receiptless-current');
const historicalOptions=process.argv.filter(arg=>arg.startsWith('--historical-config='));
let historicalSource=null;
const currentCopyPath=resolve(root,'../evidence/live-original-save-20261016-1343.json');
const currentCopySha256='c93c68e8777de00be6fd302f1a188fe693cccc3245befd24503056883295eae5';
const currentCopyBytes=4624240;
const saveKey='aincrad.save.v1';
const electron=createRequire(import.meta.url)('electron');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const canonical=location=>{try{return realpathSync(location);}catch{return resolve(location);}};
const lexicalWithin=(directory,target)=>{
  if(typeof target!=='string')return false;
  const relation=relative(resolve(directory),resolve(target));
  return relation===''||relation!=='..'&&!relation.startsWith(`..${sep}`)&&!isAbsolute(relation);
};
const within=(directory,target)=>{
  if(typeof target!=='string')return false;
  const relation=relative(canonical(directory),canonical(target));
  return relation===''||relation!=='..'&&!relation.startsWith(`..${sep}`)&&!isAbsolute(relation);
};
const failText=child=>`exit=${child.exitCode}; stdout=${child.stdoutLog}; stderr=${child.stderrLog}`;

async function loadHistoricalSource(){
  if(syntheticMode||historicalOptions.length!==1)throw new Error('Historical QA needs one local --historical-config file.');
  const supplied=historicalOptions[0].slice('--historical-config='.length);
  if(!isAbsolute(supplied)||dirname(resolve(supplied))!==resolve(root,'test-results'))
    throw new Error('Historical QA config must be a direct test-results file.');
  const configDirectory=await lstat(resolve(root,'test-results'));
  if(!configDirectory.isDirectory()||configDirectory.isSymbolicLink())
    throw new Error('Historical QA config directory is unsafe.');
  const configEntry=await lstat(supplied);
  if(!configEntry.isFile()||configEntry.isSymbolicLink())
    throw new Error('Historical QA config is not a regular file.');
  const configRoot=await realpath(resolve(root,'test-results'));
  const configPath=await realpath(supplied);
  if(dirname(configPath)!==configRoot)
    throw new Error('Historical QA config must be a regular direct test-results file.');
  const configBytes=await readFile(configPath);
  if(configBytes.length<1||configBytes.length>2048)throw new Error('Historical QA config is missing or oversized.');
  const config=JSON.parse(configBytes.toString('utf8'));
  if(!config||Object.keys(config).sort().join(',')!=='fixturePath,walSha256'||
     typeof config.fixturePath!=='string'||!isAbsolute(config.fixturePath)||
     !/^[0-9a-f]{64}$/.test(config.walSha256))
    throw new Error('Historical QA config has an invalid fixture identity.');
  const evidenceRoot=resolve(root,'../../task/evidence');
  if(!lexicalWithin(evidenceRoot,config.fixturePath))
    throw new Error('Historical QA fixture is outside copied task evidence.');
  const evidenceEntry=await lstat(evidenceRoot);
  if(!evidenceEntry.isDirectory()||evidenceEntry.isSymbolicLink())
    throw new Error('Historical QA evidence root is unsafe.');
  let cursor=evidenceRoot;
  const parts=relative(evidenceRoot,resolve(config.fixturePath)).split(sep);
  if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'))
    throw new Error('Historical QA fixture is not a copied evidence file.');
  for(const [index,part] of parts.entries()){
    cursor=join(cursor,part);
    const entry=await lstat(cursor);
    if(entry.isSymbolicLink()||index<parts.length-1&&!entry.isDirectory()||
       index===parts.length-1&&(!entry.isFile()||entry.size<1||entry.size>20*1024*1024))
      throw new Error('Historical QA fixture path is not a regular copied evidence file.');
  }
  const canonicalEvidence=await realpath(evidenceRoot),fixturePath=await realpath(config.fixturePath);
  if(!within(canonicalEvidence,fixturePath))
    throw new Error('Historical QA fixture is not a regular copied evidence file.');
  return {fixturePath,walSha256:config.walSha256};
}

function varint(bytes,at){
  let value=0,multiplier=1;
  for(let i=0;i<8;i++){
    assert.ok(at<bytes.length,'complete LevelDB varint');
    const byte=bytes[at++];value+=(byte&0x7f)*multiplier;
    if(!(byte&0x80))return{value,at};
    multiplier*=128;
  }
  assert.fail('oversized LevelDB varint');
}
async function copiedRaw(){
  if(syntheticMode){
    const {syntheticProtectedRaw}=await import('../tests/native-synthetic-fixture.mjs');
    return syntheticProtectedRaw();
  }
  if(receiptlessMode){
    const entry=await lstat(currentCopyPath);
    if(!entry.isFile()||entry.isSymbolicLink()||entry.size!==currentCopyBytes)
      throw new Error('The preserved current raw copy is unavailable or changed.');
    const bytes=await readFile(currentCopyPath);
    assert.equal(sha256(bytes),currentCopySha256,'read-only current raw copy SHA-256');
    const raw=bytes.toString('utf8');
    assert.deepEqual(Buffer.from(raw,'utf8'),bytes,'current raw copy is exact UTF-8');
    return raw;
  }
  historicalSource ||= await loadHistoricalSource();
  const bytes=await readFile(historicalSource.fixturePath);
  assert.equal(sha256(bytes),historicalSource.walSha256,'read-only copied WAL hash');
  let at=0,fragments=[];
  const records=[];
  while(at<bytes.length){
    const left=32768-at%32768;
    if(left<7){at+=left;continue;}
    const length=bytes.readUInt16LE(at+4),kind=bytes[at+6];
    if(length===0&&kind===0){at+=left;continue;}
    assert.ok(length<=left-7,'bounded LevelDB physical record');
    const part=bytes.subarray(at+7,at+7+length);at+=7+length;
    if(kind===1)records.push(part);
    else if(kind===2)fragments=[part];
    else if(kind===3)fragments.push(part);
    else if(kind===4){fragments.push(part);records.push(Buffer.concat(fragments));fragments=[];}
    else assert.fail(`unexpected LevelDB physical record ${kind}`);
  }
  assert.equal(fragments.length,0,'complete writebatch');
  for(const batch of records){
    let offset=12;
    for(let i=0;i<batch.readUInt32LE(8);i++){
      const type=batch[offset++],keyLength=varint(batch,offset);offset=keyLength.at;
      const key=batch.subarray(offset,offset+keyLength.value);offset+=keyLength.value;
      if(type===0)continue;
      assert.equal(type,1,'LevelDB put');
      const valueLength=varint(batch,offset);offset=valueLength.at;
      const value=batch.subarray(offset,offset+valueLength.value);offset+=valueLength.value;
      if(key.toString('utf8').endsWith(`\0\x01${saveKey}`)){
        assert.equal(value[0],1,'Chromium UTF-8 Local Storage encoding');
        return value.subarray(1).toString('utf8');
      }
    }
  }
  assert.fail('the historical copy has no Aincrad save');
}

function childProcess(entry,args){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(electron,[entry,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stdoutLog='';child.stderrLog='';
  for(const [stream,key] of [[child.stdout,'stdoutLog'],[child.stderr,'stderrLog']])
    stream.on('data',chunk=>{child[key]=(child[key]+chunk.toString()).slice(-8192);});
  return child;
}
async function waitExit(child,limitMs=45000){
  if(child.exitCode!==null)return child.exitCode;
  let timer;
  try{return await Promise.race([
    new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code));child.once('error',reject);}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`native process timed out: ${failText(child)}`)),limitMs);}),
  ]);}finally{clearTimeout(timer);}
}
async function waitOutput(file,child,limitMs=30000,{acrossRelaunch=false}={}){
  const deadline=Date.now()+limitMs;
  while(Date.now()<deadline){
    if(existsSync(file))return JSON.parse(await readFile(file,'utf8'));
    if(!acrossRelaunch&&child.exitCode!==null)break;
    await pause(100);
  }
  throw new Error(`native probe produced no result: ${failText(child)}`);
}

async function main(){
  const output=resolve(root,receiptlessMode?'test-results/recovered-native-receiptless-current-summary.json':
    syntheticMode?'test-results/recovered-native-synthetic-summary.json':
      'test-results/recovered-native-summary.json');
  await rm(output,{force:true}); // A failed early setup cannot leave a stale PASS artifact.
  if(!syntheticMode&&!receiptlessMode)historicalSource=await loadHistoricalSource();
  const keep=process.argv.includes('--keep');
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-recovered-native-'));
  const original=join(scratch,'original'),copy=join(scratch,'recovered');
  const pendingScreenshot=resolve(root,receiptlessMode?'test-results/recovered-native-receiptless-current-pending.png':
    syntheticMode?'test-results/recovered-native-synthetic-pending.png':
      'test-results/recovered-native-pending.png');
  const readyScreenshot=resolve(root,receiptlessMode?'test-results/recovered-native-receiptless-current-ready.png':
    syntheticMode?'test-results/recovered-native-synthetic-ready.png':
      'test-results/recovered-native-ready.png');
  const running=new Set();let probeNumber=0;
  const summary={fixture:receiptlessMode?'current-copied-raw':
    syntheticMode?'generated-synthetic-protected':'historical-copied-WAL',
    fixtureSha256:receiptlessMode?currentCopySha256:
      syntheticMode?null:historicalSource.walSha256,checks:[]};
  const check=(name,value=true)=>{assert.ok(value,name);summary.checks.push(name);};
  const argsFor=(mode,config)=>['--test',`--test-profile=${original}`,`--test-recovered-root=${copy}`,
    ...(mode==='recovered'?['--recovered-proof-v1']:[]),`--test-native-qa=${config}`];
  const startProbe=async(mode,action,extra={})=>{
    const number=++probeNumber,configPath=join(scratch,`config-${number}.json`),resultPath=join(scratch,`result-${number}.json`);
    await writeFile(configPath,JSON.stringify({version:1,action,output:resultPath,...extra}));
    const child=childProcess(root,argsFor(mode,configPath));running.add(child);
    child.once('exit',()=>running.delete(child));
    return {child,resultPath};
  };
  const probe=async(mode,action,extra={})=>{
    const {child,resultPath}=await startProbe(mode,action,extra);
    const code=await waitExit(child,action==='inspect'&&extra.waitMs?60000:45000);
    assert.equal(code,0,failText(child));
    const acrossRelaunch=['commit','open-from-original','export-stage'].includes(action);
    const result=await waitOutput(resultPath,child,acrossRelaunch?45000:1000,
      {acrossRelaunch});
    assert.equal(result.ok,true,JSON.stringify(result));
    if(acrossRelaunch)await pause(800); // The final test-only relaunch is quitting after it records readiness.
    return result;
  };
  const profilePaths=(result,where)=>{
    assert.ok(result.paths,'native profile paths present');
    assert.equal(canonical(result.paths.userData),canonical(where),'userData path');
    assert.equal(canonical(result.paths.sessionData),canonical(where),'sessionData path');
    check(`actual storagePath is inside ${where===original?'original':'recovered'} test profile`,
      typeof result.paths.storagePath==='string'&&within(where,result.paths.storagePath));
  };
  try{
    await mkdir(original,{recursive:true}); // The product must reserve and create the absent copy slot.
    const raw=await copiedRaw(),rawBytes=Buffer.from(raw,'utf8'),rawHash=sha256(rawBytes);
    assert.equal(rawBytes.toString('utf8'),raw);
    if(syntheticMode)summary.fixtureSha256=rawHash;
    const plan=prepareLegacyPendingMigration(raw);
    assert.equal(plan.ok,true,plan.reason);
    if(receiptlessMode)assert.deepEqual(plan.report.migrations.map(row=>
      [row.actorId,row.ingestionId,row.actionId,row.proof]),
      [['mira','ingestion:4861',42855,'receiptless-unknown']]);
    else if(syntheticMode)assert.equal(plan.report.migrations.length,1);
    else assert.deepEqual(plan.report.migrations.map(row=>[row.actorId,row.ingestionId]),
      [['mira','ingestion:4690']]);
    const expected=JSON.parse(plan.candidate);
    if(receiptlessMode){
      check('current copy has exactly 89 retained learned effects',
        expected.agents.reduce((count,actor)=>count+actor.discovery.effects.length,0)===89);
      check('Mira pending portion remains unknown historical physical provenance',
        expected.agents.find(actor=>actor.id==='mira')?.physiology.stomach.some(row=>
          row.id==='ingestion:4861'&&row.provenance==='legacy-physical-unknown'));
    }
    if(syntheticMode)check('synthetic fixture carries a genuinely learned effect with retained proof',
      expected.agents.some(actor=>actor.discovery?.effects?.length>0));
    const rawFile=join(scratch,syntheticMode?'generated-synthetic-raw.json':
      receiptlessMode?'current-copied-raw.json':'historical-copied-raw.json'),
      backupFile=join(scratch,'verified-raw-backup.json');
    await writeFile(rawFile,raw,{mode:0o600});
    check('backup is outside both disposable profiles',!within(original,backupFile)&&!within(copy,backupFile));
    await buildApplication();
    const seed=await probe('original','seed',{rawFile,expectedSha256:rawHash});
    profilePaths(seed,original);
    check(`${receiptlessMode?'current copied':syntheticMode?'generated synthetic':'copied historical'} raw bytes seeded into original disposable profile`,
      seed.save?.sha256===rawHash);
    const originalGate=await probe('original','inspect',{waitMs:11000});
    profilePaths(originalGate,original);
    check('protected original is paused and has no runtime',originalGate.ui?.recoveryVisible===true&&
      originalGate.runtime?.present===false);
    check('protected original never autosaved during wait',originalGate.save?.sha256===rawHash&&
      originalGate.afterWait?.save?.sha256===rawHash);
    const staged=await probe('original','export-stage',{backupFile,expectedSha256:rawHash});
    check('protected Export uses native dialog and stages a pending recovered copy',
      staged.exportStage?.ok===true&&staged.exportStage.backupSha256===rawHash&&
      staged.status?.available===true&&staged.status?.phase==='pending');
    const nativeBackup=JSON.parse(await readFile(backupFile,'utf8'));
    check('native export backup contains exact original UTF-8 bytes and SHA-256',
      nativeBackup.byteLength===rawBytes.length&&nativeBackup.sha256===rawHash&&
      Buffer.from(nativeBackup.rawUtf8Base64,'base64').equals(rawBytes));
    const originalAfterExport=await probe('original','inspect');
    check('native export and staging leave original raw bytes unchanged',
      originalAfterExport.save?.sha256===rawHash);
    const protectedOpen=await probe('original','open-from-original',{buttonId:'recovery-open'});
    profilePaths(protectedOpen,copy);
    check('protected original Open button relaunches into separate recovered copy',
      protectedOpen.openFromOriginal?.routed===true&&
      protectedOpen.status?.kind==='recovered'&&protectedOpen.status?.phase==='pending'&&
      protectedOpen.runtime?.present===false);
    const pending=await probe('recovered','inspect',{
      waitMs:11000,screenshotFile:join(scratch,'pending.png')});
    profilePaths(pending,copy);
    check('pending copy has no runtime and no autosave',pending.status?.phase==='pending'&&
      pending.runtime?.present===false&&pending.afterWait?.runtime?.present===false&&
      pending.save?.sha256===pending.afterWait?.save?.sha256);
    await mkdir(dirname(pendingScreenshot),{recursive:true});
    await copyFile(pending.screenshotFile,pendingScreenshot);
    if(!receiptlessMode){
    const sameProcess=await probe('recovered','same-process-reload');
    check('same-process renderer reload cannot mark a newly written candidate ready',
      sameProcess.sameProcessReload?.rejected===true&&sameProcess.status?.phase==='pending'&&
      sameProcess.runtime?.present===false&&sameProcess.save?.sha256===null);

    // A second cooperating process cannot write the same recovered slot.
    const first=await startProbe('recovered','hold',{waitMs:12000});
    const firstResult=await waitOutput(first.resultPath,first.child);
    assert.equal(firstResult.ok,true);
    const second=await startProbe('recovered','inspect');
    const secondExit=await waitExit(second.child,12000);
    check('second recovered-copy process exits while first owns its lock',secondExit===0&&
      !existsSync(second.resultPath)&&first.child.exitCode===null);
    assert.equal(await waitExit(first.child,20000),0,failText(first.child));

    // Surrogate for an older process that never participates in the new lock.
    const legacyFile=join(scratch,'old-style.cjs'),legacyOutput=join(scratch,'old-style-result.json');
    await writeFile(legacyFile,`const {app,session}=require('electron');const fs=require('node:fs');\n`+
      `app.setName('Aincrad');app.setPath('userData',process.argv[2]);app.setPath('sessionData',process.argv[2]);\n`+
      `app.whenReady().then(()=>{fs.writeFileSync(process.argv[3],JSON.stringify({userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),storagePath:session.defaultSession.storagePath}));setTimeout(()=>app.quit(),12000);});\n`);
    const old=childProcess(legacyFile,[original,legacyOutput]);running.add(old);old.once('exit',()=>running.delete(old));
    const oldResult=await waitOutput(legacyOutput,old);
    const copyHold=await startProbe('recovered','hold',{waitMs:12000});
    const copyHoldResult=await waitOutput(copyHold.resultPath,copyHold.child);
    profilePaths(copyHoldResult,copy);
    check('old-style original and recovered copy coexist in separate storage paths',
      old.exitCode===null&&copyHold.child.exitCode===null&&
      within(original,oldResult.storagePath)&&!within(original,copyHoldResult.paths.storagePath));
    assert.equal(await waitExit(old,20000),0,failText(old));
    assert.equal(await waitExit(copyHold.child,20000),0,failText(copyHold.child));
    }

    const committed=await probe('recovered','commit');
    check(`explicit ${receiptlessMode?'current copied-world':syntheticMode?'synthetic':'copied-world'} import reached ready state`,
      committed.commit?.ok===true&&
      committed.status?.kind==='recovered'&&committed.status?.phase==='ready');
    const reopened=await probe('recovered','inspect',{
      screenshotFile:join(scratch,'ready.png')});
    profilePaths(reopened,copy);
    check('ready copy reopens with a runtime and clear active-copy label',
      reopened.status?.phase==='ready'&&reopened.runtime?.present===true&&
      /recovered copy/i.test(reopened.ui?.activeCopyLabel||''));
    for(const id of ['aster','mira']){
      const actor=reopened.actors?.find(row=>row.id===id),reference=expected.agents.find(row=>row.id===id);
      assert.ok(actor&&reference,`${id} present in native reopened copy`);
      assert.deepEqual(actor.physiology,reference.physiology,`${id} exact physical state after native reopen`);
      assert.deepEqual(actor.effects,reference.discovery.effects,`${id} exact learned effects after native reopen`);
    }
    check('exact physical bodies and learned effects survive native full close/reopen');
    if(receiptlessMode){
      check('ready recovered copy stores the exact preflight candidate',
        reopened.save?.sha256===sha256(Buffer.from(plan.candidate,'utf8')));
      check('native reopened copy retains all 89 learned effects',
        reopened.actors.reduce((count,actor)=>count+actor.effects.length,0)===89);
    }
    await copyFile(reopened.screenshotFile,readyScreenshot);
    const originalAfter=await probe('original','inspect');
    profilePaths(originalAfter,original);
    check('original raw save is byte-identical after separate-profile import',originalAfter.save?.sha256===rawHash&&
      originalAfter.save?.byteLength===rawBytes.length);
    if(receiptlessMode)
      check('preserved current raw fixture remains byte-identical on disk',
        sha256(await readFile(currentCopyPath))===currentCopySha256);
    summary.originalRawSha256=rawHash;
    summary.copyRawSha256=reopened.save?.sha256||null;
    summary.pendingScreenshot=pendingScreenshot;
    summary.readyScreenshot=readyScreenshot;
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(summary,null,2)+'\n');
    console.log(`PASS: native recovered-copy QA (${summary.checks.length} checks). ${output}`);
  }catch(error){
    summary.error=error?.stack||String(error);
    for(const name of await readdir(scratch).catch(()=>[])){
      if(/^result-\d+\.json$/.test(name))try{
        const result=JSON.parse(await readFile(join(scratch,name),'utf8'));
        if(result.ok===false)summary.nativeFailureDiagnostic=result;
      }catch{}
      if(/^result-\d+\.json\.failure\.png$/.test(name)){
        const failureScreenshot=resolve(root,receiptlessMode?
          'test-results/recovered-native-receiptless-current-failure.png':
          'test-results/recovered-native-failure.png');
        await mkdir(dirname(failureScreenshot),{recursive:true});
        await copyFile(join(scratch,name),failureScreenshot);
        summary.failureScreenshot=failureScreenshot;
      }
    }
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(summary,null,2)+'\n');
    console.error(`FAIL: native recovered-copy QA. ${output}\n${summary.error}`);
    process.exitCode=1;
  }finally{
    for(const child of running)if(child.exitCode===null)child.kill('SIGTERM');
    await pause(500);
    for(const child of running)if(child.exitCode===null)child.kill('SIGKILL');
    if(keep)console.log(`Disposable QA profiles retained at ${scratch}`);
    else await rm(scratch,{recursive:true,force:true});
  }
}

async function runOriginalOpenRoutes(){
  if(syntheticMode)throw new Error('The historical Open-route QA uses copied evidence only.');
  const output=resolve(root,'test-results/recovered-original-open-summary.json');
  await rm(output,{force:true});
  const raw=await copiedRaw(),migration=prepareLegacyPendingMigration(raw);
  assert.equal(migration.ok,true,migration.reason);
  const candidate=migration.candidate,candidateBytes=Buffer.from(candidate,'utf8');
  const candidateHash=sha256(candidateBytes);
  const scratch=await mkdtemp(join(tmpdir(),'aincrad-original-open-'));
  const original=join(scratch,'original'),copy=join(scratch,'recovered');
  const running=new Set();let probeNumber=0;
  const summary={fixture:'historical-copied-WAL-derived-candidate',
    fixtureSha256:historicalSource.walSha256,candidateSha256:candidateHash,checks:[]};
  const check=(name,value=true)=>{assert.ok(value,name);summary.checks.push(name);};
  const start=async(mode,action,extra={})=>{
    const number=++probeNumber,configPath=join(scratch,`config-${number}.json`),
      resultPath=join(scratch,`result-${number}.json`);
    await writeFile(configPath,JSON.stringify({version:1,action,output:resultPath,...extra}));
    const args=['--test',`--test-profile=${original}`,`--test-recovered-root=${copy}`,
      ...(mode==='recovered'?['--recovered-proof-v1']:[]),`--test-native-qa=${configPath}`];
    const child=childProcess(root,args);running.add(child);child.once('exit',()=>running.delete(child));
    return {child,resultPath};
  };
  const probe=async(mode,action,extra={})=>{
    const {child,resultPath}=await start(mode,action,extra);
    assert.equal(await waitExit(child,45000),0,failText(child));
    const acrossRelaunch=action==='open-from-original'&&extra.profileOpenFault!=='reject';
    const result=await waitOutput(resultPath,child,acrossRelaunch?45000:1000,{acrossRelaunch});
    assert.equal(result.ok,true,JSON.stringify(result));
    if(acrossRelaunch)await pause(800);
    return result;
  };
  try{
    await mkdir(original,{recursive:true});
    const rawFile=join(scratch,'derived-original.json'),backupFile=join(scratch,'derived-backup.json');
    await writeFile(rawFile,candidate,{mode:0o600});
    await writeFile(backupFile,JSON.stringify({format:'aincrad.raw-save-backup.v1',saveKey,
      byteLength:candidateBytes.length,sha256:candidateHash,
      rawUtf8Base64:candidateBytes.toString('base64')})+'\n',{mode:0o600});
    await buildApplication();
    const seeded=await probe('original','seed',{rawFile,expectedSha256:candidateHash});
    check('playable original seeded only in disposable profile',seeded.save.sha256===candidateHash);
    const staged=await probe('original','stage',{backupFile});
    check('same-source verified copy available to original UI',staged.stage?.ok===true&&
      staged.status?.available===true&&staged.status?.phase==='pending');

    const welcome=await probe('original','open-from-original',{buttonId:'welcome-open-copy'});
    check('ordinary original welcome Open relaunches into separate pending copy',
      welcome.openFromOriginal?.routed===true&&welcome.status?.kind==='recovered'&&
      welcome.status?.phase==='pending'&&
      canonical(welcome.paths?.userData)===canonical(copy)&&
      canonical(welcome.paths?.sessionData)===canonical(copy)&&
      within(copy,welcome.paths?.storagePath));
    const afterWelcome=await probe('original','inspect');
    check('welcome route does not rewrite original world',afterWelcome.save.sha256===candidateHash);

    const delayedProgressFile=join(scratch,'delayed-progress.json');
    const delayed=await probe('original','open-from-original',{
      buttonId:'pause-open-copy',profileOpenFault:'delay',progressFile:delayedProgressFile});
    check('slow pause Open blocks Resume and keeps save fixed until copy relaunch',
      delayed.openFromOriginal?.routed===true&&
      delayed.openFromOriginal?.progress?.delayedOpenQuiesced===true&&
      delayed.status?.kind==='recovered'&&delayed.status?.phase==='pending');
    const afterDelayed=await probe('original','inspect');
    check('ordinary original reopen retains exact saved progress after slow Open',
      afterDelayed.worldElapsed===delayed.openFromOriginal.progress.expectedElapsed&&
      afterDelayed.save.sha256!==candidateHash);

    const rejectedProgressFile=join(scratch,'rejected-progress.json');
    const rejected=await probe('original','open-from-original',{
      buttonId:'pause-open-copy',profileOpenFault:'reject',progressFile:rejectedProgressFile});
    const rejectedProgress=JSON.parse(await readFile(rejectedProgressFile,'utf8'));
    check('rejected pause Open stays original and restores play and saving',
      rejected.openFromOriginal?.rejected===true&&rejectedProgress.openRejected===true&&
      rejected.status?.kind==='original'&&rejected.runtime?.present===true&&
      rejected.worldElapsed===rejectedProgress.expectedElapsed);
    const afterRejected=await probe('original','inspect');
    summary.rejectedProgress={savedAtProbe:rejectedProgress.expectedElapsed,
      reopened:afterRejected.worldElapsed};
    check('saved progression after rejected Open survives ordinary close/reopen',
      afterRejected.worldElapsed>=rejectedProgress.expectedElapsed&&
      afterRejected.save.sha256!==null);

    const plainProgressFile=join(scratch,'plain-progress.json');
    const plain=await probe('original','open-from-original',{
      buttonId:'pause-open-copy',progressFile:plainProgressFile});
    const afterPlain=await probe('original','inspect');
    check('ordinary pause Open routes to copy and preserves latest original save',
      plain.openFromOriginal?.routed===true&&plain.status?.kind==='recovered'&&
      afterPlain.worldElapsed===plain.openFromOriginal.progress.expectedElapsed);
    summary.finalOriginalSha256=afterPlain.save.sha256;
  }catch(error){
    summary.error=error?.stack||String(error);
    for(const name of await readdir(scratch).catch(()=>[]))if(/^result-\d+\.json$/.test(name))try{
      const result=JSON.parse(await readFile(join(scratch,name),'utf8'));
      if(result.ok===false)summary.nativeFailureDiagnostic=result;
    }catch{}
    process.exitCode=1;
  }finally{
    for(const child of running)if(child.exitCode===null)child.kill('SIGTERM');
    await pause(500);
    for(const child of running)if(child.exitCode===null)child.kill('SIGKILL');
    if(process.argv.includes('--keep'))summary.disposableProfile=scratch;
    else await rm(scratch,{recursive:true,force:true});
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify(summary,null,2)+'\n');
    console.log(`${summary.error?'FAIL':'PASS'}: original Open routes (${summary.checks.length} checks). ${output}`);
  }
}

async function runFaultMatrix(){
  if(syntheticMode)throw new Error('The historical native fault matrix uses copied evidence only.');
  const output=resolve(root,'test-results/recovered-native-fault-summary.json');
  await rm(output,{force:true});
  const raw=await copiedRaw(),rawBytes=Buffer.from(raw,'utf8'),rawHash=sha256(rawBytes);
  const plan=prepareLegacyPendingMigration(raw);
  assert.equal(plan.ok,true,plan.reason);
  const candidate=JSON.parse(plan.candidate);
  const kinds=['quota','write-throw','write-ignored','readback-corrupt',
    'restart-reject','restart-exit','after-slot-mkdir','before-manifest'];
  const summary={fixture:'historical-copied-WAL',fixtureSha256:historicalSource.walSha256,
    originalRawSha256:rawHash,scenarios:[]};
  await buildApplication();
  for(const kind of kinds){
    const scratch=await mkdtemp(join(tmpdir(),`aincrad-fault-${kind}-`));
    const original=join(scratch,'original'),copy=join(scratch,'recovered');
    const running=new Set();let probeNumber=0;
    const scenario={kind,checks:[]};
    const check=(name,value=true)=>{assert.ok(value,`${kind}: ${name}`);scenario.checks.push(name);};
    const argsFor=(mode,config,originalRoot=original)=>['--test',`--test-profile=${originalRoot}`,
      `--test-recovered-root=${copy}`,...(mode==='recovered'?['--recovered-proof-v1']:[]),
      `--test-native-qa=${config}`];
    const start=async(mode,action,extra={},originalRoot=original)=>{
      const number=++probeNumber,configPath=join(scratch,`config-${number}.json`),
        resultPath=join(scratch,`result-${number}.json`);
      await writeFile(configPath,JSON.stringify({version:1,action,output:resultPath,...extra}));
      const child=childProcess(root,argsFor(mode,configPath,originalRoot));running.add(child);
      child.once('exit',()=>running.delete(child));
      return {child,resultPath};
    };
    const probe=async(mode,action,extra={},originalRoot=original)=>{
      const {child,resultPath}=await start(mode,action,extra,originalRoot);
      assert.equal(await waitExit(child,45000),0,failText(child));
      const acrossRelaunch=['commit','resume'].includes(action);
      const result=await waitOutput(resultPath,child,acrossRelaunch?45000:1000,
        {acrossRelaunch});
      assert.equal(result.ok,true,JSON.stringify(result));
      if(acrossRelaunch)await pause(800);
      return result;
    };
    const interrupted=async(mode,action,expectedExit,extra={})=>{
      const {child,resultPath}=await start(mode,action,extra);
      const code=await waitExit(child,45000);
      assert.equal(code,expectedExit,failText(child));
      check(`${action} exits at the injected boundary (${expectedExit})`,
        !existsSync(resultPath));
    };
    try{
      await mkdir(original,{recursive:true});
      const rawFile=join(scratch,'historical-copied-raw.json'),
        backupFile=join(scratch,'verified-raw-backup.json');
      await writeFile(rawFile,raw,{mode:0o600});
      await writeFile(backupFile,JSON.stringify({format:'aincrad.raw-save-backup.v1',
        saveKey,byteLength:rawBytes.length,sha256:rawHash,
        rawUtf8Base64:rawBytes.toString('base64')})+'\n',{mode:0o600});
      const seeded=await probe('original','seed',{rawFile,expectedSha256:rawHash});
      check('copied historical original seeded exactly',seeded.save.sha256===rawHash);
      if(['after-slot-mkdir','before-manifest'].includes(kind)){
        await interrupted('original','fault-stage',87,{backupFile,faultKind:kind});
        const protectedOriginal=await probe('original','inspect');
        check('interrupted publication keeps original protected and byte-identical',
          protectedOriginal.status.kind==='original'&&protectedOriginal.status.phase==='invalid'&&
          protectedOriginal.runtime.present===false&&protectedOriginal.save.sha256===rawHash);
        if(kind==='after-slot-mkdir'){
          const attempt=await start('original','stage',{backupFile});
          assert.equal(await waitExit(attempt.child,45000),1,failText(attempt.child));
          const rejected=await waitOutput(attempt.resultPath,attempt.child,1000);
          check('unknown empty slot rejects retry without overwrite',rejected.ok===false&&
            /incomplete or ambiguous/i.test(rejected.error));
        }else{
          const otherOriginal=join(scratch,'divergent-original');
          await mkdir(otherOriginal,{recursive:true});
          const otherRaw=plan.candidate,otherBytes=Buffer.from(otherRaw,'utf8'),
            otherHash=sha256(otherBytes),otherRawFile=join(scratch,'divergent-raw.json'),
            otherBackupFile=join(scratch,'divergent-backup.json');
          await writeFile(otherRawFile,otherRaw,{mode:0o600});
          await writeFile(otherBackupFile,JSON.stringify({format:'aincrad.raw-save-backup.v1',
            saveKey,byteLength:otherBytes.length,sha256:otherHash,
            rawUtf8Base64:otherBytes.toString('base64')})+'\n',{mode:0o600});
          const otherSeed=await probe('original','seed',
            {rawFile:otherRawFile,expectedSha256:otherHash},otherOriginal);
          assert.equal(otherSeed.save.sha256,otherHash);
          const divergent=await start('original','stage',
            {backupFile:otherBackupFile},otherOriginal);
          assert.equal(await waitExit(divergent.child,45000),1,failText(divergent.child));
          const refusal=await waitOutput(divergent.resultPath,divergent.child,1000);
          check('occupied reservation refuses a different verified source',
            refusal.ok===false&&/different|source|reserved|occupied/i.test(refusal.error)&&
            (await probe('original','inspect',{},otherOriginal)).save.sha256===otherHash);
          const resumed=await probe('original','stage',{backupFile});
          check('same-source reservation and stage resume to verified pending',
            resumed.stage?.ok===true&&resumed.status.phase==='pending');
          const pending=await probe('recovered','inspect');
          check('resumed copy remains paused until explicit import',
            pending.status.phase==='pending'&&!pending.runtime.present&&pending.save.sha256===null);
          const committed=await probe('recovered','commit');
          check('resumed publication imports after closed-process verification',
            committed.status.phase==='ready'&&committed.runtime.present);
        }
      }else{
        const staged=await probe('original','stage',{backupFile});
        check('verified copy staged',staged.stage?.ok===true&&staged.status.phase==='pending');
        if(kind==='restart-exit'){
          await interrupted('recovered','fault-import',86,{faultKind:kind});
        }else{
          const failed=await probe('recovered','fault-import',{faultKind:kind});
          const shouldWrite=['readback-corrupt','restart-reject'].includes(kind);
          check('injected failure leaves copy pending with no runtime',
            failed.fault?.paused===true&&failed.status.phase==='pending'&&
            failed.runtime.present===false&&failed.ui.recoveryVisible===true&&
            (failed.save.sha256!==null)===shouldWrite);
        }
        const recovered=await probe('recovered','resume');
        check('fresh process sees only pending-empty or independently ready',
          recovered.resume?.phase==='pending-empty'||recovered.resume?.phase==='ready');
        if(recovered.resume.phase==='pending-empty'){
          check('empty copy is paused with no runtime or saved candidate',
            recovered.status.phase==='pending'&&!recovered.runtime.present&&
            recovered.save.sha256===null);
          const committed=await probe('recovered','commit');
          check('explicit retry imports after empty-key fault',
            committed.status.phase==='ready'&&committed.runtime.present);
        }
        const ready=await probe('recovered','inspect');
        check('ready copy has separately stored exact migration candidate',
          ready.status.phase==='ready'&&ready.runtime.present&&
          ready.save.sha256===sha256(Buffer.from(plan.candidate,'utf8')));
        for(const id of ['aster','mira']){
          const actor=ready.actors.find(row=>row.id===id),reference=candidate.agents.find(row=>row.id===id);
          assert.deepEqual(actor?.physiology,reference?.physiology,`${kind}: ${id} physical state`);
          assert.deepEqual(actor?.effects,reference?.discovery.effects,`${kind}: ${id} learned effects`);
        }
        check('Aster and Mira physical bodies and effects remain exact');
      }
      const originalAfter=await probe('original','inspect');
      check('original raw bytes stay unchanged through fault and recovery',
        originalAfter.save.sha256===rawHash&&originalAfter.save.byteLength===rawBytes.length);
      scenario.ok=true;
    }catch(error){
      scenario.ok=false;scenario.error=error?.stack||String(error);
      for(const name of await readdir(scratch).catch(()=>[]))
        if(/^result-\d+\.json$/.test(name))try{
          const result=JSON.parse(await readFile(join(scratch,name),'utf8'));
          if(result.ok===false)scenario.nativeFailureDiagnostic=result;
        }catch{}
    }finally{
      for(const child of running)if(child.exitCode===null)child.kill('SIGTERM');
      await pause(300);
      for(const child of running)if(child.exitCode===null)child.kill('SIGKILL');
      if(process.argv.includes('--keep'))scenario.disposableProfile=scratch;
      else await rm(scratch,{recursive:true,force:true});
      summary.scenarios.push(scenario);
      await mkdir(dirname(output),{recursive:true});
      await writeFile(output,JSON.stringify(summary,null,2)+'\n');
      console.log(`${scenario.ok?'PASS':'FAIL'}: ${kind} (${scenario.checks.length} checks)`);
    }
    if(!scenario.ok){process.exitCode=1;break;}
  }
  console.log(`Native fault matrix: ${summary.scenarios.filter(row=>row.ok).length}/${kinds.length} passed. ${output}`);
}

if((syntheticMode?1:0)+(receiptlessMode?1:0)+historicalOptions.length!==1||
    receiptlessMode&&(process.argv.includes('--faults')||process.argv.includes('--open-routes'))){
  console.error('Choose --ci-synthetic, --receiptless-current, or one local --historical-config=<absolute JSON>.');
  process.exitCode=1;
}
else if(process.argv.includes('--faults'))await runFaultMatrix();
else if(process.argv.includes('--open-routes'))await runOriginalOpenRoutes();
else await main();
