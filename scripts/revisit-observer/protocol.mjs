import assert from 'node:assert/strict';
export const PROTOCOL=Object.freeze({
 id:'voluntary-revisit-ordinary-v1',
 workflow:'Voluntary revisit ordinary v1 approved once',
 workflowFile:'voluntary-revisit-ordinary-v1-once.yml',
 activationRef:'experiments/voluntary-revisit-ordinary-v1-once',
 steps:216000,fixedStep:1/60,startAt:0,armTimeoutMs:60*60*1000,
 baseline:Object.freeze({commit:'0f10bdd3321d87aeafbfd5d2f09095b9b8fb059f',tree:'ae3dcf1637e83c271ff8ee4b8a03a1d89a559b44'}),
 candidate:Object.freeze({commit:'1fb64ad879ab7155b023f4bb3bc44c6a776204f1',tree:'1ffe3090b09fb80a4a18f7a5c7a27d66e17ef8aa'}),
 seeds:Object.freeze([436152993, 661401960]),
 freeze:Object.freeze({
  approved:true,
  inventorySha256:'a80a269e6121add418465fac8f997e597d2486d18869e43e8935d96cfadbe627',
  selectionReviewSha256:'0133075b1d5fca9b5d8d31bfd6b488a4f868b936c08f2b61c197944c777f5684',
  harnessSha256:'de942faf50ab5f63538ebb86c0fe7ca6cb86fd2bbfc7dff5a3e40afb603e4f8e',
  sourceSha256:Object.freeze({
   baseline:'a272d4b87d91f98458606aac7c7b90e3cdadc38557556482cd2a289ecd070514',
   candidate:'ac79b69199c44921eb36f500259ce2d99e405d0273d1867e1c792f9eb6211e2f',
  }),
 }),
});
export function frozenArm(pair,arm,p=PROTOCOL){
 assert([0,1].includes(pair)&&['baseline','candidate'].includes(arm),'invalid pair or arm');
 assert(p.freeze?.approved===true&&Array.isArray(p.seeds)&&p.seeds.length===2&&new Set(p.seeds).size===2,'protocol inert: seeds not frozen');
 const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
 assert(p.seeds.every(x=>Number.isSafeInteger(x)&&x>0&&x<2**32-1)&&sha(p.freeze.inventorySha256)&&sha(p.freeze.harnessSha256)&&sha(p.freeze.sourceSha256?.[arm]),'invalid freeze manifest');
 return {...p[arm],sourceSha256:p.freeze.sourceSha256[arm],harnessSha256:p.freeze.harnessSha256,arm,seed:p.seeds[pair],steps:p.steps,startAt:p.startAt,fixedStep:p.fixedStep};
}
export function activationEnvironment(env,p=PROTOCOL){
 for(const [k,v] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kumori-i/aincrad',GITHUB_EVENT_NAME:'create',GITHUB_REF:'refs/heads/'+p.activationRef,GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW:p.workflow}))assert.equal(env[k],v);
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);
 assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 return env.GITHUB_RUN_ID;
}
export function childEnvironment(env){
 return Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW','GITHUB_SHA','GITHUB_RUN_ID'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
}
