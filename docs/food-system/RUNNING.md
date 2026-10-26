# Run the current food-system validation

These commands run the release budget and single-runtime caution capability
checks described in [the acceptance specification](ACCEPTANCE.md). They work
from a clean, committed checkout using only files included in the repository.
No archived reports, other checkout, credentials or external baseline directory
are required. Use the repository's supported Node.js version on Linux or macOS.
Install dependencies before the assays. Complete `npm run check` and
`npm run build` against the final publication tree; these commands do not replace
that aggregate. Do not edit or commit files while the assays run.

The included baseline is a **preserved measured run**, not a new 600-second
baseline replay. Its full reconstructed initial state is checked against the
original recorded raw-state hash. The separately documented v4 comparison
projection is also checked; its hash never replaces the raw provenance hash.
The original experiment's failed status is retained. See
[historical evidence](HISTORICAL-EVIDENCE.md) for the extraction details.

## Create manifests and run both gates

Run the following as one Bash script from the repository root. It creates a new
output directory under the system temporary directory, outside the checkout,
then freezes the current commit/tree, complete runtime-file fingerprint,
specification, both evaluator files and packaged baseline identity. An existing
manifest or report is never overwritten. Keep the printed output directory;
failed reports and logs are useful evidence too.

```bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export RELEASE_DIR
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aincrad-food-release.XXXXXX")"
printf 'Validation evidence: %s\n' "$RELEASE_DIR"

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { BASELINE_IDENTITY, loadReleaseBaseline } from './scripts/food-release-baseline.mjs';
import { RELEASE_BUDGET_IDENTITY } from './scripts/evaluate-food-release-budget.mjs';
import { CONTROL_IDENTITY } from './scripts/evaluate-food-combined-capability.mjs';

const root = await realpath(process.cwd());
const output = await realpath(process.env.RELEASE_DIR);
const rel = relative(root, output);
assert.ok(rel && (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)),
  'Evidence directory must be outside the checkout');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '',
  'Commit or remove local changes before freezing validation');
const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// This is the same recursive ordering and hashing algorithm as both evaluators.
const files = {};
async function walk(dir) {
  const entries = (await readdir(resolve(root, dir), { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(name);
    else if (entry.name.endsWith('.js')) files[name] = hash(await readFile(resolve(root, name)));
  }
}
await walk('src');
for (const name of ['package.json', 'package-lock.json']) {
  files[name] = hash(await readFile(resolve(root, name)));
}
const runtime = { sha256: hash(JSON.stringify(files)), files };
const protocolSha256 = hash(await readFile('docs/food-system/ACCEPTANCE.md'));
const releaseEvaluators = {
  budgetSha256: hash(await readFile('scripts/evaluate-food-release-budget.mjs')),
  capabilitySha256: hash(await readFile('scripts/evaluate-food-combined-capability.mjs')),
};
assert.equal(runtime.sha256, RELEASE_BUDGET_IDENTITY.runtimeSha256);
assert.equal(protocolSha256, RELEASE_BUDGET_IDENTITY.protocolSha256);
assert.equal(protocolSha256, CONTROL_IDENTITY.protocolSha256);
assert.equal(releaseEvaluators.budgetSha256, CONTROL_IDENTITY.evaluatorSha256);
await loadReleaseBaseline(); // Verify full fixture, raw start, projection and extraction audit.

const common = {
  commit, tree, runtime, protocolSha256, releaseEvaluators,
  baselineIdentity: BASELINE_IDENTITY,
};
const manifests = {
  'budget-manifest.json': {
    ...common, evaluatorSha256: releaseEvaluators.budgetSha256,
  },
  'capability-manifest.json': {
    ...common, evaluatorSha256: releaseEvaluators.capabilitySha256,
    controlIdentity: CONTROL_IDENTITY,
  },
};
for (const [name, manifest] of Object.entries(manifests)) {
  await writeFile(resolve(output, name), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ commit, tree, runtimeSha256: runtime.sha256,
  protocolSha256, releaseEvaluators, baselineIdentity: BASELINE_IDENTITY }, null, 2));
NODE

sha256_file() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    console.log(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
  ' "$1"
}
PROTOCOL_SHA="$(sha256_file docs/food-system/ACCEPTANCE.md)"
RUNTIME_SHA="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  console.log(JSON.parse(readFileSync(process.argv[1], "utf8")).runtime.sha256);
' "$RELEASE_DIR/budget-manifest.json")"

node scripts/evaluate-food-release-budget.mjs \
  --manifest "$RELEASE_DIR/budget-manifest.json" \
  --manifest-sha256 "$(sha256_file "$RELEASE_DIR/budget-manifest.json")" \
  --protocol-sha256 "$PROTOCOL_SHA" \
  --expected-runtime "$RUNTIME_SHA" \
  --output "$RELEASE_DIR/controlled.json" \
  2>&1 | tee "$RELEASE_DIR/budget.log"

# This runs only if the budget process succeeded. The capability evaluator also
# independently checks schema, identities, actual numeric gates and final tree.
node scripts/evaluate-food-combined-capability.mjs \
  --manifest "$RELEASE_DIR/capability-manifest.json" \
  --manifest-sha256 "$(sha256_file "$RELEASE_DIR/capability-manifest.json")" \
  --protocol-sha256 "$PROTOCOL_SHA" \
  --expected-runtime "$RUNTIME_SHA" \
  --controlled-report "$RELEASE_DIR/controlled.json" \
  --controlled-sha256 "$(sha256_file "$RELEASE_DIR/controlled.json")" \
  --output "$RELEASE_DIR/capability.json" \
  2>&1 | tee "$RELEASE_DIR/capability.log"

printf 'Completed reports and frozen manifests: %s\n' "$RELEASE_DIR"
```

## Read the outcome

The budget report must say `controlled-passed`. The capability report must say
`completed-combined-capability`; `failed` and `inconclusive` are not passes.
Keep both complete JSON reports, manifests and logs, including initial exposure,
gross harm, finite resource accounting and all disclosed fixture assistance.
These bounded assisted checks do not establish autonomous survival, safe dosing,
or a causal harm reduction against another implementation.

These commands do **not** launch Electron or establish native desktop acceptance.
The real warning encounter, rendered checkpoints and separate-process native
save/reopen checks remain separate requirements in the
[verification guide](VERIFICATION.md). Never bypass a missing display or sandbox
restriction to obtain a native pass.
