/** Record actual runner identity, not an inferred OS/architecture support claim. */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
await mkdir('test-results', {recursive:true});
await writeFile('test-results/host.json', JSON.stringify({
  platform:process.platform, arch:process.arch, release:release(), node:process.version,
  commit:git('rev-parse','HEAD'), tree:git('rev-parse','HEAD^{tree}'),
  worktreeStatus:git('status','--porcelain'),
  note:'This identifies the runner and checked-out tree. Native reports and process logs establish execution, not this metadata alone.',
},null,2)+'\n');
