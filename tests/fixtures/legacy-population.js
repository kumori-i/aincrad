import { PopulationRuntime as MainPopulationRuntime } from '../../src/population.js';
/** Historical frozen harness adapter: old source body, explicit old channel. */
export class PopulationRuntime extends MainPopulationRuntime {
  constructor(state, options = {}) { super(state, {...options, communicationMode:'legacy'}); }
}
