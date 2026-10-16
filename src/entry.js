// The ordinary desktop route keeps its existing boot and save handling.
// Only the exact disposable-profile test URL enters the unsaved walking pilot.
export function entryModuleFor(search) {
  return search === '?test=1&ozarkPilot=1' ? './ozark-pilot-main.js' : './main.js';
}

export function bootEntry(search, load = path => import(path)) {
  return load(entryModuleFor(search));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  await bootEntry(window.location.search);
}
