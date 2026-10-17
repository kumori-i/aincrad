// Each world has a separate boot and save boundary. The bounded walking pilot
// remains available only through its exact disposable-profile test URL.
export function entryModuleFor(search) {
  if (search === '?test=1&ozarkPilot=1') return './ozark-pilot-main.js';
  if (search === '?ozarkWorld=1' || search === '?test=1&ozarkWorld=1')
    return './ozark-world-main.js';
  return './main.js';
}

export function bootEntry(search, load = path => import(path)) {
  return load(entryModuleFor(search));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  await bootEntry(window.location.search);
}
