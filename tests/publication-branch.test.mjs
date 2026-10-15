import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorBranch} from '../scripts/publish-github.mjs';
test('connector publication can target a checked feature branch without changing CLI main publication',()=>{
 assert.equal(connectorBranch([]),'main');
 assert.equal(connectorBranch(['--prepare-connector','out.json','--branch','feat/regional-ecology-foundation']),'feat/regional-ecology-foundation');
 for(const branch of ['', '../main','feature..bad','feature//bad','HEAD','-main','.secret','feature.lock','a/.hidden','a/b.lock','a/','a.','a b','a@{b'])assert.throws(()=>connectorBranch(['--prepare-connector','out.json','--branch',branch]));
 assert.throws(()=>connectorBranch(['--branch','feat/example']));
});
