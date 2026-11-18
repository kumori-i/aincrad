// Read existing artifacts only; no simulator imports. Exclusive output.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHOICE_DIAGNOSTIC_V2 as P} from './choice-diagnostic-v2-protocol.mjs';
import {analyzeChoiceDiagnosticPair} from './choice-diagnostic-v2-analyze.mjs';
import {verifyEvidenceJournal} from './choice-diagnostic-v2-evidence.mjs';
import {sha256,NORMALIZED_PATHS} from './producer-retest-ci-namespace.mjs';
export function analyzeChoiceFiles(offTag,onTag,manifestPath,output){
 const manifest=JSON.parse(readFileSync(manifestPath));assert.equal(manifest.protocol.id,P.id);assert.equal(manifest.source,P.runtimeSource);
 assert.equal(sha256(JSON.stringify(manifest.evaluationFiles)),manifest.harnessSha256);
 const arms=[offTag,onTag].map(tag=>{
  const arm=JSON.parse(readFileSync(tag+'.json'));assert.equal(arm.harnessSha256,manifest.harnessSha256);assert.deepEqual(arm.normalizationPaths,NORMALIZED_PATHS);
  arm.initialRaw=readFileSync(tag+'.initial.json','utf8');arm.saveRaw=readFileSync(tag+'.save.json','utf8');
  verifyEvidenceJournal(arm,readFileSync(tag+'.events.jsonl','utf8'));return arm;
 });
 const result=analyzeChoiceDiagnosticPair(...arms);writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,6);analyzeChoiceFiles(...process.argv.slice(2));}
