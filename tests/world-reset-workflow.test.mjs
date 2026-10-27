import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('reset acceptance gates Linux/macOS real dialogs and retains evidence without sandbox bypass', async () => {
  const workflow = await readFile(new URL('../.github/workflows/world-reset-native.yml', import.meta.url), 'utf8');
  for (const part of ['pull_request:', 'branches: [main]', 'ubuntu-22.04', 'macos-latest',
    'xdotool x11-utils imagemagick', 'scripts/verify-world-reset-desktop.mjs', 'if: always()',
    'test-results/world-reset-desktop/', 'contents: read']) assert.ok(workflow.includes(part), part);
  assert.doesNotMatch(workflow, /continue-on-error|no-sandbox|disable-setuid-sandbox|tccutil|sqlite3/);
  assert.equal((workflow.match(/node scripts\/verify-world-reset-desktop\.mjs/g) || []).length, 2);
});


test('pause explanation includes save-protection pauses without an Escape-only claim', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const pause = html.match(/<section id="pause-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(pause);
  assert.match(pause, /Press Escape to pause or resume/);
  assert.match(pause, /Saving problems also pause play to protect your world/);
  assert.doesNotMatch(pause, /pauses only when/);
});
