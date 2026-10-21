// Observation is not testimony, a technique, or a nutritional proof. Own links
// point into the existing paid experiment ledger; retirement never restarts it.
export const INQUIRY_LIMIT = 16;
const objectId = v => typeof v === 'string' && /^object:\d{1,9}$/.test(v);
const point = v => v && Object.keys(v).length === 2 && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) < 24000 && Math.abs(v.y) < 24000;
export function validInquiries(rows, d, elapsed, self) {
  if (!Array.isArray(rows) || rows.length > INQUIRY_LIMIT) return false;
  const seen = new Set();
  return rows.every(q => {
    if (!q || Object.keys(q).sort().join(',') !== 'actorId,actorPosition,at,attempts,retired,sourceId,sourcePosition' ||
      !objectId(q.sourceId) || q.sourceId===q.actorId || seen.has(q.sourceId) || q.actorId === self ||
      !(['aster','mira'].includes(q.actorId) || objectId(q.actorId)) ||
      !Number.isFinite(q.at) || q.at < 0 || q.at > elapsed || !point(q.actorPosition) || !point(q.sourcePosition) || Math.hypot(q.actorPosition.x-q.sourcePosition.x,q.actorPosition.y-q.sourcePosition.y)>80 ||
      typeof q.retired !== 'boolean' || !Array.isArray(q.attempts) || q.attempts.length > 3 ||
      new Set(q.attempts).size !== q.attempts.length || q.retired && q.attempts.length) return false;
    seen.add(q.sourceId);
    const attempts = q.attempts.map(id => d.experiments.find(e => e.id === id));
    return attempts.every((e, i) => e && e.at >= q.at && (i === 0 || e.id > attempts[i-1].id) &&
      (['grasp','pull'].includes(e.primitive) && e.targetId === q.sourceId && !attempts.slice(0,i).some(p=>p.primitive===e.primitive) ||
       e.primitive === 'sample' && attempts.slice(0,i).some(p=>p.ok && (p.primitive==='grasp' ? p.targetId : p.materialId)===e.targetId) && !attempts.slice(0,i).some(p=>p.primitive==='sample')));
  });
}
export function retireInquiries(d) {
  for (const q of d.inquiries || []) if (!q.retired && q.attempts.some(id => !d.experiments.some(e => e.id === id))) {
    q.retired = true; q.attempts = [];
  }
}
export function linkInquiryOutcome(d, experiment) {
  for (const q of d.inquiries || []) {
    if (q.retired || q.attempts.length >= 3 || experiment.at < q.at) continue;
    const prior = q.attempts.map(id => d.experiments.find(e => e.id === id)).filter(Boolean);
    if (prior.some(e => e.primitive === experiment.primitive)) continue;
    if (['grasp','pull'].includes(experiment.primitive) && experiment.targetId === q.sourceId ||
      experiment.primitive === 'sample' && prior.some(e => e.ok && (e.primitive === 'grasp' ? e.targetId : e.materialId) === experiment.targetId)) q.attempts.push(experiment.id);
  }
}
