/** Only explicitly requested qualification may call these process helpers. Imports launch nothing. */
import { spawn as nativeSpawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
const p = createRequire(import.meta.url)('./policy.cjs');

export async function groupGone(pid, { signal = process.kill.bind(process) } = {}) {
  if (!Number.isInteger(pid) || pid <= 1) return { gone: false, reason: 'owned-pid-unavailable' };
  try { signal(-pid, 0); return { gone: false, reason: null }; }
  catch (error) { return error.code === 'ESRCH' ? { gone: true, reason: null } : { gone: false, reason: 'group-observation-unavailable' }; }
}

export function ownedProcess(command, args, { env, input = null, deadlineMs = 20000, outputLimit = p.LIMIT.childOutput,
  spawn = nativeSpawn, signal = process.kill.bind(process), delay = sleep, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  p.demand(typeof command === 'string' && command.startsWith('/') && Array.isArray(args) && args.every(a => typeof a === 'string'), 'process-command');
  p.demand(Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= p.LIMIT.totalMs, 'process-deadline');
  let child, timer, killTimer, drainTimer, finished = false, exitConfirmed = false, closeConfirmed = false, stopPromise = null, outputBytes = 0;
  let stdout = '', stderr = '', reason = null, code = null, sig = null, launchError = false;
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });
  const complete = () => {
    if (finished) return; finished = true; unschedule(timer); unschedule(killTimer); unschedule(drainTimer);
    resolveResult({ code, signal: sig, reason, launchError, exitConfirmed, closeConfirmed, stdout, stderr, outputBytes, pid: child?.pid ?? null });
  };
  const kill = value => {
    if (!Number.isInteger(child?.pid) || child.pid <= 1) return;
    try { signal(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') reason ||= 'owned-signal-unavailable'; }
  };
  const requestStop = why => {
    if (finished) return;
    reason ||= why; kill('SIGTERM');
    if (!finished && !killTimer) killTimer = schedule(() => { kill('SIGKILL'); if (!finished) { reason ||= 'owned-exit-unconfirmed'; complete(); } }, 1500);
  };
  try {
    child = spawn(command, args, { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('error', () => { launchError = true; reason ||= 'process-launch-unavailable'; complete(); });
    child.once('exit', (c, s) => {
      if (finished) return;
      code = c; sig = s; exitConfirmed = true;
      // exit precedes stdio EOF. Do not freeze a successful result before close.
      drainTimer = schedule(() => { requestStop('process-output-close-unconfirmed'); complete(); }, 500);
      if (closeConfirmed) complete();
    });
    child.once('close', (c, s) => {
      if (finished) return;
      closeConfirmed = true;
      if (code === null) code = c; if (sig === null) sig = s;
      if (exitConfirmed || launchError) complete();
    });
    const append = which => bytes => {
      if (finished) return;
      outputBytes += bytes.length;
      if (outputBytes > outputLimit) { requestStop('process-output-limit'); return; }
      if (which === 'stdout') stdout += bytes.toString('utf8'); else stderr += bytes.toString('utf8');
    };
    child.stdout.on('data', append('stdout')); child.stderr.on('data', append('stderr'));
    child.stdin.on('error', () => requestStop('process-stdin-unavailable'));
    child.stdin.end(input ?? undefined);
    if (!finished) timer = schedule(() => requestStop('process-deadline'), deadlineMs);
  } catch { launchError = true; reason = 'process-launch-unavailable'; complete(); }
  return {
    child, result, isRunning: () => !finished && !exitConfirmed && !launchError,
    async close(why = null) {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (why && !finished) reason ||= why;
        // A direct child can exit while a renderer descendant remains in its owned group.
        kill('SIGTERM');
        let observation;
        for (let n = 0; n < 15; n++) { observation = await groupGone(child?.pid, { signal }); if (observation.gone) break; await delay(100); }
        if (!observation?.gone) {
          kill('SIGKILL');
          for (let n = 0; n < 10; n++) { observation = await groupGone(child?.pid, { signal }); if (observation.gone) break; await delay(100); }
        }
        if (!finished) { reason ||= 'owned-exit-unconfirmed'; complete(); }
        const terminal = await result;
        return { pid: child?.pid ?? null, exited: terminal.exitConfirmed, groupGone: observation?.gone === true,
          reason: observation?.reason || (!terminal.exitConfirmed ? 'owned-exit-unconfirmed' : null) };
      })();
      return stopPromise;
    }
  };
}

export async function checkedCommand(command, args, options, owned) {
  const child = ownedProcess(command, args, options); owned.push(child);
  const result = await child.result;
  const cleanup = await child.close();
  return { ...result, cleanup };
}

export function successful(result) { return result.code === 0 && !result.signal && !result.reason && !result.launchError && result.exitConfirmed && result.closeConfirmed && result.cleanup?.groupGone === true && result.cleanup?.exited === true; }
