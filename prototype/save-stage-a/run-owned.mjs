import{spawn}from'node:child_process';
/** Linux-only owner watchdog. Its detached child has a private process group. */
export async function runOwned(command,args,{cwd,env,stdio,deadlineMs=200000,killAfterMs=5000}={}){
 if(process.platform!=='linux')throw Error('Owned process-group supervisor is Linux-only');
 return await new Promise((resolve,reject)=>{let child;try{child=spawn(command,args,{cwd,env,detached:true,stdio});}catch(error){reject(error);return;}
  let hardKill,finished=false,closing=false,supervisorStop=null,cleanupError=null;const signals=[];
  const signalGroup=signal=>{if(!Number.isInteger(child.pid))return;try{process.kill(-child.pid,signal);signals.push(signal);}catch(error){if(error.code!=='ESRCH')cleanupError=String(error.message);}};
  const stop=reason=>{if(!finished&&!supervisorStop){supervisorStop=reason;signalGroup('SIGTERM');hardKill=setTimeout(()=>{if(!finished)signalGroup('SIGKILL');},killAfterMs);}};
  const watchdog=setTimeout(()=>stop('deadline'),deadlineMs),interrupt=()=>stop('interrupt');process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  async function close(code,signal,error){if(closing)return;closing=true;clearTimeout(watchdog);
   // Main PID exit cannot cancel cleanup of its renderer/utility descendants.
   signalGroup('SIGTERM');await new Promise(r=>setTimeout(r,200));signalGroup('SIGKILL');await new Promise(r=>setTimeout(r,100));
   finished=true;clearTimeout(hardKill);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
   const result={code,signal,supervisorStop,cleanupError,ownedGroup:{pgid:child.pid,signals,scope:'Only the dedicated detached child process group'}};
   if(error){Object.assign(error,{ownedResult:result});reject(error);}else resolve(result);
  }
  child.once('error',error=>close(null,null,error));child.once('exit',(code,signal)=>close(code,signal));
 });
}
