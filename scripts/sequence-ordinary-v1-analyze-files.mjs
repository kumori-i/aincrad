// Raw artifacts only. No runtime imports, exclusive report creation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SEQUENCE_ORDINARY_V1 as P} from './sequence-ordinary-v1-protocol.mjs';
import {analyzeSequencePair} from './sequence-ordinary-v1-analyze.mjs';
import {verifySequenceJournal,HARNESS_FILES,frozenSeed} from './sequence-ordinary-v1-evidence.mjs';
import {sha256} from './producer-retest-ci-namespace.mjs';
export function analyzeSequenceFiles(baselineTag,candidateTag,manifestPath,output){
 const manifest=JSON.parse(readFileSync(manifestPath));assert.deepEqual(manifest.protocol,P);
 assert.deepEqual(manifest.baseline,{commit:P.baselineCommit,tree:P.baselineTree,source:P.baselineSource});
 assert.equal(manifest.candidate.source,P.candidateSource);for(const f of ['commit','tree'])assert.match(manifest.candidate[f]??'',/^[a-f0-9]{40}$/);
 assert.deepEqual(Object.keys(manifest.evaluationFiles),HARNESS_FILES);for(const h of Object.values(manifest.evaluationFiles))assert.match(h,/^[a-f0-9]{64}$/);
 assert.equal(sha256(JSON.stringify(manifest.evaluationFiles)),manifest.harnessSha256);
 const arms=[baselineTag,candidateTag].map(tag=>{const arm=JSON.parse(readFileSync(tag+'.json'));assert.equal(arm.harnessSha256,manifest.harnessSha256);arm.initialRaw=readFileSync(tag+'.initial.json','utf8');arm.saveRaw=readFileSync(tag+'.save.json','utf8');verifySequenceJournal(arm,readFileSync(tag+'.events.jsonl','utf8'));return arm;});
 assert.equal(arms[0].pair,manifest.pair);assert.equal(arms[1].pair,manifest.pair);assert.equal(manifest.seed,frozenSeed(manifest.pair));const result=analyzeSequencePair(...arms);writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,6);analyzeSequenceFiles(...process.argv.slice(2));}
