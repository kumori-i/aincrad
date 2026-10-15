/** Reproducible regional foundation measurements, not a sustainability claim.
 * Usage: node scripts/evaluate-regional.mjs --days 1 --seeds 74193,3
 *        --human-seconds 120 --output /path/to/new-report.json
 * Output is create-only. Each seed runs in a fresh, sequential worker isolate.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HUMAN_ANCHORS = ['pond:oldwood', 'pond:north', 'pond:south', 'lake:west:2'];
const NATIVE_ECOLOGY_STEP = .5;
const sha = value => createHash('sha256').update(value).digest('hex');
const number = value => Number.isFinite(value) ? value : 0;
const sum = (items, get) => items.reduce((total, item) => total + number(get(item)), 0);
const counts = (items, key) => items.reduce((out, item) => { out[item[key]] = (out[item[key]] || 0) + 1; return out; }, {});
const clone = value => structuredClone(value);
const rounded = value => Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
const ratio = (intake, spent) => spent > 0 ? intake / spent : null;
const difference = (after, before) => Object.fromEntries(Object.keys(after).filter(key => typeof after[key] === 'number').map(key => [key, after[key] - number(before[key])]));

async function fingerprint() {
  const files = [];
  async function collect(folder) {
    for (const entry of await readdir(resolve(ROOT, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await collect(name);
      else if (/\.(?:js|mjs|json)$/.test(name)) files.push(name);
    }
  }
  await collect('src');
  files.push('scripts/evaluate-regional.mjs', 'package.json', 'package-lock.json');
  const hashes = {};
  for (const file of files.sort()) hashes[file] = sha(await readFile(resolve(ROOT, file)));
  return { sha256: sha(JSON.stringify(hashes)), files: hashes };
}
function gitState() {
  const git = args => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };
  return { commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), dirtyStatus: git(['status', '--porcelain']), description: 'Commit plus content hashes identify uncommitted candidates; no clean-tree claim is implied.' };
}
function options() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const selected = { seeds: [74193, 3], days: 1, humanSeconds: 120, output: resolve(ROOT, `reports/regional-evaluation-${stamp}.json`) };
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index], value = process.argv[++index];
    assert(value !== undefined, `Missing value for ${flag}`);
    if (flag === '--days') { selected.days = Number(value); assert(Number.isFinite(selected.days) && selected.days > 0 && selected.days <= 240, 'Days must be >0 and <=240.'); }
    else if (flag === '--human-seconds') { selected.humanSeconds = Number(value); assert(Number.isFinite(selected.humanSeconds) && selected.humanSeconds >= 0 && selected.humanSeconds <= 7200, 'Human seconds must be 0 through 7200; zero explicitly skips human trials.'); }
    else if (flag === '--seeds' || flag === '--seed') { selected.seeds = [...new Set(value.split(',').map(Number))]; assert(selected.seeds.length && selected.seeds.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff), 'Seeds must be uint32 integers.'); }
    else if (flag === '--output') selected.output = resolve(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  return selected;
}
function timings(samples, wallMs) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { steps: samples.length, wallMs: rounded(wallMs), meanStepMs: rounded(sum(samples, n => n) / Math.max(1, samples.length)), p95StepMs: rounded(percentile(.95)), p99StepMs: rounded(percentile(.99)), maximumStepMs: rounded(sorted.at(-1)), timingDefinition: 'Only the authoritative step is timed; diagnostic collection and report creation are included in wallMs, not step samples. Percentiles use nearest rank.' };
}

async function evaluateSeed(settings) {
  const startFingerprint = await fingerprint();
  assert.equal(startFingerprint.sha256, settings.expectedFingerprint, 'Worker source differs from the parent launch manifest.');
  // Dynamic import occurs after hashing; end hashes reject concurrent edits.
  const [{ CONFIG }, ecologyApi, regionApi, corridorApi, worldApi, environmentApi, { PopulationRuntime }, { createNpc }, { decisionObservation }, { nearbyWaterSources }, { ECOLOGY_RULES, ECOLOGY_SPECIES, ECOLOGY_MATERIALS }, { measureCardinalWorld, compareCardinalMetrics }] = await Promise.all([
    import('../src/config.js'), import('../src/ecology.js'), import('../src/ecology-regions.js'), import('../src/ecology-corridors.js'), import('../src/world.js'), import('../src/environment.js'), import('../src/population.js'), import('../src/npc-state.js'), import('../src/controller.js'), import('../src/resources.js'), import('../src/ecology-config.js'), import('../src/cardinal-metrics.js'),
  ]);
  const { createEnvironment, tickEnvironment } = environmentApi;
  const { ecologyCoverage, ecologyHabitatAudit, regionalHabitatAnchors, tickEcology, ecologyEnergy } = ecologyApi;
  const { habitatConditions, regionAt, regionalResourceAudit } = regionApi;
  const { corridorSegmentClear, buildHabitatCorridors } = corridorApi;
  const { freshState, canStandOutside, distance } = worldApi;
  assert.equal(ECOLOGY_RULES.stepSeconds, NATIVE_ECOLOGY_STEP, 'Evaluator must be reviewed when native ecology dt changes.');
  assert.equal(CONFIG.dayRealSeconds, 3600, 'Evaluator must be reviewed when the calendar changes.');
  let peakRss = process.memoryUsage().rss;
  const sampleMemory = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  const bodyStock = body => number(body?.availableEnergyKcal) + number(body?.storedEnergyKcal);
  const stomachStock = body => sum(body?.stomach || [], item => item.remainingKcal);
  // This does not call ecologyEnergy or measureCardinalWorld.
  function independentEnergy(ecology) {
    const stocks = {
      producersKcal: sum(ecology.plants, plant => plant.kind === 'grass' ? plant.biomassGrams * ECOLOGY_RULES.grassKcalPerGram : plant.quantity * ECOLOGY_MATERIALS[plant.kind === 'apple_tree' ? 'apple' : 'berry'].energyKcal),
      materialsKcal: sum(ecology.materials, item => item.energyKcal),
      animalStructureKcal: sum(ecology.animals, animal => animal.structureKcal),
      animalReserveKcal: sum(ecology.animals, animal => bodyStock(animal.physiology)),
      animalStomachKcal: sum(ecology.animals, animal => stomachStock(animal.physiology)),
      detritusKcal: number(ecology.detritus.energyKcal),
    };
    const remainingKcal = sum(Object.values(stocks), value => value), ledger = ecology.ledger;
    const inputKcal = ledger.initialKcal + ledger.photosynthesisKcal + ledger.externalKcal;
    const outputKcal = ledger.humanRemovedKcal + ledger.metabolizedKcal + ledger.decomposedKcal + ledger.discardedKcal;
    const toleranceKcal = Math.max(1e-6, 1e-9 * (Math.abs(inputKcal) + Math.abs(outputKcal) + Math.abs(remainingKcal)));
    return { stocks, openingKcal: ledger.initialKcal, photosynthesisInputKcal: ledger.photosynthesisKcal, externalInputKcal: ledger.externalKcal, outputKcal, closingKcal: remainingKcal, residualKcal: inputKcal - outputKcal - remainingKcal, toleranceKcal, passed: Math.abs(inputKcal - outputKcal - remainingKcal) <= toleranceKcal, engineStockDifferenceKcal: remainingKcal - ecologyEnergy(ecology), note: 'Birth transfers remain internal. Absorption transfers stomach energy to body stores and is not a second input. Stock sums are independent of the engine audit; cumulative flow counters are engine instrumentation.' };
  }
  function snapshot(state) {
    const ecology = state.environment.ecology;
    const invalidStocks = [];
    const inspect = (label, object, keys) => { for (const key of keys) if (!Number.isFinite(object?.[key]) || object[key] < -1e-9) invalidStocks.push(`${label}.${key}`); };
    inspect('detritus', ecology.detritus, ['massGrams', 'energyKcal', 'nutrients']);
    for (const p of ecology.plants) inspect(p.id, p, ['biomassGrams', 'quantity', 'capacity']);
    for (const m of ecology.materials) inspect(m.id, m, ['massGrams', 'energyKcal', 'waterMl']);
    for (const a of ecology.animals) { inspect(a.id, a, ['structureKcal']); inspect(a.id + '.physiology', a.physiology, ['availableEnergyKcal', 'storedEnergyKcal', 'waterDeficitMl']); for (const meal of a.physiology.stomach) inspect(`${a.id}.${meal.id}`, meal, ['remainingKcal', 'remainingMassGrams', 'remainingWaterMl']); }
    for (const r of ecology.regions || []) inspect(r.id, r, ['nutrients', 'massGrams', 'energyKcal']);
    return { at: state.elapsed, gameDay: state.elapsed / CONFIG.dayRealSeconds, seasonDay: (ECOLOGY_RULES.startSeasonDay + state.elapsed / CONFIG.dayRealSeconds) % ECOLOGY_RULES.yearDays, weather: state.environment.weather.kind,
      animals: counts(ecology.animals, 'species'), plants: counts(ecology.plants, 'kind'), births: ecology.births, deaths: ecology.deaths,
      animalReservesKcal: sum(ecology.animals, a => bodyStock(a.physiology)), animalStomachKcal: sum(ecology.animals, a => stomachStock(a.physiology)),
      animalAbsorbedKcal: ecology.ledger.animalAbsorbedKcal, animalSpentKcal: ecology.ledger.metabolizedKcal,
      biomassGrams: sum(ecology.plants, p => p.biomassGrams), fruitUnits: sum(ecology.plants, p => p.quantity), detritus: clone(ecology.detritus), ledger: clone(ecology.ledger),
      stocksValid: invalidStocks.length === 0, invalidStockCount: invalidStocks.length, invalidStocks: invalidStocks.slice(0, 32), depletedRegionIds: (ecology.regions || []).filter(r => r.nutrients < .001).map(r => r.id), energy: independentEnergy(ecology), regionalAudit: regionalResourceAudit(ecology) };
  }
  function soilAudit(opening, ecology) {
    const initial = new Map(opening.map(r => [r.id, r]));
    const detritusBalance = (old, region, stock, deposits, decay) => {
      if (![region[deposits], region[decay], old[deposits], old[decay]].every(Number.isFinite)) return { opening: number(old[stock]), closing: region[stock], productionInput: null, transfersIn: null, transfersOut: null, consumption: null, decayLoss: null, residual: null, passed: null };
      const transfersIn = region[deposits] - old[deposits], decayLoss = region[decay] - old[decay], residual = old[stock] + transfersIn - decayLoss - region[stock];
      const tolerance = Math.max(1e-6, 1e-9 * (Math.abs(old[stock]) + Math.abs(transfersIn) + Math.abs(decayLoss) + Math.abs(region[stock])));
      return { opening: old[stock], productionInput: 0, transfersIn, transfersOut: 0, consumption: 0, decayLoss, closing: region[stock], residual, tolerance, passed: Math.abs(residual) <= tolerance };
    };
    const rows = (ecology.regions || []).map(region => {
      const old = initial.get(region.id) || {}, uptake = number(region.uptakeNutrients) - number(old.uptakeNutrients), mineralized = number(region.mineralizedNutrients) - number(old.mineralizedNutrients);
      const residual = number(old.nutrients) + mineralized - uptake - region.nutrients;
      const throughput = Math.abs(number(old.nutrients)) + Math.abs(mineralized) + Math.abs(uptake) + Math.abs(region.nutrients);
      const tolerance = Math.max(1e-6, 1e-9 * throughput);
      return { id: region.id, nutrientUnits: { opening: number(old.nutrients), productionInput: mineralized, transfersIn: 0, transfersOut: 0, consumption: uptake, decayLoss: 0, closing: region.nutrients, residual, tolerance, passed: Math.abs(residual) <= tolerance },
        detritusMassGrams: detritusBalance(old, region, 'massGrams', 'depositedMassGrams', 'decayedMassGrams'),
        detritusEnergyKcal: detritusBalance(old, region, 'energyKcal', 'depositedKcal', 'decomposedKcal'),
        depleted: region.nutrients < .001 };
    });
    return { units: 'Approximate soil nutrient units: modeled growth consumes .004 units per gram and detritus mineralization returns .004 units per decayed gram. Not elemental mass or a closed nutrient cycle.',
      nutrientTransferDefinition: 'No direct soil-to-soil actuator or transfer runs in these trials. Local material deposits return nutrients only through measured mineralization; consumption is plant uptake.',
      detritusTransferDefinition: 'Deposited material transfers from plant/material compartments into the detritus pool at its physical destination; it is not a new energy input. Decay removes represented detritus mass and dissipates its energy. No direct detritus export actuator runs.',
      missingInstrumentation: rows.some(r => r.detritusMassGrams.passed === null || r.detritusEnergyKcal.passed === null) ? 'Required deposit/decay counters are absent; affected gross flows and residuals are null.' : null,
      engineAudit: regionalResourceAudit(ecology), rows, maximumAbsoluteNutrientResidual: Math.max(0, ...rows.map(r => Math.abs(r.nutrientUnits.residual))), allNutrientBalancesPass: rows.every(r => r.nutrientUnits.passed), allDetritusBalancesPass: rows.every(r => r.detritusMassGrams.passed === true && r.detritusEnergyKcal.passed === true), depletedRegions: rows.filter(r => r.depleted).map(r => r.id) };
  }
  function waterAccess(point, environment) {
    const candidates = nearbyWaterSources({ position: point, scene: 'valley' }, 1000, environment).filter(s => s.available).sort((a, b) => distance(point, a) - distance(point, b)).slice(0, 6);
    const failed = [];
    for (const source of candidates) {
      const routes = buildHabitatCorridors([{ key: 'origin', ...point }, { key: source.id, x: source.x, y: source.y }]);
      if (routes.length) return { verified: true, sourceId: source.id, bank: { x: source.x, y: source.y }, routeLength: routes[0].length, directDistance: distance(point, source), failuresBeforeSuccess: failed };
      failed.push({ sourceId: source.id, failures: clone(routes.failures || []) });
    }
    return { verified: false, reason: candidates.length ? 'No route found to the bounded six nearest candidates within 1000 units.' : 'No available bank candidate within 1000 units.', testedCandidates: candidates.length, failures: failed };
  }
  function corridorCoverage(route, plants, predicate) {
    const coverRadius = 150, intervals = []; let offset = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], length = distance(a, b); if (!length) continue;
      const vx = (b.x - a.x) / length, vy = (b.y - a.y) / length;
      for (const plant of plants) {
        if (!predicate(plant)) continue;
        const dx = plant.position.x - a.x, dy = plant.position.y - a.y, projection = dx * vx + dy * vy, perpendicularSquared = Math.max(0, dx * dx + dy * dy - projection * projection);
        if (perpendicularSquared > coverRadius * coverRadius) continue;
        const half = Math.sqrt(coverRadius * coverRadius - perpendicularSquared), lo = Math.max(0, projection - half), hi = Math.min(length, projection + half);
        if (hi <= lo) continue;
        const along = Math.max(0, Math.min(length, projection));
        if (!corridorSegmentClear({ x: a.x + vx * along, y: a.y + vy * along }, plant.position)) continue;
        intervals.push([offset + lo, offset + hi]);
      }
      offset += length;
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let end = 0, maximumGap = 0, covered = 0; const uncovered = [];
    for (const [lo, hi] of intervals) { if (lo > end) uncovered.push({ startArc: end, endArc: lo, length: lo - end }); maximumGap = Math.max(maximumGap, lo - end); if (hi > end) { covered += hi - Math.max(lo, end); end = hi; } }
    if (offset > end) uncovered.push({ startArc: end, endArc: offset, length: offset - end });
    maximumGap = Math.max(maximumGap, offset - end);
    return { coverRadius, routeLength: offset, coveredLength: covered, maximumUncoveredPathGap: maximumGap, uncoveredIntervals: uncovered.slice(0, 128), uncoveredIntervalCount: uncovered.length, intervalsTruncated: uncovered.length > 128, definition: 'Exact arc-length union of radius-150 plant neighborhoods whose nearest point has a radius-16 collision-checked connection to that plant. Vegetation is not a human food guarantee.' };
  }
  function structuralAudit(environment) {
    const ecology = environment.ecology, audit = ecologyHabitatAudit(ecology), anchors = regionalHabitatAnchors(), routes = audit.corridors;
    const adjacency = new Map(anchors.map(a => [a.key, []]));
    for (const route of routes) { adjacency.get(route.from)?.push(route.to); adjacency.get(route.to)?.push(route.from); }
    const seen = new Set(), components = [];
    for (const anchor of anchors) {
      if (seen.has(anchor.key)) continue;
      const group = [], queue = [anchor.key]; seen.add(anchor.key);
      while (queue.length) { const key = queue.shift(); group.push(key); for (const neighbor of adjacency.get(key) || []) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); } }
      components.push(group.sort());
    }
    const plantHabitats = {};
    for (const plant of ecology.plants) { const key = habitatConditions(plant.position).kind; plantHabitats[key] ||= { plants: 0, byKind: {}, biomassGrams: 0, fruitUnits: 0, meanMoisture: 0 }; const row = plantHabitats[key]; row.plants++; row.byKind[plant.kind] = (row.byKind[plant.kind] || 0) + 1; row.biomassGrams += number(plant.biomassGrams); row.fruitUnits += number(plant.quantity); row.meanMoisture += plant.moisture; }
    for (const row of Object.values(plantHabitats)) row.meanMoisture /= row.plants;
    const corridorRows = routes.map(route => { const direct = distance(route.points[0], route.points.at(-1)); return { from: route.from, to: route.to, routeLength: route.length, directDistance: direct, detourRatio: direct > 0 ? route.length / direct : null, points: route.points,
      allSegmentsValidRadius16: route.points.every((point, index) => index ? corridorSegmentClear(route.points[index - 1], point) : canStandOutside(point.x, point.y, 16)),
      vegetation: corridorCoverage(route, ecology.plants, p => p.kind !== 'grass' || p.biomassGrams > 0), fruit: corridorCoverage(route, ecology.plants, p => ['apple_tree', 'bramble'].includes(p.kind) && p.quantity > 0),
      nominalUnloadedWalkSeconds: route.length / CONFIG.walkSpeed }; });
    const anchorsWithAccess = audit.anchors.map(anchor => ({ ...anchor, waterAccess: waterAccess(anchor.position, environment) }));
    const predators = ecology.animals.filter(a => ECOLOGY_SPECIES[a.species].diet !== 'herbivore').map(a => {
      const prey = ecology.animals.filter(p => p.species === 'rabbit' && distance(p.position, a.position) <= 1500), reachable = prey.filter(p => corridorSegmentClear(a.position, p.position));
      return { id: a.id, species: a.species, position: clone(a.position), regionId: regionAt(ecology, a.position)?.id || null, waterAccess: waterAccess(a.position, environment), preyWithin1500: prey.length, directCollisionVerifiedPrey: reachable.length, untestedDetourPrey: prey.length - reachable.length, directTravelDistances: reachable.map(p => distance(a.position, p.position)), initialReserveKcal: bodyStock(a.physiology), note: 'Conservative straight-segment reachability at radius16; detour prey are unproven, not declared unreachable. Initial prey and finite reserves do not establish sustainable predation.' };
    });
    return { coverage: ecologyCoverage(ecology), objectBounds: { plants: ECOLOGY_RULES.maxPlants, animals: ECOLOGY_RULES.maxAnimals, materials: ECOLOGY_RULES.maxMaterials, currentPlants: ecology.plants.length, currentAnimals: ecology.animals.length, currentMaterials: ecology.materials.length }, habitatKinds: audit.habitatKinds, plantHabitatDistribution: plantHabitats, anchors: anchorsWithAccess, corridors: corridorRows, failures: audit.failures, connectedComponents: components, disconnectedAnchorIds: components.slice(1).flat(), maximumVegetationGap: Math.max(0, ...corridorRows.map(r => r.vegetation.maximumUncoveredPathGap)), maximumFruitGap: Math.max(0, ...corridorRows.map(r => r.fruit.maximumUncoveredPathGap)),
      placement: { plantRadius10Failures: ecology.plants.filter(p => !canStandOutside(p.position.x, p.position.y, 10)).map(p => p.id), animalRadiusFailures: ecology.animals.filter(a => !canStandOutside(a.position.x, a.position.y, ECOLOGY_SPECIES[a.species].radius)).map(a => a.id), predators },
      interpretation: 'Geographical and finite-stock evidence only. The four predeclared hydric human starts are ordinary distant locations, not held-out terrain, successful relocations, or proven viable human sites.' };
  }
  function clocks(state) { const e = state.environment.ecology; return { world: state.elapsed, environment: state.environment.elapsed, ecology: e.elapsed, ecologyPending: e.pending, actors: state.agents.map(a => ({ id: a.id, elapsed: a.elapsed })), aligned: Math.abs(state.elapsed - state.environment.elapsed) < 1e-6 && Math.abs(e.elapsed + e.pending - state.elapsed) < 1e-6 && state.agents.every(a => Math.abs(a.elapsed - state.elapsed) < 1e-6) }; }

  const coldStarted = performance.now(), environment = createEnvironment(settings.seed, { mode: 'discovery' }), coldCreateMs = performance.now() - coldStarted;
  const pure = { elapsed: 0, environment, agents: [] }, ecology = environment.ecology;
  const initial = snapshot(pure), openingSoil = clone(ecology.regions), before = measureCardinalWorld(pure), structure = structuralAudit(environment), samples = [], snapshots = [initial], weatherSeconds = {};
  const birthsBySpecies = {}, deathsBySpecies = {}, populationRange = Object.fromEntries(Object.keys(ECOLOGY_SPECIES).map(species => [species, { initial: initial.animals[species] || 0, minimum: initial.animals[species] || 0, maximum: initial.animals[species] || 0, final: initial.animals[species] || 0 }]));
  let previousAnimals = new Map(ecology.animals.map(a => [a.id, a.species])), worstEnergyResidual = Math.abs(initial.energy.residualKcal), allEnergyPass = initial.energy.passed;
  const steps = Math.max(1, Math.round(settings.days * CONFIG.dayRealSeconds / NATIVE_ECOLOGY_STEP)), sampleEvery = Math.round(150 / NATIVE_ECOLOGY_STEP), began = performance.now();
  for (let index = 0; index < steps; index++) {
    const started = performance.now(); pure.elapsed += NATIVE_ECOLOGY_STEP; tickEnvironment(environment, NATIVE_ECOLOGY_STEP); tickEcology(ecology, NATIVE_ECOLOGY_STEP, environment, []); samples.push(performance.now() - started);
    weatherSeconds[environment.weather.kind] = (weatherSeconds[environment.weather.kind] || 0) + NATIVE_ECOLOGY_STEP;
    const living = new Map(ecology.animals.map(a => [a.id, a.species])), current = counts(ecology.animals, 'species');
    for (const [id, species] of living) if (!previousAnimals.has(id)) birthsBySpecies[species] = (birthsBySpecies[species] || 0) + 1;
    for (const [id, species] of previousAnimals) if (!living.has(id)) deathsBySpecies[species] = (deathsBySpecies[species] || 0) + 1;
    previousAnimals = living;
    for (const [species, range] of Object.entries(populationRange)) { const count = current[species] || 0; range.minimum = Math.min(range.minimum, count); range.maximum = Math.max(range.maximum, count); range.final = count; }
    if ((index + 1) % sampleEvery === 0 || index + 1 === steps) { const row = snapshot(pure); snapshots.push(row); worstEnergyResidual = Math.max(worstEnergyResidual, Math.abs(row.energy.residualKcal)); allEnergyPass &&= row.energy.passed; sampleMemory(); }
  }
  const final = snapshots.at(-1), interval = compareCardinalMetrics(before, measureCardinalWorld(pure)), soil = soilAudit(openingSoil, ecology);
  const pureTrial = { seed: settings.seed, requestedDays: settings.days, actualDays: pure.elapsed / CONFIG.dayRealSeconds, simulatedSeconds: pure.elapsed, timestepSeconds: NATIVE_ECOLOGY_STEP, environmentTicks: steps, ecologyTicks: steps, humanCount: 0, cardinalEnabled: false, modelUsed: false,
    coldCreateMs: rounded(coldCreateMs), coldCreateDefinition: 'First createEnvironment(discovery) in a fresh worker isolate, including initial ecology and uncached corridor generation; excludes module import and report audits.', performance: timings(samples, performance.now() - began), clock: clocks(pure), structure,
    interval, initial, final, snapshots, populationRange, birthsBySpecies, deathsBySpecies, birthIdentityCountMatchesLedger: sum(Object.values(birthsBySpecies), n => n) === final.births - initial.births, deathIdentityCountMatchesLedger: sum(Object.values(deathsBySpecies), n => n) === final.deaths - initial.deaths,
    nutrition: { absorbedKcal: interval.animals.absorbedKcal, spentKcal: interval.animals.spentKcal, absorbedToSpentRatio: ratio(interval.animals.absorbedKcal, interval.animals.spentKcal), reserveChangeKcal: final.animalReservesKcal - initial.animalReservesKcal, stomachChangeKcal: final.animalStomachKcal - initial.animalStomachKcal, reserveInterpretation: 'Population aggregate changes include births/deaths; not a paired surviving-body reserve trend.' },
    soil, maximumSampledEnergyResidualKcal: worstEnergyResidual, allSampledEnergyBalancesPass: allEnergyPass, noExternalEnergy: final.ledger.externalKcal === initial.ledger.externalKcal && final.ledger.externalKcal === 0,
    weatherSeconds, snapshotIntervalSeconds: 150, performanceIncludesRendering: false };
  parentPort?.postMessage({ type: 'progress', text: `Seed ${settings.seed}: ${pure.elapsed / CONFIG.dayRealSeconds} game days; ${initial.animals.rabbit || 0}→${final.animals.rabbit || 0} rabbits, ${final.births - initial.births} births, ${final.deaths - initial.deaths} deaths; energy residual ${final.energy.residualKcal.toExponential(3)} kcal.` });

  const humanTrials = [];
  const forbidden = new Set(['regions', 'regionalVersion', 'nutrients', 'initialNutrients', 'uptakeNutrients', 'mineralizedNutrients', 'cardinal', 'worldRules', 'physiology', 'energyKcal', 'remainingKcal', 'availableEnergyKcal', 'storedEnergyKcal', 'species', 'materialType', 'productivity', 'preyWithin1500', 'ledger', 'plantGrowthMultiplier']);
  function privacyPaths(value, prefix = '') { const out = []; if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { const path = prefix ? `${prefix}.${key}` : key; if (forbidden.has(key)) out.push(path); out.push(...privacyPaths(child, path)); } return out; }
  for (const anchorId of settings.humanSeconds > 0 ? HUMAN_ANCHORS : []) {
    const state = freshState({ mode: 'legacy' }); state.simulationMode = 'discovery'; state.environment = createEnvironment(settings.seed, { mode: 'discovery' }); state.cardinal = null;
    const anchor = regionalHabitatAnchors().find(a => a.key === anchorId); assert(anchor && canStandOutside(anchor.x, anchor.y, 16), `Missing/invalid predeclared anchor ${anchorId}`);
    const actor = createNpc({ id: 'aster', seed: settings.seed, mode: 'discovery' }); actor.position = { x: anchor.x, y: anchor.y }; state.agents = [actor]; state.npc = actor;
    const pristine = !actor.discovery.techniques.length && !actor.discovery.experiments.length && !actor.inventory.items.length && !Object.keys(actor.memory.foods).length && !Object.keys(actor.memory.sources).length && !Object.keys(actor.discovery.observations).length;
    assert(pristine, 'Human start must not preload knowledge or objects.');
    const initialBody = clone(actor.physiology), initialPosition = clone(actor.position), initialEcology = snapshot(state), initialSoil = clone(state.environment.ecology.regions), runtime = new PopulationRuntime(state, { cardinal: false });
    const observations = { samples: 0, forbiddenPaths: [], first: decisionObservation(actor), last: null }, primitiveCounts = {}, actionOutcomes = {}, humanSamples = [], first = { manipulation: null, swallowed: null, absorbedBenefit: null, waterAbsorbed: null };
    let nextId = 0, travel = 0, minimumHealth = actor.physiology.health, minimumReservesKcal = bodyStock(actor.physiology), maximumWaterDeficitMl = actor.physiology.waterDeficitMl;
    const humanSteps = Math.round(settings.humanSeconds / CONFIG.fixedStep), humanBegan = performance.now();
    const checkObservation = () => { const observation = decisionObservation(actor, runtime.social); observations.samples++; observations.forbiddenPaths.push(...privacyPaths(observation)); observations.last = observation; };
    checkObservation();
    for (let index = 0; index < humanSteps; index++) {
      const previous = { ...actor.position }, scene = actor.scene, started = performance.now(); state.elapsed += CONFIG.fixedStep; runtime.tick(CONFIG.fixedStep); humanSamples.push(performance.now() - started);
      if (actor.scene === scene) travel += distance(previous, actor.position);
      minimumHealth = Math.min(minimumHealth, actor.physiology.health); minimumReservesKcal = Math.min(minimumReservesKcal, bodyStock(actor.physiology)); maximumWaterDeficitMl = Math.max(maximumWaterDeficitMl, actor.physiology.waterDeficitMl);
      if (actor.physiology.totals.absorbedKcal > initialBody.totals.absorbedKcal && first.absorbedBenefit === null) first.absorbedBenefit = state.elapsed;
      if (actor.physiology.totals.absorbedWaterMl > initialBody.totals.absorbedWaterMl && first.waterAbsorbed === null) first.waterAbsorbed = state.elapsed;
      if (actor.memory.nextId !== nextId) {
        for (const event of actor.memory.experience) {
          if (event.id < nextId || event.type !== 'action') continue;
          const action = event.details?.action, outcome = event.details?.result || {}; if (!action) continue;
          actionOutcomes[outcome.code || 'UNSPECIFIED'] = (actionOutcomes[outcome.code || 'UNSPECIFIED'] || 0) + 1;
          const row = primitiveCounts[action.type] ||= { attempts: 0, succeeded: 0, failed: 0, actualDurationSeconds: 0 }; row.attempts++; row[outcome.ok ? 'succeeded' : 'failed']++; row.actualDurationSeconds += number(outcome.durationSeconds);
          if (['grasp', 'pull', 'sample', 'strike'].includes(action.type) && first.manipulation === null) first.manipulation = event.at;
          if (action.type === 'sample' && outcome.ok && outcome.ingestionId && first.swallowed === null) first.swallowed = event.at;
        }
        nextId = actor.memory.nextId;
      }
      if ((index + 1) % 60 === 0 || index + 1 === humanSteps) { checkObservation(); sampleMemory(); }
    }
    runtime.dispose();
    const totals = difference(actor.physiology.totals, initialBody.totals), assistance = difference(actor.physiology.outsideAssistance, initialBody.outsideAssistance), finalEcology = snapshot(state), finalBody = clone(actor.physiology);
    const humanResidual = bodyStock(initialBody) + stomachStock(initialBody) + totals.ingestedKcal + assistance.energyKcal - bodyStock(finalBody) - stomachStock(finalBody) - totals.metabolizedKcal - totals.discardedKcal;
    const noAssistance = assistance.energyKcal === 0 && assistance.waterMl === 0 && actor.stats.rescues === 0 && finalEcology.ledger.externalKcal === 0;
    humanTrials.push({ seed: settings.seed, anchorId, simulatedSeconds: state.elapsed, gameDays: state.elapsed / CONFIG.dayRealSeconds, humanTimestepSeconds: CONFIG.fixedStep, ecologyTimestepSeconds: ECOLOGY_RULES.stepSeconds, modelUsed: false, cardinalEnabled: false, noPreloadedFoodWaterKnowledge: pristine,
      initialPosition, finalPosition: clone(actor.position), finalScene: actor.scene, travelDistance: travel, firstPhysicalEvents: first, initialBody, finalBody, minimumHealth, minimumReservesKcal, maximumWaterDeficitMl, totals, assistance, noOutsideAssistance: noAssistance,
      independentAbsorbedKcal: totals.absorbedKcal, metabolizedKcal: totals.metabolizedKcal, nutritionRatio: ratio(totals.absorbedKcal, totals.metabolizedKcal), reserveChangeKcal: bodyStock(finalBody) - bodyStock(initialBody), independentAbsorbedWaterMl: totals.absorbedWaterMl,
      humanEnergyResidualKcal: humanResidual, swallowedKcalMatchesEcologyRemoved: Math.abs(totals.ingestedKcal - (finalEcology.ledger.humanRemovedKcal - initialEcology.ledger.humanRemovedKcal)) <= 1e-6,
      clock: clocks(state), primitiveCounts, actionOutcomes, stats: clone(actor.stats), observedKnowledge: { objects: Object.keys(actor.discovery.observations).length, waterSources: Object.keys(actor.memory.sources).length, techniques: actor.discovery.techniques.length },
      observations: { ...observations, forbiddenPaths: [...new Set(observations.forbiddenPaths)], privacyBoundaryPassed: observations.forbiddenPaths.length === 0 }, ecology: { initial: initialEcology, final: finalEcology }, soil: soilAudit(initialSoil, state.environment.ecology), performance: timings(humanSamples, performance.now() - humanBegan),
      finiteHorizonEvidence: { acquiredAndAbsorbedFood: totals.absorbedKcal > 0, absorbedAtLeastSpent: totals.absorbedKcal >= totals.metabolizedKcal, sustainedSurvivalEstablished: false, note: 'Executed primitives and physiological totals are evidence. Technique counters, dialogue, nearby grass and survival on starting reserves are not adequate nutrition or safe relocation.' } });
    parentPort?.postMessage({ type: 'progress', text: `Seed ${settings.seed}, ${anchorId}: ${totals.absorbedKcal.toFixed(3)} kcal absorbed / ${totals.metabolizedKcal.toFixed(3)} spent in ${state.elapsed.toFixed(1)} seconds; no assistance ${noAssistance}.` });
  }
  const finishFingerprint = await fingerprint(); sampleMemory();
  return { seed: settings.seed, sourceFingerprintStart: startFingerprint, sourceFingerprintEnd: finishFingerprint, sourceUniform: startFingerprint.sha256 === finishFingerprint.sha256, pureEcology: pureTrial, humanTrials, memory: { peakSampledProcessRssBytes: peakRss, finalProcessRssBytes: process.memoryUsage().rss, workerHeapUsedBytes: process.memoryUsage().heapUsed, note: 'RSS is shared-process RSS including the coordinator and this sequential worker; snapshots may miss peaks. Worker heap is isolate-local. Neither is physical laptop or renderer memory.' } };
}

if (!isMainThread) {
  try { parentPort.postMessage({ type: 'result', result: await evaluateSeed(workerData) }); }
  catch (error) { parentPort.postMessage({ type: 'failure', error: { name: error.name, message: error.message, stack: error.stack } }); }
} else {
  const selected = options(), startedAt = new Date().toISOString(), start = performance.now(), sourceStart = await fingerprint(), gitStart = gitState();
  await mkdir(dirname(selected.output), { recursive: true });
  // Refuse historical-report replacement before beginning an expensive run.
  const output = await open(selected.output, 'wx');
  await output.writeFile(JSON.stringify({ status: 'running', startedAt, options: selected, sourceFingerprintStart: sourceStart }, null, 2) + '\n');
  const trials = [], failures = [];
  for (const seed of selected.seeds) {
    const result = await new Promise(resolvePromise => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { ...selected, seed, expectedFingerprint: sourceStart.sha256 } });
      let resolved = false;
      const finish = value => { if (!resolved) { resolved = true; resolvePromise(value); } };
      worker.on('message', message => { if (message.type === 'progress') console.log(message.text); else if (message.type === 'result') finish({ result: message.result }); else if (message.type === 'failure') finish({ error: message.error }); });
      worker.on('error', error => finish({ error: { name: error.name, message: error.message, stack: error.stack } }));
      worker.on('exit', code => { if (!resolved) finish({ error: { message: `Worker exited ${code} without a result.` } }); });
    });
    if (result.error) failures.push({ seed, ...result.error }); else trials.push(result.result);
  }
  const sourceEnd = await fingerprint(), humans = trials.flatMap(t => t.humanTrials), sourceUniform = sourceStart.sha256 === sourceEnd.sha256 && trials.every(t => t.sourceUniform && t.sourceFingerprintStart.sha256 === sourceStart.sha256);
  const summary = { completedSeeds: trials.length, failedSeeds: failures.length, pureEcologyDaysPerSeed: selected.days, humanTrials: humans.length, humanTrialsSkipped: selected.humanSeconds === 0, allClocksAligned: trials.every(t => t.pureEcology.clock.aligned) && humans.every(t => t.clock.aligned),
    allInitialPlacementsValid: trials.every(t => t.pureEcology.structure.placement.plantRadius10Failures.length === 0 && t.pureEcology.structure.placement.animalRadiusFailures.length === 0), allReturnedCorridorsPassCollision: trials.every(t => t.pureEcology.structure.corridors.every(r => r.allSegmentsValidRadius16)),
    allSampledStocksValid: trials.every(t => t.pureEcology.snapshots.every(s => s.stocksValid)) && humans.every(t => t.ecology.initial.stocksValid && t.ecology.final.stocksValid),
    allSampledEnergyBalancesPass: trials.every(t => t.pureEcology.allSampledEnergyBalancesPass) && humans.every(t => t.ecology.final.energy.passed), allRegionalNutrientBalancesPass: trials.every(t => t.pureEcology.soil.allNutrientBalancesPass) && humans.every(t => t.soil.allNutrientBalancesPass), allRegionalDetritusBalancesPass: trials.every(t => t.pureEcology.soil.allDetritusBalancesPass) && humans.every(t => t.soil.allDetritusBalancesPass),
    allHumanEnergyBalancesPass: humans.length ? humans.every(t => Math.abs(t.humanEnergyResidualKcal) <= 1e-6 && t.swallowedKcalMatchesEcologyRemoved) : null,
    noOutsideAssistance: trials.every(t => t.pureEcology.noExternalEnergy) && humans.every(t => t.noOutsideAssistance), actualObservationBoundaryPassed: humans.length ? humans.every(t => t.observations.privacyBoundaryPassed) : null,
    humanTrialsWithAbsorbedFood: humans.filter(t => t.independentAbsorbedKcal > 0).length, humanTrialsWithIntakeAtLeastExpenditure: humans.filter(t => t.nutritionRatio >= 1).length, sustainedSurvivalEstablished: false, seasonalStabilityEstablished: false };
  const report = { schemaVersion: 1, evaluator: 'regional-foundation-v1', status: failures.length ? 'failed' : sourceUniform ? 'completed' : 'mixed-source-diagnostic-only', startedAt, completedAt: new Date().toISOString(), wallSeconds: rounded((performance.now() - start) / 1000), options: selected,
    manifest: { seeds: selected.seeds, humanAnchors: HUMAN_ANCHORS, requestedEcologyDays: selected.days, dayRealSeconds: 3600, ecologyStepSeconds: .5, humanSeconds: selected.humanSeconds, weather: 'ordinary seed-derived weather, no hour/weather overrides', pureMode: 'actual engine ecology and environment; no humans or Cardinal', humanMode: 'ordinary native-step physical discovery controller; one cold-start Aster at each predeclared remote hydric anchor, no instructions, model or Cardinal', terrain: 'Same fixed valley terrain for every seed; seeds vary population quantities and weather, not independent terrain.', finalEvaluationRequiresFrozenSources: true },
    sourceFingerprintStart: sourceStart, sourceFingerprintEnd: sourceEnd, sourceUniform, gitStart, gitEnd: gitState(), hardware: { node: process.version, v8: process.versions.v8, platform: process.platform, architecture: process.arch, osType: os.type(), osRelease: os.release(), availableParallelism: os.availableParallelism(), logicalCpuCount: os.cpus().length, cpuModels: [...new Set(os.cpus().map(c => c.model))], visibleTotalMemoryBytes: os.totalmem(), containerOrVirtualization: 'Execution environment; host resources may exceed container allocation. Power mode, GPU, physical laptop identity and renderer are unmeasured.' }, trials, failures, summary,
    limitations: [
      'This is regional foundation evidence. Diurnal or short controller trials do not establish multi-day human self-sufficiency, learned relocation, stable predators, seasonal sustainability or indefinite balance.',
      'Ecology runs at its actual native .5-second update, with one .5-second environment tick for each ecology tick. Human trials run the full PopulationRuntime at its normal 1/60-second step. A half-second environment sample is not claimed bit-identical to a 1/60-second live-weather trace.',
      'Excretion, complete elemental nutrient conservation, erosion, runoff, hydrology and a closed nutrient cycle are not implemented. Regional balances only audit the represented soil/detritus pools; any missing flow instrumentation is reported as null.',
      'Initial soil, producer and body stocks are finite initialization, not earned food. Independent human intake is measured through ingestion/absorption totals; initial body reserves and social claims do not count.',
      'Geographic food/water/corridor diagnostics stay outside inhabitants. Structural availability and traversability do not prove an actor can learn, execute or energetically afford acquisition.',
      'No Ollama, renderer, desktop persistence, UI latency, minimized/background behavior, native installation, power mode or physical laptop budget is measured here. Broad laptop readiness needs separate named-hardware measurements.',
      'Population extrema and identity changes are sampled at every .5-second ecology step. Stock/energy trajectories are sampled once per game hour plus endpoints; unobserved within-interval extrema are not claimed.',
      'The four human anchors and both default seeds are development diagnostics, not held-out seeds. No failed start is removed after observing its outcome. Output refuses replacement of an existing historical report.',
    ] };
  const serialized = JSON.stringify(report, null, 2) + '\n';
  await output.truncate(0); await output.write(serialized, 0, 'utf8'); await output.close();
  console.log(JSON.stringify({ output: relative(ROOT, selected.output), sourceUniform, summary, failures }, null, 2));
  if (failures.length || !sourceUniform || !summary.allClocksAligned || !summary.allInitialPlacementsValid || !summary.allReturnedCorridorsPassCollision || !summary.allSampledStocksValid || !summary.allSampledEnergyBalancesPass || !summary.allRegionalNutrientBalancesPass || !summary.allRegionalDetritusBalancesPass || summary.allHumanEnergyBalancesPass === false || !summary.noOutsideAssistance || summary.actualObservationBoundaryPassed === false) process.exitCode = 1;
}
