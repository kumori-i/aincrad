// Pure approved Ozark landscape descriptor. Its caller chooses whether to use
// it for an offline design preview or the separate unsaved walking pilot.
const PREVIEW_VERSION = 1;
const WIDTH = 96;
const HEIGHT = 72;

const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const cellIndex = (x, y) => y * WIDTH + x;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function localVariation(seed, x, y) {
  let value = seed ^ Math.imul(x + 17, 0x9e3779b1) ^ Math.imul(y + 29, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

// Smooth seeded fields stand in for broad landform/soil differences and smaller
// openings. Sampling one value at each lattice corner, rather than each map
// cell, keeps adjacent sites coherent without imposing another wave along the
// river. The distinct scales let large forest stands coexist with small gaps.
function siteField(seed, x, y, spacingX, spacingY, salt) {
  const fx = x / spacingX;
  const fy = y / spacingY;
  const gx = Math.floor(fx);
  const gy = Math.floor(fy);
  const tx = (fx - gx) ** 2 * (3 - 2 * (fx - gx));
  const ty = (fy - gy) ** 2 * (3 - 2 * (fy - gy));
  const value = (dx, dy) => localVariation((seed ^ salt) >>> 0, gx + dx, gy + dy);
  const north = value(0, 0) * (1 - tx) + value(1, 0) * tx;
  const south = value(0, 1) * (1 - tx) + value(1, 1) * tx;
  return north * (1 - ty) + south * ty;
}

function siteMosaic(seed, x, y, salt) {
  return 0.44 * siteField(seed, x, y, 35, 25, salt) +
    0.37 * siteField(seed, x, y, 16, 13, salt ^ 0x51f15e5d) +
    0.19 * siteField(seed, x, y, 7, 8, salt ^ 0x6c8e9cf5);
}

function makeMainChannel(random) {
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;
  const origin = HEIGHT * (0.48 + random() * 0.08);
  const center = [];
  for (let x = 0; x < WIDTH; x += 1) {
    const t = x / (WIDTH - 1);
    const raw = Math.round(
      origin +
        8 * Math.sin(1.8 * Math.PI * t + phaseA) +
        4 * Math.sin(5.2 * Math.PI * t + phaseB) +
        2 * Math.sin(9.0 * Math.PI * t + phaseC),
    );
    center.push(clamp(raw, x === 0 ? 18 : center[x - 1] - 1, x === 0 ? HEIGHT - 19 : center[x - 1] + 1));
  }
  return center;
}

function makeBranch(center, startX, startY, mergeX, random) {
  const points = [cellIndex(startX, startY)];
  let x = startX;
  let y = startY;
  let steps = 0;
  while (y !== center[x] && steps < WIDTH + HEIGHT) {
    const nextX = x < mergeX ? x + 1 : x;
    const direction = Math.sign(center[nextX] - y);
    const moveInward = nextX === x || random() < 0.71;
    x = nextX;
    y += moveInward ? direction : 0;
    const next = cellIndex(x, y);
    if (next === points[points.length - 1]) throw new Error('Preview branch stalled');
    points.push(next);
    steps += 1;
  }
  if (y !== center[x]) throw new Error('Preview branch did not reach its channel');
  return points;
}

function makeSpringBranch(center, random) {
  const startX = 57 + Math.floor(random() * 5);
  const poolY = center[startX] - 11;
  const points = [cellIndex(startX, poolY)];
  let x = startX;
  let y = poolY;
  let steps = 0;
  while (y !== center[x] && steps < HEIGHT) {
    // A small horizontal change makes the seep visibly connected to the main
    // channel without inventing a full groundwater or discharge simulation.
    if (steps % 3 === 2) x += 1;
    y += Math.sign(center[x] - y);
    points.push(cellIndex(x, y));
    steps += 1;
  }
  if (y !== center[x]) throw new Error('Preview spring did not reach its channel');
  return points;
}

/**
 * Build one reproducible, deliberately coarse design sketch. Cell numbers are
 * row-major (y * width + x); all feature paths run upstream to downstream.
 * The integer elevations and site scores express relative design constraints,
 * not surveyed heights, fluid mechanics, travel times, or food yields.
 */
export function generateOzarkPreview(seed = 74193) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Preview seed must be an unsigned 32-bit integer');
  }
  const random = randomGenerator(seed);
  const center = makeMainChannel(random);
  const mainChannel = center.map((y, x) => cellIndex(x, y));
  const outlet = { cell: mainChannel[mainChannel.length - 1], name: 'Downstream valley outlet' };

  const northStartX = 8 + Math.floor(random() * 5);
  const southStartX = 24 + Math.floor(random() * 5);
  const north = makeBranch(center, northStartX, 9 + Math.floor(random() * 5), 48 + Math.floor(random() * 5), random);
  const south = makeBranch(center, southStartX, HEIGHT - 10 - Math.floor(random() * 4), 72 + Math.floor(random() * 5), random);
  const tributaries = [
    { id: 'northern-headwater', cells: north },
    { id: 'southern-headwater', cells: south },
  ];
  const springBranch = makeSpringBranch(center, random);
  const spring = {
    poolCell: springBranch[0],
    branchCells: springBranch,
    kind: 'bluff-spring-pool',
  };

  // Some seeds omit a sinkhole. A present one is a separately marked internal
  // basin, rather than a pond falsely connected to the surface river.
  const hasSinkhole = seed % 5 !== 0;
  const sinkX = 13 + Math.floor(random() * 7);
  const sinkY = HEIGHT - 7;
  const sinkRadius = 4;
  const sinkhole = hasSinkhole
    ? { cell: cellIndex(sinkX, sinkY), radius: sinkRadius, kind: 'internal-drainage' }
    : null;

  const mainSet = new Set(mainChannel);
  const tributarySet = new Set([...north, ...south]);
  const springSet = new Set(springBranch);
  const internal = new Set();
  if (sinkhole) {
    for (let x = sinkX - sinkRadius; x <= sinkX + sinkRadius; x += 1) {
      const halfWidth = Math.sqrt(sinkRadius ** 2 - (x - sinkX) ** 2);
      const upperEdge = Math.ceil(sinkY - halfWidth);
      // The short upslope strip leading into the depression is also internally
      // drained. All surface cells above it still route toward the main river.
      for (let y = upperEdge; y < HEIGHT; y += 1) internal.add(cellIndex(x, y));
    }
  }

  const cells = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = cellIndex(x, y);
      const distance = Math.abs(y - center[x]);
      const isInternal = internal.has(index);
      let flowTo;
      if (isInternal) {
        if (y !== sinkY) flowTo = cellIndex(x, y + Math.sign(sinkY - y));
        else if (x !== sinkX) flowTo = cellIndex(x + Math.sign(sinkX - x), y);
        else flowTo = null;
      } else if (distance > 0) {
        flowTo = cellIndex(x, y + Math.sign(center[x] - y));
      } else {
        flowTo = x === WIDTH - 1 ? null : mainChannel[x + 1];
      }

      const variation = localVariation(seed, x, y);
      // A strong longitudinal grade and an increasing valley-side grade make
      // every intended eastward/inward receiver lower despite small roughness.
      const baseHeight = 12 * (WIDTH - 1 - x) + 3 * distance + 0.09 * distance ** 2;
      const basinHeight = 12 * (WIDTH - 1 - sinkX) - 50 +
        3 * (Math.abs(x - sinkX) + Math.abs(y - sinkY));
      const height = Number(((isInternal ? basinHeight : baseHeight) + 0.35 * variation).toFixed(3));

      const onMain = mainSet.has(index);
      const onSpring = springSet.has(index);
      const onTributary = tributarySet.has(index);
      const inSinkholePond = isInternal &&
        (x - sinkX) ** 2 + (y - sinkY) ** 2 <= 3;
      const waterKind = onMain ? 'river' : index === spring.poolCell ? 'spring-pool' :
        onSpring ? 'spring-branch' : onTributary ? 'tributary' :
          inSinkholePond ? 'sinkhole-pond' : null;

      const connectedChannel = onMain || onTributary;
      const springSeep = onSpring ||
        (x >= 56 && x <= 70 && y < center[x] && distance < 15 && distance > 3);
      const sinkholeFloor = isInternal &&
        (x - sinkX) ** 2 + (y - sinkY) ** 2 <= sinkRadius ** 2;
      // A local mosaic modifies the reach of depositional ground and the
      // amount of retained soil on each slope. The valley and aspect remain
      // primary constraints, but no single river-shaped threshold outlines
      // every forest stand. These are design scores, not measured soils.
      const deposition = siteMosaic(seed, x, y, 0x3285a1e9);
      const soilPatch = siteMosaic(seed, x, y, 0x4ef69071);
      const wetPatch = siteMosaic(seed, x, y, 0x7b31c415);
      const coverPatch = siteMosaic(seed, x, y, 0x0b9736d5);
      const sunnySlope = y < center[x];
      const alluvialReach = 3.5 + 7 * deposition;
      const soilDepth = clamp(
        0.29 + 0.35 * (1 - Math.min(distance, 34) / 34) +
        0.48 * (soilPatch - 0.5) + (sunnySlope ? -0.055 : 0.085),
        0, 1,
      );
      const substrate = connectedChannel ? 'gravel' :
        springSeep ? 'rocky-colluvium' :
          sinkholeFloor ? 'karst-depression' :
            distance <= alluvialReach ? 'alluvium' :
              soilDepth >= 0.55 ? 'deep-loam' :
                soilDepth <= 0.44 && sunnySlope ? 'thin-limestone' :
                  isInternal ? 'rocky-colluvium' : 'weathered-soil';
      const siteMoisture = connectedChannel ? 1 :
        springSeep ? 0.84 :
          sinkholeFloor ? 0.61 :
            0.43 + 0.36 * Math.exp(-distance / 10) +
              0.29 * (wetPatch - 0.5) + (sunnySlope ? -0.055 : 0.055) +
              (substrate === 'alluvium' ? 0.10 : substrate === 'deep-loam' ? 0.05 :
                substrate === 'thin-limestone' ? -0.12 : 0);
      const moisture = Number(clamp(siteMoisture, 0, 1).toFixed(3));
      // Aspect supplies direct-light potential; potential canopy affects the
      // eventual ground-light score only after community classification.
      const directLight = sunnySlope ? 0.94 : 0.82;
      const habitat = connectedChannel ? 'river-channel' :
        springSeep ? 'spring-seep' :
          sinkholeFloor ? 'sinkhole-basin' :
            substrate === 'alluvium' && moisture >= 0.63 ? 'wet-terrace' :
              substrate === 'deep-loam' && moisture >= 0.50 && !sunnySlope &&
                coverPatch >= 0.38 ? 'shaded-cove' :
                substrate === 'thin-limestone' && moisture <= 0.43 && sunnySlope &&
                  coverPatch <= 0.63 ? 'dry-rocky-glade' :
                  soilDepth <= 0.52 && moisture <= 0.55 && sunnySlope &&
                    coverPatch <= 0.52 ? 'open-clearing' : 'oak-pine-woodland';
      const baseCanopy = {
        'river-channel': 0.17,
        'spring-seep': 0.58,
        'sinkhole-basin': 0.42,
        'wet-terrace': 0.46,
        'shaded-cove': 0.76,
        'dry-rocky-glade': 0.10,
        'open-clearing': 0.20,
        'oak-pine-woodland': 0.55,
      }[habitat];
      // Continuous cover and light scores retain gradual site transitions
      // beneath the map's necessarily discrete habitat colors.
      const canopy = Number(clamp(
        baseCanopy + 0.12 * (soilDepth - 0.5) +
        0.08 * (moisture - 0.5) + 0.06 * (coverPatch - 0.5),
        0.05, 0.88,
      ).toFixed(3));
      const light = Number(clamp(directLight - 0.75 * canopy, 0, 1).toFixed(3));
      cells.push({
        x, y, height, flowTo,
        drainage: isInternal ? 'internal' : 'surface',
        habitat, substrate, moisture, canopy, light, waterKind,
        contributingCells: 1,
      });
    }
  }

  // The visible tributaries and spring branch are actual edges of the same
  // drainage graph. Their endpoint is the main channel, whose next edge leads
  // toward the outlet.
  for (const branch of [...tributaries.map((item) => item.cells), springBranch]) {
    for (let i = 0; i < branch.length - 1; i += 1) cells[branch[i]].flowTo = branch[i + 1];
  }

  // The rank check is both a generator invariant and a useful guard against
  // future changes creating cycles or a false surface outlet.
  for (let index = 0; index < cells.length; index += 1) {
    const receiver = cells[index].flowTo;
    if (receiver === null) {
      if (index !== outlet.cell && index !== sinkhole?.cell) {
        throw new Error(`Preview has an unmarked terminal cell ${index}`);
      }
      continue;
    }
    if (cells[receiver].height >= cells[index].height) {
      throw new Error(`Preview has a non-downhill flow edge at cell ${index}`);
    }
    if (cells[index].drainage !== cells[receiver].drainage) {
      throw new Error(`Preview has a surface/internal drainage crossing at cell ${index}`);
    }
  }
  for (const index of cells.map((_, position) => position).sort((a, b) => cells[b].height - cells[a].height)) {
    const receiver = cells[index].flowTo;
    if (receiver !== null) cells[receiver].contributingCells += cells[index].contributingCells;
  }

  return {
    previewVersion: PREVIEW_VERSION,
    seed,
    width: WIDTH,
    height: HEIGHT,
    relativeScale: {
      unit: 'macro cell',
      barCells: 16,
      note: 'Relative preview scale only; no in-game distance or time calibration.',
    },
    cells,
    outlet,
    mainChannel,
    tributaries,
    spring,
    sinkhole,
    legend: {
      'dry-rocky-glade': 'Thin upland substrate and high south-facing light',
      'shaded-cove': 'Deeper north-facing soil beneath denser canopy',
      'wet-terrace': 'Low ground near the connected river',
      'open-clearing': 'Small exposed openings on drier, thinner ground',
      'oak-pine-woodland': 'Intermediate slope and site moisture',
      'river-channel': 'Connected surface channel over gravel',
      'spring-seep': 'Localized moisture beside a bluff spring branch',
      'sinkhole-basin': 'Marked internally drained karst depression',
    },
  };
}
