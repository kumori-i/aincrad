import test from 'node:test';
import assert from 'node:assert/strict';
import { driveNativeSaveDialog } from '../scripts/native-save-dialog.mjs';

const png=Buffer.alloc(12000);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
const authorized={CI:'true',AINCRAD_NATIVE_DIALOG_CI:'1',DISPLAY:':99'};
function harness(platform='linux'){
  const calls=[];let searches=0;
  return {calls,options:{pid:1234,action:'save',destination:'/isolated/generated/current.json',screenshot:'/isolated/evidence/dialog.png',platform,env:authorized,
    run:async(file,args)=>{calls.push({file,args});return {stdout:file==='xdotool'&&args[0]==='search'?(++searches===1?'77\n':''):file==='xdotool'&&args[0]==='getwindowfocus'?'77\n':file==='xprop'&&args[1]==='77'?'WM_NAME(STRING) = "Back up current stored Aincrad world before reset"\n_NET_WM_PID(CARDINAL) = 1234':''};},wait:async()=>{},read:async()=>png,write:async()=>{}}};
}

test('command contract only: native automation requires explicit isolated CI authorization',async()=>{
  const {calls,options}=harness();
  await assert.rejects(driveNativeSaveDialog({...options,env:{CI:'true'}}),/explicitly authorized isolated CI/);
  assert.equal(calls.length,0);
});
test('command contract only: Linux targets exactly one visible app-PID Save dialog and captures before keyboard action',async()=>{
  const {calls,options}=harness();const result=await driveNativeSaveDialog(options);
  assert.equal(result.realOsDialog,true);
  assert.deepEqual(calls[0],{file:'xdotool',args:['search','--all','--onlyvisible','--pid','1234','--name','^Back up current stored Aincrad world before reset$']});
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
test('command contract only: known child focus is preserved rather than moved to wrapper',async()=>{
  const {calls,options}=harness();const successful=options.run;
  const result=await driveNativeSaveDialog({...options,action:'cancel',run:async(file,args,settings)=>{
    if(file==='xdotool'&&args[0]==='getwindowfocus'){calls.push({file,args});return {stdout:'88\n'};}
    if(file==='xwininfo'&&args[1]==='88'){calls.push({file,args});return {stdout:'Parent window id: 0x4d'};}
    return successful(file,args,settings);
  }});
  assert.equal(result.realOsDialog,true);
  assert.ok(calls.some(c=>c.args.includes('Escape')));
  assert.ok(!calls.some(c=>['windowfocus','windowactivate'].includes(c.args[0])));
});
test('command contract only: unrelated focus blocks input and records X hierarchy diagnostics',async()=>{
  const {calls,options}=harness();const successful=options.run;let record;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(args[0]==='getwindowfocus'){calls.push({file,args});return {stdout:'88\n'};}
    return successful(file,args,settings);
  },write:async(path,data)=>{record={path,data:JSON.parse(data)};}}),/focus ownership cannot be proved/);
  assert.ok(!calls.some(c=>['key','type','windowfocus','windowactivate'].includes(c.args[0])));
  assert.equal(record.data.windowId,'77');assert.equal(record.data.focus[0].raw,'88');
  assert.equal(record.data.focus[0].trusted,false);assert.equal(record.data.status,'failed');
  assert.ok(Object.hasOwn(record.data,'rootTree'));assert.equal(record.data.target.id,'77');
});
test('command contract only: exact-title transient relationship can prove a native chooser, title alone cannot',async()=>{
  for(const linked of [true,false]){
    const {calls,options}=harness();const successful=options.run;
    const operation=driveNativeSaveDialog({...options,action:'cancel',run:async(file,args,settings)=>{
      if(args[0]==='getwindowfocus'){calls.push({file,args});return {stdout:'88\n'};}
      if(file==='xprop'&&args[1]==='88'){calls.push({file,args});return {stdout:'WM_NAME(STRING) = "Back up current stored Aincrad world before reset"\n'+(linked?'WM_TRANSIENT_FOR(WINDOW): window id # 0x4d':'')};}
      return successful(file,args,settings);
    }});
    if(linked)await operation;else await assert.rejects(operation,/focus ownership cannot be proved/);
    assert.equal(calls.some(c=>c.args.includes('Escape')),linked);
  }
});
test('command contract only: focus loss before input stops without refocusing',async()=>{
  const {calls,options}=harness();const successful=options.run;let focus=0;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(args[0]==='getwindowfocus'&&++focus>2){calls.push({file,args});return {stdout:'88\n'};}
    return successful(file,args,settings);
  }}),/lost proven target/);
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

test('command contract only: both dialog searches require conjunction of PID and exact title',async()=>{
  const {calls,options}=harness();await driveNativeSaveDialog(options);
  const searches=calls.filter(c=>c.file==='xdotool'&&c.args[0]==='search');
  assert.equal(searches.length,2);
  for(const search of searches){assert.ok(search.args.includes('--all'));assert.ok(search.args.includes('--pid'));assert.ok(search.args.includes('--name'));assert.ok(!search.args.includes('--any'));}
});
test('command contract only: independently reject search results with wrong PID or main-window title',async()=>{
  for(const properties of [
    'WM_NAME(STRING) = "Aincrad — Ozark wilderness"\n_NET_WM_PID(CARDINAL) = 1234',
    'WM_NAME(STRING) = "Back up current stored Aincrad world before reset"\n_NET_WM_PID(CARDINAL) = 9999',
  ]){
    const {calls,options}=harness();const successful=options.run;
    await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
      if(file==='xprop'&&args[1]==='77'){calls.push({file,args});return {stdout:properties};}
      return successful(file,args,settings);
    }}),/independently match exact Save title and Electron PID/);
    assert.ok(!calls.some(c=>['key','type','windowfocus'].includes(c.args[0])));
  }
});
test('command contract only: genuine multiple search matches remain an error',async()=>{
  const {calls,options}=harness();const successful=options.run;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(file==='xdotool'&&args[0]==='search'){calls.push({file,args});return {stdout:'77\n88\n'};}
    return successful(file,args,settings);
  }}),/Multiple matching native Save dialogs/);
  assert.ok(!calls.some(c=>['key','type'].includes(c.args[0])));
});

test('command contract only: GTK Save replaces entire Name value, captures text entry, and submits once',async()=>{
  const {calls,options}=harness();await driveNativeSaveDialog(options);
  const inputs=calls.filter(c=>c.file==='xdotool'&&['key','type'].includes(c.args[0]));
  assert.deepEqual(inputs.map(c=>c.args[0]==='type'?'type':c.args.at(-1)),['ctrl+l','ctrl+a','type','Return']);
  const typed=calls.findIndex(c=>c.args[0]==='type');
  const entered=calls.findIndex(c=>c.file==='import'&&c.args.at(-1).endsWith('.path-entered.png'));
  const submitted=calls.findIndex(c=>c.args.at(-1)==='Return');
  const after=calls.findIndex(c=>c.file==='import'&&c.args.at(-1).endsWith('.after-submit.png'));
  assert.ok(typed<entered&&entered<submitted&&submitted<after);
});
test('command contract only: nondismissal fails with post-submit OS screenshot and never reactivates Save',async()=>{
  const {calls,options}=harness();const successful=options.run;let record;
  await assert.rejects(driveNativeSaveDialog({...options,run:async(file,args,settings)=>{
    if(file==='xdotool'&&args[0]==='search'){calls.push({file,args});return {stdout:'77\n'};}
    return successful(file,args,settings);
  },write:async(_path,data)=>{record=JSON.parse(data);}}),/remained open after one submission/);
  assert.equal(calls.filter(c=>c.args.at(-1)==='Return').length,1);
  assert.equal(calls.filter(c=>c.args[0]==='search').length,51);
  assert.equal(record.saveDialogDismissed,false);assert.equal(record.status,'failed');
  assert.ok(calls.some(c=>c.file==='import'&&c.args.at(-1)===record.postInputScreenshot));
  assert.ok(record.postInputScreenshot.endsWith('.after-submit.png'));
});
