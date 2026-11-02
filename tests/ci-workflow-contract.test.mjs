import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const workflowDir=new URL('../.github/workflows/',import.meta.url);
const read=name=>readFile(new URL(name,workflowDir),'utf8');

test('PR and main run one suite per OS while standalone desktop dispatch checks both',async()=>{
  const names=(await readdir(workflowDir)).filter(name=>name.endsWith('.yml'));
  const workflows=await Promise.all(names.map(read));
  const all=workflows.flatMap((source,index)=>
    [...source.matchAll(/^\s+run: npm run check$/gm)].map(()=>names[index]));
  assert.deepEqual(all.sort(),['check.yml','desktop.yml']);
  const world=await read('check.yml'),desktop=await read('desktop.yml');
  assert.match(world,/rules-and-build:\n    needs: compatibility-preflight\n    runs-on: ubuntu-latest/);
  assert.match(desktop,/matrix:\n        os: \[macos-latest, ubuntu-22\.04\]/);
  assert.match(desktop,/name: Run complete suite before packaging when needed\n        if: runner\.os == 'macOS' \|\| github\.event_name == 'workflow_dispatch'\n        run: npm run check\n      - name: Package Linux/);
  for(const name of ['learning-cycle.yml','finite-aquatic-native.yml',
    'renewable-sharing-native.yml']){
    const workflow=await read(name);
    assert.doesNotMatch(workflow,/run: npm run check/,name);
    assert.match(workflow,/- run: npm run build/,name);
  }
});

test('fast current-source marker and syntax contracts precede the aggregate and character native work',async()=>{
  const world=await read('check.yml'),character=await read('visual-reference-native.yml');
  const protocols=['character-ordinary-pilot','character-ordinary-motor-v3',
    'character-ordinary-motor-v4'];
  for(const source of [world,character]){
    assert.match(source,/node --check src\/ozark-world-features\.js/);
    for(const protocol of protocols){
      assert.ok(source.includes(`node --check scripts/${protocol}-protocol.mjs`),protocol);
      assert.ok(source.includes(`tests/${protocol}-protocol.test.mjs`),protocol);
    }
  }
  assert.ok(world.indexOf('compatibility-preflight:')<world.indexOf('rules-and-build:'));
  assert.ok(character.indexOf('Check current feature markers')<
    character.indexOf('Install sandbox-preserving Linux display'));
});

test('general pushes target main and only superseded PR runs may cancel',async()=>{
  for(const name of ['check.yml','pixel-language.yml']){
    const source=await read(name);
    assert.match(source,/  push:\n    branches: \[main\]\n  pull_request:/,name);
  }
  for(const name of ['check.yml','desktop.yml','learning-cycle.yml',
    'finite-aquatic-native.yml','renewable-sharing-native.yml','pixel-language.yml',
    'visual-reference-native.yml','category-names-native.yml',
    'world-reset-native.yml','carcass-native.yml']){
    const source=await read(name);
    assert.match(source,/^concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.run_id \}\}\n  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/m,name);
  }
  for(const name of ['character-ordinary-pilot-once.yml',
    'character-ordinary-diagnostic-v2-once.yml',
    'character-ordinary-motor-v3-once.yml',
    'character-ordinary-motor-v4-once.yml']){
    const source=await read(name);
    assert.match(source,/cancel-in-progress: false/,name);
    assert.doesNotMatch(source,/cancel-in-progress: \$\{\{/,name);
  }
  const communication=await read('communication-native.yml');
  assert.match(communication,/  create:\n/);
  assert.match(communication,/group: communication-bridge-v1-once\n      cancel-in-progress: false/);
  assert.doesNotMatch(communication,/^concurrency:/m);
});
