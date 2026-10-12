/** World distances are in logical pixels. Change rules here, never in the renderer. */
export const CONFIG = Object.freeze({
  title: 'Aincrad',
  version: '0.1.0',
  seed: 74193,
  halfSize: 24000,
  valleyRadius: 22500,
  walkSpeed: 150,
  sprintMultiplier: 1.65,
  playerRadius: 10,
  fixedStep: 1 / 60,
  chunkSize: 640,
  treeCell: 145,
  dayRealSeconds: 3600, // One in-game day = one hour of unpaused play.
  startHour: 8,
  saveKey: 'aincrad.save.v1',
  maxCachedChunks: 48,
});
export const SPAWN = Object.freeze({ x: -680, y: 380 });
export const CAVES = Object.freeze([
  { id: 'lantern', name: 'Lantern Hollow', x: -12000, y: -21700, tint: '#81d7cf', note: 'Blue crystals light a branching chamber beneath the northern ridge.' },
  { id: 'amber', name: 'Amber Grotto', x: 14500, y: -21600, tint: '#efc16e', note: 'Warm mineral seams glow in the eastern mountain stone.' },
  { id: 'echo', name: 'Echo Cavern', x: 21400, y: 10700, tint: '#bba0e8', note: 'A violet-lit cavern tucked into the eastern escarpment.' },
]);
export const LANDMARKS = Object.freeze([
  { id: 'trailhead', name: 'The Trailhead', x: SPAWN.x, y: SPAWN.y, kind: 'camp' },
  { id: 'lake', name: 'Stillwater Lake', x: -3550, y: -6500, kind: 'water' },
  { id: 'meadow', name: 'Sunfall Meadows', x: 6200, y: 4400, kind: 'meadow' },
  { id: 'grove', name: 'The Oldwood', x: -10600, y: 6100, kind: 'forest' },
  ...CAVES.map(c => ({ ...c, kind: 'cave' })),
]);
export const CAVE_SPAWN = Object.freeze({ x: 1320, y: 1510 });
export const CAVE_EXIT = Object.freeze({ x: 1320, y: 1580 });
