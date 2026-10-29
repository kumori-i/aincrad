import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('desktop runs the complete native chains before its still-required aggregate and packaging',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/desktop.yml',import.meta.url),'utf8');
  assert.match(workflow,/os: \[macos-latest, ubuntu-22\.04\]/);
  const build=workflow.indexOf('      - run: npm run build\n');
  const mac=workflow.indexOf('      - name: Verify macOS combined food funding and actual adverse warning\n');
  const linux=workflow.indexOf('      - name: Exercise Linux window and saved structural departure\n');
  const aggregate=workflow.indexOf('      - run: npm run check\n');
  assert.ok(build>=0&&mac>build&&linux>build&&aggregate>mac&&aggregate>linux);
  assert.equal(workflow.split('      - run: npm run check\n').length,2);
  assert.match(workflow.slice(aggregate),/^      - run: npm run check\n      - name: Package Linux/);
  assert.ok(workflow.indexOf('      - name: Package macOS')>aggregate);
  assert.doesNotMatch(workflow,/continue-on-error/);
  assert.match(workflow,/if: runner\.os == 'macOS'\n        run: node scripts\/verify-combined-food-desktop\.mjs && node scripts\/verify-food-warning-desktop\.mjs/);
  assert.match(workflow,/xvfb-run -a bash -c 'openbox[^\n]*verify-combined-food-desktop\.mjs && node scripts\/verify-food-warning-desktop\.mjs'/);
  assert.match(workflow,/actions\/upload-artifact@v4\n        if: always\(\)/);
});
test('aquatic native has a finite aggregate-plus-native budget without changing diagnostic budget',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/finite-aquatic-native.yml',import.meta.url),'utf8');
  assert.equal((workflow.match(/timeout-minutes: 60/g)||[]).length,1);
  assert.equal((workflow.match(/timeout-minutes: 20/g)||[]).length,1);
  assert.match(workflow,/runs-on: \$\{\{ matrix\.os \}\}\n    timeout-minutes: 60/);
  assert.match(workflow,/- run: npm run check/);
  assert.match(workflow,/verify-aquatic-desktop\.mjs/);
});
