/** A player's letters can become an individual's tentative visual examples.
 * This module sees only the recipient's numeric crop and the literal letters.
 * It grants no object identity, food knowledge, action or character reward. */

export const PLAYER_LESSON_LIMITS = Object.freeze({
  examplesPerAgent: 64, features: 48, maxRms: 0.12, minRunnerGap: 0.02,
});

const IDS = Object.freeze(['aster', 'mira']);
const UINT32 = 0xffffffff;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const exactArray = value => Array.isArray(value) &&
  Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({length: value.length}, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const integer = (value, low, high) => Number.isSafeInteger(value) &&
  value >= low && value <= high;
const invalid = reason => { throw new TypeError(`Invalid player lesson bank: ${reason}`); };
const wordValid = word => typeof word === 'string' && /^[a-z]{1,6}$/.test(word);

function copyFeatures(features) {
  if (!exactArray(features) || features.length !== PLAYER_LESSON_LIMITS.features ||
      features.some(value => !Number.isFinite(value) || value < 0 || value > 1))
    invalid('numeric own-view features');
  return features.slice();
}

function copyExamples(examples) {
  if (!exactArray(examples) || examples.length > PLAYER_LESSON_LIMITS.examplesPerAgent)
    invalid('bounded examples');
  return examples.map(row => {
    if (!exact(row, ['word', 'features']) || !wordValid(row.word))
      invalid('literal word example');
    return {word: row.word, features: copyFeatures(row.features)};
  });
}

function copyLineage(lineage) {
  if (!exact(lineage, ['version', 'instanceId', 'nextSerial', 'agents']) ||
      lineage.version !== 2 || typeof lineage.instanceId !== 'string' ||
      !UUID.test(lineage.instanceId) ||
      !integer(lineage.nextSerial, 3, UINT32 + 1) ||
      !exactArray(lineage.agents) || lineage.agents.length !== IDS.length)
    invalid('world lineage');
  const agents = lineage.agents.map((row, index) => {
    if (!exact(row, ['agentId', 'serial']) || row.agentId !== IDS[index] ||
        !integer(row.serial, 1, UINT32) || row.serial >= lineage.nextSerial)
      invalid('individual lineage');
    return {agentId: row.agentId, serial: row.serial};
  });
  if (agents[0].serial === agents[1].serial) invalid('duplicate individual serial');
  return {instanceId: lineage.instanceId, nextSerial: lineage.nextSerial, agents};
}

function copyBank(value, lineage, allowRetiredSerial = false) {
  const owner = copyLineage(lineage);
  if (!exact(value, ['version', 'worldId', 'agents']) || value.version !== 1 ||
      value.worldId !== owner.instanceId || !exactArray(value.agents) ||
      value.agents.length !== IDS.length)
    invalid('world binding or bank shape');
  const agents = value.agents.map((row, index) => {
    const current = owner.agents[index];
    if (!exact(row, ['agentId', 'serial', 'examples']) ||
        row.agentId !== current.agentId ||
        !integer(row.serial, 1, UINT32) || row.serial >= owner.nextSerial ||
        !allowRetiredSerial && row.serial !== current.serial)
      invalid('individual binding');
    return {agentId: row.agentId, serial: row.serial,
      examples: copyExamples(row.examples)};
  });
  if (agents[0].serial === agents[1].serial)
    invalid('duplicate retained serial');
  return {version: 1, worldId: value.worldId, agents};
}

export function createFreshPlayerLessons(lineage) {
  const owner = copyLineage(lineage);
  return {version: 1, worldId: owner.instanceId,
    agents: owner.agents.map(({agentId, serial}) => ({agentId, serial, examples: []}))};
}

/** Strict save validation; no missing, copied or cross-incarnation rows. */
export function validatePlayerLessons(value, lineage) {
  return copyBank(value, lineage);
}

/** Live replacement starts empty while the other individual's examples stay
 * byte-for-byte equivalent. This cannot migrate a different world. */
export function reconcilePlayerLessons(value, lineage) {
  const owner = copyLineage(lineage);
  const old = copyBank(value, lineage, true);
  return {version: 1, worldId: old.worldId,
    agents: old.agents.map((row, index) => ({agentId: row.agentId,
      serial: owner.agents[index].serial,
      examples: row.serial === owner.agents[index].serial ? row.examples : []}))};
}

const rms = (left, right) => Math.sqrt(left.reduce((sum, value, index) =>
  sum + (value - right[index]) ** 2, 0) / PLAYER_LESSON_LIMITS.features);

/** Predict a raw token from one fresh own crop. At least two learned token
 * alternatives are needed; one-label repetition cannot look like accuracy. */
export function predictPlayerWord(examples, features) {
  const rows = copyExamples(examples), crop = copyFeatures(features);
  const byWord = new Map();
  for (const row of rows) {
    const distance = rms(row.features, crop);
    byWord.set(row.word, Math.min(distance, byWord.get(row.word) ?? Infinity));
  }
  const ranked = [...byWord].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const nearest = ranked[0]?.[1] ?? null, runner = ranked[1]?.[1] ?? null;
  const base = {word: null, labels: ranked.length,
    nearestRms: nearest, runnerRms: runner};
  if (ranked.length < 2)
    return {...base, status: 'abstained', reason: 'insufficient-labels'};
  if (nearest > PLAYER_LESSON_LIMITS.maxRms)
    return {...base, status: 'abstained', reason: 'out-of-distribution'};
  if (runner - nearest <= PLAYER_LESSON_LIMITS.minRunnerGap)
    return {...base, status: 'abstained', reason: 'ambiguous'};
  return {...base, status: 'predicted', reason: null, word: ranked[0][0]};
}

/** One completed paid and personally visible lesson adds exactly one example.
 * The diagnostic prediction is frozen before this update and never authorizes
 * a point, label, food inference or reward. */
export function learnPlayerLesson(value, {agentId, serial, word, features} = {}) {
  if (!plain(value) || !UUID.test(value.worldId || '') ||
      !exactArray(value.agents) || value.agents.length !== IDS.length)
    invalid('bank required before learning');
  const serials = value.agents.map(row => row?.serial);
  const nextSerial = Math.max(...serials) + 1;
  const lineage = {version: 2, instanceId: value.worldId, nextSerial,
    agents: value.agents.map(row => ({agentId: row?.agentId, serial: row?.serial}))};
  const bank = copyBank(value, lineage);
  if (!IDS.includes(agentId) || !integer(serial, 1, UINT32) ||
      bank.agents.find(row => row.agentId === agentId)?.serial !== serial ||
      !wordValid(word)) invalid('lesson owner or letters');
  const ownCrop = copyFeatures(features), row = bank.agents.find(a => a.agentId === agentId);
  const prediction = predictPlayerWord(row.examples, ownCrop);
  const seenWord = row.examples.some(example => example.word === word);
  // A new raw token is open-set evidence, not an error in a closed set of
  // previously heard alternatives. Keep it outside the accuracy denominator.
  const prequential = {prediction, comparable: seenWord && prediction.labels >= 2,
    correct: seenWord && prediction.status === 'predicted' ?
    prediction.word === word : null,
    uniformChance: seenWord && prediction.labels >= 2 ? 1 / prediction.labels : null};
  row.examples = [...row.examples, {word, features: ownCrop}]
    .slice(-PLAYER_LESSON_LIMITS.examplesPerAgent);
  return {bank, prequential};
}
