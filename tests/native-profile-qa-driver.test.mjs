import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

const require = createRequire(import.meta.url);
const { runNativeProfileQa, resolveQaFile, readFixedFile } = require('./native-profile-qa-driver.cjs');
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

test('native QA Windows path normalization accepts ordinary spelling variants only', async () => {
  const win = path.win32;
  const temp = 'C:\\Users\\runner\\AppData\\Local\\Temp';
  const scratch = win.join(temp, 'Aincrad-QA');
  const calls = [];
  const diagnostics = [];
  const fileSystem = {
    async realpath(target) {
      calls.push(['realpath', target]);
      if (target === temp) return `\\\\?\\${temp}`;
      if (win.relative(scratch, target) === '') return `\\\\?\\${scratch}`;
      throw new Error(`private fs error: ${target}`);
    },
    async lstat(target) {
      calls.push(['lstat', target]);
      if (win.relative(scratch, target) === '') return { isSymbolicLink: () => false };
      throw new Error(`private fs error: ${target}`);
    },
  };
  const options = { platform: 'win32', tempDirectory: temp, fileSystem,
    diagnosticSink: line => diagnostics.push(line) };
  for (const operation of ['config', 'output', 'rawFile', 'backupFile', 'screenshotFile', 'progressFile']) {
    const candidate = `c:/users/RUNNER/appdata/local/temp/aincrad-qa/${operation}.json`;
    assert.equal(await resolveQaFile(candidate, scratch, operation, options),
      win.join(scratch, `${operation}.json`));
  }
  assert.ok(calls.some(([operation, target]) => operation === 'lstat' &&
    win.relative(scratch, target) === ''));
  assert.deepEqual(diagnostics, [], 'ordinary case and separator variants need no diagnostic');
});

test('native QA Windows mismatch diagnostic distinguishes temp-root drift and short-name spelling', async () => {
  const win = path.win32;
  const temp = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp';
  const scratch = win.join(temp, 'aincrad-recovered-native-ABC123');
  const candidate = win.join(scratch, 'config-1.json');
  const lines = [];
  const diagnosticKey = Buffer.alloc(32, 7);
  const diagnosticSink = line => lines.push(line);
  const common = { platform: 'win32', tempDirectory: temp, diagnosticKey,
    diagnosticSink, syncRealpath: () => temp };
  const shortTemp = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp';
  await assert.rejects(resolveQaFile(candidate, scratch, 'config', {
    ...common, routeTempRoot: temp,
    fileSystem: { realpath: async () => shortTemp },
  }), /class=parent-mismatch; stage=lexical/);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Native QA scratch diagnostic: \{/);
  assert.ok(lines[0].length < 6000, 'one diagnostic fits in the bounded child stderr capture');
  const first = JSON.parse(lines[0].slice('Native QA scratch diagnostic: '.length));
  assert.equal(first.event, 'native-qa-scratch-parent');
  assert.equal(first.relations.routeToDriverTemp.exact, true);
  assert.equal(first.relations.hostHintToDriverTemp.exact, true);
  assert.equal(first.relations.suppliedToExpectedScratch.exact, true);
  assert.equal(first.relations.syncToAsyncTemp.foldedEqual, false);
  assert.equal(first.relations.rebasedToExpectedScratch.foldedEqual, false);
  assert.ok(first.paths.asyncTemp.components.some(component => component[4] === 1),
    '8.3-style component has a marker without printing its name');
  for (const secret of [temp, scratch, candidate, 'C:', 'runneradmin', 'RUNNER~1', 'config-1.json'])
    assert.ok(!lines[0].includes(secret), 'diagnostic contains no raw path component');

  lines.length = 0;
  const oldTemp = 'C:\\OldTemp';
  const oldScratch = win.join(oldTemp, 'aincrad-recovered-native-ABC123');
  await assert.rejects(resolveQaFile(candidate, oldScratch, 'config', {
    ...common, routeTempRoot: oldTemp,
    fileSystem: { realpath: async () => temp },
  }), /class=parent-mismatch; stage=lexical/);
  const second = JSON.parse(lines[0].slice('Native QA scratch diagnostic: '.length));
  assert.equal(second.relations.routeToDriverTemp.foldedEqual, false);
  assert.equal(second.relations.hostHintToDriverTemp.exact, true);
  assert.equal(second.relations.syncToAsyncTemp.exact, true);
  assert.equal(second.relations.rebasedToExpectedScratch.foldedEqual, false);
  assert.ok(!lines[0].includes(oldTemp));
  lines.length = 0;
  await assert.rejects(resolveQaFile(candidate, oldScratch, 'output', {
    ...common, routeTempRoot: oldTemp,
    fileSystem: { realpath: async () => temp },
  }), /class=parent-mismatch; stage=lexical/);
  assert.deepEqual(lines, [], 'only the failing config gate emits the diagnostic');
  await assert.rejects(resolveQaFile(win.join(scratch, 'other.json'), oldScratch, 'config', {
    ...common, routeTempRoot: oldTemp,
    fileSystem: { realpath: async () => temp },
  }), /class=parent-mismatch; stage=lexical/);
  assert.deepEqual(lines, [], 'arbitrary config names emit no path signatures');
});

test('native QA Windows path rejections give finite classes without exposing paths', async () => {
  const win = path.win32;
  const temp = 'C:\\Users\\runner\\AppData\\Local\\Temp';
  const scratch = win.join(temp, 'Aincrad-QA');
  const calls = [];
  const fileSystem = {
    async realpath(target) {
      calls.push(['realpath', target]);
      if (target === temp) return temp;
      if (win.relative(scratch, target) === '') return scratch;
      throw new Error(`private fs error: ${target}`);
    },
    async lstat(target) {
      calls.push(['lstat', target]);
      return { isSymbolicLink: () => false };
    },
  };
  const options = { platform: 'win32', tempDirectory: temp, fileSystem };
  const rejected = [
    [win.join(scratch, 'nested', 'file.json'), 'parent-mismatch'],
    [win.join(temp, 'sibling', 'file.json'), 'parent-mismatch'],
    ['D:\\private\\file.json', 'other-drive'],
    ['\\\\server\\share\\file.json', 'unc'],
    ['\\\\?\\C:\\Users\\runner\\AppData\\Local\\Temp\\Aincrad-QA\\file.json', 'namespace'],
    ['\\\\.\\C:\\Users\\runner\\AppData\\Local\\Temp\\Aincrad-QA\\file.json', 'namespace'],
    [win.join(scratch, 'file.json:alternate'), 'special-name'],
    [win.join(scratch, 'CON.txt'), 'special-name'],
  ];
  for (const [candidate, pathClass] of rejected) {
    calls.length = 0;
    await assert.rejects(resolveQaFile(candidate, scratch, 'config', options), error => {
      assert.match(error.message, new RegExp(`Native QA config path rejected \\(class=${pathClass}; stage=`));
      for (const secret of [candidate, temp, scratch, 'C:', 'D:', 'file.json', 'private fs error'])
        assert.ok(!error.message.includes(secret), 'diagnostic omitted private spelling');
      return true;
    });
    if (['other-drive', 'unc', 'namespace', 'special-name'].includes(pathClass))
      assert.deepEqual(calls, [], 'unsafe lexical classes require no filesystem access');
  }
});

test('native QA Windows physical parent identity and symlinks remain enforced', async () => {
  const win = path.win32;
  const temp = 'C:\\Users\\runner\\AppData\\Local\\Temp';
  const scratch = win.join(temp, 'Aincrad-QA');
  const candidate = 'c:/users/runner/appdata/local/temp/aincrad-qa/config.json';
  const options = { platform: 'win32', tempDirectory: temp };
  const realpath = async target => {
    if (target === temp) return temp;
    if (target === scratch) return scratch;
    if (win.relative(scratch, target) === '') return win.join(temp, 'other-scratch');
    throw new Error(`private fs error: ${target}`);
  };
  await assert.rejects(resolveQaFile(candidate, scratch, 'config', {
    ...options, fileSystem: { realpath, lstat: async () => ({ isSymbolicLink: () => false }) },
  }), /class=parent-mismatch; stage=physical/);
  await assert.rejects(resolveQaFile(candidate, scratch, 'config', {
    ...options, fileSystem: {
      realpath: async target => target === temp ? temp : scratch,
      lstat: async () => ({ isSymbolicLink: () => true }),
    },
  }), /class=symlink-parent; stage=physical/);
});

test('native QA rebases a trusted POSIX temp-root alias before checking scratch', async () => {
  const temporary = '/var/folders/qa-temp';
  const physicalTemp = '/private/var/folders/qa-temp';
  const scratch = `${physicalTemp}/aincrad-qa`;
  const fileSystem = {
    async realpath(target) {
      if (target === temporary) return physicalTemp;
      if (target === scratch) return scratch;
      throw new Error(`private fs error: ${target}`);
    },
    async lstat(target) {
      assert.equal(target, scratch);
      return { isSymbolicLink: () => false };
    },
  };
  assert.equal(await resolveQaFile(`${temporary}/aincrad-qa/config.json`, scratch, 'config',
    { platform: 'darwin', tempDirectory: temporary, fileSystem }), `${scratch}/config.json`);
  assert.equal(await resolveQaFile(`${scratch}/config.json`, scratch, 'config',
    { platform: 'darwin', tempDirectory: temporary, fileSystem }), `${scratch}/config.json`);
});

test('native QA bounded file read rejects symlinks and oversized files without raw paths', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'aincrad-qa-read-'));
  const outside = await mkdtemp(join(tmpdir(), 'aincrad-qa-outside-'));
  try {
    await writeFile(join(outside, 'private.json'), '{}');
    await symlink(join(outside, 'private.json'), join(scratch, 'link.json'));
    await writeFile(join(scratch, 'large.json'), 'oversized');
    for (const file of ['link.json', 'large.json']) {
      await assert.rejects(readFixedFile(join(scratch, file), scratch, 2, 'rawFile'), error => {
        assert.match(error.message, /Native QA rawFile path rejected \(class=unbounded-or-alias; stage=read\)/);
        assert.ok(!error.message.includes(scratch));
        assert.ok(!error.message.includes(outside));
        return true;
      });
    }
    await writeFile(join(scratch, 'valid.json'), '{}');
    assert.equal((await readFixedFile(join(scratch, 'valid.json'), scratch, 2, 'rawFile')).toString(), '{}');
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
