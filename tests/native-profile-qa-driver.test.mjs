import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { runNativeProfileQa } = require('./native-profile-qa-driver.cjs');
const promises = require('node:fs/promises');

test('native QA rejects symlinked parents before any renderer or profile action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aincrad-qa-path-'));
  const scratch = join(root, 'scratch'), outside = join(root, 'outside');
  const originalPath = join(scratch, 'original'), copyPath = join(scratch, 'copy');
  await mkdir(originalPath, { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(scratch, 'escape'));
  const inputs = [
    { output: join(scratch, 'escape', 'result.json') },
    { action: 'seed', rawFile: join(scratch, 'escape', 'raw.json'),
      expectedSha256: '0'.repeat(64), output: join(scratch, 'result-2.json') },
    { action: 'stage', backupFile: join(scratch, 'escape', 'backup.json'),
      output: join(scratch, 'result-3.json') },
  ];
  try {
    const app = { isPackaged: false };
    const profileRoute = { kind: 'original', originalPath, copyPath,
      isTest: true, usesTestPaths: true };
    const originalRealpath = promises.realpath, originalLstat = promises.lstat;
    const rejectUnsafeMetadata = (operation, target) => {
      if (String(target).includes('escape') || String(target).includes('outside'))
        throw new Error(`unsafe ${operation} of an untrusted path`);
    };
    promises.realpath = async (...args) => {
      rejectUnsafeMetadata('realpath', args[0]);
      return originalRealpath(...args);
    };
    promises.lstat = async (...args) => {
      rejectUnsafeMetadata('lstat', args[0]);
      return originalLstat(...args);
    };
    try {
      for (const [index, input] of inputs.entries()) {
        const configPath = join(scratch, `config-${index}.json`);
        await writeFile(configPath, JSON.stringify({ version: 1, action: 'inspect',
          output: join(scratch, 'result.json'), ...input }));
        await assert.rejects(runNativeProfileQa({ app, profileRoute, configPath,
          win: null, session: null, rawSaveBackup: null, recoveredProfile: null }),
        /direct disposable scratch/i);
      }
      const aliasedConfig = join(outside, 'aliased-config.json');
      await writeFile(aliasedConfig, JSON.stringify({ version: 1, action: 'inspect',
        output: join(scratch, 'result.json') }));
      await assert.rejects(runNativeProfileQa({ app, profileRoute,
        configPath: join(scratch, 'escape', 'aliased-config.json'),
        win: null, session: null, rawSaveBackup: null, recoveredProfile: null }),
      /direct disposable scratch/i);
      assert.equal(await readFile(aliasedConfig, 'utf8'), JSON.stringify({ version: 1,
        action: 'inspect', output: join(scratch, 'result.json') }));
    } finally {
      promises.realpath = originalRealpath;
      promises.lstat = originalLstat;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
