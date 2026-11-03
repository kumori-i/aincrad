// Native engineering evidence only. Capturing a frame does not stop the real
// simulation clock; certify consistent paid progress, not a frozen read window.
export function verifyPlayerLessonCaptureProgress(before, after) {
  const fail = message => { throw new Error('Paid pose capture: ' + message); };
  const eps=1e-8, active=before?.active;
  if(!active||!Number.isFinite(active.seconds)||!Number.isFinite(active.worked)||
      !(active.worked>0&&active.worked<active.seconds)||
      before.paused||after?.paused)fail('requires an unpaused funded pose before capture');
  const elapsed=after.elapsed-before.elapsed,wall=(after.at-before.at)/1000;
  if(!Number.isFinite(elapsed)||elapsed<0||!Number.isFinite(wall)||wall<0)
    fail('invalid capture clock interval');
  if(!/Saying and pointing/.test(before.status)||!before.nearby.includes('Pointing at a visible object'))
    fail('paid pose HUD is not visible before capture');
  if(!(after.metabolizedKcal>=before.metabolizedKcal))fail('body ledger went backwards');
  if(after.miraExamples!==before.miraExamples)fail('unseen recipient gained a copied example');
  if(after.active){
    for(const key of ['word','startedAt','expiresAt','seconds'])
      if(after.active[key]!==active[key])fail('active gesture identity changed');
    const worked=after.active.worked-active.worked;
    if(!Number.isFinite(worked)||Math.abs(worked-elapsed)>eps)
      fail('paid work did not match elapsed simulation time');
    if(after.asterExamples!==before.asterExamples)fail('unfinished pose taught an example');
  } else {
    if(elapsed+eps<active.seconds-active.worked)fail('gesture vanished before enough time elapsed');
    if(after.asterExamples!==before.asterExamples+1)fail('elapsed completion did not retain exactly one own-image example');
  }
  return {elapsedSeconds:elapsed,wallSeconds:wall,completedDuringCapture:!after.active,
    pngVisualReviewRequired:true};
}
