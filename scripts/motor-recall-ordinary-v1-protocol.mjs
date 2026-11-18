// Prospective unforced cohort. No execution or retry during engineering checks.
export const MOTOR_RECALL_ORDINARY_V1=Object.freeze({
 id:'motor-recall-ordinary-v1',seed:79223,seconds:1200,steps:72000,fixedStep:1/60,
 baselineCommit:'0a4eb36b3eaa7fa469a6da9257df588689aa046b',
 baselineTree:'426bcdb7f9bd28eb93dc21fbb15da283224e574f',
 baselineSource:'a4f39099b935133fd959541f9896aa3f34cdd7840b9d876f6d3ea9f94dd86412',
 candidateSource:'4aa7bcc87ac84b14ac34b6d0ff5f0321f7ca6e0d5b28526bc61924809bb0706f',
 activationRef:'experiments/motor-recall-ordinary-v1-once',
 workflow:'Motor recall ordinary v1 — approved once',workflowFile:'motor-recall-ordinary-v1-once.yml',
 arms:Object.freeze(['baseline','candidate']),
});
