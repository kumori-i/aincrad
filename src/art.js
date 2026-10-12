/** Original, procedurally drawn artwork. No third-party images or fonts. */
import { hash, noise, terrain, waterDistance, forestAmount, ridgeValue, clamp } from './world.js';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function poly(ctx, pts, fill, stroke = null, width = 1) {
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
export function ellipse(ctx, x, y, rx, ry, fill, rotation = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
}
export function line(ctx, pts, stroke, width = 1) {
  ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}
const COLORS = {
  meadow: [107, 139, 83], forest: [70, 113, 81], trail: [170, 165, 113],
  shore: [182, 175, 130], water: [48, 111, 122], shallows: [88, 146, 137],
  scree: [128, 139, 115], mountain: [93, 109, 105], bridge: [133, 113, 78],
};
export function groundColor(x, y, map = false) {
  const t = terrain(x, y);
  let col = COLORS[t], v = noise(x, y, 130, 1313) * 11 + noise(x, y, 680, 5290) * 12 - 12;
  if (t === 'water') v += clamp(waterDistance(x, y) / 100, -15, 0);
  if (t === 'mountain') v += noise(x, y, 240, 980) * 35 - 15;
  if (map && t === 'mountain') {
    const contour = Math.sin(noise(x, y, 1400, 7371) * 35 + ridgeValue(x, y) * 9);
    v += contour > .83 ? 16 : -2;
  }
  return col.map(c => clamp(Math.round(c + v), 0, 255));
}
export function makeGroundChunk(cx, cy, size) {
  const small = canvas(size / 8, size / 8), s = small.width, sc = small.getContext('2d');
  const img = sc.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const col = groundColor(cx * size + x * 8 + 4, cy * size + y * 8 + 4), i = (y * s + x) * 4;
    img.data[i] = col[0]; img.data[i+1] = col[1]; img.data[i+2] = col[2]; img.data[i+3] = 255;
  }
  sc.putImageData(img, 0, 0);
  const out = canvas(size, size), ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, size, size);
  for (let j = 0; j < size / 23; j++) for (let i = 0; i < size / 23; i++) {
    const wx = cx * size + i * 23 + hash(i, j, cx * 1049 + cy) * 21;
    const wy = cy * size + j * 23 + hash(i, j, cx * 819 + cy + 71) * 21;
    const t = terrain(wx, wy), x = wx - cx * size, y = wy - cy * size;
    const h = hash(Math.floor(wx), Math.floor(wy), 569);
    if (t === 'meadow' || t === 'forest') {
      ctx.strokeStyle = t === 'forest' ? '#84a07a42' : '#d6d99548'; ctx.lineWidth = .9;
      if (h < .76) {
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x - 4, y - 4 - h * 6); ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y - 7); ctx.moveTo(x+3,y);ctx.lineTo(x+5,y-4);ctx.stroke();
      }
      if (h > .972 || (noise(wx,wy,450,728) > .69 && h > .77)) {
        ellipse(ctx,x,y,2.1,1,'#46694d');
        const color = h < .88 ? '#d9cc81' : h < .94 ? '#b5a3be' : '#e9dfba';
        ellipse(ctx,x,y-5,2.5,1.4,color); ellipse(ctx,x-4,y-3,1.4,1.4,color);
      }
    } else if (t === 'trail' || t === 'shore' || t === 'scree') {
      ctx.fillStyle = h < .5 ? '#394d3b18' : '#f4eac633';
      ctx.fillRect(x, y, h * 3 + 1, 1.5);
      if (h > .93) ellipse(ctx, x, y, 4, 2, '#69776355');
    }
    if (t === 'shore' && h > .65 && waterDistance(wx,wy) < 45) {
      line(ctx, [[x-3,y],[x-4,y-11]], '#566f4e',1.6); line(ctx,[[x+1,y],[x+3,y-16]],'#75804e',1.5);
      line(ctx,[[x+3,y-13],[x+3,y-18]],'#776141',2.7);
    }
  }
  return out;
}
function oakSprite(variant) {
  const c=canvas(200,215),g=c.getContext('2d'); g.translate(100,189);
  ellipse(g,12,7,51,18,'#142f294a',-.2);
  poly(g,[[-9,0],[-6,-64],[5,-72],[9,-5],[17,3],[8,5],[0,1],[-12,5]],'#645943');
  line(g,[[1,-9],[-1,-68]],'#a49767',3); line(g,[[-2,-36],[-26,-71]],'#726247',7);line(g,[[3,-42],[25,-89]],'#726247',6);
  const base=variant===4?'#365e49':'#32624d', mid=variant===4?'#58774c':'#437754', light=variant===4?'#839552':'#6c965b';
  const clusters=[[-31,-76,33,26],[29,-79,34,29],[-4,-67,40,24],[-40,-105,29,28],[34,-112,31,27],[1,-129,43,37],[-17,-101,42,32],[17,-111,32,32]];
  for(let i=0;i<clusters.length;i++) {
    const [x,y,rx,ry]=clusters[i];
    ellipse(g,x+2,y+7,rx,ry,base); ellipse(g,x-2,y-4,rx*.94,ry*.88,mid);
    ellipse(g,x-rx*.15,y-ry*.27,rx*.72,ry*.58,light);
    ellipse(g,x-rx*.3,y-ry*.37,rx*.45,ry*.24,variant===4?'#a8af66':'#92ad70');
  }
  for(let i=0;i<80;i++) {
    const x=(hash(i,variant,901)-.5)*100,y=-68-hash(i,variant,981)*95;
    if((x/54)**2+((y+112)/55)**2>1)continue;
    g.fillStyle=i%3===0?'#c9cb8059':'#244e3c30';g.fillRect(x,y,3+hash(i,0,174)*5,2);
  }
  return {image:c,ox:100,oy:189};
}
function pineSprite(variant) {
  const c=canvas(170,230),g=c.getContext('2d');g.translate(85,204);
  ellipse(g,13,4,44,15,'#14372c4d',-.17);
  poly(g,[[-6,2],[-5,-110],[4,-109],[7,2]],'#786c4a');line(g,[[1,0],[1,-54]],'#b09b62',2);
  for(let k=0;k<4;k++) {
    const y=-19-k*33,w=58-k*11,h=75-k*4;
    const pts=[[0,y-h],[-w*.45,y-h*.43],[-w*.32,y-h*.43],[-w*.78,y-h*.15],[-w*.6,y-h*.17],[-w,y+4],[-w*.45,y+1],[-w*.2,y+8],[w*.1,y+7],[w*.6,y+2],[w,y-2],[w*.61,y-h*.19],[w*.73,y-h*.16],[w*.3,y-h*.53],[w*.38,y-h*.5]];
    poly(g,pts,variant===2?'#305b4d':'#315f4b');
    poly(g,[[0,y-h],[-w*.45,y-h*.43],[-w*.32,y-h*.43],[-w*.75,y-h*.16],[-w*.52,y-h*.19],[-w*.84,y],[0,y+1],[w*.25,y-h*.1]],variant===2?'#447d65':'#4e7d54');
    poly(g,[[0,y-h],[-w*.33,y-h*.52],[-w*.15,y-h*.56],[-w*.52,y-h*.24],[0,y-h*.32]],variant===2?'#6f9b79':'#839c63');
    line(g,[[-w*.73,y],[0,y+5],[w*.8,y-1]],'#163f3444',2);
  }
  return{image:c,ox:85,oy:204};
}
function rockSprite(variant) {
  const c=canvas(135,105),g=c.getContext('2d');g.translate(67,82);
  ellipse(g,7,3,41,14,'#203e3044');
  poly(g,[[-44,-6],[-33,-33],[-12,-54],[21,-49],[41,-26],[38,-3],[10,10],[-22,6]],'#6f8076');
  poly(g,[[-44,-6],[-33,-33],[-12,-54],[8,-23],[-1,3]],'#a6afa0');
  poly(g,[[-12,-54],[21,-49],[41,-26],[8,-23]],'#bec1a9');
  poly(g,[[8,-23],[41,-26],[38,-3],[10,10],[-1,3]],'#788b7f');
  line(g,[[-30,-26],[-13,-21],[-16,-9]],'#748679',2);
  if(variant%2===0){ellipse(g,-26,0,15,4,'#799661');ellipse(g,-34,-9,7,3,'#a1ad73');}
  return{image:c,ox:67,oy:82};
}
function mountainSprite(variant) {
  const c=canvas(560,510),g=c.getContext('2d');g.translate(280,452);
  ellipse(g,25,4,210,32,'#29433c45');
  const top=-365-variant*9;
  poly(g,[[-245,7],[-208,-79],[-170,-105],[-139,-186],[-88,-216],[-43,top+61],[0,top],[48,top+75],[91,-212],[130,-175],[157,-103],[214,-54],[239,9],[119,30],[-119,29]],'#566f6a');
  poly(g,[[-245,7],[-208,-79],[-170,-105],[-139,-186],[-88,-216],[-43,top+61],[0,top],[-7,-245],[-58,-185],[-44,-139],[-92,-83],[-124,-55],[-132,18]],'#879990');
  poly(g,[[0,top],[48,top+75],[91,-212],[130,-175],[157,-103],[214,-54],[239,9],[92,10],[69,-103],[29,-154],[29,-261]],'#627e79');
  poly(g,[[0,top],[-7,-245],[-58,-185],[-44,-139],[-92,-83],[-72,-47],[-8,-87],[42,-54],[22,-159],[29,-261]],'#718b81');
  poly(g,[[0,top],[-43,top+61],[-73,-240],[-37,-263],[-20,-242],[4,-284],[29,-261],[52,-247],[48,top+75]],'#ccd0bb');
  poly(g,[[0,top],[4,-284],[29,-261],[52,-247],[48,top+75]],'#a0b4a6');
  line(g,[[-138,-178],[-111,-140],[-139,-75]],'#c3c6ac55',3);
  line(g,[[81,-187],[92,-110],[152,-30]],'#3f625c66',3);
  for(let i=0;i<32;i++){const x=(hash(i,variant,519)-.5)*375,y=hash(i,variant,220)*68-32;ellipse(g,x,y,7+hash(i,0,843)*17,4,'#708c7288');}
  return{image:c,ox:280,oy:452};
}
const sprites=new Map();
export function getSprite(kind,variant=0) {
  const key=kind+variant;
  if(!sprites.has(key))sprites.set(key,kind==='oak'?oakSprite(variant):kind==='pine'?pineSprite(variant):kind==='mountain'?mountainSprite(variant):rockSprite(variant));
  return sprites.get(key);
}
export function drawObject(g,o,player=null) {
  const s=getSprite(o.kind,o.variant||0);
  const fade=player&&o.kind!=='rock'&&o.kind!=='mountain'&&Math.abs(player.x-o.x)<55*o.scale&&player.y<o.y&&player.y>o.y-135*o.scale;
  g.save();if(fade)g.globalAlpha=.48;
  g.drawImage(s.image,o.x-s.ox*o.scale,o.y-s.oy*o.scale,s.image.width*o.scale,s.image.height*o.scale);g.restore();
}
export function drawAvatar(g,p,facing,time,moving,scene) {
  g.save();g.translate(p.x,p.y);
  ellipse(g,2,3,14,6,'#162d2d66');
  const step=moving?Math.sin(time*13):0,bob=moving?Math.abs(step)*1.3:Math.sin(time*2)*.25;
  g.translate(0,-bob);
  // Boots and legs are independently animated; the actor's collision point is at the feet.
  g.fillStyle='#303e36';g.fillRect(-8,-12+step*3,6,12);g.fillRect(3,-12-step*3,6,12);
  g.fillStyle='#5a4b38';g.fillRect(-9,-2+step*3,8,4);g.fillRect(2,-2-step*3,8,4);
  const back=facing.y<-.2,side=Math.abs(facing.x)>.6;
  poly(g,[[-10,-33],[-16,-9],[-5,-12],[1,-7],[13,-12],[10,-32]],'#a65442');
  poly(g,[[-10,-33],[-12,-13],[-2,-14],[1,-8],[3,-30]],'#c96d4d');
  poly(g,[[-8,-31],[8,-31],[9,-15],[-8,-15]],'#547568');
  if(back){g.fillStyle='#ae976b';g.fillRect(-7,-31,15,17);g.fillStyle='#d8c596';g.fillRect(-7,-30,15,5);g.strokeStyle='#594f3c';g.strokeRect(-7,-31,15,17);g.fillStyle='#77734f';g.fillRect(-8,-15,18,4);}
  else{g.fillStyle='#ded0a2';g.fillRect(-4,-31,7,14);g.fillStyle='#725841';g.fillRect(-8,-18,17,3);}
  ellipse(g,-12,-23-step*2,3,5,'#dec09a');ellipse(g,12,-23+step*2,3,5,'#dec09a');
  const fx=side?Math.sign(facing.x)*3:0;
  g.fillStyle='#d8b788';g.fillRect(-7+fx,-43,14,13);g.fillStyle='#a57851';g.fillRect(-7+fx,-43,14,4);
  if(!back){g.fillStyle='#2e3b33';g.fillRect((side?Math.sign(facing.x)*7:-3),-36,2,2);if(!side)g.fillRect(4,-36,2,2);}
  ellipse(g,fx,-42,16,4,'#6c6748');poly(g,[[-10+fx,-44],[-7+fx,-54],[6+fx,-54],[10+fx,-43]],'#bbad77');
  g.fillStyle='#776642';g.fillRect(-10+fx,-46,20,3);ellipse(g,fx-2,-54,7,2,'#d8c996');
  if(scene!=='valley'){
    g.fillStyle='#524532';g.fillRect(14,-22,2,13);ellipse(g,15,-10,5,6,'#e9b862');ellipse(g,15,-11,2.5,3,'#fff0bc');
  }
  g.restore();
}
export function drawBridge(g,b,width) {
  g.save();g.translate(b.x,b.y);
  ellipse(g,8,10,width+52,64,'#173c3e66');
  g.fillStyle='#544f3b';g.fillRect(-width-70,-72,(width+70)*2,144);
  g.fillStyle='#aa9060';g.fillRect(-width-70,-61,(width+70)*2,122);
  for(let x=-width-65;x<width+65;x+=18){g.fillStyle=(Math.floor(x/18)%3)?'#c1a979':'#b6a174';g.fillRect(x,-60,16,120);line(g,[[x+4,-46],[x+5,43]],'#786e4b44',1);}
  for(const y of [-74,76]){
    g.fillStyle='#56543c';g.fillRect(-width-82,y-7,(width+82)*2,9);
    g.fillStyle='#d6c599';g.fillRect(-width-82,y-12,(width+82)*2,4);
    for(let x=-width-75;x<=width+75;x+=90){g.fillStyle='#796d4a';g.fillRect(x-4,y-22,9,30);g.fillStyle='#e2cea0';g.fillRect(x-5,y-25,11,5);}
  }
  g.restore();
}
export function drawCamp(g,x,y,time) {
  g.save();g.translate(x,y);
  ellipse(g,-18,-48,71,19,'#314e3044');
  poly(g,[[-87,-40],[-38,-110],[15,-45]],'#d5bb81');poly(g,[[-38,-110],[28,-105],[77,-42],[15,-45]],'#b39b65');
  poly(g,[[-87,-40],[-38,-110],[15,-45],[-20,-39]],'#e1cea0');
  poly(g,[[-56,-40],[-38,-90],[-16,-40]],'#31463b');line(g,[[-38,-117],[-38,-92]],'#685a3e',4);
  line(g,[[28,-109],[77,-43],[93,-29]],'#635f45',1.5);line(g,[[-40,-108],[-92,-31],[-103,-29]],'#635f45',1.5);
  // Bedroll, a crate, and a stone fire ring. All decorative, not interactive resources yet.
  g.fillStyle='#687f66';g.fillRect(-61,-22,48,14);ellipse(g,-57,-15,5,7,'#b2b386');g.fillStyle='#9b8055';g.fillRect(35,-9,29,20);line(g,[[35,-7],[64,9],[35,9],[64,-7]],'#d1af78',2);
  const fx=15,fy=71;ellipse(g,fx,fy+2,26,11,'#40584266');
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2;ellipse(g,fx+Math.cos(a)*23,fy+Math.sin(a)*12,5,3.6,'#a1a791');}
  line(g,[[fx-15,fy-2],[fx+13,fy+6]],'#65513a',6);line(g,[[fx+13,fy-2],[fx-13,fy+6]],'#7d5736',5);
  poly(g,[[fx-8,fy+2],[fx-9,fy-7],[fx-3,fy-20-Math.sin(time*7)*3],[fx+1,fy-9],[fx+6,fy-17],[fx+10,fy-2],[fx+4,fy+4]],'#e19a4d');
  poly(g,[[fx-4,fy+1],[fx-1,fy-12],[fx+5,fy],[fx+1,fy+3]],'#f8d893');
  for(let i=0;i<4;i++){const p=(time*.2+i*.25)%1;ellipse(g,fx+Math.sin(time+i)*p*15,fy-22-p*69,4+p*7,3+p*5,`rgba(208,213,183,${(1-p)*.15})`);}
  // Sign beside the camp.
  g.fillStyle='#706043';g.fillRect(107,-57,6,27);g.fillStyle='#c0a878';g.fillRect(88,-72,44,19);g.strokeStyle='#726745';g.strokeRect(88,-72,44,19);
  line(g,[[96,-64],[124,-64],[119,-68]],'#595c40',1.5);
  g.restore();
}
export function drawCaveEntrance(g,c,time) {
  drawObject(g,{x:c.x-38,y:c.y-70,kind:'mountain',variant:1,scale:1.05});
  g.save();g.translate(c.x,c.y);
  ellipse(g,0,17,73,20,'#243e3444');
  poly(g,[[-68,13],[-60,-49],[-31,-76],[26,-73],[58,-39],[68,13]],'#738778');
  poly(g,[[-49,14],[-44,-34],[-22,-57],[18,-55],[42,-32],[47,14]],'#162b2b');
  poly(g,[[-31,12],[-27,-25],[-10,-41],[13,-33],[31,13]],'#0c1e24');
  line(g,[[-66,11],[-60,-48],[-29,-74],[25,-71]],'#aab199',5);
  poly(g,[[-71,16],[-82,4],[-66,-19],[-48,-13],[-51,15]],'#9baa8b');
  poly(g,[[49,14],[42,-15],[65,-23],[81,2],[71,17]],'#7a9280');
  for(const x of [-76,73]){g.fillStyle='#5d4d32';g.fillRect(x,-20,5,30);ellipse(g,x+2,-26,5,7,'#dda867');ellipse(g,x+1,-27,2.5,4,'#f5df99');}
  const glow=g.createRadialGradient(0,-9,2,0,-9,40);glow.addColorStop(0,c.tint+'20');glow.addColorStop(1,c.tint+'00');g.fillStyle=glow;g.fillRect(-40,-49,80,80);
  g.restore();
}
export function drawCaveObject(g,o,tint) {
  g.save();g.translate(o.x,o.y);g.scale(o.scale,o.scale);ellipse(g,4,4,23,9,'#071b2255');
  if(o.kind==='crystal') {
    const grad=g.createRadialGradient(0,-10,0,0,-10,60);grad.addColorStop(0,tint+'32');grad.addColorStop(1,tint+'00');g.fillStyle=grad;g.fillRect(-60,-70,120,120);
    poly(g,[[-18,2],[-26,-28],[-15,-38],[-6,-26],[-6,4]],tint);poly(g,[[-8,5],[-7,-44],[2,-56],[13,-41],[10,4]],tint);poly(g,[[9,5],[16,-27],[26,-31],[30,-21],[20,6]],tint);
    poly(g,[[2,-56],[2,-5],[10,4],[13,-41]],'#ffffff48');poly(g,[[-26,-28],[-18,-22],[-15,-38]],'#ffffff88');
    line(g,[[2,-48],[2,-6]],'#edf8ec88',1.5);
  } else {
    poly(g,[[-22,3],[-12,-34],[-5,-46],[5,-16],[10,-29],[24,1],[10,8]],'#52616b');
    poly(g,[[-22,3],[-12,-34],[-5,-46],[-4,-4]],'#7c8586');line(g,[[-5,-42],[-2,-13]],'#a5aba144',2);
  }
  g.restore();
}
