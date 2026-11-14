/** Bounded retry from personal action receipts only, never private gut state.
 * A failed admission neither discredits a source nor cancels delayed feedback.
 * Urgent thirst shortens, but never removes, the refractory interval.
 */
export function deferDrinkRetry(experience, elapsed, thirst) {
  const event=experience.filter(e=>e?.type==='action'&&e.details?.action?.type==='drink').at(-1);
  if(!event||!Number.isInteger(event.id)||event.id<=0||experience.filter(e=>e?.id===event.id).length!==1||event.details.result?.ok!==false||event.details.result.code!=='TOO_FULL'||
     !Number.isFinite(event.at)||event.at<0||!Number.isFinite(elapsed)||event.at>elapsed)return false;
  const interval=['parched','desperate thirst'].includes(thirst)?2:10;
  return elapsed-event.at<interval;
}
