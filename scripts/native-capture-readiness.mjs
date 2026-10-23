/** Native QA only. Frame opportunities are readiness signals, not proof of
 * compositor contents. Keep the independent PNG-size guard and failed bytes. */
export async function waitForCaptureFrames() {
  await window.__aquaticQa?.settleDraw?.();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { readyState: document.readyState, visibilityState: document.visibilityState };
}

/** Self-contained for serialization into the isolated Electron main runner.
 * Retry only small/empty images, never fixture actions or assertion failures.
 * A stalled renderer/capture fails at the overall deadline; late results cannot
 * turn a timeout into success or overwrite retained evidence. */
export async function captureWithReadiness({ prepare, capture, retain,
  maxAttempts = 4, timeoutMs = 5000, now = () => performance.now() }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid native capture bounds');
  const started = now();
  const bounded = async operation => {
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) throw new Error('Native capture readiness timed out');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native capture readiness timed out')), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const metadata = { attempt, maxAttempts, timeoutMs };
    let png;
    try {
      metadata.stage = 'readiness';
      metadata.readiness = await bounded(prepare);
      metadata.stage = 'capture';
      const image = await bounded(capture);
      png = image.toPNG();
      Object.assign(metadata, image.getSize(), { bytes: png.length, empty: image.isEmpty() });
      // Synchronous encoding also counts against the same deadline.
      if (now() - started >= timeoutMs) throw new Error('Native capture readiness timed out');
      metadata.status = !metadata.empty && png.length > 10000 ? 'ready' : 'small-or-empty';
    } catch (error) {
      metadata.status = 'error'; metadata.error = String(error?.stack || error);
      metadata.elapsedMs = now() - started;
      await retain(png, metadata);
      throw error;
    }
    metadata.elapsedMs = now() - started;
    await retain(png, metadata);
    if (metadata.status === 'ready') return { png, metadata };
  }
  throw new Error('Native capture remained small or empty after ' + maxAttempts + ' attempts');
}
