// A fresh, in-memory walking pilot view. Ground pixels come only from the
// selected pilot geometry; no historical valley layers are drawn here.
import { ART_PIXEL, drawAvatar, drawNpc } from './art.js';
import { previewGroundColor } from './preview-ground-dispatch.js';
import { CONFIG } from './config.js';

const CHUNK_SIZE = 256;
const CACHE_LIMIT = 64;
const OUTSIDE_COLOR = Object.freeze([28, 43, 43]);
const STEEP_COLORS = Object.freeze([
  Object.freeze([169, 97, 86]), Object.freeze([200, 136, 99]),
]);
const SHALLOW_COLORS = Object.freeze([
  Object.freeze([80, 158, 171]), Object.freeze([99, 177, 184]),
]);
const FLOW_MARK = Object.freeze([187, 229, 211]);
const DEFAULT_ANIM = Object.freeze({
  time: 0, moving: false, facing: Object.freeze({ x: 0, y: 1 }),
});

function finitePoint(point) {
  return point !== null && typeof point === 'object' &&
    Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validBounds(bounds) {
  return bounds !== null && typeof bounds === 'object' &&
    ['minX', 'maxX', 'minY', 'maxY'].every(key => Number.isFinite(bounds[key])) &&
    bounds.minX < bounds.maxX && bounds.minY < bounds.maxY;
}

function within(bounds, x, y) {
  return x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY;
}

function shallowColor(x, y, direction) {
  // A short pixel arrow sits in each 32-unit cell and follows the authored
  // channel tangent. This is a visible current cue, not a fluid simulation.
  if (direction && Number.isFinite(direction.x) &&
      Number.isFinite(direction.y)) {
    const dx = direction.x, dy = direction.y;
    const ax = (Math.floor(x / 32) + .5) * 32;
    const ay = (Math.floor(y / 32) + .5) * 32;
    const rx = x - ax, ry = y - ay;
    const along = rx * dx + ry * dy;
    const across = rx * -dy + ry * dx;
    const shaft = along >= -9 && along <= 3 && Math.abs(across) <= 2.5;
    const head = along > 3 && along <= 10 &&
      Math.abs(Math.abs(across) - (10 - along) * .7) <= 2.5;
    if (shaft || head) return FLOW_MARK;
  }
  return SHALLOW_COLORS[(Math.floor((x + y) / 8) & 1)];
}

/** Terrain and actor only, in the same logical pixel coordinates as geometry. */
export class PilotRenderer {
  constructor(target, geometry) {
    if (!target || typeof target.getContext !== 'function' ||
        !geometry || !Object.isFrozen(geometry) ||
        !geometry.profile || !Object.isFrozen(geometry.profile) ||
        !finitePoint(geometry.spawn) || !Object.isFrozen(geometry.spawn) ||
        !validBounds(geometry.bounds) || !Object.isFrozen(geometry.bounds) ||
        typeof geometry.sample !== 'function' ||
        typeof geometry.classify !== 'function') {
      throw new TypeError('Expected frozen Ozark pilot geometry and canvas');
    }
    this.canvas = target;
    this.ctx = target.getContext('2d', { alpha: false });
    this.pixels = document.createElement('canvas');
    this.pixelCtx = this.pixels.getContext('2d', { alpha: false });
    if (!this.ctx || !this.pixelCtx) throw new Error('Pilot requires Canvas 2D');
    this.geometry = geometry;
    this.bounds = geometry.bounds;
    this.camera = { ...geometry.spawn };
    this.zoom = 1.5;
    this.chunks = new Map();
    this.frame = 0;
    this.resize();
  }

  resize(width, height, dpr) {
    this.width = width ?? globalThis.window?.innerWidth ?? this.canvas.clientWidth ?? this.canvas.width;
    this.height = height ?? globalThis.window?.innerHeight ?? this.canvas.clientHeight ?? this.canvas.height;
    this.dpr = Math.min(dpr ?? globalThis.window?.devicePixelRatio ?? 1, 2);
    if (!Number.isFinite(this.width) || this.width <= 0 ||
        !Number.isFinite(this.height) || this.height <= 0 ||
        !Number.isFinite(this.dpr) || this.dpr <= 0) {
      throw new RangeError('Expected positive pilot viewport dimensions');
    }
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.imageSmoothingEnabled = false;
  }

  snap(point) {
    if (!finitePoint(point)) throw new TypeError('Expected finite pilot camera point');
    this.camera = { x: point.x, y: point.y };
  }

  terrainColor(x, y) {
    if (!within(this.bounds, x, y)) return OUTSIDE_COLOR;
    const site = this.geometry.sample(x, y);
    const paint = site.paint;
    const color = previewGroundColor(paint);
    // Only the explicitly assessed shallow reach gets the wading palette and
    // channel-tangent marks. Deep and unassessed water, and the separate pond,
    // keep their original colors. Dry grade marks remain unchanged.
    if (paint === 'surface-water' && site.waterBand === 'shallow-water') {
      return shallowColor(x, y, site.currentDirection);
    }
    if (paint === 'surface-water' || paint === 'internal-pond') return color;
    const footing = this.geometry.classify(x, y, CONFIG.playerRadius);
    if (footing.reason === 'outside-pilot-bounds' ||
        footing.reason === 'outside-approved-bounds') return OUTSIDE_COLOR;
    if (footing.reason === 'excessive-grade') {
      return STEEP_COLORS[(Math.floor(x / 16) + Math.floor(y / 16)) & 1];
    }
    return color;
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
    if (!context) throw new Error('Pilot requires Canvas 2D');
    const image = context.createImageData(side, side);
    const originX = cx * CHUNK_SIZE, originY = cy * CHUNK_SIZE;
    // One source sample colors a 4-world-pixel square, matching the existing
    // pixel-art ground resolution while keeping every lookup in the pilot.
    for (let py = 0; py < side; py += 2) for (let px = 0; px < side; px += 2) {
      const x = originX + px * ART_PIXEL + 2;
      const y = originY + py * ART_PIXEL + 2;
      const color = this.terrainColor(x, y);
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
        const i = ((py + dy) * side + px + dx) * 4;
        image.data[i] = color[0];
        image.data[i + 1] = color[1];
        image.data[i + 2] = color[2];
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    this.chunks.set(key, out);
    if (this.chunks.size > CACHE_LIMIT) this.chunks.delete(this.chunks.keys().next().value);
    return out;
  }

  draw(state, anim = DEFAULT_ANIM) {
    const player = state?.player;
    if (!finitePoint(player)) throw new TypeError('Expected finite pilot player position');
    this.snap(state.cameraTarget === 'aster' && finitePoint(state.agent?.position)
      ? state.agent.position : player);
    this.frame += 1;
    const scale = Math.max(2, Math.round(this.zoom * ART_PIXEL * this.dpr));
    const width = Math.ceil(this.canvas.width / scale);
    const height = Math.ceil(this.canvas.height / scale);
    if (this.pixels.width !== width || this.pixels.height !== height) {
      this.pixels.width = width;
      this.pixels.height = height;
    }
    const g = this.pixelCtx;
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1c2b2b';
    g.fillRect(0, 0, width, height);
    const centerX = Math.floor(width / 2), centerY = Math.floor(height / 2);
    const drawCamera = {
      x: Math.round(this.camera.x / ART_PIXEL) * ART_PIXEL,
      y: Math.round(this.camera.y / ART_PIXEL) * ART_PIXEL,
    };
    g.save();
    g.translate(centerX, centerY);
    g.scale(1 / ART_PIXEL, 1 / ART_PIXEL);
    g.translate(-drawCamera.x, -drawCamera.y);
    const left = drawCamera.x - centerX * ART_PIXEL;
    const top = drawCamera.y - centerY * ART_PIXEL;
    const right = left + width * ART_PIXEL;
    const bottom = top + height * ART_PIXEL;
    for (let cy = Math.floor(top / CHUNK_SIZE); cy <= Math.floor(bottom / CHUNK_SIZE); cy += 1) {
      for (let cx = Math.floor(left / CHUNK_SIZE); cx <= Math.floor(right / CHUNK_SIZE); cx += 1) {
        g.drawImage(this.chunk(cx, cy), cx * CHUNK_SIZE, cy * CHUNK_SIZE,
          CHUNK_SIZE, CHUNK_SIZE);
      }
    }
    if (finitePoint(state.agent?.position) && state.agent.position.y <= player.y)
      drawNpc(g, state.agent, anim.time);
    drawAvatar(g, player, anim.facing, anim.time, anim.moving, 'valley');
    if (finitePoint(state.agent?.position) && state.agent.position.y > player.y)
      drawNpc(g, state.agent, anim.time);
    // The actor's disc may touch shallow water before its center enters a
    // painted water pixel. Small foot splashes make that contact visible.
    if (this.geometry.classify(player.x, player.y, CONFIG.playerRadius).reason === 'shallow-water') {
      g.fillStyle = '#bde6d3';
      g.fillRect(player.x - 15, player.y + 6, 7, 2);
      g.fillRect(player.x + 8, player.y + 6, 7, 2);
    }
    g.restore();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.pixels, 0, 0, width * scale, height * scale);
  }
}
