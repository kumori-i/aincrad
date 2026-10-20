// Read-only presentation of the separately identified, playable Ozark world.
// Every terrain pixel comes from the same geometry used by movement and sight.
import { ART_PIXEL, drawAvatar, drawNpc, drawEcologyObject, drawFieldNote } from './art.js';
import { AtlasViewport, atlasActors } from './atlas.js';
import { CONFIG } from './config.js';
import { renderEcology } from './ecology.js';
import { previewGroundColor } from './preview-ground-dispatch.js';

const CHUNK_SIZE = 256;
const CHUNK_LIMIT = 64;
const CHUNK_ART_STEP = 4; // Eight logical world units per terrain lookup.
const OUTSIDE = Object.freeze([28, 43, 43]);
const CLIMBABLE = Object.freeze([[183, 135, 96], [208, 160, 105]]);
const CLIFF = Object.freeze([[119, 86, 82], [150, 100, 88]]);
const SHALLOWS = Object.freeze([[80, 158, 171], [99, 177, 184]]);
const FLOW = Object.freeze([187, 229, 211]);
const DEFAULT_ANIM = Object.freeze({ time: 0, moving: false,
  facing: Object.freeze({ x: 0, y: 1 }) });

const finitePoint = point => point !== null && typeof point === 'object' &&
  Number.isFinite(point.x) && Number.isFinite(point.y);

function hashCell(x, y, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

function smoothNoise(x, y, size, seed) {
  const gx = Math.floor(x / size), gy = Math.floor(y / size);
  const fx = x / size - gx, fy = y / size - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const upper = hashCell(gx, gy, seed) * (1 - sx) +
    hashCell(gx + 1, gy, seed) * sx;
  const lower = hashCell(gx, gy + 1, seed) * (1 - sx) +
    hashCell(gx + 1, gy + 1, seed) * sx;
  return upper * (1 - sy) + lower * sy;
}

function texturedGround(base, site, x, y) {
  // Purely visual substrate variation, not vegetation or a new resource. The
  // two spatial scales keep nearby terrain legible without square random tiles.
  const broad = (smoothNoise(x, y, 64, 571) - .5) * 25;
  const fine = (smoothNoise(x, y, 18, 991) - .5) * 16;
  const light = (Number.isFinite(site.light) ? site.light - .5 : 0) * 10;
  const canopy = (Number.isFinite(site.canopy) ? site.canopy - .5 : 0) * 8;
  const moisture = (Number.isFinite(site.moisture) ? site.moisture - .5 : 0) * 6;
  const shade = broad + fine + light - canopy;
  const byte = value => Math.max(0, Math.min(255, Math.round(value)));
  return [byte(base[0] + shade * .75 - moisture * .35),
    byte(base[1] + shade + moisture * .4),
    byte(base[2] + shade * .8 + moisture * .7)];
}

function inside(bounds, x, y) {
  return x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY;
}

function shallowColor(x, y, direction) {
  // A short arrow in each cell follows the authored channel tangent. It is a
  // current cue, not a forecast of the actor's resulting trajectory.
  if (finitePoint(direction)) {
    const cx = (Math.floor(x / 32) + .5) * 32;
    const cy = (Math.floor(y / 32) + .5) * 32;
    const rx = x - cx, ry = y - cy;
    const along = rx * direction.x + ry * direction.y;
    const across = rx * -direction.y + ry * direction.x;
    if (along >= -9 && along <= 3 && Math.abs(across) <= 3 ||
        along > 3 && along <= 10 &&
        Math.abs(Math.abs(across) - (10 - along) * .7) <= 3) return FLOW;
  }
  return SHALLOWS[(Math.floor((x + y) / 8) & 1)];
}

function agents(state) {
  return Array.isArray(state?.agents) ? state.agents.filter(agent =>
    finitePoint(agent?.position) && ['aster', 'mira'].includes(agent.id)) : [];
}

function objectsNear(state, bounds) {
  const ecology = state?.environment?.ecology;
  if (!ecology || !['plants', 'animals', 'materials'].every(key =>
    Array.isArray(ecology[key]))) return [];
  // renderEcology is the established visual projection. Filter its result to
  // the viewport before any sprite work; held objects are excluded there.
  return renderEcology(ecology, 'valley').filter(object =>
    object.x >= bounds.left - 160 && object.x <= bounds.right + 160 &&
    object.y >= bounds.top - 180 && object.y <= bounds.bottom + 100);
}

/** Private presentation projection for actual possessions, never remembered
 * objects. A live fish cannot appear in a hand; no inventory-only ghost draws. */
export function heldAquaticSprites(state, actor) {
  if (state?.environment?.ecology?.aquatic?.version !== 1 || !actor?.inventory?.items) return [];
  const held = new Set(actor.inventory.items);
  return (state.environment.ecology.materials || []).filter(item =>
    item.heldBy === actor.id && held.has(item.id) && item.scene === actor.scene &&
    (item.kind === 'fish_specimen' || item.materialType === 'fish_tissue'))
    .map((item, index) => ({ id: item.id, kind: item.kind,
      materialType: item.materialType, x: actor.position.x + 18 + index * 7,
      y: actor.position.y - 29 + index * 7,
      stage: item.kind === 'fish_specimen' && !(item.fishTissue?.massGrams > 0) ?
        'bare' : item.spoiled ? 'spoiled' : 'fresh',
      quantity: item.kind === 'fish_specimen' ? (item.fishTissue?.massGrams > 0 ? 1 : 0) : 1,
    }));
}

/** The new-world renderer never reads historical valley art or landmarks. */
export class OzarkWorldRenderer {
  constructor(target, geometry) {
    if (!target || typeof target.getContext !== 'function' ||
        !geometry || !Object.isFrozen(geometry) ||
        !geometry.profile || !Object.isFrozen(geometry.profile) ||
        !geometry.bounds || !Object.isFrozen(geometry.bounds) ||
        !finitePoint(geometry.spawn) ||
        !['minX', 'maxX', 'minY', 'maxY'].every(key =>
          Number.isFinite(geometry.bounds[key])) ||
        geometry.bounds.minX >= geometry.bounds.maxX ||
        geometry.bounds.minY >= geometry.bounds.maxY ||
        typeof geometry.sample !== 'function' ||
        typeof geometry.classify !== 'function') {
      throw new TypeError('Expected a frozen playable Ozark geometry and canvas');
    }
    this.canvas = target;
    this.ctx = target.getContext('2d', { alpha: false });
    this.pixels = document.createElement('canvas');
    this.pixelCtx = this.pixels.getContext('2d', { alpha: false });
    if (!this.ctx || !this.pixelCtx) throw new Error('Ozark requires Canvas 2D');
    this.geometry = geometry;
    this.bounds = geometry.bounds;
    this.camera = { ...geometry.spawn };
    this.zoom = 1.5;
    this.targetZoom = 1.5;
    this.followNpc = false;
    this.followId = 'aster';
    this.inspectorOpen = false;
    this.chunks = new Map();
    this.frame = 0;
    this.atlasView = new AtlasViewport({ bounds: {
      x: this.bounds.minX, y: this.bounds.minY,
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    } });
    this.atlasMarkers = [];
    this.atlasBase = null;
    this.atlasDetail = null;
    this.miniTerrain = null;
    this.resize();
  }

  resize(width, height, dpr) {
    this.width = width ?? globalThis.window?.innerWidth ?? this.canvas.clientWidth ?? this.canvas.width;
    this.height = height ?? globalThis.window?.innerHeight ?? this.canvas.clientHeight ?? this.canvas.height;
    this.dpr = Math.min(dpr ?? globalThis.window?.devicePixelRatio ?? 1, 2);
    if (![this.width, this.height, this.dpr].every(value =>
      Number.isFinite(value) && value > 0)) {
      throw new RangeError('Expected positive Ozark viewport dimensions');
    }
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
  }

  snap(point) {
    if (!finitePoint(point)) throw new TypeError('Expected finite Ozark camera point');
    this.camera = { x: point.x, y: point.y };
  }

  agents(state) { return agents(state); }
  selectedAgent(state) {
    return this.agents(state).find(agent =>
      agent.id === (state?.selectedAgentId || this.followId)) ?? null;
  }
  viewScene() { return 'valley'; }
  viewSubject(state) { return this.subject(state); }

  subject(state) {
    const selected = this.selectedAgent(state);
    return this.followNpc && selected ? selected.position : state?.player;
  }

  terrainColor(x, y) {
    if (!inside(this.bounds, x, y)) return OUTSIDE;
    const site = this.geometry.sample(x, y);
    const base = previewGroundColor(site.paint);
    if (site.paint === 'surface-water' && site.waterBand === 'shallow-water') {
      return shallowColor(x, y, site.currentDirection);
    }
    if (site.paint === 'surface-water' || site.paint === 'internal-pond') return base;
    // The walk and climb classifications are the actual movement thresholds.
    // Color only the dry grade they report, never an independent slope guess.
    const walk = this.geometry.classify(x, y, CONFIG.playerRadius, 'walk');
    if (walk.reason !== 'excessive-grade') return texturedGround(base, site, x, y);
    const climb = this.geometry.classify(x, y, CONFIG.playerRadius, 'climb');
    const palette = climb.walkable ? CLIMBABLE : CLIFF;
    return palette[(Math.floor(x / 16) + Math.floor(y / 16)) & 1];
  }

  chunk(cx, cy) {
    const key = `${this.geometry.profile.identity}:${cx},${cy}`;
    if (this.chunks.has(key)) {
      const cached = this.chunks.get(key);
      this.chunks.delete(key);
      this.chunks.set(key, cached);
      return cached;
    }
    const side = CHUNK_SIZE / ART_PIXEL;
    const out = document.createElement('canvas');
    out.width = side;
    out.height = side;
    const context = out.getContext('2d');
    if (!context) throw new Error('Ozark requires Canvas 2D');
    const image = context.createImageData(side, side);
    for (let py = 0; py < side; py += CHUNK_ART_STEP) {
      for (let px = 0; px < side; px += CHUNK_ART_STEP) {
        const x = cx * CHUNK_SIZE + px * ART_PIXEL + CHUNK_ART_STEP;
        const y = cy * CHUNK_SIZE + py * ART_PIXEL + CHUNK_ART_STEP;
        const color = this.terrainColor(x, y);
        for (let dy = 0; dy < CHUNK_ART_STEP; dy++) {
          for (let dx = 0; dx < CHUNK_ART_STEP; dx++) {
            const index = ((py + dy) * side + px + dx) * 4;
            image.data[index] = color[0];
            image.data[index + 1] = color[1];
            image.data[index + 2] = color[2];
            image.data[index + 3] = 255;
          }
        }
      }
    }
    context.putImageData(image, 0, 0);
    this.chunks.set(key, out);
    if (this.chunks.size > CHUNK_LIMIT) {
      this.chunks.delete(this.chunks.keys().next().value);
    }
    return out;
  }

  screenPoint(x, y) {
    const scale = this.pixelScale / this.dpr;
    return {
      x: ((x - this.drawCamera.x) / ART_PIXEL + this.renderCenterX) * scale,
      y: ((y - this.drawCamera.y) / ART_PIXEL + this.renderCenterY) * scale,
    };
  }

  draw(state, anim = DEFAULT_ANIM) {
    if (!finitePoint(state?.player)) {
      throw new TypeError('Expected finite Ozark player position');
    }
    const subject = this.subject(state);
    this.snap(subject);
    this.frame++;
    this.pixelScale = Math.max(2, Math.round(this.targetZoom * ART_PIXEL * this.dpr));
    this.zoom = this.pixelScale / (ART_PIXEL * this.dpr);
    const width = Math.ceil(this.canvas.width / this.pixelScale);
    const height = Math.ceil(this.canvas.height / this.pixelScale);
    if (this.pixels.width !== width || this.pixels.height !== height) {
      this.pixels.width = width;
      this.pixels.height = height;
    }
    const g = this.pixelCtx;
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1c2b2b';
    g.fillRect(0, 0, width, height);
    const inspectorOffset = this.inspectorOpen ?
      Math.min(430, this.width * .53) / 2 : 0;
    this.renderCenterX = Math.floor(width / 2 -
      inspectorOffset * this.dpr / this.pixelScale);
    this.renderCenterY = Math.floor(height / 2);
    this.drawCamera = {
      x: Math.round(this.camera.x / ART_PIXEL) * ART_PIXEL,
      y: Math.round(this.camera.y / ART_PIXEL) * ART_PIXEL,
    };
    const bounds = {
      left: this.drawCamera.x - this.renderCenterX * ART_PIXEL,
      top: this.drawCamera.y - this.renderCenterY * ART_PIXEL,
    };
    bounds.right = bounds.left + width * ART_PIXEL;
    bounds.bottom = bounds.top + height * ART_PIXEL;
    g.save();
    g.translate(this.renderCenterX, this.renderCenterY);
    g.scale(1 / ART_PIXEL, 1 / ART_PIXEL);
    g.translate(-this.drawCamera.x, -this.drawCamera.y);
    for (let cy = Math.floor(bounds.top / CHUNK_SIZE);
      cy <= Math.floor(bounds.bottom / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(bounds.left / CHUNK_SIZE);
        cx <= Math.floor(bounds.right / CHUNK_SIZE); cx++) {
        g.drawImage(this.chunk(cx, cy), cx * CHUNK_SIZE, cy * CHUNK_SIZE,
          CHUNK_SIZE, CHUNK_SIZE);
      }
    }
    if (finitePoint(state.waypoint) && inside(this.bounds,
      state.waypoint.x, state.waypoint.y)) {
      g.fillStyle = '#4c3e2a';
      g.fillRect(state.waypoint.x - 5, state.waypoint.y - 18, 10, 18);
      g.fillStyle = '#efd184';
      g.fillRect(state.waypoint.x - 3, state.waypoint.y - 16, 6, 11);
    }
    const time = state.environment?.elapsed ?? state.elapsed ?? 0;
    const objects = objectsNear(state, bounds).map(entity => ({
      kind: 'ecology', x: entity.x, y: entity.y, entity,
    }));
    if (state.community?.notes) {
      for (const note of state.community.notes) {
        if (note.scene === 'valley' && finitePoint(note.position) &&
            note.position.x >= bounds.left - 160 && note.position.x <= bounds.right + 160 &&
            note.position.y >= bounds.top - 180 && note.position.y <= bounds.bottom + 100) {
          objects.push({ kind: 'note', x: note.position.x, y: note.position.y, note });
        }
      }
    }
    objects.push({ kind: 'player', x: state.player.x, y: state.player.y });
    for (const agent of agents(state)) objects.push({
      kind: 'agent', x: agent.position.x, y: agent.position.y, agent,
    });
    objects.sort((a, b) => a.y - b.y);
    for (const object of objects) {
      if (object.x < bounds.left - 160 || object.x > bounds.right + 160 ||
          object.y < bounds.top - 180 || object.y > bounds.bottom + 100) continue;
      if (object.kind === 'ecology') drawEcologyObject(g, object.entity, time, subject);
      else if (object.kind === 'note') drawFieldNote(g, object.note);
      else if (object.kind === 'player') drawAvatar(g, state.player,
        anim.facing ?? DEFAULT_ANIM.facing, anim.time ?? time,
        Boolean(anim.moving), 'valley');
      else {
        drawNpc(g, object.agent, time);
        for (const held of heldAquaticSprites(state, object.agent))
          drawEcologyObject(g, held, time, subject);
      }
    }
    const footing = this.geometry.classify(state.player.x, state.player.y,
      CONFIG.playerRadius, 'walk');
    if (footing.reason === 'shallow-water') {
      g.fillStyle = '#bde6d3';
      g.fillRect(state.player.x - 15, state.player.y + 6, 7, 2);
      g.fillRect(state.player.x + 8, state.player.y + 6, 7, 2);
    }
    g.restore();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.pixels, 0, 0,
      width * this.pixelScale, height * this.pixelScale);
  }

  // Keep the small renderer contract used by existing panel/loop utilities.
  render(state, anim) { this.draw(state, anim); }

  drawMini(target, state, now = state?.elapsed ?? 0) {
    const g = target.getContext('2d');
    const width = target.width, height = target.height;
    if (!g || width <= 0 || height <= 0) return;
    const subject = this.subject(state);
    if (!finitePoint(subject)) return;
    const scale = 14;
    const key = `${Math.round(subject.x / 24)},${Math.round(subject.y / 24)},${width},${height}`;
    if (!this.miniTerrain || this.miniTerrain.key !== key ||
        now - this.miniTerrain.time >= .7) {
      const side = 64;
      const image = document.createElement('canvas');
      image.width = side;
      image.height = side;
      const context = image.getContext('2d');
      const pixels = context.createImageData(side, side);
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const wx = subject.x + (x / side - .5) * width * scale;
          const wy = subject.y + (y / side - .5) * height * scale;
          const color = this.terrainColor(wx, wy);
          const index = (y * side + x) * 4;
          pixels.data[index] = color[0];
          pixels.data[index + 1] = color[1];
          pixels.data[index + 2] = color[2];
          pixels.data[index + 3] = 255;
        }
      }
      context.putImageData(pixels, 0, 0);
      this.miniTerrain = { key, time: now, image, origin: { ...subject } };
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniTerrain.image, 0, 0, width, height);
    const origin = this.miniTerrain.origin;
    const marker = (point, color, size) => {
      const x = (point.x - origin.x) / scale + width / 2;
      const y = (point.y - origin.y) / scale + height / 2;
      if (x < 3 || x > width - 3 || y < 3 || y > height - 3) return;
      g.fillStyle = '#19392f';
      g.fillRect(Math.round(x) - size - 1, Math.round(y) - size - 1,
        size * 2 + 2, size * 2 + 2);
      g.fillStyle = color;
      g.fillRect(Math.round(x) - size, Math.round(y) - size,
        size * 2, size * 2);
    };
    marker(state.player, '#f6d68b', 3);
    for (const agent of agents(state)) marker(agent.position,
      agent.id === 'mira' ? '#d4b4e5' : '#c2df88', 3);
  }

  atlasStatus() { return this.atlasView.status(); }
  atlasFit() { return this.atlasView.fit(); }
  atlasZoom(factor, x, y) { return this.atlasView.zoomAt(factor, x, y); }
  atlasPan(dx, dy) { return this.atlasView.pan(dx, dy); }
  atlasPoint(x, y) { return this.atlasView.toWorld(x, y); }
  atlasMarkerAt(x, y) {
    return [...this.atlasMarkers].reverse().find(marker =>
      Math.hypot(marker.x - x, marker.y - y) < 11 ||
      x >= marker.label.x && x <= marker.label.x + marker.label.w &&
      y >= marker.label.y && y <= marker.label.y + marker.label.h)?.id ?? null;
  }
  atlasCenter(id, state) {
    const actor = atlasActors(state).find(item => item.id === id);
    if (!actor) return false;
    if (this.atlasView.zoom < 8) this.atlasView.zoomAt(8 / this.atlasView.zoom);
    this.atlasView.centerOn(actor.position.x, actor.position.y);
    return true;
  }

  atlasBaseImage() {
    if (this.atlasBase) return this.atlasBase;
    // This coarse, immutable overview is sampled once. Never scan the full
    // 38,000 × 28,400 world at one sample per art pixel.
    const width = 192, height = 144;
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const g = image.getContext('2d');
    const pixels = g.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const wx = this.bounds.minX + (x + .5) / width *
          (this.bounds.maxX - this.bounds.minX);
        const wy = this.bounds.minY + (y + .5) / height *
          (this.bounds.maxY - this.bounds.minY);
        const color = this.terrainColor(wx, wy);
        const index = (y * width + x) * 4;
        pixels.data[index] = color[0];
        pixels.data[index + 1] = color[1];
        pixels.data[index + 2] = color[2];
        pixels.data[index + 3] = 255;
      }
    }
    g.putImageData(pixels, 0, 0);
    this.atlasBase = image;
    return image;
  }

  atlasDetailImage(width, height) {
    const view = this.atlasView;
    const quantum = 8 / view.scale;
    const key = `${Math.round(view.center.x / quantum)},${Math.round(view.center.y / quantum)},` +
      `${Math.round(view.zoom * 100)},${width},${height}`;
    if (this.atlasDetail?.key === key) return this.atlasDetail;
    const pixelWidth = Math.min(160, Math.max(1, Math.ceil(width * .32)));
    const pixelHeight = Math.min(120, Math.max(1, Math.ceil(height * .32)));
    const worldWidth = width * 1.3 / view.scale;
    const worldHeight = height * 1.3 / view.scale;
    const x0 = view.center.x - worldWidth / 2;
    const y0 = view.center.y - worldHeight / 2;
    const image = document.createElement('canvas');
    image.width = pixelWidth;
    image.height = pixelHeight;
    const g = image.getContext('2d');
    const pixels = g.createImageData(pixelWidth, pixelHeight);
    for (let y = 0; y < pixelHeight; y++) {
      for (let x = 0; x < pixelWidth; x++) {
        const color = this.terrainColor(x0 + (x + .5) / pixelWidth * worldWidth,
          y0 + (y + .5) / pixelHeight * worldHeight);
        const index = (y * pixelWidth + x) * 4;
        pixels.data[index] = color[0];
        pixels.data[index + 1] = color[1];
        pixels.data[index + 2] = color[2];
        pixels.data[index + 3] = 255;
      }
    }
    g.putImageData(pixels, 0, 0);
    this.atlasDetail = { key, image, x0, y0, worldWidth, worldHeight };
    return this.atlasDetail;
  }

  drawAtlas(target, state) {
    const measured = target.getBoundingClientRect?.();
    if (measured?.width > 0 && measured?.height > 0) {
      const width = Math.round(measured.width), height = Math.round(measured.height);
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
    }
    const g = target.getContext('2d');
    const width = target.width, height = target.height;
    if (!g || width <= 0 || height <= 0) return;
    this.atlasView.resize(width, height);
    const view = this.atlasView;
    const corner = view.toCanvas(this.bounds.minX, this.bounds.minY);
    const worldWidth = this.bounds.maxX - this.bounds.minX;
    const worldHeight = this.bounds.maxY - this.bounds.minY;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1c2b2b';
    g.fillRect(0, 0, width, height);
    g.save();
    g.beginPath();
    g.rect(corner.x, corner.y, worldWidth * view.scale,
      worldHeight * view.scale);
    g.clip();
    g.drawImage(this.atlasBaseImage(), corner.x, corner.y,
      worldWidth * view.scale, worldHeight * view.scale);
    if (view.zoom > 2) {
      const detail = this.atlasDetailImage(width, height);
      const point = view.toCanvas(detail.x0, detail.y0);
      g.drawImage(detail.image, point.x, point.y,
        detail.worldWidth * view.scale, detail.worldHeight * view.scale);
    }
    if (finitePoint(state?.waypoint) && inside(this.bounds,
      state.waypoint.x, state.waypoint.y)) {
      const point = view.toCanvas(state.waypoint.x, state.waypoint.y);
      g.fillStyle = '#4c3e2a';
      g.fillRect(Math.round(point.x) - 5, Math.round(point.y) - 5, 10, 10);
      g.fillStyle = '#efd184';
      g.fillRect(Math.round(point.x) - 3, Math.round(point.y) - 3, 6, 6);
    }
    g.restore();
    // The atlas is a human-facing map; it does not project hidden food or
    // animal positions into agent observations or plot historical landmarks.
    const actors = atlasActors(state);
    this.atlasMarkers = [];
    g.font = 'bold 12px "Courier New", monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (let index = 0; index < actors.length; index++) {
      const actor = actors[index];
      const point = view.toCanvas(actor.position.x, actor.position.y);
      const x = Math.max(9, Math.min(width - 9, point.x));
      const y = Math.max(9, Math.min(height - 9, point.y));
      const outside = point.x !== x || point.y !== y;
      const labelText = actor.name + (outside ? ' · beyond view' : '');
      const labelWidth = Math.min(width - 16, g.measureText(labelText).width + 12);
      const labelHeight = 21;
      const label = {
        x: Math.max(8, Math.min(width - labelWidth - 8,
          x + (index === 0 ? -labelWidth - 14 : 14))),
        y: Math.max(8, Math.min(height - labelHeight - 8,
          y + (index === 2 ? 15 : -28))),
        w: labelWidth, h: labelHeight,
      };
      for (let attempt = 0; attempt < 8 && this.atlasMarkers.some(other =>
        label.x < other.label.x + other.label.w + 3 &&
        label.x + label.w + 3 > other.label.x &&
        label.y < other.label.y + other.label.h + 3 &&
        label.y + label.h + 3 > other.label.y); attempt++) {
        label.y = Math.max(8, Math.min(height - labelHeight - 8,
          label.y + (index % 2 ? 25 : -25)));
      }
      g.fillStyle = '#18362e';
      g.fillRect(x - 6, y - 6, 12, 12);
      g.fillStyle = actor.color;
      g.fillRect(x - 4, y - 4, 8, 8);
      g.fillStyle = '#18362ee8';
      g.fillRect(label.x, label.y, label.w, label.h);
      g.strokeStyle = actor.color;
      g.lineWidth = 1;
      g.strokeRect(label.x + .5, label.y + .5,
        label.w - 1, label.h - 1);
      g.fillStyle = actor.color;
      g.fillText(labelText, label.x + 6, label.y + label.h / 2);
      this.atlasMarkers.push({ id: actor.id, x, y, label,
        position: { ...actor.position } });
    }
    g.textBaseline = 'alphabetic';
  }
}
