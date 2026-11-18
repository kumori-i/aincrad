/** Diagnostics only. Renderer and main timestamps are separate clock domains. */
export async function waitForPlayerJournalFrames(token, attempt) {
  const emit = stage => { try { console.debug('PLAYER_JOURNAL_READINESS ' + JSON.stringify({token,attempt,stage,
    rendererAt:performance.now(),visibilityState:document.visibilityState,focused:document.hasFocus()})); } catch {} };
  emit('renderer-entry'); emit('settle-start');
  await window.__aquaticQa?.settleDraw?.();
  emit('settle-complete');
  await new Promise(resolve => requestAnimationFrame(() => { emit('raf-1'); requestAnimationFrame(() => { emit('raf-2'); resolve(); }); }));
  emit('renderer-complete');
  return {readyState:document.readyState,visibilityState:document.visibilityState};
}
/** Self-contained for serialization; primitive-only detached bounded snapshots. */
export function createPlayerJournalProgress(token, now = () => performance.now()) {
  const events=[]; let sealed=false, attempt=0;
  const stages=new Set(['renderer-entry','settle-start','settle-complete','raf-1','raf-2','renderer-complete']);
  const mark=stage=>{if(!sealed&&events.length<96)events.push({attempt,stage,mainAt:now()});};
  return {
    next(){if(!sealed){attempt++;mark('evaluate-start');}return attempt;}, mark,
    console(event,...details){
      const message=typeof event?.message==='string'?event.message:details[1];
      if(typeof message!=='string'||!message.startsWith('PLAYER_JOURNAL_READINESS '))return false;
      let row;try{row=JSON.parse(message.slice('PLAYER_JOURNAL_READINESS '.length));}catch{return false;}
      if(row?.token!==token||!Number.isSafeInteger(row.attempt)||row.attempt<1||row.attempt>attempt||!stages.has(row.stage)||!Number.isFinite(row.rendererAt)||typeof row.visibilityState!=='string'||typeof row.focused!=='boolean')return false;
      if(!sealed&&events.length<96)events.push({attempt:row.attempt,stage:row.stage,mainAt:now(),rendererAt:row.rendererAt,visibilityState:row.visibilityState,focused:row.focused});
      return true;
    },
    snapshot(terminal=false){if(terminal)sealed=true;return {clock:'main-performance-ms; rendererAt is separate renderer-performance-ms',sealed,events:events.map(e=>({...e}))};},
  };
}
