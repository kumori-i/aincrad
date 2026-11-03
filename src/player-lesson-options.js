// Reconcile the observer's picker without replacing unchanged native options.
// This function never chooses a new target or grants action authority.
export function reconcilePlayerLessonOptions(picker, rows) {
  const prior = picker.value;
  const existing = new Map(Array.from(picker.options, option => [option.value, option]));
  const title = value => String(value || 'object').replaceAll('-', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
  const desired = [{value:'', label:rows.length ? 'Choose a visible object' : 'No visible source nearby'},
    ...rows.map(row => ({value:row.targetId,
      label:`${title(row.appearance?.details || row.appearance?.shape)} · ${Math.round(row.distance)} away`}))];
  const values = new Set(desired.map(row => row.value));
  for (const option of Array.from(picker.options)) if (!values.has(option.value)) option.remove();
  desired.forEach((row, index) => {
    const option = existing.get(row.value) || picker.ownerDocument.createElement('option');
    if (option.value !== row.value) option.value = row.value;
    if (option.textContent !== row.label) option.textContent = row.label;
    if (picker.options[index] !== option) picker.insertBefore(option, picker.options[index] || null);
  });
  // Only retire a selection when its physical source actually leaves the view.
  if (!values.has(prior)) picker.value = '';
}
