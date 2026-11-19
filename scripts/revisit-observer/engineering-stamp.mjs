import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {PROTOCOL as P} from './protocol.mjs';
import {checkedGit} from './run.mjs';
import {sha256} from './source.mjs';
const phase=process.argv[2];assert(['before','after'].includes(phase));
assert.match(process.env.GITHUB_SHA??'',/^[0-9a-f]{40}$/);
const specs=[['protocol','.',process.env.GITHUB_SHA],...['baseline','candidate'].map(arm=>[arm,'../'+arm,P[arm].commit,P[arm].tree])];
const checkouts=Object.fromEntries(specs.map(([name,path,head,tree])=>{
 const root=resolve(path);checkedGit(root,head,tree);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'});
 const files=Object.fromEntries(git('ls-files','-z').split('\0').filter(Boolean).sort().map(f=>[f,sha256(readFileSync(resolve(root,f)))]));
 return [name,{head,tree:git('rev-parse','HEAD^{tree}').trim(),files}];
}));
console.log(JSON.stringify({phase,checkouts,platform:process.platform,node:process.version,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,scope:'inert authored engineering validation only'}));
