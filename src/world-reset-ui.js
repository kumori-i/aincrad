import { OZARK_SAVE_KEY } from './ozark-save.js';
import { prepareFreshWorld, replaceActiveWorld, resetOutcomeMessage } from './world-reset.js';

export function installWorldReset({ document, storage, geometry, previous, freeze, release,
  retire, reload, exportCurrentWorld }) {
  const $ = id => document.getElementById(id);
  const dialog = $('reset-dialog');
  let active = false, busy = false, terminal = false, cancelRequested = false, expected, prepared, opener;
  function controls() {
    $('reset-confirm').disabled = busy || terminal || !prepared || !$('reset-acknowledge').checked;
    $('reset-backup-confirm').disabled = busy || terminal || !prepared || expected === null || !exportCurrentWorld;
    $('reset-cancel').disabled = terminal || cancelRequested;
    $('reset-acknowledge').disabled = busy || terminal;
    $('reset-reload').hidden = !terminal;
  }
  function open(event) {
    if (active) return;
    opener = event.currentTarget;
    active = true; busy = false; terminal = false; cancelRequested = false; prepared = null;
    freeze();
    $('reset-acknowledge').checked = false;
    try {
      expected = storage.getItem(OZARK_SAVE_KEY);
      prepared = prepareFreshWorld(geometry, previous());
      $('reset-status').textContent = expected === null ?
        'No stored active world exists. This discards the current session and starts fresh.' :
        'A backup exports only the exact currently stored world, even if invalid—not unsaved live progress. It is a recovery file, not an in-app undo.';
    } catch {
      $('reset-status').textContent = 'The stored world could not be read or a fresh world could not be validated. Reset is unavailable; no reset write was attempted.';
    }
    controls(); dialog.showModal(); $('reset-cancel').focus();
  }
  function cancel() {
    if (!active || terminal) return;
    if (busy) {
      cancelRequested = true;
      $('reset-status').textContent = 'Reset canceled. Waiting for the backup operation to finish; the active world will not be replaced.';
      controls(); return;
    }
    active = false; prepared = null; expected = undefined;
    dialog.close(); release(); opener?.focus();
  }
  async function confirm(backup) {
    if (!active || busy || terminal || !prepared || (!backup && !$('reset-acknowledge').checked)) return;
    busy = true; controls();
    if (backup) {
      try {
        if (expected === null || !exportCurrentWorld) throw new Error('Backup unavailable');
        const result = await exportCurrentWorld(expected);
        if (cancelRequested) { busy = false; cancel(); return; }
        if (!result?.ok) {
          $('reset-status').textContent = result?.canceled ?
            'Backup canceled. Reset was canceled too; no reset write was attempted.' :
            'Backup failed. Reset was not performed. You may cancel or retry.';
          busy = false; controls(); return;
        }
      } catch {
        if (cancelRequested) { busy = false; cancel(); return; }
        $('reset-status').textContent = 'Backup failed. Reset was not performed. You may cancel or retry.';
        busy = false; controls(); return;
      }
    }
    // Retire before mutation. Any failure from here requires a new renderer;
    // there is no path that resumes/saves this old population after an attempt.
    terminal = true;
    try { retire(); }
    catch {
      $('reset-status').textContent = 'The old session could not be stopped safely. No reset write was attempted. Reload before trying again.';
      busy = false; controls(); return;
    }
    const result = replaceActiveWorld(storage, expected, prepared);
    $('reset-status').textContent = resetOutcomeMessage(result);
    busy = false; controls();
    if (result.ok) {
      try { reload(); }
      catch { $('reset-status').textContent = 'The active world was replaced, but reopening failed. Use Reload world to continue; the old session remains stopped.'; }
    }
  }
  for (const id of ['reset-world', 'recovery-reset-world']) $(id).addEventListener('click', open);
  $('reset-cancel').addEventListener('click', cancel);
  $('reset-confirm').addEventListener('click', () => confirm(false));
  $('reset-backup-confirm').addEventListener('click', () => confirm(true));
  $('reset-acknowledge').addEventListener('change', controls);
  $('reset-reload').addEventListener('click', () => {
    if (!terminal || busy) return;
    try { reload(); }
    catch { $('reset-status').textContent = 'Reopening failed. The old session remains stopped. Close and reopen the app to inspect the stored world.'; }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  // Capture before game shortcuts, including Escape and Ctrl/Cmd+S. Native
  // dialog focus containment supplies safe Tab/Shift+Tab navigation.
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.code === 'KeyS') event.preventDefault();
    event.stopPropagation();
  }, true);
  return { active: () => active };
}
