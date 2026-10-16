/** Original palette-limited pixel artwork. Two world units are one art pixel. */
import { hash, noise, terrain, waterDistance, ridgeValue, clamp } from './world.js';
import { bodySignals } from './interoception.js';
import { habitatConditions } from './ecology-regions.js';

export const ART_PIXEL = 2;
export function canvas(w, h) { const c=document.createElement('canvas');c.width=Math.ceil(w);c.height=Math.ceil(h);return c; }
const snap = n => Math.round(n / ART_PIXEL) * ART_PIXEL;
function rect(g,x,y,w,h,color){g.fillStyle=color;g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function pixelPoly(g,pts,color,unit=1){
  if(!color)return;g.fillStyle=color;
  const top=Math.floor(Math.min(...pts.map(p=>p[1]))/unit),bottom=Math.ceil(Math.max(...pts.map(p=>p[1]))/unit);
  for(let row=top;row<bottom;row++){
    const y=(row+.5)*unit,xs=[];
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const a=pts[j],b=pts[i];if((a[1]>y)===(b[1]>y))continue;
      xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    for(let i=0;i<xs.length;i+=2){const x=Math.ceil(xs[i]/unit-.5),end=Math.ceil(xs[i+1]/unit-.5);if(end>x)g.fillRect(x*unit,row*unit,(end-x)*unit,unit);}
  }
}
function pixelOval(g,x,y,rx,ry,color,unit=1){
  g.fillStyle=color;ry=Math.max(ry,unit/2);rx=Math.max(rx,unit/2);
  for(let row=Math.floor((y-ry)/unit);row<Math.ceil((y+ry)/unit);row++){
    const dy=((row+.5)*unit-y)/ry;if(Math.abs(dy)>1)continue;
    const half=rx*Math.sqrt(1-dy*dy),left=Math.ceil((x-half)/unit-.5),right=Math.ceil((x+half)/unit-.5);
    if(right>left)g.fillRect(left*unit,row*unit,(right-left)*unit,unit);
  }
}
function pixelLine(g,pts,color,width=1,unit=1){
  g.fillStyle=color;const size=Math.max(1,Math.round(width/unit));
  for(let i=1;i<pts.length;i++){
    let x=Math.round(pts[i-1][0]/unit),y=Math.round(pts[i-1][1]/unit);const bx=Math.round(pts[i][0]/unit),by=Math.round(pts[i][1]/unit);
    const dx=Math.abs(bx-x),dy=-Math.abs(by-y),sx=x<bx?1:-1,sy=y<by?1:-1;let error=dx+dy;
    for(;;){g.fillRect((x-Math.floor(size/2))*unit,(y-Math.floor(size/2))*unit,size*unit,size*unit);if(x===bx&&y===by)break;const e=2*error;if(e>=dy){error+=dy;x+=sx;}if(e<=dx){error+=dx;y+=sy;}}
  }
}
export function poly(g,pts,fill,stroke=null,width=1){pixelPoly(g,pts,fill,ART_PIXEL);if(stroke)pixelLine(g,[...pts,pts[0]],stroke,width,ART_PIXEL);}
export function ellipse(g,x,y,rx,ry,fill){pixelOval(g,x,y,rx,ry,fill,ART_PIXEL);}
export function line(g,pts,stroke,width=1){pixelLine(g,pts,stroke,width,ART_PIXEL);}
const PALETTES={
  meadow:['#78a743','#80ae49','#89b651','#73a03e','#92bb57'],
  forest:['#568439','#5f8f3e','#659545','#4f7d35','#6c9a47'],
  meadow_dry_meadow:['#929d57','#9ca562','#a8ad6c','#86944e','#b1b576'],
  meadow_cool_upland:['#718d78','#799581','#849e88','#698571','#8fa78e'],
  meadow_riparian:['#63a36b','#70ae75','#7bb87c','#5a9963','#86bf86'],
  forest_cool_upland:['#436c63','#4c776b','#568173','#3e665d','#638d7b'],
  forest_riparian:['#407b5c','#4b8864','#55926a','#377352','#629b73'],
  forest_woodland:['#3e6c38','#487940','#518347','#376334','#5b8c4b'],
  trail:['#d3ab70','#d9b57b','#cda36a','#dfbd86','#c79b62'],
  shore:['#d9bc7c','#e0c68e','#cfb16e','#e6cd97','#d4b676'],
  water:['#378cab','#3b93b1','#3485a5','#4299b4','#30809e'],
  shallows:['#68b9b8','#72c3bf','#5db0b2','#80c8c0','#63b5b7'],
  scree:['#a3a084','#aea98b','#969980','#b7ae8e','#8c927b'],
  mountain:['#626c72','#717980','#566169','#7a8185','#515b62'],
  bridge:['#be925a','#cba069','#ab814d','#d7ac70','#b28954'],
};
function rgb(hex){return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
const RGB_PALETTES=Object.fromEntries(Object.entries(PALETTES).map(([key,colors])=>[key,colors.map(rgb)]));
function paletteIndex(x,y){return Math.floor(clamp(noise(x,y,96,571)*4+noise(x,y,670,339)*2-1,0,4));}
const landType=type=>type==='meadow'||type==='forest';
const landPalette=(type,kind)=>RGB_PALETTES[`${type}_${kind}`]||RGB_PALETTES[type];
function chunkHabitat(x,y,cache,model){
  // Chunk art samples 32-unit cells; physical terrain and collision still use exact coordinates.
  const gx=Math.floor(x/32),gy=Math.floor(y/32),key=`${gx},${gy}`;
  if(!cache.has(key))cache.set(key,habitatConditions({x:(gx+.5)*32,y:(gy+.5)*32},model));
  return cache.get(key);
}
function atlasMark(x,y,kind){
  // Place a small mark within each cell, rather than recoloring the entire
  // cell into a square that dominates the atlas when zoomed in.
  if(kind==='meadow')return null;
  const unit=240,gx=Math.floor(x/unit),gy=Math.floor(y/unit),h=hash(gx,gy,7761);
  if(kind==='dry_meadow'&&h<=.3||kind==='cool_upland'&&h<=.4||
    kind==='riparian'&&h<=.35||kind==='woodland'&&h<=.25)return null;
  const dx=x-gx*unit-52-hash(gx,gy,7762)*136;
  const dy=y-gy*unit-52-hash(gx,gy,7763)*136;
  if(kind==='dry_meadow'&&Math.abs(dx)<46&&Math.abs(dy)<7)return '#c5be81';
  if(kind==='cool_upland'&&Math.abs(dx)<42&&Math.abs(dy+dx*.33)<7)return '#a2aea0';
  if(kind==='riparian'&&Math.abs(dx)<8&&Math.abs(dy)<38)return '#9ac893';
  if(kind==='woodland'&&(dx/34)**2+(dy/18)**2<1)return '#2d5933';
  return null;
}
export function groundColor(x,y,map=false,model=0){
  const type=terrain(x,y),site=landType(type)?habitatConditions({x,y},model):null;
  const colors=site?landPalette(type,site.kind):RGB_PALETTES[type],shade=paletteIndex(x,y);
  if(map&&type==='mountain'&&Math.sin(ridgeValue(x,y)*34+noise(x,y,850,993)*5)>.72)return RGB_PALETTES.mountain[3];
  if(map&&site){const mark=atlasMark(x,y,site.kind);if(mark)return rgb(mark);}
  return colors[shade];
}
export function makeGroundChunk(cx,cy,size,model=0){
  const out=canvas(size/ART_PIXEL,size/ART_PIXEL),g=out.getContext('2d'),s=out.width,image=g.createImageData(s,s),originX=cx*size,originY=cy*size,sites=new Map();
  // Sample the physical terrain at four world units; a small stepped edge follows the same collision boundary.
  for(let py=0;py<s;py+=2)for(let px=0;px<s;px+=2){
    const x=originX+px*ART_PIXEL+2,y=originY+py*ART_PIXEL+2,type=terrain(x,y),d=waterDistance(x,y);
    const site=landType(type)?chunkHabitat(x,y,sites,model):null;
    let color=(site?landPalette(type,site.kind):RGB_PALETTES[type])[paletteIndex(x,y)];
    if(type==='shore'&&d<8)color=rgb('#a48954');
    else if(type==='shallows'&&d>-9)color=rgb('#c2dbba');
    else if(type==='water'&&d>-57)color=rgb('#85cfca');
    else if((type==='meadow'||type==='forest')&&terrain(x,y-4)==='trail')color=rgb('#5b7e38');
    else if(type==='mountain'){
      const level=Math.floor(y/20),block=Math.floor((x+(level%2)*24)/48),crack=((Math.floor(y)%20+20)%20)<4;
      color=RGB_PALETTES.mountain[Math.floor(hash(block,level,411)*4)];if(crack)color=rgb('#48535d');
    }
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){if(px+dx>=s||py+dy>=s)continue;const i=((py+dy)*s+px+dx)*4;image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=255;}
  }
  g.putImageData(image,0,0);
  const spacing=32;
  for(let ty=Math.floor(originY/spacing);ty<=Math.ceil((originY+size)/spacing);ty++)for(let tx=Math.floor(originX/spacing);tx<=Math.ceil((originX+size)/spacing);tx++){
    const h=hash(tx,ty,705),wx=tx*spacing+4+Math.floor(hash(tx,ty,791)*23),wy=ty*spacing+4+Math.floor(hash(tx,ty,845)*23),x=Math.floor((wx-originX)/ART_PIXEL),y=Math.floor((wy-originY)/ART_PIXEL),type=terrain(wx,wy);
    if(landType(type)){
      // Ground details are decorative, never resource or forage markers.
      // Keep their few pixels inside the sampled terrain class at boundaries.
      if(terrain(wx-24,wy-14)!==type||terrain(wx+24,wy-14)!==type||
        terrain(wx-24,wy+12)!==type||terrain(wx+24,wy+12)!==type)continue;
      const kind=chunkHabitat(wx,wy,sites,model).kind;
      if(kind==='dry_meadow'){
        rect(g,x-3,y+1,4,1,'#bdb77b');
        if(h>.34){rect(g,x-1,y-2,1,3,'#777d45');rect(g,x+2,y-1,1,2,'#d2c487');}
        if(h>.78){rect(g,x+5,y+3,3,1,'#786f58');rect(g,x+6,y+2,1,1,'#ccc096');}
      }else if(kind==='cool_upland'){
        rect(g,x-3,y+1,5,1,'#526f68');
        if(h>.23){rect(g,x-1,y-3,1,3,'#a3b29a');rect(g,x+2,y-2,1,2,'#5a7f71');}
        if(h>.66){rect(g,x+5,y+3,4,1,'#a7a99a');rect(g,x+6,y+2,2,1,'#5f7774');}
      }else if(kind==='riparian'){
        rect(g,x-2,y+1,5,1,'#3f8055');
        rect(g,x-2,y-3,1,4,'#a3c67d');rect(g,x+1,y-5,1,6,'#568f5d');
        if(h>.38){rect(g,x+4,y-4,1,5,'#bfce88');rect(g,x+5,y-5,1,2,'#826e4d');}
        if(h>.79)rect(g,x-5,y+3,7,1,'#97bc81');
      }else if(kind==='woodland'){
        rect(g,x-5,y+3,9,2,'#345c32');
        rect(g,x-2,y-2,1,4,'#729b54');rect(g,x-4,y-3,3,1,'#7daa61');rect(g,x,y-4,3,1,'#6b9651');
        if(h>.32){rect(g,x+4,y+4,7,1,'#284f30');rect(g,x+5,y+2,2,1,'#a2a46c');}
      }else{
        const dark=type==='forest'?'#3e692f':'#5b8a35',light=type==='forest'?'#87aa50':'#b1cc64';
        rect(g,x-2,y,4,1,dark);rect(g,x-2,y-2,1,2,dark);rect(g,x,y-3,1,3,light);rect(g,x+2,y-1,1,2,light);
        if(h>.54){rect(g,x+5,y+4,3,1,light);rect(g,x+6,y+2,1,2,dark);}
        if(h>.943){rect(g,x,y-3,1,4,'#4e8038');const petal=h>.982?'#d587a7':h>.966?'#faf0b6':'#f6d36b';rect(g,x-1,y-4,3,1,petal);rect(g,x,y-5,1,3,petal);rect(g,x,y-4,1,1,'#b78c45');}
        if(h<.026){pixelOval(g,x,y,3,2,'#59864c');rect(g,x-2,y-1,3,1,'#b1bd79');}
      }
    }else if(type==='trail'||type==='shore'||type==='scree'){
      rect(g,x,y,2+(h>.6?1:0),1,type==='scree'?'#747d6f':'#b69059');if(h>.75)rect(g,x-1,y-1,2,1,type==='scree'?'#c5b99b':'#ecd3a0');
      if(type==='shore'&&h>.67&&waterDistance(wx,wy)<46){rect(g,x,y-5,1,6,'#577d43');rect(g,x+2,y-7,1,8,'#6a8b42');rect(g,x+2,y-8,1,3,'#866941');}
    }else if(type==='water'&&h>.74){rect(g,x,y,6,1,'#67b8c5');rect(g,x+7,y+2,3,1,'#2d7f9e');}
  }
  return out;
}
function oakSprite(variant){
  const c=canvas(72,88),g=c.getContext('2d');g.translate(36,77);
  pixelOval(g,4,3,23,6,'#233e2b55');
  pixelPoly(g,[[-4,0],[-3,-35],[3,-37],[4,-4],[8,1],[3,3],[-2,1],[-7,3]],'#473e2c');
  rect(g,-2,-33,3,31,'#8d693b');rect(g,-2,-32,1,25,'#c59450');rect(g,1,-21,1,18,'#654d32');
  pixelLine(g,[[-1,-18],[-10,-31]],'#5c492f',3);pixelLine(g,[[2,-23],[12,-39]],'#70512f',3);
  const dark=variant===4?'#365329':'#254b2f',mid=variant===4?'#617d33':'#47782f',light=variant===4?'#8eaa43':'#6d9c3c',bright=variant===4?'#becd66':'#a0bc50';
  const groups=[[-18,-33,14,11],[16,-35,15,12],[-3,-27,16,10],[-24,-48,12,13],[23,-51,11,12],[-1,-61,18,14],[-11,-50,17,14],[11,-51,14,13]];
  for(let i=0;i<groups.length;i++){
    const [x,y,rx,ry]=groups[i];pixelOval(g,x+1,y+2,rx+1,ry+1,dark);pixelOval(g,x,y-1,rx,ry,mid);pixelOval(g,x-2,y-3,rx-2,ry-3,light);
    pixelPoly(g,[[x-rx+3,y-3],[x-rx+5,y-7],[x-4,y-ry+2],[x+4,y-ry+2],[x+8,y-ry+5],[x+2,y-5],[x-5,y-2]],bright);
    for(let j=0;j<12;j++){const px=x-rx+3+Math.floor(hash(i,j,127+variant)*Math.max(1,rx*2-6)),py=y-ry+4+Math.floor(hash(i,j,329)*Math.max(1,ry*2-8));if(((px-x)/rx)**2+((py-y)/ry)**2>.77)continue;rect(g,px,py,2+(j%3===0?1:0),1,j%4===0?bright:j%3===0?dark:light);}
  }
  return{image:c,ox:36,oy:77};
}
function pineSprite(variant){
  const c=canvas(62,94),g=c.getContext('2d');g.translate(31,85);pixelOval(g,4,3,23,5,'#233e2b55');
  rect(g,-3,-35,6,36,'#4c402e');rect(g,-1,-35,2,36,'#b17e40');
  const base=variant===2?'#24554c':'#285434',mid=variant===2?'#397c66':'#427e3a',light=variant===2?'#62a284':'#81a94d';
  for(let k=0;k<5;k++){
    const y=-7-k*13,w=27-k*4,top=y-30;
    pixelPoly(g,[[0,top],[-5,y-21],[-3,y-21],[-w+5,y-5],[-w+8,y-5],[-w,y+1],[-10,y+2],[-7,y+5],[4,y+5],[8,y+2],[w,y+1],[w-8,y-6],[w-5,y-5],[5,y-21],[3,y-21]],base);
    pixelPoly(g,[[0,top],[-5,y-21],[-3,y-21],[-w+6,y-4],[-w+11,y-5],[-w+5,y],[0,y+1],[4,y-9]],mid);
    pixelPoly(g,[[0,top],[-4,y-22],[-2,y-22],[-w+12,y-8],[-w+16,y-9],[-3,y-11],[1,y-17]],light);
    for(let i=0;i<4;i++)rect(g,-w+8+i*5,y-2-(i%2)*4,3,1,k%2?'#659646':mid);
  }
  return{image:c,ox:31,oy:85};
}
function rockSprite(variant){
  const c=canvas(52,41),g=c.getContext('2d');g.translate(26,33);pixelOval(g,3,3,20,5,'#28402e55');
  pixelPoly(g,[[-21,0],[-17,-14],[-7,-23],[9,-22],[20,-12],[20,0],[8,5],[-12,4]],'#4d6165');
  pixelPoly(g,[[-20,-1],[-16,-14],[-7,-22],[1,-10],[-1,1]],'#91a292');
  pixelPoly(g,[[-7,-22],[9,-21],[19,-12],[1,-10]],'#bbc0a3');
  pixelPoly(g,[[1,-10],[19,-12],[19,-1],[8,4],[-1,1]],'#738780');
  pixelLine(g,[[-14,-13],[-7,-9],[-9,-3]],'#6b8076');rect(g,4,-8,5,1,'#93a292');rect(g,13,-5,3,1,'#4e6666');
  if(variant%2===0){pixelOval(g,-11,0,8,2,'#608845');rect(g,-15,-4,4,2,'#9cad62');}
  return{image:c,ox:26,oy:33};
}
function mountainSprite(variant){
  const c=canvas(210,150),g=c.getContext('2d');g.translate(105,129);pixelOval(g,4,5,96,12,'#263b3544');
  const top=-115-variant*3;
  pixelPoly(g,[[-103,6],[-97,-25],[-81,-27],[-81,-55],[-67,-55],[-67,-79],[-40,-80],[-40,top+13],[-16,top+13],[-16,top],[20,top],[20,top+17],[51,top+17],[51,-73],[69,-73],[69,-49],[87,-49],[87,-24],[100,-24],[103,8],[54,17],[-66,17]],'#46545b');
  const shelves=[[-97,-21,196,24],[-81,-51,168,27],[-67,-76,135,23],[-40,top+17,92,22],[-16,top+1,36,17]];
  for(let k=0;k<shelves.length;k++){
    const [x,y,w,h]=shelves[k];rect(g,x,y,w,h,'#6e7b7c');rect(g,x,y,w,3,'#b1b5a0');rect(g,x+4,y+3,Math.floor(w*.38),h-5,'#88958d');rect(g,x+Math.floor(w*.62),y+5,Math.floor(w*.38)-4,h-5,'#546770');
    for(let col=0;col<w;col+=17){const offset=(k%2)*7;rect(g,x+col+offset,y+3,1,h-3,'#4c6068');rect(g,x+col+offset+2,y+4,7,1,'#99a196');}
    rect(g,x+4,y+h-2,w-7,2,'#3f525a');
  }
  for(let i=0;i<26;i++){const x=-93+Math.floor(hash(i,variant,529)*188),y=-15+Math.floor(hash(i,variant,837)*30);rect(g,x,y,3+(i%4),2,i%3?'#738b67':'#a4ad80');}
  return{image:c,ox:105,oy:129};
}
const sprites=new Map();
export function getSprite(kind,variant=0){const key=kind+variant;if(!sprites.has(key))sprites.set(key,kind==='oak'?oakSprite(variant):kind==='pine'?pineSprite(variant):kind==='mountain'?mountainSprite(variant):rockSprite(variant));return sprites.get(key);}
export function drawObject(g,o,player=null){
  const s=getSprite(o.kind,o.variant||0),scale=Math.round((o.scale||1)*4)/4,w=s.image.width*ART_PIXEL*scale,h=s.image.height*ART_PIXEL*scale;
  const fade=player&&o.kind!=='rock'&&o.kind!=='mountain'&&Math.abs(player.x-o.x)<w*.43+16&&player.y<o.y+4&&player.y>o.y-s.oy*ART_PIXEL*scale-40;
  g.save();g.imageSmoothingEnabled=false;if(fade)g.globalAlpha=.45;g.drawImage(s.image,snap(o.x-s.ox*ART_PIXEL*scale),snap(o.y-s.oy*ART_PIXEL*scale),snap(w),snap(h));g.restore();
}
function drawPerson(g,facing,frame,npc=false,flask=0,collapsed=false,scene='valley',identity='aster',posture='awake'){
  const back=facing.y<-.2,side=Math.abs(facing.x)>.6,left=facing.x<0,step=frame===1?-1:frame===3?1:0;
  const mira=npc&&identity==='mira',resting=['resting','sleeping','dozing'].includes(posture);
  const outline='#2e3a35',pants=npc?(mira?'#655452':'#354e57'):'#3c5360',cloth=npc?(mira?'#806b93':'#62864d'):'#b86949',light=npc?(mira?'#b29cc4':'#98b46a'):'#dc9a60',skin=mira?'#dcb593':'#e3bd8c',hair=npc?(mira?'#9a593f':'#73513c'):'#75533b';
  if(collapsed){g.translate(8,0);g.rotate(-Math.PI/2);}
  if(resting&&!collapsed)g.translate(0,6);
  if(resting){rect(g,-9,-6,8,4,outline);rect(g,1,-6,8,4,outline);rect(g,-8,-6,6,2,pants);rect(g,2,-6,6,2,pants);rect(g,-10,-3,5,2,'#503e32');rect(g,6,-3,5,2,'#503e32');}
  else{rect(g,-5,-7+step,4,7,outline);rect(g,2,-7-step,4,7,outline);rect(g,-4,-7+step,2,5,pants);rect(g,3,-7-step,2,5,pants);rect(g,-5,-1+step,4,2,'#503e32');rect(g,2,-1-step,4,2,'#503e32');}
  pixelPoly(g,[[-5,-17],[-7,-12],[-6,-5],[-3,-4],[5,-5],[7,-12],[5,-17]],outline);
  rect(g,-5,-17,10,11,cloth);rect(g,-4,-16,3,9,light);rect(g,-4,-6,9,1,'#5b4732');rect(g,0,-6,2,1,'#d4b56c');
  const arm=step?(step>0?1:-1):0;rect(g,-7,-15+arm,2,7,cloth);rect(g,6,-15-arm,2,7,cloth);rect(g,-7,-9+arm,2,3,skin);rect(g,6,-9-arm,2,3,skin);
  if(back){rect(g,-4,-16,8,9,npc?(mira?'#76664d':'#3f5860'):'#9c8053');rect(g,-3,-15,6,2,npc?(mira?'#b6a17a':'#698b94'):'#d8bd7c');rect(g,-3,-11,6,1,'#2d3e3a');rect(g,-4,-14,1,7,'#d3b582');}
  else{rect(g,-1,-15,3,7,npc?(mira?'#dfc8a5':'#c8d3a1'):'#f0d5a1');rect(g,-1,-9,3,1,mira?'#8a7375':'#6b794c');}
  const fx=side?(left?-1:1):0;rect(g,-5+fx,-25,10,10,outline);rect(g,-4+fx,-24,8,8,skin);rect(g,-4+fx,-17,8,1,'#c79364');
  rect(g,-5+fx,-25,10,4,hair);rect(g,-5+fx,-21,2,5,hair);if(back){rect(g,-4+fx,-22,8,6,hair);rect(g,-3+fx,-24,6,1,mira?'#cb8960':'#9a6b49');}
  else{if(!side){rect(g,-2,-20,posture==='sleeping'?2:1,posture==='sleeping'?1:2,outline);rect(g,2,-20,posture==='sleeping'?2:1,posture==='sleeping'?1:2,outline);}else rect(g,left?-4:4,-20,posture==='sleeping'?2:1,posture==='sleeping'?1:2,outline);rect(g,fx,-17,2,1,'#a57851');}
  if(mira){rect(g,4+fx,-22,2,9,hair);rect(g,5+fx,-14,2,2,'#c59067');rect(g,5+fx,-20,1,5,'#c77850');}
  if(npc){rect(g,-4+fx,-25,6,1,mira?'#d59567':'#a47850');rect(g,5,-11,3,5,flask>.01?'#6aadc3':'#725d43');rect(g,6,-12,1,2,'#d0ac63');rect(g,6,-9,1,2,flask>.01?'#bce2d7':'#a28b65');}
  else{rect(g,-8+fx,-24,16,2,'#5f5939');rect(g,-5+fx,-29,10,5,'#ad9553');rect(g,-4+fx,-29,7,1,'#d7bb6b');rect(g,-5+fx,-25,10,1,'#6c5534');}
  if(scene!=='valley'){rect(g,7,-14,1,9,'#8b6440');pixelPoly(g,[[6,-14],[5,-17],[7,-22],[10,-17],[9,-14]],'#eaa24c');rect(g,7,-19,1,3,'#ffe59b');}
}
export function drawAvatar(g,p,facing,time,moving,scene){
  g.save();g.translate(snap(p.x),snap(p.y));g.scale(ART_PIXEL,ART_PIXEL);pixelOval(g,0,2,7,3,'#203b2e55');drawPerson(g,facing,moving?Math.floor(time*7)%4:0,false,0,false,scene);g.restore();
}
export function drawBridge(g,b,width){
  g.save();g.translate(snap(b.x),snap(b.y));g.scale(ART_PIXEL,ART_PIXEL);const half=Math.round((width+76)/ART_PIXEL);
  rect(g,-half-4,-36,half*2+8,73,'#4e5842');rect(g,-half,-30,half*2,61,'#ad7f4a');
  for(let x=-half;x<half;x+=8){rect(g,x,-30,7,60,(Math.floor(x/8)%3)?'#c29a62':'#d1ac70');rect(g,x,-29,7,1,'#e6c48a');rect(g,x+2,-21,1,34,'#ac7d48');rect(g,x+4,17,2,1,'#8f663f');}
  for(const y of [-35,35]){rect(g,-half-7,y,half*2+14,4,'#544731');rect(g,-half-7,y,half*2+14,1,'#d9b47b');for(let x=-half+1;x<half;x+=30){rect(g,x,y-10,4,13,'#785333');rect(g,x,y-10,1,11,'#c69b61');rect(g,x-1,y-11,6,2,'#eccb93');}}
  g.restore();
}
export function drawCamp(g,x,y,time){
  g.save();g.translate(snap(x),snap(y));g.scale(ART_PIXEL,ART_PIXEL);pixelOval(g,-8,-19,40,8,'#40542e44');
  pixelPoly(g,[[-47,-19],[-22,-60],[-6,-62],[23,-20]],'#504d33');pixelPoly(g,[[-45,-21],[-21,-58],[4,-21]],'#dec27d');pixelPoly(g,[[-21,-58],[-6,-60],[23,-21],[4,-21]],'#aa925a');
  pixelPoly(g,[[-40,-22],[-21,-53],[-2,-22]],'#eed392');pixelPoly(g,[[-30,-21],[-21,-49],[-10,-21]],'#443e30');pixelPoly(g,[[-24,-22],[-21,-41],[-15,-22]],'#242e27');
  pixelLine(g,[[-21,-61],[-21,-54]],'#62553a',2);pixelLine(g,[[-6,-61],[25,-20],[34,-14]],'#807044');pixelLine(g,[[-21,-57],[-48,-16],[-52,-16]],'#8f7b4b');
  for(let i=0;i<4;i++)rect(g,-18+i*6,-49+i*7,2,1,'#cfb278');
  rect(g,-37,-8,26,8,'#3f6857');rect(g,-35,-7,22,1,'#8dab76');rect(g,-36,-6,3,5,'#c1bb88');rect(g,-34,-1,22,1,'#304e40');
  rect(g,19,-5,16,12,'#66492e');rect(g,20,-4,14,10,'#ad8249');rect(g,20,-4,14,1,'#d1aa69');rect(g,22,-3,2,9,'#694d32');rect(g,30,-3,2,9,'#694d32');pixelLine(g,[[24,-3],[30,4]],'#d0a666');
  const fx=6,fy=36;pixelOval(g,fx,fy+2,14,5,'#29432f55');for(let i=0;i<9;i++){const a=i/9*Math.PI*2;pixelOval(g,Math.round(fx+Math.cos(a)*12),Math.round(fy+Math.sin(a)*6),3,2,i%2?'#a7ad8c':'#6f8268');}
  pixelLine(g,[[fx-8,fy],[fx+6,fy+4]],'#60432d',3);pixelLine(g,[[fx+6,fy-1],[fx-6,fy+4]],'#98623a',2);
  const flame=Math.floor(time*5)%3;pixelPoly(g,[[fx-4,fy+1],[fx-5,fy-4],[fx-1,fy-12-flame],[fx+1,fy-5],[fx+4,fy-9+flame],[fx+5,fy],[fx+2,fy+2]],'#e99742');pixelPoly(g,[[fx-2,fy+1],[fx,fy-7],[fx+3,fy],[fx+1,fy+2]],'#ffe18a');
  rect(g,55,-30,3,15,'#654d32');rect(g,44,-39,25,11,'#624a31');rect(g,45,-38,23,9,'#d9b675');rect(g,46,-37,21,1,'#efd092');pixelLine(g,[[49,-33],[62,-33],[59,-35]],'#765633');
  g.restore();
}
function drawRefugeBluff(g,c){
  g.save();g.translate(snap(c.x),snap(c.y));g.scale(ART_PIXEL,ART_PIXEL);
  // This stepped bluff occupies the same clearing as caveMountain's physical outcrop.
  pixelPoly(g,[[-35,45],[-63,35],[-85,18],[-105,-5],[-117,-37],[-121,-65],[-114,-95],[-99,-123],[-76,-147],[-48,-162],[-22,-170],[24,-170],[55,-160],[80,-143],[100,-121],[115,-94],[122,-63],[116,-32],[106,-6],[84,21],[60,36],[35,45],[35,-18],[-35,-18]],'#465b60');
  const shelves=[[-46,-161,94,14],[-73,-142,146,17],[-96,-122,191,18],[-109,-101,219,18],[-116,-78,233,18],[-116,-55,233,19],[-109,-31,219,15]];
  for(let i=0;i<shelves.length;i++){
    const [x,y,w,h]=shelves[i];rect(g,x,y,w,h,i%2?'#718780':'#809087');rect(g,x,y,w,2,'#b3b9a0');rect(g,x+2,y+3,Math.floor(w*.45),h-5,'#8f9d8c');rect(g,x+Math.floor(w*.68),y+3,Math.floor(w*.32)-2,h-4,'#586e73');rect(g,x+2,y+h-2,w-4,2,'#405960');
    for(let k=8;k<w-6;k+=21){rect(g,x+k+(i%2)*5,y+3,1,h-5,'#526d70');rect(g,x+k+3,y+4,7,1,'#acb49b');}
    for(let k=0;k<8;k++){const mx=x+4+Math.floor(hash(k,i,772)*(w-9)),my=y+4+Math.floor(hash(k,i,614)*Math.max(1,h-7));rect(g,mx,my,3,1,k%3?'#849773':'#b3b58b');}
  }
  for(const [x,y,w,h] of [[-103,-11,67,14],[36,-11,67,14],[-80,10,44,13],[36,10,44,13],[-58,27,22,10],[36,27,22,10]]){rect(g,x,y,w,h,'#71867a');rect(g,x,y,w,2,'#aab594');rect(g,x+w-5,y+3,4,h-4,'#4b6466');rect(g,x+2,y+h-2,w-3,2,'#40585a');}
  for(let i=0;i<18;i++){const x=-62+Math.floor(hash(i,0,531)*125),y=-155-Math.floor(hash(i,1,352)*13);rect(g,x,y,4+(i%4),2,'#6d8758');rect(g,x+1,y,3,1,'#a0af71');}
  pixelPoly(g,[[-111,-72],[-113,-82],[-111,-93],[-107,-101],[-104,-96],[-106,-86],[-103,-74]],'#6b855e');pixelPoly(g,[[107,-32],[111,-38],[108,-49],[103,-44],[103,-36]],'#79926a');
  g.restore();
}
export function drawCaveEntrance(g,c){
  if(c.id==='refuge')drawRefugeBluff(g,c);else drawObject(g,{x:c.x-14,y:c.y-50,kind:'mountain',variant:1,scale:.85});
  g.save();g.translate(snap(c.x),snap(c.y));g.scale(ART_PIXEL,ART_PIXEL);pixelOval(g,0,8,34,7,'#21372c66');
  pixelPoly(g,[[-36,8],[-34,-13],[-28,-28],[-17,-38],[14,-38],[27,-27],[34,-12],[36,8]],'#53646a');
  pixelPoly(g,[[-32,7],[-30,-11],[-24,-25],[-14,-33],[13,-33],[25,-23],[30,-9],[32,7]],'#929d89');
  pixelPoly(g,[[-24,7],[-24,-11],[-17,-24],[-8,-29],[9,-29],[20,-19],[25,-8],[25,7]],'#293c41');
  pixelPoly(g,[[-19,7],[-18,-10],[-10,-22],[6,-22],[17,-10],[20,7]],'#11242d');
  rect(g,-31,-8,7,2,'#b0b69a');rect(g,-23,-27,9,2,'#c0c2a6');rect(g,-10,-35,17,2,'#c6c7ac');rect(g,19,-24,7,2,'#73867d');
  pixelLine(g,[[-30,-17],[-24,-17],[-22,-27]],'#62766e');pixelLine(g,[[14,-33],[14,-27],[24,-26]],'#62766e');
  pixelPoly(g,[[-36,9],[-42,2],[-35,-8],[-24,-5],[-23,8]],'#8d9d7a');pixelPoly(g,[[24,8],[22,-4],[33,-10],[41,2],[35,9]],'#657e6b');
  for(const x of [-37,36]){rect(g,x,-10,2,17,'#755339');pixelPoly(g,[[x-2,-12],[x-3,-16],[x,-21],[x+3,-16],[x+2,-12]],'#e8a354');rect(g,x,-18,1,5,'#ffe4a2');}
  g.restore();
}
export function drawCaveObject(g,o,tint){
  g.save();g.translate(snap(o.x),snap(o.y));g.scale(ART_PIXEL*Math.round(o.scale*4)/4,ART_PIXEL*Math.round(o.scale*4)/4);pixelOval(g,1,3,13,4,'#0d212a88');
  if(o.kind==='crystal'){
    pixelPoly(g,[[-12,2],[-14,-15],[-9,-22],[-4,-15],[-3,3]],'#395f76');pixelPoly(g,[[-11,0],[-12,-15],[-9,-19],[-7,-13],[-6,1]],tint);
    pixelPoly(g,[[-5,4],[-5,-23],[0,-30],[7,-22],[6,3]],'#36576f');pixelPoly(g,[[-3,2],[-3,-23],[0,-27],[2,-22],[2,2]],tint);pixelPoly(g,[[0,-27],[2,-22],[2,2],[5,1],[5,-21]],'#b4d9dc');
    pixelPoly(g,[[6,3],[9,-14],[14,-18],[18,-11],[13,4]],'#395f76');pixelPoly(g,[[8,2],[11,-13],[14,-16],[14,-2],[12,3]],tint);rect(g,-2,-20,1,13,'#ebf2d8');rect(g,-10,-16,1,7,'#cae7da');
  }else{pixelPoly(g,[[-13,3],[-8,-18],[-3,-26],[3,-9],[6,-16],[13,2],[5,6]],'#465463');pixelPoly(g,[[-12,2],[-8,-18],[-3,-25],[-3,0]],'#8d9692');pixelPoly(g,[[-3,-25],[3,-9],[4,4],[-3,0]],'#617681');rect(g,-5,-16,1,9,'#bdc0a4');}
  g.restore();
}
/** Apples on the ground are drawn from actual finite stock, never an animation counter. */
export function drawApplePatch(g,patch,stock,capacity=patch.capacity||3){
  g.save();g.translate(snap(patch.x),snap(patch.y));g.scale(ART_PIXEL,ART_PIXEL);
  pixelOval(g,0,2,26,9,'#29452f44');
  // A low orchard understory keeps the gather point visibly accessible.
  for(const [x,y,variant] of [[-17,-8,0],[15,-6,1],[-7,6,2]]){
    pixelOval(g,x,y+2,10,5,'#2d5535');pixelOval(g,x-1,y,10,5,'#548a3b');pixelOval(g,x-3,y-2,6,3,'#91b44f');
    rect(g,x-7,y,3,1,'#acc868');rect(g,x+3,y+1,3,1,'#3e7035');rect(g,x-2,y+3,2,3,'#826542');
    if(variant!==2){rect(g,x-8,y-4,1,3,'#b3bf76');rect(g,x-9,y-4,3,1,'#e9ddb1');}
  }
  const count=Math.min(6,Math.max(0,Math.ceil(Math.max(0,stock)/Math.max(1,capacity)*Math.min(6,capacity))));
  const fruit=[[-4,-6],[13,1],[-17,5],[4,9],[22,-4],[-25,-6]];
  for(let i=0;i<count;i++){
    const [x,y]=fruit[i];pixelOval(g,x,y+3,4,2,'#2c493344');
    rect(g,x-1,y-5,1,3,'#654932');rect(g,x,y-5,3,1,'#a7bc61');
    pixelPoly(g,[[x-3,y-2],[x-1,y-3],[x+1,y-2],[x+3,y-3],[x+5,y-1],[x+4,y+3],[x+1,y+4],[x-2,y+3]],'#8e3c31');
    pixelPoly(g,[[x-2,y-2],[x,y-2],[x+1,y-1],[x+3,y-2],[x+4,y],[x+3,y+2],[x-1,y+2]],'#cf6246');
    rect(g,x-1,y-1,2,1,'#f4a16a');
  }
  if(!count){rect(g,-4,0,3,1,'#8a754a');rect(g,5,3,2,1,'#a88e56');}
  g.restore();
}
/** Decorative fauna has no inventory, decision policy, or simulation side effects. */
export function drawFauna(g,animal,time){
  const facing=animal.facing||{x:1,y:0},flip=facing.x<0?-1:1,frame=animal.moving?Math.floor(time*6)%4:0;
  g.save();g.translate(snap(animal.x),snap(animal.y));g.scale(ART_PIXEL*flip,ART_PIXEL);
  const step=frame===1?-1:frame===3?1:0;
  if(animal.kind==='fish'){
    g.globalAlpha=.7;pixelPoly(g,[[-6,0],[-3,-3],[3,-3],[6,0],[3,2],[-3,2]],'#215969');
    pixelPoly(g,[[-6,0],[-9,-3],[-9,3]],'#2e7180');rect(g,0,-2,4,1,'#78b9b4');rect(g,4,-1,1,1,'#143f50');
    if(frame===1||frame===3)rect(g,-8,0,2,1,'#6caeb0');
  }else if(animal.kind==='rabbit'){
    pixelOval(g,0,2,8,3,'#25453144');pixelOval(g,-1,-4,7,5,'#685c48');pixelOval(g,-2,-5,6,4,'#ad9e78');
    pixelOval(g,5,-7,4,4,'#c5b48a');rect(g,4,-15,2,7,'#7a654d');rect(g,5,-15,1,6,'#dbc4a0');rect(g,8,-14,2,6,'#8d7455');rect(g,8,-13,1,4,'#d6b297');
    pixelOval(g,-7,-4,2,2,'#e0d7b7');rect(g,-5,-1+step,3,2,'#d2c29e');rect(g,3,-1-step,4,2,'#d2c29e');rect(g,7,-8,1,1,'#323b2e');rect(g,9,-6,1,1,'#81664a');
  }else if(animal.kind==='deer'){
    pixelOval(g,0,2,17,4,'#24473144');pixelOval(g,-2,-15,14,7,'#694c35');pixelOval(g,-3,-17,12,5,'#b88c57');pixelOval(g,-3,-13,10,3,'#ddbd83');
    for(const [x,offset] of [[-11,step],[-5,-step],[6,-step],[11,step]]){rect(g,x,-12+offset,2,13-offset,'#705238');rect(g,x,-1,3,2,'#453f32');}
    pixelPoly(g,[[8,-15],[9,-25],[15,-29],[19,-25],[15,-18],[14,-11]],'#b98b55');pixelOval(g,17,-27,6,3,'#d1a971');rect(g,20,-27,3,2,'#63543d');rect(g,18,-28,1,1,'#343e2e');
    pixelPoly(g,[[11,-27],[8,-32],[11,-31],[15,-27]],'#9a754b');pixelPoly(g,[[17,-29],[19,-33],[21,-31],[20,-28]],'#c5a475');rect(g,-15,-21,2,5,'#e4c99a');
    for(const [x,y] of [[-10,-19],[-5,-18],[0,-20],[4,-18]])rect(g,x,y,2,1,'#e3c28a');
  }else if(animal.kind==='bird'){
    pixelOval(g,0,2,5,2,'#284c3144');pixelPoly(g,[[-5,-3],[-2,-8],[3,-7],[5,-4],[3,0],[-2,0]],'#546b66');
    pixelOval(g,2,-7,3,3,'#8bada1');rect(g,5,-7,3,1,'#d3ad68');rect(g,3,-8,1,1,'#263d36');
    pixelPoly(g,[[-3,-4],[-8,-5],[-5,-1],[0,-1]],frame===1||frame===3?'#aac3a9':'#6f9182');rect(g,-1,0,1,2,'#a78b53');rect(g,2,0,1,2,'#a78b53');
  }else{
    for(const [x,y,petal] of [[-7,0,'#eed582'],[1,-3,'#e9adbd'],[8,2,'#f0e4ba']]){rect(g,x,y-4,1,5,'#537f3e');rect(g,x-1,y-5,3,1,petal);rect(g,x,y-6,1,3,petal);rect(g,x,y-5,1,1,'#af9053');}
  }
  g.restore();
}
/** Ecology sprites reflect persisted visual state. Drawing never advances a body or resource. */
export function drawEcologyObject(g,object,time,subject=null){
  const kind=object.kind,quantity=Math.max(0,Math.floor(object.quantity||0)),stage=object.stage||'growing',dry=Number.isFinite(object.moistureRatio)&&object.moistureRatio<.3;
  if(kind==='apple_tree'&&['seedling','juvenile'].includes(stage)){
    g.save();g.translate(snap(object.x),snap(object.y));g.scale(ART_PIXEL,ART_PIXEL);
    const ratio=Math.max(0,Math.min(1,object.structureRatio||0)),height=Math.round(9+ratio*25),young=stage==='seedling';
    pixelOval(g,0,1,young?5:10,2,'#243c2b44');rect(g,-1,-height,2,height,young?'#719047':'#8e6942');
    pixelPoly(g,[[-1,-height+2],[-7,-height-1],[-7,-height+3],[-2,-height+5]],dry?'#a49b62':'#77a94c');
    pixelPoly(g,[[0,-height+3],[7,-height-3],[8,-height+1],[2,-height+6]],dry?'#c4b87b':'#9abd5d');
    if(!young){pixelLine(g,[[0,-height*.45],[-7,-height*.65]],'#8e6942',1);pixelOval(g,-8,-height*.68,5,3,dry?'#8b8156':'#658f43');pixelOval(g,4,-height-3,4,3,dry?'#c3b576':'#aecb6f');}
    g.restore();return;
  }
  if(kind==='apple_tree'&&stage!=='bare'){
    drawObject(g,{kind:'oak',x:object.x,y:object.y,variant:stage==='ripe'?4:1,scale:.82},subject);
    g.save();g.translate(snap(object.x),snap(object.y));g.scale(ART_PIXEL,ART_PIXEL);
    if(dry)for(const [x,y] of [[-22,-47],[20,-52],[-7,-63],[11,-70]])pixelOval(g,x,y,7,3,'#a79d5c');
    const count=Math.min(24,quantity),flower=stage==='flowering';
    for(let i=0;i<(flower?14:count);i++){
      const x=-19+Math.floor(hash(i,0,618)*38),y=-47+Math.floor(hash(i,1,946)*22),color=flower?'#f3d9cc':stage==='ripe'?'#c36b43':'#8cad43';
      if(flower){rect(g,x-1,y,3,1,color);rect(g,x,y-1,1,3,color);rect(g,x,y,1,1,'#d4ac68');}
      else{pixelOval(g,x,y,2,2,stage==='ripe'?'#82422f':'#4d7239');rect(g,x-1,y-1,2,2,color);rect(g,x,y-3,1,2,'#624832');}
    }
    g.restore();return;
  }
  g.save();g.translate(snap(object.x),snap(object.y));g.scale(ART_PIXEL,ART_PIXEL);
  if(kind==='apple_tree'){
    pixelOval(g,0,2,22,5,'#243c2b44');rect(g,-3,-47,6,47,'#59442f');rect(g,-1,-45,2,44,'#b08146');
    for(const branch of [[0,-18,-16,-32],[0,-32,16,-43],[0,-40,-10,-54]])pixelLine(g,[[branch[0],branch[1]],[branch[2],branch[3]]],'#775536',3);
    rect(g,-4,-1,9,2,'#70553a');
  }else if(kind==='grass'){
    const mass=Math.max(0,Math.min(1,object.biomassRatio??0));pixelOval(g,0,1,17,4,'#3a603444');
    for(let i=0;i<12;i++){const x=-16+i*3,y=Math.floor(hash(i,0,432)*5),height=Math.max(1,Math.floor(2+mass*(4+hash(i,1,983)*6)));rect(g,x,y-height,1,height,dry?(i%3?'#a69e58':'#d1c281'):(i%3?'#85af4b':'#bad270'));if(mass>.3)rect(g,x-1,y-height+2,1,2,dry?'#807b4b':'#588637');}
  }else if(kind==='bramble'){
    pixelOval(g,0,2,21,6,'#233c2c55');
    for(const [x,y] of [[-12,-4],[12,-3],[0,-11]]){pixelOval(g,x,y,11,7,dry?'#666342':'#355738');pixelOval(g,x-2,y-2,8,5,dry?'#8e8955':stage==='bare'?'#707c43':'#638a3c');rect(g,x-6,y-5,5,1,dry?'#b3a970':'#94b450');}
    pixelLine(g,[[-18,0],[-9,-10],[0,-1],[9,-13],[18,0]],'#7b6440',1);
    for(let i=0;i<Math.min(12,quantity);i++){const x=-15+Math.floor(hash(i,0,769)*30),y=-13+Math.floor(hash(i,1,314)*11);rect(g,x,y,2,2,stage==='ripe'?'#7b4060':'#809246');rect(g,x,y,1,1,stage==='ripe'?'#be7292':'#adba66');}
  }else if(['rabbit','fox','bobcat'].includes(kind)){
    const resting=object.sleeping||['sleep','sleeping','rest','resting'].includes(object.activity),moving=!resting&&['move','moving','wander','wandering','flee','fleeing','chase','chasing','pursue','pursuing','seek','seeking'].includes(object.activity),frame=moving?Math.floor(time*6)%4:0,step=frame===1?-1:frame===3?1:0,flip=(object.facing?.x??1)<0?-1:1;
    g.scale(flip,1);pixelOval(g,0,2,kind==='rabbit'?8:14,3,'#233d2b55');
    if(kind==='rabbit'){
      pixelOval(g,-1,resting?-3:-5,7,resting?4:5,'#77634c');pixelOval(g,-2,resting?-4:-6,6,3,'#baab83');pixelOval(g,5,resting?-4:-8,4,3,'#d3c198');
      if(resting){rect(g,3,-9,6,2,'#b19976');rect(g,7,-4,2,1,'#514737');}
      else{rect(g,4,-17,2,7,'#8d7255');rect(g,5,-16,1,5,'#e7ccb0');rect(g,8,-15,2,6,'#aa8665');rect(g,7,-9,1,1,'#343d2d');rect(g,-5,-1+step,3,2,'#d8cba7');rect(g,3,-1-step,4,2,'#d8cba7');}
      pixelOval(g,-7,-3,2,2,'#e7dcc0');
    }else{
      const fox=kind==='fox',dark=fox?'#78432f':'#655846',fur=fox?'#c17944':'#ac946b',light=fox?'#e4b078':'#d3bb8c';
      if(resting){pixelOval(g,0,-4,12,6,dark);pixelOval(g,-1,-5,10,5,fur);pixelOval(g,8,-3,5,4,light);rect(g,9,-4,2,1,'#3a3d2f');pixelLine(g,[[-10,-4],[-6,0],[3,0]],fox?'#dfae7b':'#938264',3);}
      else{pixelOval(g,-2,-9,11,6,dark);pixelOval(g,-3,-11,9,4,fur);pixelOval(g,9,-13,6,4,fur);pixelPoly(g,[[11,-12],[18,-10],[12,-8]],light);rect(g,17,-10,2,1,'#3c392f');rect(g,11,-14,1,1,'#343d2e');pixelPoly(g,[[5,-15],[5,-22],[10,-17]],dark);pixelPoly(g,[[12,-16],[14,-21],[16,-15]],dark);rect(g,6,-20,1,3,light);for(const [x,offset] of [[-9,step],[-3,-step],[5,-step],[10,step]])rect(g,x,-5+offset,2,6-offset,dark);if(fox){pixelLine(g,[[-12,-9],[-20,-6],[-22,-1]],fur,5);pixelLine(g,[[-22,-3],[-22,-1]],'#e5d7ac',4);}else{rect(g,-15,-10,4,2,dark);for(const [x,y] of [[-8,-13],[-3,-11],[2,-13],[7,-16]])rect(g,x,y,2,1,'#615646');}}
    }
    if(object.sleeping){rect(g,0,-24,3,1,'#d7dfbb');rect(g,2,-23,1,1,'#d7dfbb');rect(g,1,-22,1,1,'#d7dfbb');rect(g,0,-21,3,1,'#d7dfbb');}
  }else if(kind==='carcass'){
    pixelOval(g,0,2,13,3,'#283b2b66');pixelOval(g,0,-2,10,4,'#71634f');pixelOval(g,-2,-3,8,3,['decaying','spoiled'].includes(object.stage)?'#88836b':'#aa906b');rect(g,8,-3,4,3,'#b8a37e');rect(g,-7,1,3,2,'#534b3c');rect(g,3,1,4,2,'#534b3c');
  }else{
    const rawColor=object.color||'',color=rawColor.startsWith('#')?rawColor:/purple/.test(rawColor)?'#916184':/dark red/.test(rawColor)?'#9a6252':/red/.test(rawColor)?'#bc7451':/green/.test(rawColor)?'#8cad4e':'#ae9870',shape=object.shape||'round';pixelOval(g,0,2,5,2,'#2c422f44');
    if(/leaf|blade|sprig/.test(shape)){pixelPoly(g,[[-5,0],[0,-7],[5,-5],[3,-1]],color);pixelLine(g,[[-4,0],[2,-5]],'#687847',1);}
    else if(/strip|piece|fibrous|irregular/.test(shape)){pixelPoly(g,[[-6,0],[-4,-4],[2,-5],[6,-2],[2,2],[-2,1]],color);rect(g,-2,-3,4,1,'#d6ba90');}
    else{pixelOval(g,0,-2,4,4,color);rect(g,-2,-4,2,1,'#e1c494');rect(g,0,-7,1,2,'#74583a');}
  }
  g.restore();
}
export function drawShelterLamp(g,x,y){
  g.save();g.translate(snap(x),snap(y));g.scale(ART_PIXEL,ART_PIXEL);
  pixelOval(g,0,0,22,10,'#d5a55214');pixelOval(g,0,0,14,7,'#e7bf7422');
  rect(g,-3,-16,6,12,'#594c38');rect(g,-4,-17,8,2,'#b39560');rect(g,-2,-14,4,8,'#ecba65');rect(g,-1,-13,2,6,'#f7df9c');rect(g,-4,-5,8,2,'#917341');rect(g,-1,-3,2,4,'#665439');
  g.restore();
}
const LETTERS={A:'010101111101101',S:'111100111001111',T:'111010010010010',E:'111100110100111',R:'110101110101101',M:'101111111101101',I:'111010010010111',Z:'111001010100111'};
function pixelLabel(g,label,x,y,color){
  for(let letter=0;letter<label.length;letter++){const glyph=LETTERS[label[letter]];if(!glyph)continue;for(let pixel=0;pixel<15;pixel++)if(glyph[pixel]==='1')rect(g,x+letter*4+pixel%3,y+Math.floor(pixel/3),1,1,color);}
}
/** A note is a physical marker. Its claims remain journal data, never world rules. */
export function drawFieldNote(g,note){
  const p=note.position||note;g.save();g.translate(snap(p.x),snap(p.y));g.scale(ART_PIXEL,ART_PIXEL);
  pixelOval(g,0,3,9,3,'#243d3155');rect(g,-1,-3,3,9,'#74553a');rect(g,0,-3,1,8,'#b98c59');
  rect(g,-6,-17,13,16,'#514d37');rect(g,-5,-16,11,14,'#ead4a0');rect(g,-5,-16,11,1,'#fff0bf');rect(g,4,-15,2,4,'#bba474');
  const ink=note.authorId==='mira'?'#80658d':'#52714b';rect(g,-3,-12,6,1,ink);rect(g,-3,-9,5,1,'#927d56');rect(g,-3,-6,7,1,'#927d56');
  g.restore();
}
export function drawNpc(g,npc,time){
  const p=npc.position,collapsed=npc.lifecycle==='COLLAPSED',moving=npc.active?.request.type==='move'&&npc.active.blockedFor<.1;
  const target=npc.active?.route?.[npc.active.index],dx=target?target.x-p.x:0,dy=target?target.y-p.y:1,len=Math.hypot(dx,dy)||1,facing={x:dx/len,y:dy/len};
  const presentation=npc.presentation||{},signals=bodySignals(npc),posture=['resting','sleeping','dozing'].includes(signals.activity)?signals.activity:npc.bodyMode||'awake',identity=npc.id==='mira'||npc.name==='Mira'?'mira':'aster';
  g.save();g.translate(snap(p.x),snap(p.y));g.scale(ART_PIXEL,ART_PIXEL);
  if(presentation.rescueUntil>npc.elapsed){pixelOval(g,0,-12,23,28,'#e9ca6e22');pixelOval(g,0,-12,17,22,'#e9ca6e22');for(let i=0;i<4;i++){const phase=(Math.floor(time*5)+i*7)%25,x=[-13,12,-7,7][i];rect(g,x,-10-phase,1,2,'#f9df99');rect(g,x-1,-9-phase,3,1,'#f9df99');}}
  pixelOval(g,0,2,collapsed?13:7,3,'#203b2e66');
  if(['resting','sleeping','dozing'].includes(posture)){pixelOval(g,0,4,13,5,'#4c6558');pixelOval(g,0,3,12,4,identity==='mira'?'#95819f':'#7c9270');line(g,[[-10,3],[10,3]],'#c2b590');}
  g.save();drawPerson(g,facing,moving?Math.floor(time*7)%4:0,true,npc.flask?.water||0,collapsed,npc.scene||'valley',identity,posture);g.restore();
  if(presentation.drinkUntil>npc.elapsed){rect(g,8,-26,1,3,'#b3e7dc');rect(g,11,-22,1,2,'#78bfcc');}
  if(presentation.eatUntil>npc.elapsed){if(npc.mode==='discovery'){rect(g,8,-24,3,3,'#dab78b');rect(g,10,-25,2,2,'#b4a37a');}else{pixelOval(g,11,-25,3,3,'#ce7350');rect(g,10,-29,1,2,'#8e7641');rect(g,11,-28,2,1,'#b6c774');rect(g,9,-26,1,1,'#f1c483');}}
  // Names and sensation icons reveal felt condition without exposing hidden body stores.
  const label=identity==='mira'?'MIRA':'ASTER',labelWidth=label.length*4+2;
  rect(g,-labelWidth/2,-37,labelWidth,8,'#24382cf0');rect(g,-labelWidth/2+1,-36,labelWidth-2,1,identity==='mira'?'#c5a3ce':'#d6c58b');pixelLabel(g,label,-labelWidth/2+2,-35,'#f3e2b6');
  const icons=[];
  if(!['content','peckish'].includes(signals.hunger))icons.push('food');
  if(!['quenched','dry mouth'].includes(signals.thirst))icons.push('water');
  if(['hot','cold','overheated','shivering','dangerously hot','dangerously cold'].includes(signals.thermal))icons.push(['hot','overheated','dangerously hot'].includes(signals.thermal)?'hot':'cold');
  if(['sleeping','dozing'].includes(posture))icons.push('sleep');else if(['weary','exhausted'].includes(signals.fatigue)||['groggy','sleepy','struggling to stay awake'].includes(signals.sleepiness))icons.push('tired');
  if(collapsed||signals.pain==='severe')icons.splice(0,icons.length,'urgent');
  for(let i=0;i<Math.min(3,icons.length);i++){
    const x=-Math.min(3,icons.length)*4+i*8+2,y=-45,type=icons[i];rect(g,x-3,y-1,7,7,'#24382cdd');
    if(type==='food'){if(npc.mode==='discovery'){rect(g,x-1,y,1,3,'#dab990');pixelOval(g,x+1,y+3,2,2,'#dab990');rect(g,x-1,y+3,1,2,'#dab990');}else{pixelOval(g,x,y+2,2,2,'#e38c62');rect(g,x,y-1,1,2,'#a9bc75');}}
    else if(type==='water'){pixelPoly(g,[[x,y],[x-2,y+3],[x-1,y+5],[x+1,y+5],[x+2,y+3]],'#9fd7d5');rect(g,x,y+3,1,1,'#e0ecd4');}
    else if(type==='hot'||type==='cold'){const color=type==='hot'?'#eda26c':'#b7d9e6';rect(g,x,y,1,4,color);rect(g,x-1,y+3,3,2,color);}
    else if(type==='sleep'){pixelLabel(g,'Z',x-1,y,'#ddd2af');}
    else if(type==='tired'){rect(g,x-1,y+1,3,1,'#ddd2af');rect(g,x-1,y+3,3,1,'#ddd2af');}
    else{rect(g,x,y,1,3,'#e3a073');rect(g,x,y+4,1,1,'#e3a073');}
  }
  if(presentation.speakUntil>npc.elapsed){
    rect(g,4,-59,18,12,'#494634');rect(g,5,-58,16,10,'#f1dfb8');rect(g,6,-57,14,1,'#fff0ce');pixelPoly(g,[[8,-48],[12,-48],[8,-45]],'#f1dfb8');
    for(let i=0;i<3;i++)rect(g,8+i*4,-53,2,2,identity==='mira'?'#80658d':'#52714b');
  }
  g.restore();
}
