import { bindCommunicationMode } from '../../src/communication-mode.js';
/** Explicit historical language fixture authority; never imported by main. */
export function legacyFixture(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.agents)) for (const actor of value.agents) legacyFixture(actor);
  if (value.state) legacyFixture(value.state);
  if (['aster','mira'].includes(value.id) && value.memory) bindCommunicationMode(value,'legacy');
  return value;
}
