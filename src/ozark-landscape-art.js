// Original, read-only landscape artwork. Surface marks are flat substrate:
// no extra plants, food, loose materials, obstacles, or simulated actions.
import { ART_PIXEL } from './art.js';
import { landscapeCrown, landscapeSun } from './ozark-structures.js';

export const landscapeHash = (x, y, seed = 0) => {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const PALETTE = Object.freeze({
  'dry-rocky-glade': rgb('#b0aa76'), 'open-clearing': rgb('#8fa453'),
  'oak-pine-woodland': rgb('#638248'), 'shaded-cove': rgb('#496c50'),
  'wet-terrace': rgb('#739d5c'), 'spring-seep': rgb('#618f71'),
  'sinkhole-basin': rgb('#80916a'), 'river-channel': rgb('#8da474'),
  divide: rgb('#c7af82'),
});
function broadNoise(x, y, size, seed) {
  const cx = Math.floor(x / size), cy = Math.floor(y / size);
  const fx = x / size - cx, fy = y / size - cy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = landscapeHash(cx, cy, seed) * (1 - sx) + landscapeHash(cx + 1, cy, seed) * sx;
  const bottom = landscapeHash(cx, cy + 1, seed) * (1 - sx) + landscapeHash(cx + 1, cy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}
export function landscapeWaterDistance(site, cellPixels = 400) {
  return Math.min(site.surfaceWaterDistance ?? Infinity,
    site.sinkholePondDistance ?? Infinity) * cellPixels;
}
export function landscapeGroundColor(site, x, y, { cellPixels = 400, grade = 'walk', map = false, baseColor = null } = {}) {
  const distance = landscapeWaterDistance(site, cellPixels);
  if (site.paint === 'surface-water' || site.paint === 'internal-pond') {
    const pond = site.paint === 'internal-pond';
    const deep = pond ? rgb('#3f726f') : rgb('#286e88');
    const shallow = pond ? rgb('#7eaca0') : rgb('#71b6b0');
    const depth = Math.max(0, -distance);
    const t = Number.isFinite(distance) ? clamp(depth / 105, 0, 1) : site.waterBand === 'shallow-water' ? 0 : 1;
    return mix(shallow, deep, t);
  }
  if (grade !== 'walk') {
    const level = Math.floor((y + broadNoise(x, y, 180, 817) * 34) / 24);
    const colors = grade === 'climb' ? ['#b49e74', '#c6b087', '#a18e6d'] : ['#786e62', '#8e8271', '#625e58'];
    return rgb(colors[((level % 3) + 3) % 3]);
  }
  let base = baseColor || PALETTE[site.paint] || PALETTE[site.habitat] || PALETTE['open-clearing'];
  // Related continuous moisture/canopy values tie categorical habitat patches
  // together, instead of rendering the descriptor grid as hard square tiles.
  if (!map && site.paint !== 'divide' && Number.isFinite(site.canopy)) {
    const cover = clamp(site.canopy, 0, 1);
    const natural = mix(rgb('#99aa5b'), rgb('#436b48'), cover);
    base = mix(base, natural, .42);
  }
  const shade = map ? 0 : Math.round((broadNoise(x, y, 210, 571) - .5) * 3) * 3;
  base = base.map((v, i) => clamp(v + shade * (i === 2 ? .65 : 1), 0, 255));
  // Dry bank, damp soil, and submerged shallows remain on their actual sides
  // of the authoritative water line. Nothing changes a collision boundary.
  if (distance >= 0 && distance < 9) return mix(rgb('#6f8063'), rgb('#a3b489'), distance / 9);
  if (distance >= 9 && distance < 25) return mix(rgb('#b9b98a'), base, (distance - 9) / 16);
  return base.map(Math.round);
}
function mark(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
function oval(g, x, y, rx, ry, color) {
  g.fillStyle = color;
  for (let py = Math.floor(y - ry); py < Math.ceil(y + ry); py++) {
    const half = rx * Math.sqrt(Math.max(0, 1 - ((py + .5 - y) / ry) ** 2));
    const left = Math.round(x - half), right = Math.round(x + half);
    if (right > left) g.fillRect(left, py, right - left, 1);
  }
}
function polygon(g, points, color) {
  g.fillStyle = color;
  const top = Math.floor(Math.min(...points.map(p => p[1]))), bottom = Math.ceil(Math.max(...points.map(p => p[1])));
  for (let y = top; y < bottom; y++) {
    const intersections = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      if ((a[1] > y + .5) === (b[1] > y + .5)) continue;
      intersections.push(a[0] + (y + .5 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2)
      g.fillRect(Math.round(intersections[i]), y, Math.max(1, Math.round(intersections[i + 1] - intersections[i])), 1);
  }
}

/** Chunk-local one/two-pixel flattened marks, never silhouettes of resources. */
export function drawLandscapeSubstrate(g, geometry, originX, originY, size, sample) {
  const spacing = 36;
  for (let gy = Math.floor(originY / spacing) - 1; gy <= Math.ceil((originY + size) / spacing); gy++) {
    for (let gx = Math.floor(originX / spacing) - 1; gx <= Math.ceil((originX + size) / spacing); gx++) {
      const h = landscapeHash(gx, gy, 6031);
      const wx = gx * spacing + 5 + landscapeHash(gx, gy, 6059) * 26;
      const wy = gy * spacing + 5 + landscapeHash(gx, gy, 6067) * 26;
      const site = sample(wx, wy);
      if (!site || site.paint === 'surface-water' || site.paint === 'internal-pond') continue;
      const distance = landscapeWaterDistance(site, geometry.profile.cellPixels);
      const x = Math.round((wx - originX) / ART_PIXEL), y = Math.round((wy - originY) / ART_PIXEL);
      const dry = site.habitat === 'dry-rocky-glade' || site.paint === 'divide';
      const forest = ['oak-pine-woodland', 'shaded-cove'].includes(site.habitat);
      const wet = ['wet-terrace', 'spring-seep', 'river-channel'].includes(site.habitat);
      if (distance < 32 || dry) {
        // Exposed stone chips are embedded in the ground and have no volume.
        const dark = dry ? '#918b61' : '#8e9870', light = dry ? '#d2c59a' : '#ccd0a1';
        if (h < .7) { mark(g, x - 2, y, 5 + Math.floor(h * 5), 1, dark); mark(g, x - 1, y - 1, 3, 1, light); }
        if (h > .43) { mark(g, x + 5, y + 4, 2, 1, dark); mark(g, x - 5, y + 3, 2, 1, light); }
        if (dry && h > .88) { mark(g, x - 6, y + 6, 11, 1, '#a3996b'); mark(g, x - 5, y + 5, 7, 1, '#c5b98c'); }
      } else if (forest) {
        // Flat leaf litter and moss patches, distinct from forage sprites.
        if (h < .5) { mark(g, x - 3, y, 7, 2, '#52733e'); mark(g, x - 1, y - 1, 4, 1, '#789247'); }
        if (h > .28) { mark(g, x + 4, y + 3, 3, 1, '#9e9960'); mark(g, x + 5, y + 4, 2, 1, '#727b42'); }
        if (h > .72) { mark(g, x - 5, y + 5, 3, 1, '#b0a96b'); mark(g, x - 4, y + 6, 2, 1, '#6c753b'); }
      } else {
        const dark = wet ? '#5f8850' : '#7e9849', light = wet ? '#98b56c' : '#b2bd72';
        if (h < .65) { mark(g, x - 2, y, 5, 1, dark); mark(g, x + 1, y - 1, 3, 1, light); }
        if (h > .42) { mark(g, x + 5, y + 4, 4, 1, dark); mark(g, x + 6, y + 3, 2, 1, light); }
      }
    }
  }
}

/** Sparse animated surface reflections, on sampled water only. */
export function drawLandscapeWater(g, geometry, bounds, time) {
  const spacing = 86, phase = Math.floor(time * 2) % 4;
  for (let cy = Math.floor(bounds.top / spacing); cy <= Math.ceil(bounds.bottom / spacing); cy++) {
    for (let cx = Math.floor(bounds.left / spacing); cx <= Math.ceil(bounds.right / spacing); cx++) {
      const h = landscapeHash(cx, cy, 6337);
      if (h < .42) continue;
      const x = Math.round((cx * spacing + h * 45) / 2) * 2;
      const y = Math.round((cy * spacing + landscapeHash(cx, cy, 6373) * 45) / 2) * 2;
      if (x < geometry.bounds.minX + 20 || x > geometry.bounds.maxX - 20 || y < geometry.bounds.minY + 20 || y > geometry.bounds.maxY - 20) continue;
      const site = (geometry.cartographicSample || geometry.sample)(x, y);
      if (!['surface-water', 'internal-pond'].includes(site.paint) || landscapeWaterDistance(site, geometry.profile.cellPixels) > -18) continue;
      const frame = (phase + Math.floor(h * 4)) % 4;
      if (frame === 3) continue;
      mark(g, x - 9, y, frame === 0 ? 14 : 20, 2, frame === 0 ? '#75b7b8' : '#559ba9');
      mark(g, x + 9, y - 2, 6, 2, '#6bafb4');
      if (frame === 1) mark(g, x - 5, y + 6, 10, 2, '#4591a1');
    }
  }
}

const structuralSprites = new Map();
function treeSprite(kind, variant) {
  const canvas = document.createElement('canvas'); canvas.width = 104; canvas.height = 140;
  const g = canvas.getContext('2d'); g.translate(52, 127);
  const pine = kind === 'pine';
  const palette = pine ? ['#233f36', '#315c43', '#477b4e', '#6c9a61', '#9fb673'] :
    variant % 3 === 2 ? ['#2e462f', '#48683a', '#638446', '#86a357', '#b7c478'] :
      ['#263f31', '#3f6238', '#5d8343', '#83a24d', '#b3c168'];
  // Root collar and bark align with the actual solid trunk, not the canopy.
  polygon(g, [[-5, 0], [-4, -48], [3, -53], [6, -4], [12, 1], [5, 3], [-2, 1], [-10, 3]], '#3e3e2b');
  mark(g, -3, -48, 6, 47, '#7a5d38'); mark(g, -3, -44, 2, 41, '#b08a4c');
  mark(g, 2, -39, 2, 36, '#564731'); mark(g, -1, -25, 2, 3, '#4b3f2c');
  polygon(g, [[-1,-29],[-17,-46],[-16,-53],[2,-36]], '#6e5234');
  polygon(g, [[1,-38],[18,-59],[20,-60],[7,-35]], '#886239');
  const trunk = document.createElement('canvas'); trunk.width=104; trunk.height=140;
  trunk.getContext('2d').drawImage(canvas,0,0);
  g.clearRect(-52,-127,104,140);
  if (pine) {
    for (let layer = 0; layer < 6; layer++) {
      const y = -17 - layer * 14, w = 40 - layer * 6;
      polygon(g, [[-1,y-37],[-w+9,y-11],[-w+13,y-10],[-w,y+2],[-w+12,y+2],[-w+16,y+7],[0,y+5],[w-13,y+8],[w-10,y+3],[w,y+2],[w-12,y-11],[w-9,y-12]], palette[0]);
      polygon(g, [[-1,y-36],[-w+12,y-9],[-w+17,y-9],[-w+6,y],[0,y+2],[w-8,y],[w-16,y-10]], palette[1]);
      polygon(g, [[-2,y-33],[-w+19,y-11],[-w+22,y-9],[-w+12,y-3],[-6,y-4],[3,y-13]], palette[2]);
      polygon(g, [[-2,y-30],[-w+24,y-11],[-w+23,y-7],[-9,y-8],[0,y-17]], palette[3]);
      mark(g, -w+11, y-1, 7, 1, palette[3]); mark(g, 9, y-4, Math.max(2,w-20), 2, palette[2]);
    }
  } else {
    const groups = [[-22,-43,20,15],[19,-47,24,17],[-4,-39,25,15],[-32,-65,16,20],[30,-69,17,19],[-17,-82,22,20],[8,-91,23,20],[-6,-66,27,21],[19,-73,20,17]];
    for (let i=0;i<groups.length;i++) {
      const [x,y,rx,ry]=groups[i];
      oval(g,x+1,y+3,rx+1,ry,palette[0]); oval(g,x,y,rx,ry-1,palette[1]);
      oval(g,x-3,y-4,rx-3,ry-4,palette[2]);
      polygon(g,[[x-rx+5,y-6],[x-rx+8,y-ry+7],[x-7,y-ry+1],[x+3,y-ry+1],[x+10,y-ry+7],[x+4,y-9],[x-7,y-4]],palette[3]);
      // Few connected leaf clusters rather than independent random pixels.
      for (let n=0;n<5;n++) {
        const dx=-rx+7+landscapeHash(i,n,901+variant)*(rx*2-14);
        const dy=-ry+7+landscapeHash(i,n,937)*(ry*2-13);
        if((dx/rx)**2+(dy/ry)**2>.65)continue;
        mark(g,x+dx,y+dy,4+n%3,2,n===0?palette[4]:palette[3]);
        mark(g,x+dx+2,y+dy-1,3,1,n===0?palette[4]:palette[2]);
      }
      mark(g,x+rx-8,y+2,5,2,palette[0]);
    }
  }
  return { image:canvas, trunk, ox:52, oy:127 };
}
function stoneSprite(variant) {
  const canvas=document.createElement('canvas');canvas.width=58;canvas.height=45;
  const g=canvas.getContext('2d');g.translate(29,35);
  polygon(g,[[-24,0],[-21,-13],[-12,-25],[4,-28],[21,-18],[25,-3],[14,6],[-9,7]],'#505b55');
  polygon(g,[[-22,-1],[-19,-13],[-11,-24],[4,-26],[2,-10],[-6,3]],'#a4a891');
  polygon(g,[[4,-26],[20,-17],[23,-5],[2,-10]],'#c7c5a9');
  polygon(g,[[2,-10],[23,-5],[14,5],[-6,3]],'#7b8879');
  mark(g,-13,-15,12,2,'#c8c9ab');mark(g,-18,-8,5,1,'#7d8d7a');mark(g,4,-6,11,1,'#a4af96');
  polygon(g,[[-4,-24],[0,-18],[-2,-11],[3,-7],[2,-4]],'#727f6e');
  if(variant%3!==1){oval(g,-13,2,9,3,'#557746');mark(g,-18,-1,7,2,'#829a5a');mark(g,-12,0,5,1,'#b1b67c');}
  return{image:canvas,ox:29,oy:35};
}
/** Draw only authoritative structural records. No fruit is ever painted. */
export function drawStructuralObject(g, object, subjects = []) {
  const key=`${object.kind}:${object.variant || 0}`;
  if(!structuralSprites.has(key))structuralSprites.set(key,object.kind==='rock'?stoneSprite(object.variant||0):treeSprite(object.kind,object.variant||0));
  const sprite=structuralSprites.get(key),scale=object.scale||1;
  const multiplier=(object.kind==='rock'?1:ART_PIXEL)*scale,w=sprite.image.width*multiplier,h=sprite.image.height*multiplier;
  g.save();
  // One low, directional contact shadow anchors the canopy and solid root.
  g.fillStyle=object.kind==='rock'?'#253c3033':'#29443044';
  for(let row=0;row<8;row++){
    const half=Math.sqrt(Math.max(0,1-((row-4)/4)**2))*(object.kind==='rock'?27:44)*scale;
    g.fillRect(Math.round(object.x-half+11*scale),Math.round(object.y+row*2-4),Math.round(half*2),2);
  }
  const x=Math.round((object.x-sprite.ox*multiplier)/2)*2;
  const y=Math.round((object.y-sprite.oy*multiplier)/2)*2;
  g.imageSmoothingEnabled=false;
  if(sprite.trunk)g.drawImage(sprite.trunk,x,y,Math.round(w/2)*2,Math.round(h/2)*2);
  const seen=new Set();
  for(const subject of Array.isArray(subjects)?subjects:subjects?[subjects]:[]) {
    const key=`${subject.x},${subject.y}`;
    if(seen.has(key))continue;seen.add(key);
    if(object.kind==='rock'||Math.abs(subject.x-object.x)>w*.5+30||
      subject.y>object.y+4||subject.y<object.y-sprite.oy*multiplier-20)continue;
    // One common fully clear window per person, not compounded half-opacity
    // crowns. Only foliage is cut away; trunks, collisions and shade remain.
    g.beginPath();g.rect(x-2,y-2,w+4,h+4);
    const centerY=subject.y-28,rx=29,ry=42;
    for(let row=Math.floor((centerY-ry)/2);row<Math.ceil((centerY+ry)/2);row++) {
      const t=(row*2+1-centerY)/ry;
      if(Math.abs(t)>=1)continue;
      const half=rx*Math.sqrt(1-t*t);
      g.rect(Math.round((subject.x-half)/2)*2,row*2,Math.round(half)*2,2);
    }
    g.clip('evenodd');
  }
  g.drawImage(sprite.image,x,y,Math.round(w/2)*2,Math.round(h/2)*2);
  g.restore();
}

const shadowSprites = new Map();
/** Ground-plane crown shadows use the very same projection as felt shade. */
export function drawLandscapeShadows(g, objects, hour, bounds = null) {
  const sun = landscapeSun(hour);
  if (!sun.daylight) return;
  for (const object of objects) {
    const crown = landscapeCrown(object);
    if (!crown) continue;
    const x = object.x + sun.dx * crown.height * sun.lengthFactor;
    const y = object.y + sun.dy * crown.height * sun.lengthFactor;
    if(bounds && (x+crown.radiusX<bounds.left || x-crown.radiusX>bounds.right ||
      y+crown.radiusY<bounds.top || y-crown.radiusY>bounds.bottom))continue;
    // Cache only the two original pixel silhouettes, not one bitmap per tree
    // or clock tick. Drawing a scaled mask replaces thousands of row calls.
    if(!shadowSprites.has(object.kind)) {
      const image=document.createElement('canvas'),rx=object.kind==='pine'?40:48,
        ry=object.kind==='pine'?28:34;
      image.width=rx*2;image.height=ry*2;
      oval(image.getContext('2d'),rx,ry,rx,ry,'#203e34');
      shadowSprites.set(object.kind,image);
    }
    g.save();g.imageSmoothingEnabled=false;
    g.globalAlpha=.30*crown.cover*sun.strength;
    g.drawImage(shadowSprites.get(object.kind),Math.round((x-crown.radiusX)/2)*2,
      Math.round((y-crown.radiusY)/2)*2,Math.round(crown.radiusX)*2,Math.round(crown.radiusY)*2);
    g.restore();
  }
}

export function drawLandscapeLight(g, width, height, hour) {
  const sun = landscapeSun(hour);
  const h = ((hour % 24)+24)%24;
  const night = !sun.daylight;
  const twilight = Math.max(0,1-Math.min(Math.abs(h-6),Math.abs(h-18))/2);
  const opacity = night ? .29 - twilight*.12 : (1-sun.strength/.78)*.13;
  if (opacity <= .005) return;
  g.save();g.globalAlpha=opacity;
  g.fillStyle=twilight>.3?'#b47c68':'#203959';g.fillRect(0,0,width,height);g.restore();
}

/** Top-down physical crowns/footprints, used only at readable atlas zoom. */
export function drawAtlasStructures(g, objects, view) {
  for(const object of objects) {
    const point=view.toCanvas(object.x,object.y),crown=landscapeCrown(object);
    if(crown){
      oval(g,point.x,point.y,Math.max(2,crown.radiusX*view.scale),
        Math.max(2,crown.radiusY*view.scale),'#294f3c75');
      mark(g,point.x-1,point.y-1,2,2,object.kind==='pine'?'#b0c38a':'#8da66c');
    }else{
      const radius=Math.max(1.5,object.radius*object.scale*view.scale);
      oval(g,point.x,point.y,radius,radius*.7,'#d0c6a4');
      mark(g,point.x-radius*.5,point.y+radius*.3,Math.max(2,radius),1,'#727d6b');
    }
  }
}
