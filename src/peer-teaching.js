/** Secondhand procedure data only. Never an action, personal effect or proof. */
export const PEER_TEACHING_WINDOW_SECONDS = 900; // One quarter of the 3600-play-second day.
const objectId = value => typeof value === 'string' && /^object:[1-9][0-9]{0,8}$/.test(value);
const token = value => typeof value === 'string' && /^[a-zA-Z0-9:_\-.]{1,80}$/.test(value) && !['__proto__','prototype','constructor'].includes(value);
const time = value => Number.isFinite(value) && value >= 0 && value <= 1e10;
export function cleanPeerTeaching(raw) {
  if (!raw || raw.version !== 1 || !objectId(raw.sourceObjectId) || !token(raw.senderTechniqueId) ||
      !['pull','grasp'].includes(raw.acquisition) || !time(raw.receivedAt)) return null;
  return {version:1, sourceObjectId:raw.sourceObjectId, senderTechniqueId:raw.senderTechniqueId,
    acquisition:raw.acquisition, receivedAt:raw.receivedAt,
    state:['ready','waiting','complete','unavailable'].includes(raw.state)?raw.state:'unavailable',
    ...(typeof raw.lastCode==='string'?{lastCode:raw.lastCode.slice(0,60)}:{})};
}
export function peerTeachingText(sourceObjectId, acquisition) {
  const action=acquisition==='pull'?'pulled a piece from':'picked up';
  return `I ${action} ${sourceObjectId}, then sampled what I held. I later felt relief. You can try ${acquisition}, then sample your own result; that benefit is my experience, not a promise.`;
}
export function isPeerTeaching(report) {
  return report && ['aster','mira'].includes(report.sourceId) && report.channel === 'peer' &&
    cleanPeerTeaching(report.teaching) !== null;
}
export function teachingExpired(report, now) {
  return !time(now) || !isPeerTeaching(report) || report.teaching.receivedAt > now ||
    now - report.teaching.receivedAt >= PEER_TEACHING_WINDOW_SECONDS;
}
export function peerTeachingLabel(report, now) {
  if (report.status==='contradicted') return 'contradicted by my own bodily experience';
  if (report.status==='supported') return 'supported by my own bodily experience';
  if (report.teaching?.state==='unavailable') return 'attempt unavailable; reported benefit remains unverified';
  if (report.teaching?.state==='waiting') return 'sampled; my bodily feedback is still pending';
  if (teachingExpired(report,now)) return 'old advice; no new attempt';
  return report.cursor>0?'acquired; next step is my own sample':'taught procedure; not yet tried';
}
/** Reconstruct only from this receiver's already validated action/feedback rows.
 * Missing post-attempt links disable the attempt; never replay an acquisition. */
export function restorePeerTeaching(report, raw, discovery, npc, interruption=null) {
  const teaching = cleanPeerTeaching(raw.teaching);
  if (!teaching || !['aster','mira'].includes(raw.sourceId) || raw.sourceId===npc?.id || raw.channel!=='peer') {
    report.proposed=[]; report.cursor=0; report.evidence=[]; report.status='unverified';
    return;
  }
  report.teaching=teaching;
  report.status='unverified';
  const source=teaching.sourceObjectId;
  const disable=()=>{teaching.state='unavailable';teaching.lastCode='TEACHING_LINK_UNAVAILABLE';report.proposed=[];report.cursor=0;report.evidence=[];};
  if (npc && teaching.receivedAt>npc.elapsed) {disable();return;}
  const expected=raw.proposed?.[raw.cursor];
  if ((interruption===true || interruption?.type===expected?.type&&interruption?.targetId===expected?.targetId) &&
      raw.status==='unverified' && teaching.state==='ready') {disable();return;}
  const rawEvidence=Array.isArray(raw.evidence)?raw.evidence:[];
  if (rawEvidence.length>2 || new Set(rawEvidence).size!==rawEvidence.length) {disable();return;}
  const attempted=rawEvidence.map(id=>discovery.experiments.find(e=>e.id===id));
  if (!attempted.length&&raw.cursor===0&&teaching.state==='unavailable'&&!raw.proposed?.length) {report.proposed=[];report.cursor=0;report.evidence=[];return;}
  if (attempted.some(e=>!e) || !discovery.observations[source]) {disable();return;}
  report.proposed=[{type:teaching.acquisition,targetId:source},{type:'sample',targetId:source}];
  report.evidence=[...rawEvidence];report.cursor=0;
  if (!attempted.length) {
    if (raw.cursor!==0 || teaching.state!=='ready') disable();
    return;
  }
  const acquired=attempted[0];
  if (acquired.primitive!==teaching.acquisition || acquired.targetId!==source || acquired.at<teaching.receivedAt) {disable();return;}
  if (!acquired.ok) {teaching.state='unavailable';teaching.lastCode=acquired.code;report.cursor=2;return;}
  const material=teaching.acquisition==='grasp'?acquired.targetId:acquired.materialId;
  if (!objectId(material) || !discovery.observations[material]) {disable();return;}
  report.proposed[1].targetId=material;report.cursor=1;
  if (attempted.length===1) {
    if (raw.cursor!==1 || teaching.state!=='ready') {disable();return;}
    return;
  }
  const sample=attempted[1];
  if (sample.primitive!=='sample' || sample.targetId!==material || sample.id<=acquired.id || sample.at<acquired.at) {disable();return;}
  report.cursor=2;
  if (!sample.ok) {teaching.state='unavailable';teaching.lastCode=sample.code;return;}
  const effects=discovery.effects.filter(e=>e.ingestionId===sample.ingestionId&&e.actionId===sample.actionId);
  if (effects.some(e=>e.effect==='discomfort')) report.status='contradicted';
  else if(effects.some(e=>e.effect==='sustained')) report.status='supported';
  teaching.state=report.status==='unverified'?'waiting':'complete';
}
