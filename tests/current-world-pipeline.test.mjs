import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
test('one current boot/render/save path cannot silently regain a retired runtime or migration',()=>{
  for(const file of ['src/main.js','src/renderer.js','src/save.js','src/recovered-profile-boot.js',
    'src/ozark-pilot-main.js','desktop/recovered-profile.cjs','scripts/verify-recovered-native.mjs'])
    assert.equal(existsSync(new URL(file,root)),false,file);
  const entry=read('src/entry.js');assert.match(entry,/ozark-world-main/);assert.doesNotMatch(entry,/ozarkWorld=|ozarkPilot=|\.\/main\.js/);
  const main=read('src/ozark-world-main.js');assert.doesNotMatch(main,/\baincradWorld\b|welcome-ozark|__aincrad/);
  assert.match(main,/await renderer\.prepareAtlas\(\)/);assert.match(main,/location\.search !== '\?test=1'/);
  const save=read('src/ozark-save.js');assert.match(save,/OZARK_SAVE_KEY = 'aincrad\.world\.v2'/);
  assert.doesNotMatch(save,/from '\.\/save\.js'|prepareLegacy|migrateSave/);
  const html=read('index.html');assert.doesNotMatch(html,/id="welcome"|original world|welcome-ozark/i);
  assert.match(html,/id="world-loading"/);
});
test('publication workflows require direct desktop smoke and leave only policy diagnostics nonblocking',()=>{
  assert.match(read('.github/workflows/desktop.yml'),/pull_request:/);
  assert.doesNotMatch(read('.github/workflows/desktop.yml'),/--no-sandbox/);
  const aquatic=read('.github/workflows/finite-aquatic-native.yml');
  assert.equal((aquatic.match(/continue-on-error: true/g)||[]).length,1);
  assert.ok(aquatic.indexOf('continue-on-error: true')>aquatic.indexOf('autonomous-diagnostic:'));
  assert.match(aquatic,/verify-aquatic-desktop\.mjs/);
  assert.match(read('.github/workflows/carcass-native.yml'),/verify-carcass-desktop\.mjs/);
  const native=read('scripts/verify-aquatic-desktop.mjs');
  assert.match(native,/'social-write', 'social-reopen'/);
  assert.match(native,/window\.__ozarkWorld\.detailReady\(\)/);
  assert.match(native,/ownProofNotInvented:true/);
});
