import { categoryLabels, recordCategoryGrounding, resolveCategoryName } from './category-names.js';
import { resolvePoint } from './naming-runtime.js';
import { appearanceCuesMatch } from './peer-teaching.js';
import { visualSampleCurrent } from './visual-group-memory.js';

export const CATEGORY_ACK_WINDOW_SECONDS = 60;

/** A local gesture grounds a tentative word in the listener's own ordinary
 * samples. Neither prose nor a restored message can enter this transport.
 * Only the speaker's own model proposal is introduced, never a copied peer
 * dictionary or a whole extension of unseen category members. */
export class CategoryNameRuntime {
  #pending = new Map();

  constructor(social) {
    this.social = social;
    this.environment = social.getEnvironment?.();
  }

  dispose() { this.#pending.clear(); this.environment = null; }
  pendingCount() { return this.#pending.size; }

  local(speaker, listener) {
    const helpers = this.social.naming;
    return this.environment && this.environment === this.social.getEnvironment?.() &&
      this.social.agents().includes(speaker) && this.social.agents().includes(listener) &&
      speaker.elapsed === this.environment.elapsed && listener.elapsed === this.environment.elapsed &&
      helpers?.local(speaker, listener) &&
      !this.social.foodSharing?.holding(speaker) && !this.social.foodSharing?.holding(listener);
  }

  tick() {
    if(this.social.communicationMode!=='legacy')return;
    const helpers = this.social.naming;
    if (!this.environment || this.environment !== this.social.getEnvironment?.() || !helpers) {
      this.#pending.clear();
      return;
    }
    const now = this.environment.elapsed;
    for (const [key, pending] of this.#pending) {
      const { speaker, listener, token, at, epochs } = pending;
      if (!Number.isFinite(now) || now < at || now - at >= CATEGORY_ACK_WINDOW_SECONDS ||
          !this.local(speaker, listener) || speaker.epoch !== epochs[0] || listener.epoch !== epochs[1]) {
        this.#pending.delete(key);
        continue;
      }
      if (now === at) continue;
      if (helpers.pendingCount() || helpers.opportunityCount() || !helpers.ready(listener)) continue;
      const objects = helpers.visible(listener);
      const labels = categoryLabels(listener).filter(row => row.token === token && row.speakerId === speaker.id);
      if (!labels.length) { this.#pending.delete(key); continue; }
      const selected = resolveCategoryName(listener, token, speaker.id, objects);
      const text = selected
        ? `I have one currently matching example of ${token}. That is an appearance comparison, not knowledge of its other properties.`
        : `I cannot pick a single ${token} from what I see. Please point if you mean one individual; similar appearance does not tell me its other properties.`;
      helpers.emit(listener, speaker, text);
      this.#pending.delete(key);
      return;
    }
    if (helpers.pendingCount() || helpers.opportunityCount()) return;
    for (const speaker of this.social.agents()) {
      if (!helpers.ready(speaker)) continue;
      const labels = categoryLabels(speaker).filter(row => row.source === 'own');
      if (!labels.length) continue;
      for (const listener of this.social.agents()) {
        if (speaker === listener || !this.local(speaker, listener)) continue;
        const speakerObjects = helpers.visible(speaker), listenerObjects = helpers.visible(listener);
        for (const label of labels) {
          const own = speaker.categoryNames?.own.find(row => row.token === label.token && appearanceCuesMatch(row.cues, label.cues));
          if (!own || own.announcedTo.some(row => row.peerId === listener.id)) continue;
          for (const member of label.members) {
            const object = speakerObjects.find(row => row.id === member.objectId);
            if (!object || !appearanceCuesMatch(object.appearance, own.cues) ||
                !visualSampleCurrent(speaker, object.id) || !visualSampleCurrent(listener, object.id) ||
                resolvePoint(speakerObjects, object.position)?.id !== object.id) continue;
            // The receiver gets a gesture, not the sender's identity selection.
            const pointed = resolvePoint(listenerObjects, object.position);
            if (!pointed || pointed.id !== object.id || !appearanceCuesMatch(pointed.appearance, own.cues)) continue;
            const proposed = helpers.proposed();
            const event = helpers.evidence(proposed, speaker, listener, object);
            if (!recordCategoryGrounding(speaker, listener, own, pointed.id, event)) continue;
            helpers.emit(speaker, listener, `I call things that look like this ${own.token}: a tentative appearance name, not a promise about food or safety.`);
            this.#pending.set(listener.id, { speaker, listener, token:own.token, at:now,
              epochs:[speaker.epoch, listener.epoch] });
            return;
          }
        }
      }
    }
  }
}
