import { createSavePreparationProtocol } from './save-preparation.js';
// Static same-origin module. Pure preparation only; no persistence side effects.
const receive=createSavePreparationProtocol({send:message=>self.postMessage(message)});
self.addEventListener('message',event=>receive(event.data));
