/** A distinct once-only diagnostic identity with the first pilot's physical,
 * sampling and evidence limits unchanged. The frozen v1 protocol stays intact. */
import {CHARACTER_ORDINARY_PILOT_PROTOCOL as V1} from './character-ordinary-pilot-protocol.mjs';

export {CHARACTER_PILOT_COUNT_KEYS,readCharacterPilotClock,
  guardFreshCharacterPilot,projectCharacterPilot,validateCharacterPilotClock,
  validateCharacterPilotProjection,createCharacterPilotSchedule,
  createCharacterPilotTracker,createCharacterPilotBudget,
  boundedCharacterPilotTerminal} from './character-ordinary-pilot-protocol.mjs';

export const CHARACTER_ORDINARY_PILOT_PROTOCOL=Object.freeze({...V1,
  id:'ordinary-character-gate-diagnostic-v2',
  activationRef:'experiments/character-gate-diagnostic-v2-once',
  receiptRef:'experiments/character-gate-diagnostic-v2-receipt',
  workflow:'Ordinary character-gate diagnostic v2 — approved once',
});
