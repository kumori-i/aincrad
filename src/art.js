/** Original palette-limited pixel artwork. Two world units are one art pixel. */
import { hash, noise, terrain, waterDistance, ridgeValue, clamp } from './world.js';
import { NPC_RULES } from './config.js';

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
export function groundColor(x,y,map=false){
  const type=terrain(x,y),colors=RGB_PALETTES[type],shade=paletteIndex(x,y);
  if(map&&type==='mountain'&&Math.sin(ridgeValue(x,y)*34+noise(x,y,850,993)*5)>.72)return RGB_PALETTES.mountain[3];
  return colors[shade];
}
export function makeGroundChunk(cx,cy,size){
  const out=canvas(size/ART_PIXEL,size/ART_PIXEL),g=out.getContext('2d'),s=out.width,image=g.createImageData(s,s),originX=cx*size,originY=cy*size;
  // Sample the physical terrain at four world units; a small stepped edge follows the same collision boundary.
  for(let py=0;py<s;py+=2)for(let px=0;px<s;px+=2){
    const x=originX+px*ART_PIXEL+2,y=originY+py*ART_PIXEL+2,type=terrain(x,y),d=waterDistance(x,y);
    let color=RGB_PALETTES[type][paletteIndex(x,y)];
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
    if(type==='meadow'||type==='forest'){
      const dark=type==='forest'?'#3e692f':'#5b8a35',light=type==='forest'?'#87aa50':'#b1cc64';
      rect(g,x-2,y,4,1,dark);rect(g,x-2,y-2,1,2,dark);rect(g,x,y-3,1,3,light);rect(g,x+2,y-1,1,2,light);
      if(h>.54){rect(g,x+5,y+4,3,1,light);rect(g,x+6,y+2,1,2,dark);}
      if(h>.943){rect(g,x,y-3,1,4,'#4e8038');const petal=h>.982?'#d587a7':h>.966?'#faf0b6':'#f6d36b';rect(g,x-1,y-4,3,1,petal);rect(g,x,y-5,1,3,petal);rect(g,x,y-4,1,1,'#b78c45');}
      if(h<.026){pixelOval(g,x,y,3,2,'#59864c');rect(g,x-2,y-1,3,1,'#b1bd79');}
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
function drawPerson(g,facing,frame,npc=false,flask=0,collapsed=false,scene='valley'){
  const back=facing.y<-.2,side=Math.abs(facing.x)>.6,left=facing.x<0,step=frame===1?-1:frame===3?1:0;
  const outline='#2e3a35',pants=npc?'#354e57':'#3c5360',cloth=npc?'#62864d':'#b86949',light=npc?'#98b46a':'#dc9a60',skin='#e3bd8c',hair=npc?'#73513c':'#75533b';
  if(collapsed){g.translate(8,0);g.rotate(-Math.PI/2);}
  rect(g,-5,-7+step,4,7,outline);rect(g,2,-7-step,4,7,outline);rect(g,-4,-7+step,2,5,pants);rect(g,3,-7-step,2,5,pants);
  rect(g,-5,-1+step,4,2,'#503e32');rect(g,2,-1-step,4,2,'#503e32');
  pixelPoly(g,[[-5,-17],[-7,-12],[-6,-5],[-3,-4],[5,-5],[7,-12],[5,-17]],outline);
  rect(g,-5,-17,10,11,cloth);rect(g,-4,-16,3,9,light);rect(g,-4,-6,9,1,'#5b4732');rect(g,0,-6,2,1,'#d4b56c');
  const arm=step?(step>0?1:-1):0;rect(g,-7,-15+arm,2,7,cloth);rect(g,6,-15-arm,2,7,cloth);rect(g,-7,-9+arm,2,3,skin);rect(g,6,-9-arm,2,3,skin);
  if(back){rect(g,-4,-16,8,9,npc?'#3f5860':'#9c8053');rect(g,-3,-15,6,2,npc?'#698b94':'#d8bd7c');rect(g,-3,-11,6,1,'#2d3e3a');rect(g,-4,-14,1,7,'#d3b582');}
  else{rect(g,-1,-15,3,7,npc?'#c8d3a1':'#f0d5a1');rect(g,-1,-9,3,1,'#6b794c');}
  const fx=side?(left?-1:1):0;rect(g,-5+fx,-25,10,10,outline);rect(g,-4+fx,-24,8,8,skin);rect(g,-4+fx,-17,8,1,'#c79364');
  rect(g,-5+fx,-25,10,4,hair);rect(g,-5+fx,-21,2,5,hair);if(back){rect(g,-4+fx,-22,8,6,hair);rect(g,-3+fx,-24,6,1,'#9a6b49');}
  else{if(!side){rect(g,-2,-20,1,2,outline);rect(g,2,-20,1,2,outline);}else rect(g,left?-4:4,-20,1,2,outline);rect(g,fx,-17,2,1,'#a57851');}
  if(npc){rect(g,-4+fx,-25,6,1,'#a47850');rect(g,5,-11,3,5,flask>.01?'#6aadc3':'#725d43');rect(g,6,-12,1,2,'#d0ac63');rect(g,6,-9,1,2,flask>.01?'#bce2d7':'#a28b65');}
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
export function drawShelterLamp(g,x,y){
  g.save();g.translate(snap(x),snap(y));g.scale(ART_PIXEL,ART_PIXEL);
  pixelOval(g,0,0,22,10,'#d5a55214');pixelOval(g,0,0,14,7,'#e7bf7422');
  rect(g,-3,-16,6,12,'#594c38');rect(g,-4,-17,8,2,'#b39560');rect(g,-2,-14,4,8,'#ecba65');rect(g,-1,-13,2,6,'#f7df9c');rect(g,-4,-5,8,2,'#917341');rect(g,-1,-3,2,4,'#665439');
  g.restore();
}
export function drawNpc(g,npc,time){
  const p=npc.position,collapsed=npc.lifecycle==='COLLAPSED',moving=npc.active?.request.type==='move'&&npc.active.blockedFor<.1;
  const target=npc.active?.route?.[npc.active.index],dx=target?target.x-p.x:0,dy=target?target.y-p.y:1,len=Math.hypot(dx,dy)||1,facing={x:dx/len,y:dy/len};
  g.save();g.translate(snap(p.x),snap(p.y));g.scale(ART_PIXEL,ART_PIXEL);
  if(npc.presentation.rescueUntil>npc.elapsed){pixelOval(g,0,-12,23,28,'#e9ca6e22');pixelOval(g,0,-12,17,22,'#e9ca6e22');for(let i=0;i<4;i++){const phase=(Math.floor(time*5)+i*7)%25,x=[-13,12,-7,7][i];rect(g,x,-10-phase,1,2,'#f9df99');rect(g,x-1,-9-phase,3,1,'#f9df99');}}
  pixelOval(g,0,2,collapsed?13:7,3,'#203b2e66');g.save();drawPerson(g,facing,moving?Math.floor(time*7)%4:0,true,npc.flask.water,collapsed,npc.scene||'valley');g.restore();
  if(npc.presentation.drinkUntil>npc.elapsed){rect(g,8,-26,1,3,'#b3e7dc');rect(g,11,-22,1,2,'#78bfcc');}
  if(npc.presentation.eatUntil>npc.elapsed){pixelOval(g,11,-25,3,3,'#ce7350');rect(g,10,-29,1,2,'#8e7641');rect(g,11,-28,2,1,'#b6c774');rect(g,9,-26,1,1,'#f1c483');}
  // A compact status plate is pixel-aligned; the inspector carries the full evidence and history.
  rect(g,-11,-37,22,8,'#24382cf0');rect(g,-10,-36,20,1,'#d6c58b');
  const glyphs=['010101111101101','111100111001111','111010010010010','111100110100111','110101110101101'];
  for(let letter=0;letter<glyphs.length;letter++)for(let pixel=0;pixel<15;pixel++)if(glyphs[letter][pixel]==='1')rect(g,-9+letter*4+pixel%3,-35+Math.floor(pixel/3),1,1,'#f3e2b6');
  rect(g,-10,-40,20,2,'#2e4633');rect(g,-10,-40,Math.max(0,Math.round(20*npc.hydration/100)),2,collapsed||npc.hydration<=NPC_RULES.criticalHydration?'#cf7756':npc.hydration<=NPC_RULES.thirstWarning?'#dba554':'#7ac2c2');
  if(Number.isFinite(npc.nourishment)){rect(g,-10,-43,20,2,'#3d392c');rect(g,-10,-43,Math.max(0,Math.round(20*npc.nourishment/100)),2,npc.nourishment<=NPC_RULES.criticalNourishment?'#cf7756':npc.nourishment<=NPC_RULES.hungerWarning?'#dba554':'#d1b46b');}
  const hot=npc.feelings?.heat||0,cold=npc.feelings?.cold||0;if(hot>.25||cold>.25){const color=hot>cold?'#ea9a61':'#a8d3e5';rect(g,13,-35,3,7,color);rect(g,12,-31,5,3,color);rect(g,14,-34,1,4,'#faf0c3');}
  g.restore();
}
