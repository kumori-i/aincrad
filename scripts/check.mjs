import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let files=[];
for(const dir of ['src','scripts','desktop','tests'])for(const f of await readdir(resolve(root,dir)))if(/\.(js|cjs|mjs)$/.test(f))files.push(`${dir}/${f}`);
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
console.log(`Syntax OK: ${files.length} JavaScript modules.`);
const tests=files.filter(f=>f.endsWith('.test.mjs'));
const r=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
process.exitCode=r.status??1;
