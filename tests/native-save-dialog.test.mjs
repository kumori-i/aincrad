import test from 'node:test';
import assert from 'node:assert/strict';
import { driveNativeSaveDialog } from '../scripts/native-save-dialog.mjs';

const png=Buffer.alloc(12000);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
const authorized={CI:'true',AINCRAD_NATIVE_DIALOG_CI:'1',DISPLAY:':99'};
function harness(platform='linux'){
  const calls=[];
  return {calls,options:{pid:1234,action:'save',destination:'/isolated/generated/current.json',screenshot:'/isolated/evidence/dialog.png',platform,env:authorized,
    run:async(file,args)=>{calls.push({file,args});return {stdout:file==='xdotool'&&args[0]==='search'?'77\n':''};},wait:async()=>{},read:async()=>png}};
}

test('command contract only: native automation requires explicit isolated CI authorization',async()=>{
  const {calls,options}=harness();
  await assert.rejects(driveNativeSaveDialog({...options,env:{CI:'true'}}),/explicitly authorized isolated CI/);
  assert.equal(calls.length,0);
});
test('command contract only: Linux targets exactly one visible app-PID Save dialog and captures before keyboard action',async()=>{
  const {calls,options}=harness();const result=await driveNativeSaveDialog(options);
  assert.equal(result.realOsDialog,true);
  assert.deepEqual(calls[0],{file:'xdotool',args:['search','--onlyvisible','--pid','1234','--name','^Back up current stored Aincrad world before reset$']});
  const capture=calls.findIndex(c=>c.file==='import');
  const input=calls.findIndex(c=>c.file==='xdotool'&&c.args[0]==='key');
  assert.ok(capture<input);
  assert.ok(calls.some(c=>c.args.includes('/isolated/generated/current.json')));
  assert.ok(calls.filter(c=>c.args[0]==='key').every(c=>c.args.includes('--clearmodifiers')));
});
test('command contract only: Linux Cancel sends native Escape rather than renderer or IPC substitution',async()=>{
  const {calls,options}=harness();await driveNativeSaveDialog({...options,action:'cancel'});
  assert.deepEqual(calls.at(-1),{file:'xdotool',args:['key','--clearmodifiers','Escape']});
  assert.ok(!calls.some(c=>c.args.includes('ctrl+l')));
});
test('command contract only: screenshot failure blocks native Save input',async()=>{
  const {calls,options}=harness();
  await assert.rejects(driveNativeSaveDialog({...options,read:async()=>Buffer.from('empty')}),/screenshot is missing\/empty/);
  assert.ok(!calls.some(c=>c.file==='xdotool'&&c.args[0]==='key'));
});
test('command contract only: macOS uses actual System Events sheet controls and screen capture',async()=>{
  const {calls,options}=harness('darwin');await driveNativeSaveDialog(options);
  assert.deepEqual(calls.map(c=>c.file),['osascript','screencapture','osascript']);
  assert.ok(calls[0].args[1].includes('unix id is targetPid'));
  assert.ok(calls[0].args[1].includes('button "Save"'));
  assert.deepEqual(calls.at(-1).args.slice(-4),['1234','save','current.json','/isolated/generated']);
  assert.ok(!calls.some(c=>c.file==='tccutil'||c.file==='sqlite3'||c.file==='sudo'));
});
test('command contract only: Accessibility denial is a blocking error, not a skipped native pass',async()=>{
  const {options}=harness('darwin');
  let calls=0;
  await assert.rejects(driveNativeSaveDialog({...options,run:async()=>{calls++;throw new Error('not authorized to send Apple events');}}),/Accessibility\/Automation permission required/);
  assert.equal(calls,1,'Unchanged permission denial is never retried');
});

test('command contract only: missing Linux tool is not retried',async()=>{
  const {options}=harness();let calls=0;
  await assert.rejects(driveNativeSaveDialog({...options,run:async()=>{calls++;throw Object.assign(new Error('spawn ENOENT'),{code:'ENOENT'});}}),/ENOENT/);
  assert.equal(calls,1);
});
test('command contract only: Linux no-match readiness can wait before targeting visible dialog',async()=>{
  const {calls,options}=harness();const successful=options.run;let probes=0;
  await driveNativeSaveDialog({...options,action:'cancel',run:async(file,args,settings)=>{
    if(file==='xdotool'&&args[0]==='search'&&++probes===1)throw Object.assign(new Error('no match'),{code:1,stderr:''});
    return successful(file,args,settings);
  }});
  assert.equal(probes,2);assert.ok(calls.some(c=>c.args.includes('Escape')));
});
