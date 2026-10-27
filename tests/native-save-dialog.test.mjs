import test from 'node:test';
import assert from 'node:assert/strict';
import { driveNativeSaveDialog } from '../scripts/native-save-dialog.mjs';

const png=Buffer.alloc(12000);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
const authorized={CI:'true',AINCRAD_NATIVE_DIALOG_CI:'1',DISPLAY:':99'};
function harness(platform='linux'){
  const calls=[];
  return {calls,options:{pid:1234,action:'save',destination:'/isolated/generated/current.json',screenshot:'/isolated/evidence/dialog.png',platform,env:authorized,
    run:async(file,args)=>{calls.push({file,args});return {stdout:file==='xdotool'&&['search','getwindowfocus'].includes(args[0])?'77\n':''};},wait:async()=>{},read:async()=>png,write:async()=>{}}};
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
  assert.deepEqual(calls.map(c=>c.file),['screencapture','osascript','screencapture','osascript','osascript']);
  assert.ok(calls[1].args[1].includes('unix id is targetPid'));
  assert.ok(calls[1].args[1].includes('elementName is "Save"'));
  assert.deepEqual(calls.at(-1).args.slice(-4),['1234','save','current.json','/isolated/generated']);
  assert.ok(!calls.some(c=>c.file==='tccutil'||c.file==='sqlite3'||c.file==='sudo'));
});
test('command contract only: Accessibility denial is a blocking error, not a skipped native pass',async()=>{
  const {options}=harness('darwin');
  let calls=0;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file)=>{if(file==='screencapture')return {stdout:''};calls++;throw new Error('not authorized to send Apple events');}}),/Accessibility\/Automation permission required/);
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

test('command contract only: already focused modal receives no WM activation or focus request',async()=>{
  const {calls,options}=harness();await driveNativeSaveDialog({...options,action:'cancel'});
  assert.ok(calls.some(c=>c.args[0]==='getwindowfocus'));
  assert.ok(!calls.some(c=>['windowactivate','windowfocus'].includes(c.args[0])));
});
test('command contract only: unfocused dialog gets one ordinary focus request after screenshot and is verified',async()=>{
  const {calls,options}=harness();const successful=options.run;let focus=0;
  await driveNativeSaveDialog({...options,action:'cancel',run:async(file,args,settings)=>{
    if(args[0]==='getwindowfocus'&&++focus===1){calls.push({file,args});return {stdout:'88\n'};}
    return successful(file,args,settings);
  }});
  const requests=calls.filter(c=>c.args[0]==='windowfocus');
  assert.deepEqual(requests,[{file:'xdotool',args:['windowfocus','77']}]);
  assert.ok(calls.findIndex(c=>c.file==='import')<calls.findIndex(c=>c.args[0]==='windowfocus'));
  assert.ok(!calls.some(c=>c.args.includes('--sync')));
});
test('command contract only: wrong focus after one request blocks input and records target/focus diagnostics',async()=>{
  const {calls,options}=harness();const successful=options.run;let record;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(args[0]==='getwindowfocus'){calls.push({file,args});return {stdout:'88\n'};}
    return successful(file,args,settings);
  },write:async(path,data)=>{record={path,data:JSON.parse(data)};}}),/did not acquire exact target focus/);
  assert.ok(!calls.some(c=>['key','type'].includes(c.args[0])));
  assert.equal(record.path,options.screenshot+'.dialog.json');
  assert.equal(record.data.windowId,'77');assert.deepEqual(record.data.focus,['88','88']);
  assert.equal(record.data.status,'failed');
});
test('command contract only: focus loss immediately before input is not refocused or retried',async()=>{
  const {calls,options}=harness();const successful=options.run;let focus=0;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(args[0]==='getwindowfocus'&&++focus>1){calls.push({file,args});return {stdout:'88\n'};}
    return successful(file,args,settings);
  }}),/lost exact target focus/);
  assert.ok(!calls.some(c=>['key','type','windowfocus'].includes(c.args[0])));
});

test('command contract only: Mac recognition failure retains screenshot and AX hierarchy without input',async()=>{
  const {calls,options}=harness('darwin');const successful=options.run;let record;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(file==='osascript'&&args.at(-1)==='inspect'){calls.push({file,args});return {stdout:'AXGroup | nested\nAXButton | Save'};}
    if(file==='osascript'&&args.at(-1)==='probe'){calls.push({file,args});throw Object.assign(new Error('ambiguous'),{stderr:'Native Save sheet requires unique descendant Save and Cancel buttons'});}
    return successful(file,args,settings);
  },write:async(_path,data)=>{record=JSON.parse(data);}}),/unique descendant/);
  assert.equal(calls[0].file,'screencapture');
  assert.equal(record.accessibilityHierarchy,'AXGroup | nested\nAXButton | Save');
  assert.equal(record.status,'failed');
  assert.ok(!calls.some(c=>c.file==='osascript'&&c.args.includes('save')));
  const source=calls.find(c=>c.file==='osascript').args[1];
  assert.ok(source.includes('entire contents of saveSheet'));
  assert.ok(source.includes('(count textFields) is 1'));
  assert.ok(source.includes('(count foundSheets) is not 1'));
  assert.ok(!source.includes('text field 1 of saveSheet'));
});
