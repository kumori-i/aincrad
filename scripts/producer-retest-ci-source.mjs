// Source fixtures are executable test inputs, not restored agent knowledge.
// Validate complete pinned bytes BEFORE writing into a new private directory.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,realpathSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './producer-retest-ci-namespace.mjs';
import {PRODUCER_RETEST_CI_PROTOCOL as P} from './producer-retest-ci-protocol.mjs';
const keys=(v,list)=>assert.deepEqual(Object.keys(v).sort(),[...list].sort());
export function sourceFingerprint(root){
 const sourceRoot=lstatSync(resolve(root,'src'));assert.ok(sourceRoot.isDirectory()&&!sourceRoot.isSymbolicLink(),'No source root symlink');
 const files={};function walk(relative){
  for(const entry of readdirSync(resolve(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=`${relative}/${entry.name}`,path=resolve(root,name);assert.equal(lstatSync(path).isSymbolicLink(),false,'No source symlink');
   if(entry.isDirectory())walk(name);else {assert.ok(entry.isFile(),'Regular sources only');if(name.endsWith('.js'))files[name]=sha256(readFileSync(path));}
  }
 }walk('src');return sha256(JSON.stringify(files));
}
export function validateBaseline(bytes,expectedArchiveSha=P.baselineArchiveSha256){
 assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<2*1024*1024);
 assert.equal(sha256(bytes),expectedArchiveSha,'Baseline archive bytes changed');
 const decoded=gunzipSync(bytes,{maxOutputLength:8*1024*1024}),text=decoded.toString('utf8');assert.ok(Buffer.from(text).equals(decoded),'Lossless UTF-8 required');
 const data=JSON.parse(text);assert.equal(JSON.stringify(data),text,'Canonical JSON only; duplicate keys rejected');keys(data,['version','sourceCommit','sourceSha256','files']);assert.equal(data.version,1);assert.equal(data.sourceCommit,P.baselineCommit);assert.equal(data.sourceSha256,P.baselineSource);
 assert.ok(data.files&&typeof data.files==='object'&&!Array.isArray(data.files));const entries=Object.entries(data.files);assert.ok(entries.length>1&&entries.length<512);
 const source={};for(const[path,file]of entries){
  assert.ok(path==='package.json'||/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(path),'Invalid baseline path');assert.ok(!path.split('/').some(s=>s==='.'||s==='..'||s.startsWith('.')));
  keys(file,['sha256','content']);assert.equal(typeof file.content,'string');assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.equal(sha256(file.content),file.sha256);
  if(path.startsWith('src/'))source[path]=file.sha256;
 }
 assert.equal(JSON.parse(data.files['package.json']?.content).type,'module');
 assert.equal(sha256(JSON.stringify(source)),P.baselineSource,'Baseline source fingerprint changed');return data;
}
export function extractBaseline(bytes,parent){
 const data=validateBaseline(bytes);assert.equal(realpathSync(parent),resolve(parent),'No extraction parent symlinks');assert.ok(lstatSync(parent).isDirectory()&&!lstatSync(parent).isSymbolicLink());const root=mkdtempSync(resolve(parent,'baseline-source-'));
 for(const[path,file]of Object.entries(data.files)){const target=resolve(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,file.content,{flag:'wx'});}
 assert.equal(sourceFingerprint(root),P.baselineSource);return root;
}
export function validateArmArguments(args,env=process.env){
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,'kumori-i/aincrad');assert.equal(env.GITHUB_EVENT_NAME,'create');assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');assert.equal(env.GITHUB_WORKFLOW,P.workflow);
 assert.ok(args.length===4||args.length===5);const[root,tag,seed,source,initial]=args;assert.ok(root&&tag);assert.equal(Number(seed),P.seed);
 assert.ok([P.baselineSource,P.candidateSource].includes(source));if(source===P.candidateSource)assert.match(initial??'',/^[a-f0-9]{64}$/);else assert.equal(initial,undefined);
 const arm=source===P.baselineSource?'baseline':'candidate';assert.equal(tag.split(/[\\/]/).at(-1),`${arm}-${P.seed}`);return {root,tag,seed:P.seed,source,initial,arm};
}
