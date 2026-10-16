/* Fixed raster and local CSP probes only. No game, simulation, fixture, import or timer tape. */
(async () => {
  const canvas = document.getElementById('canvas'), context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#112233'; context.fillRect(0, 0, 1440, 900);
  for (const [x, y, color] of [[0, 0, '#e74c3c'], [1360, 0, '#2ecc71'], [0, 820, '#3498db'], [1360, 820, '#f1c40f'], [640, 370, '#9b59b6']]) {
    context.fillStyle = color; context.fillRect(x, y, 80, 80);
  }
  // Center sample at (720,450) is strictly inside this final rectangle.
  context.fillStyle = '#9b59b6'; context.fillRect(640, 370, 160, 160);
  const violations = [], probeOutcomes = { evalDenied: false, inlineDidNotExecute: false, fetchDenied: false, workerDenied: false };
  document.addEventListener('securitypolicyviolation', event => {
    if (violations.length < 16) violations.push({ effectiveDirective: event.effectiveDirective, blockedURI: event.blockedURI, originalPolicy: event.originalPolicy, disposition: event.disposition });
  });
  try { (0, eval)('1+1'); } catch (error) { probeOutcomes.evalDenied = error instanceof EvalError; }
  globalThis.qualificationInlineRan = false;
  const script = document.createElement('script'); script.textContent = 'globalThis.qualificationInlineRan=true'; document.body.appendChild(script);
  probeOutcomes.inlineDidNotExecute = globalThis.qualificationInlineRan === false;
  const fetchProbe = fetch('qualification://app/probe.json').then(() => { probeOutcomes.fetchDenied = false; }, () => { probeOutcomes.fetchDenied = true; });
  let worker = null;
  const workerProbe = new Promise(resolve => {
    try {
      worker = new Worker('qualification://app/probe-worker.js');
      worker.onmessage = () => { probeOutcomes.workerDenied = false; worker.terminate(); resolve(); };
      worker.onerror = event => { event.preventDefault(); probeOutcomes.workerDenied = true; worker.terminate(); resolve(); };
    } catch (error) { probeOutcomes.workerDenied = error instanceof DOMException && error.name === 'SecurityError'; resolve(); }
  });
  await Promise.race([Promise.all([fetchProbe, workerProbe]), new Promise(resolve => setTimeout(resolve, 1000))]);
  worker?.terminate();
  // One bounded collection interval; never retry a probe until a desirable result appears.
  await new Promise(resolve => setTimeout(resolve, 100));
  let rafCount = 0;
  await new Promise(resolve => requestAnimationFrame(() => { rafCount++; requestAnimationFrame(() => { rafCount++; resolve(); }); }));
  const rect = canvas.getBoundingClientRect();
  await globalThis.qualificationNative.submit({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    canvasWidth: canvas.width, canvasHeight: canvas.height, canvasRectWidth: rect.width, canvasRectHeight: rect.height,
    nodeAbsent: ['require', 'process', 'Buffer', 'module', 'exports'].every(name => typeof globalThis[name] === 'undefined'),
    violations, probeOutcomes, rafCount });
})().catch(() => { /* Outer fixed watchdog reports unavailable; no retry or alternate page. */ });
