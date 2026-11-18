/** Native QA diagnostics only. Main and renderer clocks are distinct; no elapsed
 * timestamp here is simulation time or proof that a compositor frame exists. */
export function createCaptureProgress({token,now=()=>performance.now()}) {
  const prefix='AINCRAD_CAPTURE_PROGRESS ',events=[];let sealed=false,attempt=0,dropped=0;
  const mark=(stage,details={})=>{
    if(sealed||typeof stage!=='string')return;
    if(events.length>=96){dropped++;return;}
    const observed={};
    for(const key of ['focused','visible'])if(typeof details[key]==='boolean')observed[key]=details[key];
    for(const key of ['readyState','visibilityState'])if(typeof details[key]==='string')observed[key]=details[key];
    if(Number.isFinite(details.rendererAtMs))observed.rendererAtMs=details.rendererAtMs;
    events.push({attempt,stage,mainAtMs:now(),...observed});
  };
  const next=()=>{if(sealed)return null;attempt++;mark('prepare-start');return token+':'+attempt;};
  const receive=message=>{
    if(sealed||typeof message!=='string'||!message.startsWith(prefix))return;
    let row;try{row=JSON.parse(message.slice(prefix.length));}catch{return;}
    if(row?.token!==token+':'+attempt||!['entry','settle-start','settle-complete','raf-1','raf-2'].includes(row.stage))return;
    mark('renderer:'+row.stage,{rendererAtMs:Number.isFinite(row.rendererAtMs)?row.rendererAtMs:null,
      readyState:typeof row.readyState==='string'?row.readyState:null,visibilityState:typeof row.visibilityState==='string'?row.visibilityState:null,
      focused:typeof row.focused==='boolean'?row.focused:null});
  };
  const snapshot=(terminal=false)=>{if(terminal)sealed=true;const value=JSON.parse(JSON.stringify({clock:'main-process-performance-now-ms',rendererClock:'renderer-performance-now-ms-not-aligned-to-main',attempt,dropped,events}));for(const row of value.events)Object.freeze(row);Object.freeze(value.events);return Object.freeze(value);};
  return {mark,next,receive,snapshot};
}

/** Same optional settleDraw and two RAF opportunities as waitForCaptureFrames.
 * Reporting is best effort and does not add an await, poll, retry or fallback. */
export async function waitForCaptureProgress(token) {
  const report=stage=>{try{console.info('AINCRAD_CAPTURE_PROGRESS '+JSON.stringify({token,stage,
    rendererAtMs:performance.now(),readyState:document.readyState,visibilityState:document.visibilityState,
    focused:typeof document.hasFocus==='function'?document.hasFocus():null}));}catch{}};
  report('entry');report('settle-start');
  await window.__aquaticQa?.settleDraw?.();
  report('settle-complete');
  await new Promise(resolve=>requestAnimationFrame(()=>{report('raf-1');requestAnimationFrame(()=>{report('raf-2');resolve();});}));
  return {readyState:document.readyState,visibilityState:document.visibilityState};
}
