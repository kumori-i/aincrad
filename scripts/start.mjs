import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=resolve(root,'node_modules/electron/cli.js');
if(!existsSync(cli)){
  console.error('Electron is not installed. Run npm install, then npm start.');
  process.exitCode=1;
}else if(!existsSync(resolve(root,'dist/desktop/main.cjs'))){
  console.error('The desktop build is missing. Run npm run build, then npm start.');
  process.exitCode=1;
}else{
  const flags=process.argv.slice(2);
  // These flags are confined to an isolated test process, never a normal launch.
  if(flags.includes('--smoke-test')&&process.platform==='linux'){
    if(!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY)flags.push('--ozone-platform=headless');
    flags.push('--disable-gpu');
  }
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  // The Electron package resolves (and, if needed, downloads) its own binary.
  const electron=createRequire(import.meta.url)('electron');
  const child=spawn(electron,[root,...flags],{cwd:root,stdio:'inherit',env});
  child.on('error',e=>{console.error('Desktop launch failed:',e.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}
