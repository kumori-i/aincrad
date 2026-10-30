/** Read one reviewed receipt from a separate Git ref. This module cannot
 * activate the ordinary pilot; the execution runner verifies the receipt. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFile,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as P} from './character-ordinary-pilot-protocol.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REF='refs/heads/'+P.receiptRef;
const FILE='receipt.json';
const hex40=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=(args,root)=>execFileSync('git',args,{cwd:root,maxBuffer:128*1024});

export function characterPilotReceiptBlob(treeBytes){
  assert(Buffer.isBuffer(treeBytes),'Git tree inventory must be bytes');
  const entries=treeBytes.toString('utf8').split('\0');
  assert.equal(entries.length,2,'Receipt-data tree must contain exactly one file');
  assert.equal(entries[1],'');
  const match=/^100644 blob ([a-f0-9]{40})\treceipt\.json$/.exec(entries[0]);
  assert(match,'Receipt-data tree must contain only a regular root receipt.json');
  return match[1];
}

/** Git fetch changes local Git metadata, never the worktree or remote. The
 * resolved object and raw bytes are frozen; the receipt stays outside source. */
export async function fetchCharacterPilotReceiptRef({root=ROOT,env=process.env,git=command}={}){
  assert.equal(env.GITHUB_ACTIONS,'true');
  assert.equal(env.GITHUB_EVENT_NAME,'create');
  assert.equal(env.GITHUB_REF,'refs/heads/'+P.activationRef);
  assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
  assert(hex40(env.GITHUB_SHA),'Exact created-branch commit required');
  assert(isAbsolute(env.RUNNER_TEMP||'')&&isAbsolute(env.GITHUB_ENV||''),
    'GitHub runner temporary paths required');
  const read=(...args)=>git(args,root);
  assert.equal(read('rev-parse','HEAD').toString('utf8').trim(),env.GITHUB_SHA,
    'Checked-out source differs from created branch');
  read('fetch','--no-tags','--no-recurse-submodules','--depth=1','origin',REF);
  const commit=read('rev-parse','FETCH_HEAD^{commit}').toString('utf8').trim();
  assert(hex40(commit),'Receipt-data ref did not resolve to a commit');
  const blob=characterPilotReceiptBlob(read('ls-tree','-r','-z','--full-tree',commit));
  const size=Number(read('cat-file','-s',blob).toString('utf8').trim());
  assert(Number.isSafeInteger(size)&&size>0&&size<=16*1024,
    'Receipt-data file exceeds the bounded receipt size');
  const bytes=read('cat-file','blob',blob);
  assert.equal(bytes.length,size,'Receipt-data blob size changed');
  const parsed=JSON.parse(bytes.toString('utf8'));
  assert(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),
    'Receipt-data JSON object required');
  const path=join(env.RUNNER_TEMP,'aincrad-character-pilot-receipt.json');
  await writeFile(path,bytes,{flag:'wx',mode:0o600});
  await appendFile(env.GITHUB_ENV,
    `AINCRAD_CHARACTER_PILOT_RECEIPT_PATH=${path}\n`+
    `AINCRAD_CHARACTER_PILOT_RECEIPT_REF=${REF}\n`+
    `AINCRAD_CHARACTER_PILOT_RECEIPT_COMMIT=${commit}\n`);
  const result={receiptRef:REF,receiptCommit:commit,receiptSha256:sha(bytes),bytes:size};
  console.log(JSON.stringify(result));
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await fetchCharacterPilotReceiptRef();
