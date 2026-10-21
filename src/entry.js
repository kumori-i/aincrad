// One authoritative watershed; query parameters never select another world.
export function entryModuleFor() { return './ozark-world-main.js'; }
export function bootEntry(_search, load = path => import(path)) { return load(entryModuleFor()); }
if (typeof window !== 'undefined' && typeof document !== 'undefined') await bootEntry(window.location.search);
