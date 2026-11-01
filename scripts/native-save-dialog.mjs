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

// This exact osascript error is emitted only by the zero-sheet check above,
// before frontmost, text entry, keystrokes or clicks. All other action errors
// leave input outcome uncertain and must remain terminal.
const macPreInputNoSheet=error=>error.commandCode===1&&!error.commandSignal&&
  !error.commandKilled&&/^\d+:\d+: execution error: NATIVE_DIALOG_NOT_READY \(-2700\)\r?\n?$/.test(error.commandStderr);


export async function driveNativeSaveDialog({pid, action, destination, screenshot,
  platform = process.platform, env = process.env, run = execute, wait = sleep, read = readFile, write = writeFile, now = () => performance.now()}) {
  if (env.CI !== 'true' || env.AINCRAD_NATIVE_DIALOG_CI !== '1')
    throw new Error('Real dialog automation is restricted to an explicitly authorized isolated CI desktop');
  if (!Number.isSafeInteger(pid) || pid < 1 || !['cancel','save'].includes(action) ||
      typeof screenshot !== 'string' || action === 'save' && typeof destination !== 'string')
    throw new Error('Invalid native dialog automation request');
  const diagnostics={platform,pid,action,screenshot,commands:[],focus:[]};
  const command = async (file,args) => {
    const entry={file,args};diagnostics.commands.push(entry);
    try { const result=await run(file,args,{encoding:'utf8',timeout:10000,maxBuffer:256*1024,env});entry.stdout=result.stdout;return result; }
    catch(error) {
      entry.error={code:error.code,signal:error.signal,killed:error.killed,stderr:error.stderr,message:error.message};
      const failure=new Error(`Native dialog command ${file} failed (tool/display/Accessibility/Automation permission required): ${error.stderr || error.message}`);
      failure.commandCode=error.code;failure.commandStderr=error.stderr || '';
      failure.commandSignal=error.signal;failure.commandKilled=error.killed;
      throw failure;
    }
  };
  let windowId,recognizedAt;
  try {
  if(platform==='linux'){
    if(!env.DISPLAY)throw new Error('Real native Save dialog automation requires an X11 DISPLAY');
    for(let i=0;i<100;i++){
      let result;
      try { result=await command('xdotool',['search','--all','--onlyvisible','--pid',String(pid),'--name','^'+title+'$']); }
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
  const windowIdentity=value=>{
    if(!/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(value))throw new Error('Invalid X window identity');
    const numeric=BigInt(value);if(numeric<=0n||numeric>0xffffffffn)throw new Error('Invalid X window identity');
    return String(numeric);
  };
  async function inspectXWindow(id){
    const tree=(await command('xwininfo',['-id',id,'-tree'])).stdout;
    const properties=(await command('xprop',['-id',id,'WM_CLASS','WM_NAME','_NET_WM_NAME','_NET_WM_PID','WM_TRANSIENT_FOR'])).stdout;
    const parent=tree.match(/Parent window id:\s*(0x[0-9a-f]+)/i)?.[1];
    const transient=properties.match(/WM_TRANSIENT_FOR[^\n]*window id #\s*(0x[0-9a-f]+)/i)?.[1];
    const names=properties.split('\n').map(line=>line.match(/^(?:_NET_WM_NAME|WM_NAME)\([^)]*\) = "(.*)"$/)?.[1]).filter(name=>name!==undefined);
    const ownerPid=Number(properties.match(/^_NET_WM_PID\(CARDINAL\) = ([0-9]+)$/m)?.[1]);
    return {id,tree,properties,ownerPid,parent:parent&&parent!=='0x0'?windowIdentity(parent):null,
      transient:transient&&transient!=='0x0'?windowIdentity(transient):null,
      namedDialog:names.length>0&&names.every(name=>name===title)};
  }
  async function focusedDialog(){
    const raw=windowIdentity((await command('xdotool',['getwindowfocus','-f'])).stdout.trim());
    const resolved=windowIdentity((await command('xdotool',['getwindowfocus'])).stdout.trim());
    const focus={raw,resolved,windows:[],trusted:false};diagnostics.focus.push(focus);
    const target=windowIdentity(windowId),queue=[raw],visited=new Set();
    // Prove child ancestry, or a title-matched native transient relation, to the
    // exact PID/title target. Numeric XID ranges and matching titles alone do not
    // confer trust. Preserve current GTK child focus; never focus the wrapper.
    for(let n=0;queue.length&&n<16;n++){
      const id=queue.shift();if(visited.has(id))continue;visited.add(id);
      const info=await inspectXWindow(id);focus.windows.push(info);
      if(id===target){focus.trusted=info.namedDialog&&info.ownerPid===pid;return focus.trusted;}
      if(info.parent)queue.push(info.parent);
      if(info.namedDialog&&info.transient)queue.push(info.transient);
    }
    return false;
  }
  if(platform==='linux'){
    diagnostics.rootTree=(await command('xwininfo',['-root','-tree'])).stdout;
    diagnostics.target=await inspectXWindow(windowIdentity(windowId));
    if(!diagnostics.target.namedDialog||diagnostics.target.ownerPid!==pid)throw new Error('Selected X window does not independently match exact Save title and Electron PID; no input was sent');
    if(!await focusedDialog())throw new Error('Native Save focus ownership cannot be proved; no input was sent');
    recognizedAt=now();
  }
  async function linuxInput(args){
    if(!await focusedDialog())throw new Error('Native Save dialog lost proven target/descendant focus; input stopped');
    return command('xdotool',args);
  }
  // Capturing a real OS screen is necessary but not a semantic visual review.
  if(platform==='darwin'){
    const actionArgs=['-e',macScript,String(pid),action,
      action==='save'?basename(destination):'',action==='save'?dirname(destination):''];
    for(let attempt=0;attempt<10;attempt++){
      if(attempt){
        // A preceding exact zero-sheet error proves no input was sent. Re-read
        // the same PID and unique sheet/buttons before any new action attempt.
        diagnostics.macActionReacquisitions=attempt;
        await wait(200);
        try{
          const inspected=await command('osascript',['-e',macScript,String(pid),'inspect']);
          diagnostics.accessibilityHierarchy=inspected.stdout;
          await command('osascript',['-e',macScript,String(pid),'probe']);
        }catch(error){if(!macPreInputNoSheet(error)||attempt===9)throw error;continue;}
      }
      try{await command('osascript',actionArgs);break;}
      catch(error){if(!macPreInputNoSheet(error)||attempt===9)throw error;}
    }
  }else if(action==='cancel'){
    await linuxInput(['key','--clearmodifiers','Escape']);
  }else{
    // gettext LANGUAGE overrides message locale except in the untranslated C/
    // POSIX locale. Never change the already-running app's locale for this test.
    const messageLocale=env.LC_ALL||env.LC_MESSAGES||env.LANG||'C';
    const preferredLanguage=env.LANGUAGE?.split(':').find(Boolean);
    const effectiveLocale=/^(?:C|POSIX)$/.test(messageLocale)?messageLocale:preferredLanguage||messageLocale;
    diagnostics.messageLocale=messageLocale;diagnostics.effectiveMnemonicLocale=effectiveLocale;
    if(!/^(?:C(?:[.@]|$)|POSIX$|en(?:[_@.-]|$))/i.test(effectiveLocale))
      throw new Error('Direct Save mnemonic requires an existing English/C message locale; no input was sent');
    // GTK3 location_toggle_popup_handler in SAVE mode only focuses the existing
    // Name entry; it does not clear/select its text. Select the whole value,
    // including any unselected .json suffix, before typing the absolute path.
    // https://github.com/GNOME/gtk/blob/gtk-3-24/gtk/gtkfilechooserwidget.c
    await linuxInput(['key','--clearmodifiers','ctrl+l']);
    await linuxInput(['key','--clearmodifiers','ctrl+a']);
    await linuxInput(['type','--clearmodifiers','--delay','1','--',destination]);
    diagnostics.pathEnteredScreenshot=screenshot+'.path-entered.png';
    await command('import',['-window','root',diagnostics.pathEnteredScreenshot]);
    // Electron44.7's Chromium152 deliberately makes Save a non-default response.
    // Activate GTK_STOCK_SAVE (_Save) directly, rather than entry Return.
    // https://raw.githubusercontent.com/chromium/chromium/152.0.7977.130/ui/gtk/select_file_dialog_linux_gtk.cc
    // https://docs.gtk.org/gtk3/ctor.Button.new_with_mnemonic.html
    // Conservative test readiness after verified recognition, not a claim that
    // this pinned Chromium version has a minimum-display security timer.
    const remainingVisibleMs=550-(now()-recognizedAt);
    diagnostics.minimumVisibleMs=550;
    diagnostics.activationWaitMs=remainingVisibleMs>0?Math.ceil(remainingVisibleMs)+1:0;
    if(diagnostics.activationWaitMs)await wait(diagnostics.activationWaitMs);
    diagnostics.visibleBeforeActivationMs=now()-recognizedAt;
    if(diagnostics.visibleBeforeActivationMs<550)throw new Error('Native Save visible interval could not be established; no activation was sent');
    await linuxInput(['key','--clearmodifiers','alt+s']);
    // Observe completion only. Never send an ungrounded second activation into a
    // still-open chooser, completion popup or newly opened error dialog.
    let dismissed=false;
    for(let attempt=0;attempt<50;attempt++){
      let names;
      try { names=await command('xdotool',['search','--all','--onlyvisible','--pid',String(pid),'--name','^'+title+'$']); }
      catch(error){
        if(error.commandCode===1&&!error.commandSignal&&!error.commandKilled&&!error.commandStderr.trim())names={stdout:''};
        // A child can disappear while xdotool recursively enumerates X windows.
        // Only these exact post-activation X_QueryTree/X_GetProperty disappearance
        // diagnostics are inconclusive:
        // it is NOT proof of dismissal. Require a later clean no-match, retain
        // the failed command, and never send another activation or input.
        else if(error.commandCode===1&&!error.commandSignal&&!error.commandKilled&&
          /^X Error of failed request:  BadWindow \(invalid Window parameter\)\n  Major opcode of failed request:  (?:15 \(X_QueryTree\)|20 \(X_GetProperty\))\n  Resource id in failed request:  0x[0-9a-f]+\n  Serial number of failed request:  \d+\n  Current serial number in output stream:  \d+\n?$/.test(error.commandStderr)){
          diagnostics.inconclusiveDisappearanceProbes=(diagnostics.inconclusiveDisappearanceProbes||0)+1;
          await wait(100);continue;
        }else throw error;
      }
      const remaining=names.stdout.trim().split(/\s+/).filter(Boolean);
      if(remaining.length>1)throw new Error('Multiple matching native Save dialogs; no further input was sent');
      if(remaining.length===0){dismissed=true;break;}
      if(remaining[0]!==windowId)throw new Error('Native Save target changed; no further input was sent');
      await wait(100);
    }
    diagnostics.postInputScreenshot=screenshot+'.after-submit.png';
    await command('import',['-window','root',diagnostics.postInputScreenshot]);
    diagnostics.saveDialogDismissed=dismissed;
    if(!dismissed)throw new Error(diagnostics.inconclusiveDisappearanceProbes
      ? 'Native Save dismissal could not be established after one submission; inspect command diagnostics and OS screenshots'
      : 'Native Save chooser remained open after one submission; inspect path-entered and after-submit OS screenshots');

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
