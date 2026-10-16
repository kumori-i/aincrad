// Pure continuous queries over the approved design descriptor. Policy callers
// separately decide collision, water handling, grade, and playable scope.
const MAX_SIDE = 128;
const MAX_PATHS = 64;
const RADII = Object.freeze({
  main: 0.5,
  tributary: 0.35,
  'spring-outflow': 0.28,
  'spring-pool': 0.75,
  sinkhole: Math.sqrt(3),
});

function indexAt(x, y, width) {
  return y * width + x;
}

function requireCellIndex(index, length, label) {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new TypeError(`${label} is outside the preview grid`);
  }
  return index;
}

function copyPath(path, name, cells, drainage) {
  if (!Array.isArray(path) || path.length < 2 || path.length > cells.length) {
    throw new TypeError(`${name} must be a bounded path of at least two cells`);
  }
  const copy = [];
  const seen = new Set();
  for (let position = 0; position < path.length; position += 1) {
    const index = requireCellIndex(path[position], cells.length, `${name} cell`);
    if (seen.has(index)) throw new TypeError(`${name} repeats a cell`);
    if (cells[index].drainage !== drainage) throw new TypeError(`${name} crosses a drainage divide`);
    if (position > 0) {
      const previous = copy[position - 1];
      const dx = Math.abs(cells[index].x - cells[previous].x);
      const dy = Math.abs(cells[index].y - cells[previous].y);
      if (dx > 1 || dy > 1 || dx + dy === 0 || cells[previous].flowTo !== index) {
        throw new TypeError(`${name} does not follow connected downstream cells`);
      }
    }
    copy.push(index);
    seen.add(index);
  }
  return copy;
}

function pointSegmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const fraction = Math.max(0, Math.min(1,
    ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy),
  ));
  return Math.hypot(x - (ax + fraction * dx), y - (ay + fraction * dy));
}

function pathDistance(x, y, points) {
  let nearest = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    nearest = Math.min(nearest, pointSegmentDistance(x, y, a.x, a.y, b.x, b.y));
  }
  return nearest;
}

function bilinear(a, b, c, d, tx, ty) {
  return (1 - ty) * ((1 - tx) * a + tx * b) +
    ty * ((1 - tx) * c + tx * d);
}

/**
 * Create a read-only query adapter over a version 1, bounded design preview.
 * Queries use relative macro-cell coordinates, with lattice integers at cell
 * centers. A compact ridge marks the watershed in this provisional 2.5D
 * heightfield; its grade does not establish physical routing or traversal.
 */
export function createOzarkPreviewSampler(descriptor) {
  const width = descriptor?.width;
  const height = descriptor?.height;
  if (descriptor?.previewVersion !== 1 || !Number.isInteger(width) ||
      !Number.isInteger(height) || width < 2 || height < 2 ||
      width > MAX_SIDE || height > MAX_SIDE ||
      !Array.isArray(descriptor.cells) || descriptor.cells.length !== width * height) {
    throw new TypeError('Expected a bounded version 1 preview descriptor');
  }
  const length = width * height;
  const cells = descriptor.cells.map((source, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!source || source.x !== x || source.y !== y ||
        !['surface', 'internal'].includes(source.drainage) ||
        typeof source.habitat !== 'string' || !source.habitat ||
        typeof source.substrate !== 'string' || !source.substrate ||
        !['height', 'moisture', 'canopy', 'light'].every((key) => Number.isFinite(source[key]))) {
      throw new TypeError(`Malformed preview cell ${index}`);
    }
    if (source.moisture < 0 || source.moisture > 1 ||
        source.canopy < 0 || source.canopy > 1 || source.light < 0 || source.light > 1) {
      throw new TypeError(`Preview site score outside [0,1] at cell ${index}`);
    }
    const flowTo = source.flowTo === null ? null :
      requireCellIndex(source.flowTo, length, `Cell ${index} receiver`);
    return {
      x, y, height: source.height, moisture: source.moisture,
      canopy: source.canopy, light: source.light,
      habitat: source.habitat, substrate: source.substrate,
      drainage: source.drainage, flowTo,
    };
  });

  const surfaceTerminal = requireCellIndex(descriptor.outlet?.cell, length, 'Surface outlet');
  const internalTerminal = descriptor.sinkhole == null ? null :
    requireCellIndex(descriptor.sinkhole.cell, length, 'Internal sinkhole');
  if (typeof descriptor.outlet.name !== 'string' || !descriptor.outlet.name ||
      descriptor.outlet.name.length > 100 ||
      (internalTerminal !== null &&
        (!Number.isFinite(descriptor.sinkhole.radius) || descriptor.sinkhole.radius <= 0 ||
          descriptor.sinkhole.radius > MAX_SIDE)) ||
      cells[surfaceTerminal].drainage !== 'surface' || cells[surfaceTerminal].flowTo !== null ||
      (internalTerminal !== null &&
        (descriptor.sinkhole.kind !== 'internal-drainage' ||
          cells[internalTerminal].drainage !== 'internal' ||
          cells[internalTerminal].flowTo !== null || internalTerminal === surfaceTerminal))) {
    throw new TypeError('Preview termini do not match their drainage classes');
  }

  for (let index = 0; index < length; index += 1) {
    const cell = cells[index];
    const next = cell.flowTo;
    if (next === null) {
      if (index !== surfaceTerminal && index !== internalTerminal) {
        throw new TypeError(`Unmarked preview terminal at cell ${index}`);
      }
    } else {
      const dx = Math.abs(cells[next].x - cell.x);
      const dy = Math.abs(cells[next].y - cell.y);
      if (Math.max(dx, dy) !== 1 || cells[next].height >= cell.height ||
          cells[next].drainage !== cell.drainage) {
        throw new TypeError(`Invalid adjacent downhill receiver at cell ${index}`);
      }
    }
  }
  // Memoized iterative traversal keeps validation linear even for a maximum
  // 128 × 128 descriptor whose channels pass through many cells.
  const reached = new Int32Array(length).fill(-1);
  const visiting = new Uint8Array(length);
  for (let start = 0; start < length; start += 1) {
    if (reached[start] !== -1) continue;
    const trail = [];
    let cursor = start;
    while (reached[cursor] === -1) {
      if (visiting[cursor]) throw new TypeError(`Preview drainage cycle at cell ${cursor}`);
      visiting[cursor] = 1;
      trail.push(cursor);
      const next = cells[cursor].flowTo;
      if (next === null) {
        reached[cursor] = cursor;
        break;
      }
      cursor = next;
    }
    const terminal = reached[cursor];
    for (const index of trail) {
      reached[index] = terminal;
      visiting[index] = 0;
      const expected = cells[index].drainage === 'surface' ? surfaceTerminal : internalTerminal;
      if (terminal !== expected) throw new TypeError(`Wrong preview terminal at cell ${index}`);
    }
  }

  const main = copyPath(descriptor.mainChannel, 'Main channel', cells, 'surface');
  if (main.at(-1) !== surfaceTerminal) throw new TypeError('Main channel misses surface outlet');
  const mainSet = new Set(main);
  if (!Array.isArray(descriptor.tributaries) || descriptor.tributaries.length > MAX_PATHS) {
    throw new TypeError('Malformed or oversized tributary collection');
  }
  const tributaries = descriptor.tributaries.map((branch, position) => {
    if (typeof branch?.id !== 'string' || !branch.id || branch.id.length > 80) {
      throw new TypeError(`Malformed tributary ${position}`);
    }
    const path = copyPath(branch.cells, `Tributary ${position}`, cells, 'surface');
    if (!mainSet.has(path.at(-1)) || path.slice(0, -1).some((index) => mainSet.has(index))) {
      throw new TypeError(`Tributary ${position} must join the main channel once`);
    }
    return { id: branch.id, path };
  });
  if (new Set(tributaries.map((branch) => branch.id)).size !== tributaries.length) {
    throw new TypeError('Duplicate tributary identifier');
  }
  const springPool = requireCellIndex(descriptor.spring?.poolCell, length, 'Spring pool');
  const springPath = copyPath(descriptor.spring?.branchCells, 'Spring outflow', cells, 'surface');
  if (springPath[0] !== springPool || !mainSet.has(springPath.at(-1)) ||
      springPath.slice(0, -1).some((index) => mainSet.has(index))) {
    throw new TypeError('Spring pool must flow along one branch into the main channel');
  }
  if (internalTerminal === null && cells.some((cell) => cell.drainage === 'internal')) {
    throw new TypeError('Internal drainage has no marked sinkhole');
  }
  const totalPathCells = main.length + springPath.length +
    tributaries.reduce((sum, branch) => sum + branch.path.length, 0);
  if (totalPathCells > 4 * length) {
    throw new TypeError('Preview feature paths exceed bounded point budget');
  }
  const pathPoint = (index) => ({ x: cells[index].x, y: cells[index].y });
  const features = [
    { kind: 'main', id: 'main', radius: RADII.main, points: main.map(pathPoint) },
    ...tributaries.map((branch) => ({
      kind: 'tributary', id: branch.id,
      radius: RADII.tributary, points: branch.path.map(pathPoint),
    })),
    { kind: 'spring-outflow', id: 'spring-outflow',
      radius: RADII['spring-outflow'], points: springPath.map(pathPoint) },
  ];
  const poolPoint = pathPoint(springPool);
  const sinkholePoint = internalTerminal === null ? null : pathPoint(internalTerminal);

  // Basin identity comes from the validated drainage graph. The watershed is
  // the clipped midline between orthogonally adjacent centers with different
  // termini. Its segments do not redirect either basin's downstream edges.
  const watershedSegments = [];
  const addWatershed = (ax, ay, bx, by, first, second) => {
    watershedSegments.push({
      ax, ay, bx, by,
      target: Math.max(first.height, second.height) + 1,
    });
  };
  if (internalTerminal !== null) {
    for (let cy = 0; cy < height; cy += 1) {
      for (let cx = 0; cx < width; cx += 1) {
        const first = cells[indexAt(cx, cy, width)];
        if (cx + 1 < width) {
          const second = cells[indexAt(cx + 1, cy, width)];
          if (first.drainage !== second.drainage) {
            addWatershed(cx + .5, Math.max(0, cy - .5), cx + .5,
              Math.min(height - 1, cy + .5), first, second);
          }
        }
        if (cy + 1 < height) {
          const second = cells[indexAt(cx, cy + 1, width)];
          if (first.drainage !== second.drainage) {
            addWatershed(Math.max(0, cx - .5), cy + .5,
              Math.min(width - 1, cx + .5), cy + .5, first, second);
          }
        }
      }
    }
    if (watershedSegments.length === 0) {
      throw new TypeError('Internal drainage has no watershed boundary');
    }
  }
  // All segments meeting at a half-cell vertex use one target there. This
  // makes their compact bumps join continuously, including at clipped ends.
  const vertexTargets = new Map();
  const vertexKey = (x, y) => `${x},${y}`;
  for (const segment of watershedSegments) {
    for (const [vx, vy] of [[segment.ax, segment.ay], [segment.bx, segment.by]]) {
      const key = vertexKey(vx, vy);
      vertexTargets.set(key, Math.max(vertexTargets.get(key) ?? -Infinity, segment.target));
    }
  }
  for (const segment of watershedSegments) {
    segment.startTarget = vertexTargets.get(vertexKey(segment.ax, segment.ay));
    segment.endTarget = vertexTargets.get(vertexKey(segment.bx, segment.by));
  }
  const baseHeight = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    return bilinear(
      cells[indexAt(x0, y0, width)].height,
      cells[indexAt(x1, y0, width)].height,
      cells[indexAt(x0, y1, width)].height,
      cells[indexAt(x1, y1, width)].height,
      x - x0, y - y0,
    );
  };

  return {
    sample(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || y < 0 || x > width - 1 || y > height - 1) {
        throw new RangeError('Preview query is outside relative cell coordinates');
      }
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const tx = x - x0;
      const ty = y - y0;
      const corners = [
        cells[indexAt(x0, y0, width)], cells[indexAt(x1, y0, width)],
        cells[indexAt(x0, y1, width)], cells[indexAt(x1, y1, width)],
      ];
      const nearest = cells[indexAt(Math.ceil(x - 0.5), Math.ceil(y - 0.5), width)];
      let watershedDistance = null;
      let crestRise = 0;
      let onWatershed = false;
      for (const segment of watershedSegments) {
        const vertical = segment.ax === segment.bx;
        const qx = vertical ? segment.ax : Math.max(segment.ax, Math.min(segment.bx, x));
        const qy = vertical ? Math.max(segment.ay, Math.min(segment.by, y)) : segment.ay;
        const distance = Math.hypot(x - qx, y - qy);
        watershedDistance = Math.min(watershedDistance ?? Infinity, distance);
        if (distance === 0) onWatershed = true;
        if (distance < .5) {
          const fraction = vertical ?
            (qy - segment.ay) / (segment.by - segment.ay) :
            (qx - segment.ax) / (segment.bx - segment.ax);
          const target = segment.startTarget * (1 - fraction) + segment.endTarget * fraction;
          const riseAtLine = Math.max(0, target - baseHeight(qx, qy));
          const u = 1 - 2 * distance;
          crestRise = Math.max(crestRise, riseAtLine * u * u * (3 - 2 * u));
        }
      }
      const drainage = onWatershed ? 'divide' : nearest.drainage;
      const terminalCell = drainage === 'divide' ? null :
        drainage === 'internal' ? internalTerminal : surfaceTerminal;

      let surfaceWaterDistance = Infinity;
      let nearestChannel = null;
      for (const feature of features) {
        const signed = pathDistance(x, y, feature.points) - feature.radius;
        if (signed < surfaceWaterDistance) {
          surfaceWaterDistance = signed;
          nearestChannel = { kind: feature.kind, id: feature.id };
        }
      }
      const poolSigned = Math.hypot(x - poolPoint.x, y - poolPoint.y) - RADII['spring-pool'];
      if (poolSigned < surfaceWaterDistance) {
        surfaceWaterDistance = poolSigned;
        nearestChannel = { kind: 'spring-pool', id: 'spring-pool' };
      }
      const interpolate = (key) => bilinear(
        corners[0][key], corners[1][key], corners[2][key], corners[3][key], tx, ty,
      );
      return {
        elevation: interpolate('height') + crestRise,
        crestRise,
        moisture: interpolate('moisture'),
        canopy: interpolate('canopy'),
        light: interpolate('light'),
        habitat: nearest.habitat,
        substrate: nearest.substrate,
        drainage,
        terminalCell,
        watershedDistance,
        surfaceWaterDistance,
        nearestChannel,
        sinkholePondDistance: sinkholePoint === null ? null :
          Math.hypot(x - sinkholePoint.x, y - sinkholePoint.y) - RADII.sinkhole,
      };
    },
  };
}
