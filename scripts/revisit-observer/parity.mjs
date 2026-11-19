import assert from 'node:assert/strict';
import {PROTOCOL as P} from './protocol.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {validateArmStream} from './coverage.mjs';
import {instrumentCopy,verifyInstrumentedCopy} from './source.mjs';
const [baseRepo,candidateRepo,localEquivalentFlag]=process.argv.slice(2);
assert(baseRepo&&candidateRepo&&(!localEquivalentFlag||localEquivalentFlag==='--local-equivalent-tree'));
for(const [name,repo] of [['baseline',baseRepo],['candidate',candidateRepo]]){
 const sha=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 assert.equal(execFileSync('git',['-C',repo,'rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),P[name].tree);
 // Hosted validation never uses the local-equivalent switch.
 if(!localEquivalentFlag)assert.equal(sha,P[name].commit);
 const root=mkdtempSync(join(tmpdir(),'revisit-authored-fixture-'));
 try{
  const archive=execFileSync('git',['-C',repo,'archive',sha],{maxBuffer:2**26});
  execFileSync('tar',['-x','-C',root],{input:archive});
  const path=f=>join(root,'src',f+'.js');
  copyFileSync(new URL('./observer.mjs',import.meta.url),path('revisit-research-observer'));
  const fixture=join(root,'tests','revisit-research-parity-fixture.mjs');
  copyFileSync(new URL('./parity-fixture.mjs',import.meta.url),fixture);
  copyFileSync(new URL('./save.mjs',import.meta.url),join(root,'tests','revisit-research-save.mjs'));
  const run=mode=>JSON.parse(execFileSync(process.execPath,[fixture,mode],{maxBuffer:2**24}));
  const unpatched=run('off');
  rmSync(path('revisit-research-observer'));
  const manifest=instrumentCopy({repo,root,commit:sha,candidate:name==='candidate'});
  verifyInstrumentedCopy(root,manifest);
  const {evidence,...observed}=run('on');
  assert.deepEqual(observed,{actor:unpatched.actor,ecology:unpatched.ecology,decision:unpatched.decision,sequence:unpatched.sequence,zeroTickSave:unpatched.zeroTickSave});
  assert.equal(evidence.gap,null);assert.ok(evidence.rows.some(r=>r.kind==='handling'&&r.sight));
  if(name==='candidate'){assert.ok(evidence.rows.some(r=>r.kind==='bound'));assert.ok(evidence.rows.some(r=>r.kind==='move-completion'&&r.paid>0&&r.propelled>0));}
  verifyInstrumentedCopy(root,manifest);
  const coverage=validateArmStream(evidence.rows,'aster',evidence.rows.filter(r=>r.kind==='pose').length,{candidate:name==='candidate',startAt:0,dt:.25});
  console.log(JSON.stringify({name,sha,rows:evidence.rows.length,choice:observed.decision.action.type,tree:manifest.pristine.tree,overlay:manifest.overlay,parity:true,zeroTickSave:observed.zeroTickSave,coverage}));
 }finally{rmSync(root,{recursive:true,force:true});}
}
