import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {frozenArm} from './protocol.mjs';
import {verifyArchive} from './verify-archive.mjs';
import {comparableInitial} from './initial.mjs';
function main(){
 const [root,pairText]=process.argv.slice(2);assert.match(pairText??'',/^[01]$/);
 const pair=Number(pairText),results={},hashes=[];
 for(const arm of ['baseline','candidate']){
  const expected=frozenArm(pair,arm),read=name=>readFileSync(resolve(root,arm,name));
  const manifest=JSON.parse(read('terminal.json')),initial=read('initial.json');
  hashes.push(comparableInitial(JSON.parse(initial)));
  const result=verifyArchive({manifest,initial,final:read('final.json'),journal:read('research.jsonl'),expected});
  assert.equal(result.complete,true,'arm incomplete');
  results[arm]=result;
 }
 assert.equal(hashes[0],hashes[1],'paired initialization differs');
 writeFileSync(resolve(root,'analysis.json'),JSON.stringify({status:'integrity-passed-awaiting-independent-interpretation',pair,results},null,2)+'\n',{flag:'wx'});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main();
