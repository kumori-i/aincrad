// Read-only presentation of the single playable Ozark world.
// Every terrain pixel comes from the same geometry used by movement and sight.
import { ART_PIXEL, drawAvatar, drawNpc, drawEcologyObject, drawFieldNote } from './art.js';
import { AtlasViewport, atlasActors } from './atlas.js';
import { CONFIG } from './config.js';
import { renderEcology } from './ecology.js';
import { environmentHour } from './environment.js';
import { landscapeGroundColor, landscapeWaterDistance, drawLandscapeSubstrate, drawLandscapeWater, drawStructuralObject, drawLandscapeShadows, drawLandscapeLight, drawAtlasStructures } from './ozark-landscape-art.js';

const CHUNK_SIZE = 256;
const CHUNK_LIMIT = 64;
const CHUNK_ART_STEP = 4; // Eight logical world units per terrain lookup.
const OUTSIDE = Object.freeze([28, 43, 43]);
const DEFAULT_ANIM = Object.freeze({ time: 0, moving: false,
  facing: Object.freeze({ x: 0, y: 1 }) });

const finitePoint = point => point !== null && typeof point === 'object' &&
  Number.isFinite(point.x) && Number.isFinite(point.y);

function inside(bounds, x, y) {
  return x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY;
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

/** Presentation reads only the current Ozark geometry and world state. */
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
    this.pendingChunks = new Map();
    this.frame = 0;
    this.atlasView = new AtlasViewport({ bounds: {
      x: this.bounds.minX, y: this.bounds.minY,
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    } });
    this.atlasMarkers = [];
    this.atlasBase = null;
    this.atlasPaletteGrid = new Map();
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

  terrainColor(x, y, site = null, map = false) {
    if (!inside(this.bounds, x, y)) return OUTSIDE;
    site ||= map && this.geometry.cartographicSample ? this.geometry.cartographicSample(x, y) : this.geometry.sample(x, y);
    let grade = 'walk';
    if (!map && !['surface-water', 'internal-pond'].includes(site.paint)) {
      const walk = this.geometry.classify(x, y, CONFIG.playerRadius, 'walk');
      if (walk.reason === 'excessive-grade') grade =
        this.geometry.classify(x, y, CONFIG.playerRadius, 'climb').walkable ? 'climb' : 'cliff';
    }
    return landscapeGroundColor(site, x, y, {
      cellPixels: this.geometry.profile.cellPixels, grade, map,
      baseColor: !map && grade==='walk' && this.geometry.cartographicSample &&
        !['surface-water','internal-pond'].includes(site.paint) ? this.atlasColor(x,y,site) : null,
    });
  }

  paintChunkRow(work, py, step = CHUNK_ART_STEP) {
    const { cx, cy, side, image, sites } = work;
    for (let px=0;px<side;px+=step) {
      const x=cx*CHUNK_SIZE+px*ART_PIXEL+step;
      const y=cy*CHUNK_SIZE+py*ART_PIXEL+step;
      const site=inside(this.bounds,x,y)?this.geometry.sample(x,y):null;
      if(step===CHUNK_ART_STEP)sites.set(`${px/step},${py/step}`,site);
      const color=this.terrainColor(x,y,site);
      for(let dy=0;dy<step;dy++)for(let dx=0;dx<step;dx++) {
        const index=((py+dy)*side+px+dx)*4;
        image.data[index]=color[0];image.data[index+1]=color[1];
        image.data[index+2]=color[2];image.data[index+3]=255;
      }
    }
  }

  finishChunk(work) {
    const {context,image,cx,cy,sites}=work;
    context.putImageData(image,0,0);
    const originX=cx*CHUNK_SIZE,originY=cy*CHUNK_SIZE;
    drawLandscapeSubstrate(context,this.geometry,originX,originY,CHUNK_SIZE,
      (x,y)=>sites.get(`${Math.floor((x-originX)/(ART_PIXEL*CHUNK_ART_STEP))},${Math.floor((y-originY)/(ART_PIXEL*CHUNK_ART_STEP))}`));
    this.pendingChunks.delete(work.key);
  }

  chunk(cx, cy, progressive = false) {
    const key=`${this.geometry.profile.identity}:${cx},${cy}`;
    if(this.chunks.has(key)) {
      const cached=this.chunks.get(key);this.chunks.delete(key);this.chunks.set(key,cached);
      return cached;
    }
    const side=CHUNK_SIZE/ART_PIXEL,out=document.createElement('canvas');
    out.width=side;out.height=side;
    const context=out.getContext('2d');
    if(!context)throw new Error('Ozark requires Canvas 2D');
    const work={key,cx,cy,side,context,image:context.createImageData(side,side),sites:new Map(),row:0};
    // Show an immediately usable coarse surface, then refine only new chunks
    // under a per-frame time budget. Cached full detail is never redrawn.
    const step=progressive?16:CHUNK_ART_STEP;
    for(let py=0;py<side;py+=step)this.paintChunkRow(work,py,step);
    if(progressive){context.putImageData(work.image,0,0);this.pendingChunks.set(key,work);}
    else this.finishChunk(work);
    this.chunks.set(key,out);
    if(this.chunks.size>CHUNK_LIMIT){const oldest=this.chunks.keys().next().value;this.chunks.delete(oldest);this.pendingChunks.delete(oldest);}
    return out;
  }

  refineChunks(budgetMs = 6) {
    const deadline=performance.now()+budgetMs;
    const queue=[...this.pendingChunks.values()].sort((a,b)=>
      Math.hypot((a.cx+.5)*CHUNK_SIZE-this.camera.x,(a.cy+.5)*CHUNK_SIZE-this.camera.y)-
      Math.hypot((b.cx+.5)*CHUNK_SIZE-this.camera.x,(b.cy+.5)*CHUNK_SIZE-this.camera.y));
    for(const work of queue) {
      while(work.row<work.side && performance.now()<deadline) {
        this.paintChunkRow(work,work.row);work.row+=CHUNK_ART_STEP;
      }
      if(work.row>=work.side)this.finishChunk(work);
      if(performance.now()>=deadline)break;
    }
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
        g.drawImage(this.chunk(cx, cy, true), cx * CHUNK_SIZE, cy * CHUNK_SIZE,
          CHUNK_SIZE, CHUNK_SIZE);
      }
    }
    const time = state.environment?.elapsed ?? state.elapsed ?? 0;
    const hour = environmentHour(state.environment ?? {elapsed:time});
    const structuralObjects = this.geometry.structures?.objectsInRect({
      left: bounds.left - 500, right: bounds.right + 500,
      top: bounds.top - 500, bottom: bounds.bottom + 500,
    }) ?? [];
    drawLandscapeWater(g, this.geometry, bounds, time);
    drawLandscapeShadows(g, structuralObjects, hour, bounds);
    if (finitePoint(state.waypoint) && inside(this.bounds,
      state.waypoint.x, state.waypoint.y)) {
      g.fillStyle = '#4c3e2a';
      g.fillRect(state.waypoint.x - 5, state.waypoint.y - 18, 10, 18);
      g.fillStyle = '#efd184';
      g.fillRect(state.waypoint.x - 3, state.waypoint.y - 16, 6, 11);
    }
    const objects = objectsNear(state, bounds).map(entity => ({
      kind: 'ecology', x: entity.x, y: entity.y, entity,
    }));
    for (const object of structuralObjects) objects.push({ kind: 'structure', x: object.x, y: object.y, object });
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
    const visiblePeople = [state.player, ...agents(state).map(agent => agent.position)];
    objects.sort((a, b) => a.y - b.y);
    for (const object of objects) {
      if (object.x < bounds.left - 160 || object.x > bounds.right + 160 ||
          object.y < bounds.top - 180 || object.y > bounds.bottom + 320) continue;
      if (object.kind === 'structure') drawStructuralObject(g, object.object, visiblePeople);
      else if (object.kind === 'ecology') drawEcologyObject(g, object.entity, time, subject);
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
    drawLandscapeLight(g, width, height, hour);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.pixels, 0, 0,
      width * this.pixelScale, height * this.pixelScale);
    this.refineChunks();
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
          const color = this.atlasColor(wx, wy);
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

  atlasColor(x, y, suppliedSite = null) {
    if (!inside(this.bounds,x,y)) return OUTSIDE;
    const site=suppliedSite || (this.geometry.cartographicSample || this.geometry.sample)(x,y);
    const water=landscapeWaterDistance(site,this.geometry.profile.cellPixels);
    if(['surface-water','internal-pond'].includes(site.paint)||water<32)
      return landscapeGroundColor(site,x,y,{cellPixels:this.geometry.profile.cellPixels,map:true});
    const spacing=this.geometry.profile.cellPixels || 400;
    const rx=(x-this.bounds.minX)/spacing,ry=(y-this.bounds.minY)/spacing;
    const ix=Math.floor(rx),iy=Math.floor(ry),fx=rx-ix,fy=ry-iy;
    const colorAt=(cx,cy)=>{
      const key=`${cx},${cy}`;
      if(this.atlasPaletteGrid.has(key))return this.atlasPaletteGrid.get(key);
      const wx=Math.max(this.bounds.minX,Math.min(this.bounds.maxX,this.bounds.minX+cx*spacing));
      const wy=Math.max(this.bounds.minY,Math.min(this.bounds.maxY,this.bounds.minY+cy*spacing));
      const s=(this.geometry.cartographicSample || this.geometry.sample)(wx,wy);
      const color=landscapeGroundColor({...s,paint:s.habitat||s.paint,
        surfaceWaterDistance:Infinity,sinkholePondDistance:Infinity},wx,wy,{map:true});
      this.atlasPaletteGrid.set(key,color);return color;
    };
    const a=colorAt(ix,iy),b=colorAt(ix+1,iy),c=colorAt(ix,iy+1),d=colorAt(ix+1,iy+1);
    return a.map((v,i)=>Math.round((v*(1-fx)+b[i]*fx)*(1-fy)+(c[i]*(1-fx)+d[i]*fx)*fy));
  }

  drawAtlasContours(g, elevations, width, height) {
    // Marching-cell segments follow real elevation. Unlike thresholded single
    // pixels these form connected contours and do not speckle the overview.
    const step=3;
    g.strokeStyle='#314e3b44';g.lineWidth=.55;g.beginPath();
    for(let y=0;y<height-step;y+=step)for(let x=0;x<width-step;x+=step){
      const points=[[x,y],[x+step,y],[x+step,y+step],[x,y+step]];
      const zs=points.map(([px,py])=>elevations[py*width+px]);
      const low=Math.min(...zs),high=Math.max(...zs);
      if(!Number.isFinite(low)||!Number.isFinite(high))continue;
      for(let level=Math.ceil(low/80)*80;level<=high;level+=80){
        const hits=[];
        for(let i=0;i<4;i++){
          const j=(i+1)%4;
          if((zs[i]<level)===(zs[j]<level)||zs[i]===zs[j])continue;
          const t=(level-zs[i])/(zs[j]-zs[i]);
          hits.push([points[i][0]+(points[j][0]-points[i][0])*t,
            points[i][1]+(points[j][1]-points[i][1])*t]);
        }
        for(let i=0;i+1<hits.length;i+=2){g.moveTo(...hits[i]);g.lineTo(...hits[i+1]);}
      }
    }
    g.stroke();
  }

  atlasBaseWork() {
    const width=384,height=288,image=document.createElement('canvas');
    image.width=width;image.height=height;
    const g=image.getContext('2d');
    return {width,height,image,g,pixels:g.createImageData(width,height),
      elevations:new Float64Array(width*height)};
  }

  paintAtlasBaseRow(work,y) {
    const {width,height,pixels,elevations}=work;
    for(let x=0;x<width;x++) {
      const wx=this.bounds.minX+(x+.5)/width*(this.bounds.maxX-this.bounds.minX);
      const wy=this.bounds.minY+(y+.5)/height*(this.bounds.maxY-this.bounds.minY);
      const site=(this.geometry.cartographicSample || this.geometry.sample)(wx,wy);
      const color=this.atlasColor(wx,wy,site),index=(y*width+x)*4;
      elevations[y*width+x]=['surface-water','internal-pond'].includes(site.paint)?NaN:site.elevation;
      pixels.data[index]=color[0];pixels.data[index+1]=color[1];
      pixels.data[index+2]=color[2];pixels.data[index+3]=255;
    }
  }

  finishAtlasBase(work) {
    const {g,pixels,elevations,width,height,image}=work;
    g.putImageData(pixels,0,0);this.drawAtlasContours(g,elevations,width,height);
    this.atlasBase=image;return image;
  }

  atlasBaseImage() {
    if(this.atlasBase)return this.atlasBase;
    // Bounded cached overview, never a full-world art-pixel scan.
    const work=this.atlasBaseWork();
    for(let y=0;y<work.height;y++)this.paintAtlasBaseRow(work,y);
    return this.finishAtlasBase(work);
  }

  /** Prepare during the initial loading state without monopolizing the UI.
   * The synchronous accessor remains deterministic for tests and small tools.
   */
  async prepareAtlas(yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0))) {
    if(this.atlasBase)return this.atlasBase;
    if(this.atlasPreparing)return this.atlasPreparing;
    this.atlasPreparing=(async()=>{
      const work=this.atlasBaseWork();let deadline=performance.now()+8;
      for(let y=0;y<work.height;y++) {
        if(this.atlasBase)return this.atlasBase;
        this.paintAtlasBaseRow(work,y);
        if(performance.now()>=deadline){await yieldFrame();deadline=performance.now()+8;}
      }
      return this.finishAtlasBase(work);
    })();
    try{return await this.atlasPreparing;}finally{this.atlasPreparing=null;}
  }

  atlasDetailImage(width, height) {
    const view = this.atlasView;
    const quantum = 8 / view.scale;
    const key = `${Math.round(view.center.x / quantum)},${Math.round(view.center.y / quantum)},` +
      `${Math.round(view.zoom * 100)},${width},${height}`;
    if (this.atlasDetail?.key === key) return this.atlasDetail;
    const pixelWidth = Math.min(320, Math.max(1, Math.ceil(width * .5)));
    const pixelHeight = Math.min(240, Math.max(1, Math.ceil(height * .5)));
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
        const color = this.atlasColor(x0 + (x + .5) / pixelWidth * worldWidth,
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
    g.imageSmoothingEnabled = true;
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
    if (this.geometry.structures && view.zoom >= 16) {
      const topLeft=view.toWorld(0,0,{bounded:false}),bottomRight=view.toWorld(width,height,{bounded:false});
      if(topLeft&&bottomRight)drawAtlasStructures(g,this.geometry.structures.objectsInRect({
        left:topLeft.x-150,top:topLeft.y-150,right:bottomRight.x+150,bottom:bottomRight.y+150,
      }),view);
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
    g.strokeStyle = '#aab28b'; g.lineWidth = 1;
    g.strokeRect(Math.round(corner.x) + .5, Math.round(corner.y) + .5,
      Math.round(worldWidth * view.scale) - 1, Math.round(worldHeight * view.scale) - 1);
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
      const collides = candidate => this.atlasMarkers.some(other =>
        candidate.x < other.label.x + other.label.w + 3 &&
        candidate.x + candidate.w + 3 > other.label.x &&
        candidate.y < other.label.y + other.label.h + 3 &&
        candidate.y + candidate.h + 3 > other.label.y);
      const originalY=label.y;
      for(let attempt=1;collides(label)&&attempt<=16;attempt++) {
        const offset=Math.ceil(attempt/2)*25*(attempt%2?1:-1);
        label.y=Math.max(8,Math.min(height-labelHeight-8,originalY+offset));
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
