// Session-only prequential bookkeeping for personally seen player lessons.
// Counts describe the training stream, never held-out transfer or meaning.
// The caller owns the one-use physical witness; this module receives only the
// prior prediction, individual identity and current world lineage.
import {createFreshPlayerLessons} from './player-lesson-bank.js';

const MAX_COUNT = 1_000_000_000;
const IDS = ['aster', 'mira'];
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) => plain(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
const invalid = () => { throw new TypeError('Invalid player lesson evaluation'); };
const blankRow = ({agentId, serial}) => ({agentId, serial, completedExamples:0,
  comparable:0, predicted:0, correct:0, abstained:0,
  uniformChanceSum:0, saturated:false});

function copyEvaluation(value) {
  if (!exact(value, ['worldId', 'agents']) || typeof value.worldId !== 'string' ||
      !Array.isArray(value.agents) || value.agents.length !== IDS.length ||
      Reflect.ownKeys(value.agents).length !== IDS.length + 1) invalid();
  return {worldId:value.worldId,agents:value.agents.map((row,index) => {
    if (!exact(row, ['agentId','serial','completedExamples','comparable',
      'predicted','correct','abstained','uniformChanceSum','saturated']) ||
        row.agentId !== IDS[index] || !Number.isSafeInteger(row.serial) ||
        row.serial < 1 || row.serial > 0xffffffff ||
        !['completedExamples','comparable','predicted','correct','abstained']
          .every(key => integer(row[key])) ||
        !Number.isFinite(row.uniformChanceSum) ||
        row.uniformChanceSum < 0 || row.uniformChanceSum > MAX_COUNT ||
        typeof row.saturated !== 'boolean' ||
        row.correct > row.predicted ||
        !row.saturated && row.predicted + row.abstained > row.comparable ||
        row.comparable > row.completedExamples) invalid();
    return {...row};
  })};
}

function increment(row,key,amount=1) {
  const next=row[key]+amount;
  if (next >= MAX_COUNT) {
    row[key]=MAX_COUNT;
    row.saturated=true;
  } else row[key]=next;
}

export function createPlayerLessonEvaluation(lineage) {
  const bank=createFreshPlayerLessons(lineage);
  return {worldId:bank.worldId,agents:bank.agents.map(blankRow)};
}

/** Replacement clears just that individual's session scores. Reopen should
 * instead create a new blank evaluation; no score is part of a save. */
export function reconcilePlayerLessonEvaluation(value,lineage) {
  const fresh=createPlayerLessonEvaluation(lineage), previous=copyEvaluation(value);
  if (fresh.worldId !== previous.worldId) invalid();
  return {worldId:fresh.worldId,agents:fresh.agents.map((row,index) =>
    previous.agents[index].serial===row.serial ? previous.agents[index] : row)};
}

/** Record exactly one accepted own-image example, using the frozen prediction
 * returned by learnPlayerLesson BEFORE that example was added. An unseen raw
 * word is open-set evidence and never enters the known-label denominator. */
export function recordPlayerLessonEvaluation(value,{agentId,serial,prequential}={}) {
  const next=copyEvaluation(value);
  const row=next.agents.find(agent => agent.agentId===agentId);
  if (!row || row.serial!==serial || !exact(prequential,
    ['prediction','comparable','correct','uniformChance']) ||
      !plain(prequential.prediction) ||
      !Number.isSafeInteger(prequential.prediction.labels) ||
      prequential.prediction.labels<0 || prequential.prediction.labels>64 ||
      !['predicted','abstained'].includes(prequential.prediction.status) ||
      typeof prequential.comparable!=='boolean') invalid();
  const comparable=prequential.comparable;
  if (comparable) {
    const labels=prequential.prediction.labels;
    if (labels<2 || !Number.isFinite(prequential.uniformChance) ||
        prequential.uniformChance!==1/labels ||
        (prequential.prediction.status==='predicted' ?
          typeof prequential.correct!=='boolean' : prequential.correct!==null)) invalid();
  } else if (prequential.correct!==null || prequential.uniformChance!==null) invalid();
  increment(row,'completedExamples');
  if (comparable) {
    increment(row,'comparable');
    if (prequential.prediction.status==='predicted') {
      increment(row,'predicted');
      if (prequential.correct) increment(row,'correct');
    } else increment(row,'abstained');
    increment(row,'uniformChanceSum',prequential.uniformChance);
  }
  return next;
}

/** A defensive, bounded observer projection. No world ID or crop is exposed. */
export function playerLessonEvaluationSnapshot(value) {
  const clean=copyEvaluation(value);
  return {sessionOnly:true,agents:clean.agents};
}
