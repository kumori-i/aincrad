// NEW prospective cohort. Both seeds frozen before any ordinary execution.
export const SEQUENCE_ORDINARY_V1=Object.freeze({
 id:'sequence-ordinary-v1',seeds:Object.freeze([2585496148,540480811]),seedFreeze:Object.freeze({
  approved:true,at:'2026-11-18T18:32:14Z',
  derivation:'SHA256(sequence-ordinary-v1|dc9099a6102766505d07342544a6d8fe4d801277|i), first four bytes unsigned big-endian, i=0,1; reject known canonical labels and actor+1 aliases',
  inventorySha256:'5403cbc9eb43b644f209c3e8c564bccf655b42f4bff774363c12a229328f0feb',
  canonicalRejectSha256:'9fda452a5e8edbf7292b617cca15eeab42cf0e100e97262c17fa55928acac314',
  domainAuditSha256:'aec48c7dfc3d3c6a33399310714cde7d86229335c8cd4bfc3287e94bde2ae2c3',
  limitation:'Available history only: lost local-only history and six expired/empty artifacts remain gaps. Distinct initial states do not establish statistical independence. Physical world seed is fixed.',
 }),
 seconds:3600,steps:216000,fixedStep:1/60,armTimeoutMs:60*60*1000,pairTimeoutMinutes:135,
 baselineCommit:'83b03dbb527c93b39e07263a46b37ad29141cf5b',baselineTree:'03af0e0b04dddde033a3ecba1df378b1468ba005',
 baselineSource:'4aa7bcc87ac84b14ac34b6d0ff5f0321f7ca6e0d5b28526bc61924809bb0706f',
 candidateSource:'ccad62ce1debd637911b2130423d8132d096417080d7a2a4c33c85deb8876ac4',
 reviewedCandidateTree:'dc9099a6102766505d07342544a6d8fe4d801277',
 activationRef:'experiments/sequence-ordinary-v1-once',workflow:'Sequence ordinary v1 — approved once',workflowFile:'sequence-ordinary-v1-once.yml',
 arms:Object.freeze(['baseline','candidate']),
});
