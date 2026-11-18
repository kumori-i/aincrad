// Fresh prospective cohort. Never reuse a started arm or any historical seed.
export const PRODUCER_RETEST_CI_PROTOCOL=Object.freeze({
  "id": "producer-retest-ci-v1",
  "workflow": "Producer retest CI v1 — approved once",
  "activationRef": "experiments/producer-retest-ci-v1-once",
  "workflowFile": "producer-retest-ci-v1-once.yml",
  "seed": 77201,
  "seconds": 1200,
  "fixedStep": 0.016666666666666666,
  "baselineSource": "7f548d1f167f33114ae33b80d8522253c40d6640d989efa5986a411c1a565b50",
  "candidateSource": "a4f39099b935133fd959541f9896aa3f34cdd7840b9d876f6d3ea9f94dd86412",
  "baselineCommit": "b2bd319df750b8981caca34c7d9fdfb1410ad106",
  "baselineArchiveSha256": "794169d346c298b7d5a52816d804f0009c8024425ed452236ef0d6a64bd7992c"
});
