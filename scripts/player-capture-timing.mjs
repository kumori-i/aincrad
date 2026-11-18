/** Diagnostic only. The caller retains its existing overall deadline and gates.
 * Main-process monotonic milliseconds, not renderer or simulation time. */
export async function capturePaidPoseWithTiming({capturePage,readAfter,witness,timing,
  now=()=>performance.now()}) {
  timing.clock='main-process-performance-now-ms';
  timing.stage='capture-page';timing.capturePageStartedAt=now();
  try {
    const image=await capturePage();
    timing.capturePageCompletedAt=now();
    timing.stage='after-witness';timing.afterWitnessStartedAt=now();
    witness.after=await readAfter();
    timing.afterWitnessCompletedAt=now();timing.stage='complete';
    return image;
  } catch(error) {
    timing.failedAt=now();timing.error=String(error);throw error;
  }
}
