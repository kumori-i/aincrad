/** CI-only OS interaction with an actual native Save dialog. Never replaces Electron dialog APIs. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
const execute = promisify(execFile);
const title = 'Back up current stored Aincrad world before reset';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const macScript = `on run argv
  set targetPid to (item 1 of argv) as integer
  set operation to item 2 of argv
  tell application "System Events"
    set p to first application process whose unix id is targetPid
    set foundSheets to {}
    repeat with candidateWindow in windows of p
      repeat with candidateSheet in sheets of candidateWindow
        set end of foundSheets to contents of candidateSheet
      end repeat
    end repeat
    if (count foundSheets) is 0 then error "NATIVE_DIALOG_NOT_READY"
    if (count foundSheets) is not 1 then error "Ambiguous native sheet target; no input sent"
    set saveSheet to item 1 of foundSheets
    set descendants to entire contents of saveSheet
    if (count descendants) > 512 then error "Native sheet hierarchy exceeds bounded inspection limit"
    set report to "pid=" & targetPid & ", sheets=1, descendants=" & (count descendants)
    set saveButtons to {}
    set cancelButtons to {}
    set textFields to {}
    set namedFields to {}
    repeat with elementRef in descendants
      set e to contents of elementRef
      set elementRole to role of e
      set elementName to name of e
      set elementDescription to description of e
      if elementName is missing value then set elementName to ""
      if elementDescription is missing value then set elementDescription to ""
      if (length of elementName) > 160 then set elementName to text 1 thru 160 of elementName
      if (length of elementDescription) > 160 then set elementDescription to text 1 thru 160 of elementDescription
      set report to report & linefeed & elementRole & " | " & elementName & " | " & elementDescription
      if elementRole is "AXButton" then
        if elementName is "Save" then set end of saveButtons to e
        if elementName is "Cancel" then set end of cancelButtons to e
      else if elementRole is "AXTextField" then
        set end of textFields to e
        if elementName contains "Save As" or elementDescription contains "Save As" then set end of namedFields to e
      end if
    end repeat
    if operation is "inspect" then return report
    if (count saveButtons) is not 1 or (count cancelButtons) is not 1 then error "Native Save sheet requires unique descendant Save and Cancel buttons; no input sent"
    if operation is "probe" then return "native-save-sheet-descendants"
    set frontmost of p to true
    if operation is "cancel" then
      click item 1 of cancelButtons
    else if operation is "save" then
      if (count namedFields) is 1 then
        set filenameField to item 1 of namedFields
      else if (count namedFields) is 0 and (count textFields) is 1 then
        set filenameField to item 1 of textFields
      else
        error "Native Save filename field is ambiguous; no input sent"
      end if
      set value of filenameField to item 3 of argv
      tell p
        keystroke "g" using {command down, shift down}
        delay 0.5
        keystroke item 4 of argv
        key code 36
        delay 0.8
      end tell
      click item 1 of saveButtons
    end if
  end tell
end run`;


export async function driveNativeSaveDialog({pid, action, destination, screenshot,
  platform = process.platform, env = process.env, run = execute, wait = sleep, read = readFile, write = writeFile}) {
  if (env.CI !== 'true' || env.AINCRAD_NATIVE_DIALOG_CI !== '1')
    throw new Error('Real dialog automation is restricted to an explicitly authorized isolated CI desktop');
  if (!Number.isSafeInteger(pid) || pid < 1 || !['cancel','save'].includes(action) ||
      typeof screenshot !== 'string' || action === 'save' && typeof destination !== 'string')
    throw new Error('Invalid native dialog automation request');
  const diagnostics={platform,pid,action,screenshot,commands:[],focus:[]};
  const command = async (file,args) => {
    const entry={file,args};diagnostics.commands.push(entry);
    try { const result=await run(file,args,{encoding:'utf8',timeout:10000,env});entry.stdout=result.stdout;return result; }
    catch(error) {
      entry.error={code:error.code,signal:error.signal,killed:error.killed,stderr:error.stderr,message:error.message};
      const failure=new Error(`Native dialog command ${file} failed (tool/display/Accessibility/Automation permission required): ${error.stderr || error.message}`);
      failure.commandCode=error.code;failure.commandStderr=error.stderr || '';
      throw failure;
    }
  };
  let windowId;
  try {
  if(platform==='linux'){
    if(!env.DISPLAY)throw new Error('Real native Save dialog automation requires an X11 DISPLAY');
    for(let i=0;i<100;i++){
      let result;
      try { result=await command('xdotool',['search','--onlyvisible','--pid',String(pid),'--name','^'+title+'$']); }
      catch(error){
        // xdotool search exit 1 with no diagnostic is the documented no-match
        // result. Missing tools, display errors and permission denials are final.
        if(error.commandCode!==1 || error.commandStderr.trim() || i===99)throw error;
        await wait(100);continue;
      }
      const ids=result.stdout.trim().split(/\s+/).filter(Boolean);
      if(ids.length===1){windowId=ids[0];break;}
      if(ids.length>1)throw new Error('Multiple matching native Save dialogs; no input was sent');
      await wait(100);
    }
    if(!windowId)throw new Error('Native Save dialog was not recognized; no input was sent');
    diagnostics.windowId=windowId;
    await command('import',['-window','root',screenshot]);
  }else if(platform==='darwin'){
    // Preserve an OS screenshot even if AX inspection cannot recognize hierarchy.
    await command('screencapture',['-x',screenshot]);
    for(let i=0;i<50;i++){
      try{const inspected=await command('osascript',['-e',macScript,String(pid),'inspect']);diagnostics.accessibilityHierarchy=inspected.stdout;windowId='native-save-sheet';break;}
      catch(error){if(!error.commandStderr.includes('NATIVE_DIALOG_NOT_READY') || i===49)throw error;await wait(200);}
    }
    await command('screencapture',['-x',screenshot]);
    // Retain the actual OS dialog and bounded read-only AX hierarchy before
    // recognition failure; nested Cocoa controls need not be direct children.
    await command('osascript',['-e',macScript,String(pid),'probe']);
  }else throw new Error('Native dialog automation supports Linux and macOS only');
  const png=await read(screenshot);
  if(png.length<=10000 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw new Error('Native dialog screenshot is missing/empty; Screen Recording or display access may be required');
  async function focusedDialog(){
    // Without -f, xdotool resolves a focused child to its WM_CLASS ancestor.
    // Accept only our exact PID/title-recognized dialog, never a sibling window.
    const focused=(await command('xdotool',['getwindowfocus'])).stdout.trim();
    diagnostics.focus.push(focused);
    return focused===windowId;
  }
  if(platform==='linux'&&!await focusedDialog()){
    // Modal dialogs may already own keyboard focus without becoming the WM's
    // active window. Do not wait for _NET_ACTIVE_WINDOW via windowactivate --sync.
    await command('xdotool',['windowfocus',windowId]);
    if(!await focusedDialog())throw new Error('Native Save dialog did not acquire exact target focus; no input was sent');
  }
  async function linuxInput(args){
    if(!await focusedDialog())throw new Error('Native Save dialog lost exact target focus; input stopped');
    return command('xdotool',args);
  }
  // Capturing a real OS screen is necessary but not a semantic visual review.
  if(platform==='darwin'){
    await command('osascript',['-e',macScript,String(pid),action,action==='save'?basename(destination):'',action==='save'?dirname(destination):'']);
  }else if(action==='cancel'){
    await linuxInput(['key','--clearmodifiers','Escape']);
  }else{
    await linuxInput(['key','--clearmodifiers','ctrl+l']);
    await linuxInput(['type','--clearmodifiers','--delay','1','--',destination]);
    await linuxInput(['key','--clearmodifiers','Return']);
    await wait(500);
    // GTK may first resolve the typed location, leaving the Save dialog open.
    const names=await command('xdotool',['search','--onlyvisible','--pid',String(pid),'--name','^'+title+'$']).catch(error=>{if(error.commandCode===1&&!error.commandStderr.trim())return {stdout:''};throw error;});
    if(names.stdout.trim()===windowId)await linuxInput(['key','--clearmodifiers','Return']);
  }
  diagnostics.status='input-completed';
  await write(screenshot+'.dialog.json',JSON.stringify(diagnostics,null,2));
  return {platform,pid,action,windowId,screenshot,bytes:png.length,realOsDialog:true,semanticVisualReview:'required'};
  }catch(error){
    diagnostics.status='failed';diagnostics.error=String(error.stack||error);
    await write(screenshot+'.dialog.json',JSON.stringify(diagnostics,null,2)).catch(writeError=>{error.diagnosticsWriteError=String(writeError);});
    throw error;
  }
}
