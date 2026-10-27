/** CI-only OS interaction with an actual native Save dialog. Never replaces Electron dialog APIs. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
const execute = promisify(execFile);
const title = 'Back up current stored Aincrad world before reset';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const macScript = `on run argv
  set targetPid to (item 1 of argv) as integer
  set operation to item 2 of argv
  tell application "System Events"
    set p to first application process whose unix id is targetPid
    tell p
      set frontmost to true
      if not (exists window 1) then error "NATIVE_DIALOG_NOT_READY"
      if not (exists sheet 1 of window 1) then error "NATIVE_DIALOG_NOT_READY"
      set saveSheet to sheet 1 of window 1
      if not (exists button "Save" of saveSheet) or not (exists button "Cancel" of saveSheet) then error "Visible sheet is not the native Save dialog"
      if operation is "probe" then return "native-save-sheet"
      if operation is "cancel" then
        click button "Cancel" of saveSheet
      else if operation is "save" then
        set value of text field 1 of saveSheet to item 3 of argv
        keystroke "g" using {command down, shift down}
        delay 0.5
        keystroke item 4 of argv
        key code 36
        delay 0.8
        click button "Save" of sheet 1 of window 1
      end if
    end tell
  end tell
end run`;

export async function driveNativeSaveDialog({pid, action, destination, screenshot,
  platform = process.platform, env = process.env, run = execute, wait = sleep, read = readFile}) {
  if (env.CI !== 'true' || env.AINCRAD_NATIVE_DIALOG_CI !== '1')
    throw new Error('Real dialog automation is restricted to an explicitly authorized isolated CI desktop');
  if (!Number.isSafeInteger(pid) || pid < 1 || !['cancel','save'].includes(action) ||
      typeof screenshot !== 'string' || action === 'save' && typeof destination !== 'string')
    throw new Error('Invalid native dialog automation request');
  const command = async (file,args) => {
    try { return await run(file,args,{encoding:'utf8',timeout:10000,env}); }
    catch(error) {
      const failure=new Error(`Native dialog command ${file} failed (tool/display/Accessibility/Automation permission required): ${error.stderr || error.message}`);
      failure.commandCode=error.code;failure.commandStderr=error.stderr || '';
      throw failure;
    }
  };
  let windowId;
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
    await command('xdotool',['windowactivate','--sync',windowId]);
    await command('import',['-window','root',screenshot]);
  }else if(platform==='darwin'){
    for(let i=0;i<50;i++){
      try{await command('osascript',['-e',macScript,String(pid),'probe']);windowId='native-save-sheet';break;}
      catch(error){if(!error.commandStderr.includes('NATIVE_DIALOG_NOT_READY') || i===49)throw error;await wait(200);}
    }
    await command('screencapture',['-x',screenshot]);
  }else throw new Error('Native dialog automation supports Linux and macOS only');
  const png=await read(screenshot);
  if(png.length<=10000 || !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw new Error('Native dialog screenshot is missing/empty; Screen Recording or display access may be required');
  // Capturing a real OS screen is necessary but not a semantic visual review.
  if(platform==='darwin'){
    await command('osascript',['-e',macScript,String(pid),action,action==='save'?basename(destination):'',action==='save'?dirname(destination):'']);
  }else if(action==='cancel'){
    await command('xdotool',['key','--clearmodifiers','Escape']);
  }else{
    await command('xdotool',['key','--clearmodifiers','ctrl+l']);
    await command('xdotool',['type','--clearmodifiers','--delay','1','--',destination]);
    await command('xdotool',['key','--clearmodifiers','Return']);
    await wait(500);
    // GTK may first resolve the typed location, leaving the Save dialog open.
    const names=await command('xdotool',['search','--onlyvisible','--pid',String(pid),'--name','^'+title+'$']).catch(error=>{if(error.commandCode===1&&!error.commandStderr.trim())return {stdout:''};throw error;});
    if(names.stdout.trim()===windowId)await command('xdotool',['key','--clearmodifiers','Return']);
  }
  return {platform,pid,action,windowId,screenshot,bytes:png.length,realOsDialog:true,semanticVisualReview:'required'};
}
