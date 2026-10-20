import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Test-only reference. Reverse only the reviewed dispatch delta and pin every
// byte of the original main policy. Frozen pre-aquatic source is preserved so
// later separately gated features do not redefine the historical comparator.
// No production export or runtime flag.
export const originalWaterReturn = "      const move=routeTarget(npc,source);if(move)return wrap(move,'I am approaching remembered water.','water');";
export const guardedWaterReturn = `      const move=routeTarget(npc,source);if(move){
        // Do not let a remembered-water walk bypass an existing local safety action.
        const safety=terrainTraversalDecision(npc);
        if(safety?.need==='safety')return wrap(safety.action,safety.reason,'safety');
        return wrap(move,'I am approaching remembered water.','water');
      }`;
const source = readFileSync(new URL('./pre-aquatic-discovery.js', import.meta.url), 'utf8');
const baseline = source.replace(guardedWaterReturn, originalWaterReturn);
assert.equal(createHash('sha256').update(baseline).digest('hex'),
  'edb12cf185592b313f8a24a0c84528519872c91257e243a3067c3586b3479b2a', 'complete original main discovery policy bytes');
const imports = baseline.replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(`../../src/${path.slice(2)}`, import.meta.url).href}'`);
const reference = await import(`data:text/javascript;base64,${Buffer.from(imports + '\nexport { terrainTraversalDecision };\n').toString('base64')}`);
export const baselineDecision = reference.discoveryDecision;
export const terrainDecision = reference.terrainTraversalDecision;
