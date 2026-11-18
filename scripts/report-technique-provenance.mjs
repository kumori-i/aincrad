// Read JSON evidence; exclusive standalone output. No simulation or source writes.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {reportTechniqueProvenance} from './technique-provenance-report.mjs';
const [input,output,...extra]=process.argv.slice(2);
if(!input||!output||extra.length)throw Error('Usage: node scripts/report-technique-provenance.mjs INPUT.json NEW-REPORT.json');
if(statSync(input).size>32*1024*1024)throw Error('Evidence input exceeds 32 MiB');
const report=reportTechniqueProvenance(JSON.parse(readFileSync(input,'utf8')));
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(report.status==='unavailable')process.exitCode=2;
