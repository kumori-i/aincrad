import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=resolve(root,'node_modules/electron/cli.js');
if(!existsSync(cli)){
  console.error('\nThe optional Electron desktop runtime is not installed.\n\nFor the desktop window:\n  npm install\n  npm start\n\nTo play immediately without downloading anything:\n  npm run web\n');
  process.exitCode=1;
}else{
  // Use Electron's CLI so modern releases can download their binary on first launch.
  const child=spawn(process.execPath,[cli,root,...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
  child.on('error',e=>{console.error('Desktop launch failed:',e.message);process.exitCode=1;});
  child.on('exit',(code)=>{process.exitCode=code??1;});
}
