import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('category names CI gates both native platforms and reset/stale-reply tests without claiming live inference',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/category-names-native.yml',import.meta.url),'utf8');
  for(const part of ['pull_request:','branches: [main]','workflow_dispatch:','ubuntu-22.04','macos-latest',
    'contents: read','fail-fast: false','timeout-minutes: 20','node scripts/record-native-host.mjs','npm ci',
    'set -euo pipefail','tests/category-name*.test.mjs','tests/naming-model*.test.mjs',
    'tests/naming-world-reset.test.mjs','tests/world-reset.test.mjs','tests/world-reset-ui.test.mjs',
    'sudo apt-get install -y xvfb openbox','xvfb-run -a bash -c',
    'test-results/host.json','test-results/category-names-focused.log','test-results/category-names-desktop/',
    'if: always()','retention-days: 7','No live inference, model download','separate World reset native acceptance workflow'])
    assert.ok(workflow.includes(part),part);
  assert.equal((workflow.match(/node scripts\/verify-category-names-desktop\.mjs/g)||[]).length,2);
  assert.match(workflow,/if: runner\.os == 'macOS'\n        run: node scripts\/verify-category-names-desktop\.mjs/);
  assert.match(workflow,/if: runner\.os == 'Linux'\n        run: xvfb-run/);
  assert.doesNotMatch(workflow,/continue-on-error|--no-sandbox|--disable-setuid-sandbox|--prepare-only|ollama pull|windows-latest/);
  assert.ok(workflow.indexOf('id: focused')<workflow.indexOf('id: native_linux'));
  assert.ok(workflow.indexOf('id: focused')<workflow.indexOf('id: native_macos'));
});
