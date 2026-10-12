import { CONFIG, CAVES, SPAWN, CAVE_EXIT, LANDMARKS } from './config.js';
import { clamp, lerp, hash, noise, terrain, ridgeValue, objectsInRect, riverX, riverWidth, BRIDGES, waterDistance, caveDistance, CAVE_OBJECTS, clockTime } from './world.js';
import { canvas, makeGroundChunk, groundColor, ellipse, line, poly, drawObject, drawAvatar, drawBridge, drawCamp, drawCaveEntrance, drawCaveObject, drawNpc } from './art.js';

export class Renderer {
  constructor(target, state) {
    this.canvas=target;this.ctx=target.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('A Canvas 2D context is required to run Aincrad.');
    this.camera={x:state.player.x-220,y:state.player.y-70};this.zoom=1.55;this.targetZoom=1.55;
    this.chunks=new Map();this.caveCanvas=null;this.caveMask=null;this.mapCanvas=null;this.scene=state.scene;
    this.followNpc=false;this.inspectorOpen=false;this.viewportOffsetX=0;this.frame=0;this.lastMini=0;this.resize();
  }
  resize(){this.width=window.innerWidth;this.height=window.innerHeight;this.dpr=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);}
  snap(p){this.camera={...p};}
  chunk(cx,cy) {
    const key=`${cx},${cy}`;
    if(this.chunks.has(key)){const c=this.chunks.get(key);this.chunks.delete(key);this.chunks.set(key,c);return c;}
    const c=makeGroundChunk(cx,cy,CONFIG.chunkSize);this.chunks.set(key,c);
    if(this.chunks.size>CONFIG.maxCachedChunks)this.chunks.delete(this.chunks.keys().next().value);
    return c;
  }
  screenPoint(x,y){return{x:(x-this.camera.x)*this.zoom+this.width/2-this.viewportOffsetX,y:(y-this.camera.y)*this.zoom+this.height/2};}
  render(state, anim, dt, started) {
    this.viewportOffsetX=this.inspectorOpen?Math.min(430,this.width*.53)/2:0;
    const g=this.ctx,p=this.followNpc&&state.scene==='valley'?state.npc.position:state.player;this.frame++;
    if(this.scene!==state.scene){this.scene=state.scene;this.snap(p);this.caveCanvas=null;}
    const target={x:p.x+(started?0:-220),y:p.y+(started?-40:-70)};
    const ease=1-Math.exp(-dt*8);
    this.camera.x=lerp(this.camera.x,target.x,ease);this.camera.y=lerp(this.camera.y,target.y,ease);this.zoom=lerp(this.zoom,this.targetZoom,1-Math.exp(-dt*10));
    g.setTransform(this.dpr,0,0,this.dpr,0,0);g.fillStyle='#172f2c';g.fillRect(0,0,this.width,this.height);
    g.save();g.translate(this.width/2-this.viewportOffsetX,this.height/2);g.scale(this.zoom,this.zoom);g.translate(-this.camera.x,-this.camera.y);
    const view={x:this.camera.x-this.width/this.zoom/2-200,y:this.camera.y-this.height/this.zoom/2-220,w:this.width/this.zoom+400,h:this.height/this.zoom+540};
    if(state.scene==='valley') this.drawValley(g,state,anim,view);else this.drawCave(g,state,anim,view);
    g.restore();
    if(state.scene==='valley')this.lighting(g,state,anim);
    else this.caveLighting(g,state);
  }
  drawValley(g,state,anim,v) {
    const s=CONFIG.chunkSize;
    for(let cy=Math.floor(v.y/s);cy<=Math.floor((v.y+v.h)/s);cy++)for(let cx=Math.floor(v.x/s);cx<=Math.floor((v.x+v.w)/s);cx++)g.drawImage(this.chunk(cx,cy),cx*s,cy*s);
    // Ripples are purely visual; their animation never updates world state.
    for(let cy=Math.floor(v.y/90);cy<=Math.floor((v.y+v.h)/90);cy++)for(let cx=Math.floor(v.x/95);cx<=Math.floor((v.x+v.w)/95);cx++){
      const x=cx*95+hash(cx,cy,370)*65,y=cy*90+hash(cx,cy,822)*60;
      if(waterDistance(x,y)>-30)continue;
      const phase=(anim.time*.27+hash(cx,cy,384))%1,opacity=Math.sin(phase*Math.PI)*.23;
      const width=12+hash(cx,cy,841)*26;
      line(g,[[x-width,y+phase*12],[x,y-1+phase*12],[x+width*.7,y+phase*12]],`rgba(201,235,210,${opacity})`,1.3);
      if(hash(cx,cy,155)>.7)line(g,[[x-width*.4,y+5+phase*12],[x+width*.3,y+5+phase*12]],`rgba(207,239,218,${opacity*.5})`,1);
    }
    for(const b of BRIDGES)if(Math.abs(b.x-this.camera.x)<v.w&&Math.abs(b.y-this.camera.y)<v.h)drawBridge(g,b,riverWidth(b.y));
    const objects=objectsInRect(v.x,v.y,v.w,v.h);
    // Mountain sprites overlap outside the impassable ridge, forming a continuous ring.
    for(let cy=Math.floor(v.y/310);cy<=Math.floor((v.y+v.h+400)/310);cy++)for(let cx=Math.floor(v.x/360);cx<=Math.floor((v.x+v.w)/360);cx++){
      const x=cx*360+hash(cx,cy,992)*80,y=cy*310+hash(cx,cy,199)*100;
      if(ridgeValue(x,y)<1.008||CAVES.some(c=>Math.hypot(x-c.x,y-c.y)<410))continue;
      objects.push({kind:'mountain',x,y,scale:.87+hash(cx,cy,893)*.4,variant:Math.floor(hash(cx,cy,753)*3)});
    }
    objects.push({kind:'camp',x:SPAWN.x,y:SPAWN.y-10});
    for(const c of CAVES)objects.push({kind:'cave',x:c.x,y:c.y,definition:c});
    objects.push({kind:'player',x:state.player.x,y:state.player.y});
    if(state.npc)objects.push({kind:'npc',x:state.npc.position.x,y:state.npc.position.y});
    objects.sort((a,b)=>a.y-b.y);
    for(const o of objects) {
      if(o.x<v.x-400||o.x>v.x+v.w+400||o.y<v.y-100||o.y>v.y+v.h+400)continue;
      if(o.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,state.scene);
      else if(o.kind==='npc')drawNpc(g,state.npc,anim.time);
      else if(o.kind==='camp')drawCamp(g,SPAWN.x,SPAWN.y-10,anim.time);
      else if(o.kind==='cave')drawCaveEntrance(g,o.definition,anim.time);
      else drawObject(g,o,state.player);
    }
    // Butterflies in the meadow: bounded, deterministic decoration only.
    for(let i=0;i<7;i++){
      const cx=Math.floor(this.camera.x/650),cy=Math.floor(this.camera.y/650);
      const x=cx*650+hash(i,cx,890+cy)*750+Math.sin(anim.time*.6+i)*25;
      const y=cy*650+hash(i,cy,921+cx)*650+Math.cos(anim.time*.43+i)*20;
      if(terrain(x,y)!=='meadow')continue;
      ellipse(g,x,y,3*Math.abs(Math.sin(anim.time*10+i)),1.6,i%2?'#dcca806e':'#dbdab788',.4);
    }
    if(state.waypoint){const w=state.waypoint;ellipse(g,w.x,w.y,19,8,'#eed59533');line(g,[[w.x,w.y],[w.x,w.y-48]],'#e6d0a2',2);poly(g,[[w.x,w.y-48],[w.x+21,w.y-40],[w.x,w.y-32]],'#dec38a');}
  }
  buildCave() {
    const c=canvas(2700,1900),g=c.getContext('2d'),s=8,w=Math.ceil(c.width/s),h=Math.ceil(c.height/s),small=canvas(w,h),sg=small.getContext('2d'),img=sg.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const d=caveDistance(x*s,y*s),n=noise(x*s,y*s,75,831)*16-8,idx=(y*w+x)*4;
      let col=d<0?[64+n,75+n,76+n]:d<42?[91+n,103+n,100+n]:[28+n*.3,43+n*.3,47+n*.3];
      if(d<0&&d>-23)col=[42+n,54+n,60+n];
      img.data[idx]=col[0];img.data[idx+1]=col[1];img.data[idx+2]=col[2];img.data[idx+3]=255;
    }sg.putImageData(img,0,0);g.drawImage(small,0,0,c.width,c.height);
    for(let y=0;y<1900;y+=27)for(let x=0;x<2700;x+=29){
      if(caveDistance(x,y)>0)continue;const h=hash(x,y,902);g.fillStyle=h>.5?'#e2d6ad12':'#041e2333';g.fillRect(x+h*14,y,4+h*5,1.5);
      if(h>.965)line(g,[[x,y],[x+13,y-5],[x+21,y-2]],'#081c2344',1);
    }
    this.caveCanvas=c;
  }
  drawCave(g,state,anim,v) {
    if(!this.caveCanvas)this.buildCave();g.fillStyle='#1c2b2f';g.fillRect(v.x,v.y,v.w,v.h);g.drawImage(this.caveCanvas,0,0);
    const definition=CAVES.find(c=>c.id===state.scene),tint=definition?.tint||'#83cbc6';
    // Exit stairs return to the exact entrance used, not a generic spawn point.
    g.fillStyle='#afad8d';for(let i=0;i<6;i++){g.globalAlpha=.3+i*.06;g.fillRect(CAVE_EXIT.x-45,CAVE_EXIT.y-10+i*9,90,6);}g.globalAlpha=1;
    const glow=g.createRadialGradient(CAVE_EXIT.x,CAVE_EXIT.y+40,0,CAVE_EXIT.x,CAVE_EXIT.y+40,180);glow.addColorStop(0,'#ece4b14a');glow.addColorStop(1,'#ece4b100');g.fillStyle=glow;g.fillRect(CAVE_EXIT.x-180,CAVE_EXIT.y-140,360,360);
    const objects=[...CAVE_OBJECTS,{...state.player,kind:'player'}].sort((a,b)=>a.y-b.y);
    for(const o of objects){if(o.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,state.scene);else drawCaveObject(g,o,tint);}
    for(const o of CAVE_OBJECTS.filter(o=>o.kind==='crystal')){
      const phase=(anim.time*.2+o.seed)%1;ellipse(g,o.x+Math.sin(anim.time+o.seed*10)*14,o.y-20-phase*44,1.2,1.2,tint+Math.floor(Math.sin(phase*Math.PI)*130).toString(16).padStart(2,'0'));
    }
  }
  lighting(g,state,anim) {
    const h=clockTime(state.elapsed).hour+clockTime(state.elapsed).minute/60;
    const dark=h<5||h>21?.42:h<7?.42*(7-h)/2:h>18?.42*(h-18)/3:0;
    if(dark>0){g.fillStyle=`rgba(13,26,59,${dark})`;g.fillRect(0,0,this.width,this.height);}
    if(h>16&&h<20){g.fillStyle=`rgba(224,155,78,${.045*Math.sin((h-16)/4*Math.PI)})`;g.fillRect(0,0,this.width,this.height);}
    // Subtle drifting cloud shade avoids obscuring the player's position.
    for(let i=0;i<2;i++){
      const x=((anim.time*9+i*this.width*.6)%(this.width+800))-400,y=this.height*(.2+i*.48);
      const grad=g.createRadialGradient(x,y,50,x,y,420);grad.addColorStop(0,'#153e3220');grad.addColorStop(1,'#153e3200');g.fillStyle=grad;g.fillRect(x-430,y-430,860,860);
    }
  }
  caveLighting(g,state) {
    const p=this.screenPoint(state.player.x,state.player.y-22);
    const gradient=g.createRadialGradient(p.x,p.y,55*this.zoom,p.x,p.y,320*this.zoom);
    gradient.addColorStop(0,'#07132200');gradient.addColorStop(.5,'#07132222');gradient.addColorStop(1,'#071322a0');g.fillStyle=gradient;g.fillRect(0,0,this.width,this.height);
    const warm=g.createRadialGradient(p.x+15,p.y,0,p.x+15,p.y,110*this.zoom);warm.addColorStop(0,'#efbe6720');warm.addColorStop(1,'#efbe6700');g.fillStyle=warm;g.fillRect(p.x-200,p.y-200,400,400);
  }
  drawMini(target,state,now) {
    if(now-this.lastMini<.7)return;this.lastMini=now;
    const g=target.getContext('2d'),w=target.width,h=target.height,scale=state.scene==='valley'?16:4;
    const sw=70,small=canvas(sw,sw),sg=small.getContext('2d'),img=sg.createImageData(sw,sw);
    for(let y=0;y<sw;y++)for(let x=0;x<sw;x++){
      const wx=state.player.x+(x/sw-.5)*w*scale,wy=state.player.y+(y/sw-.5)*h*scale;
      const col=state.scene==='valley'?groundColor(wx,wy):caveDistance(wx,wy)<0?[99,121,118]:[36,53,53];
      const i=(y*sw+x)*4;img.data[i]=col[0];img.data[i+1]=col[1];img.data[i+2]=col[2];img.data[i+3]=255;
    }sg.putImageData(img,0,0);g.drawImage(small,0,0,w,h);
    g.fillStyle='#17382d33';g.fillRect(0,0,w,h);
    for(const l of LANDMARKS){if(state.scene!=='valley')break;const x=(l.x-state.player.x)/scale+w/2,y=(l.y-state.player.y)/scale+h/2;if(x<9||x>w-9||y<9||y>h-9)continue;g.font='13px Georgia';g.textAlign='center';g.fillStyle='#f1dfb0';g.fillText(l.kind==='cave'?'△':l.kind==='camp'?'⌂':'·',x,y);}
    if(state.scene!=='valley'){g.fillStyle='#f0d098';g.fillRect((CAVE_EXIT.x-state.player.x)/scale+w/2-3,(CAVE_EXIT.y-state.player.y)/scale+h/2-3,6,6);}
    ellipse(g,w/2,h/2,8,8,'#142d27bb');poly(g,[[w/2,h/2-6],[w/2-4,h/2+5],[w/2,h/2+2],[w/2+4,h/2+5]],'#fff1c8');
  }
  drawAtlas(target,state) {
    const g=target.getContext('2d'),w=target.width,h=target.height;
    const isValley=state.scene==='valley',worldW=isValley?CONFIG.halfSize*2:2700,worldH=isValley?CONFIG.halfSize*2:1900,ox=isValley?-CONFIG.halfSize:0,oy=isValley?-CONFIG.halfSize:0;
    // Square world in an 840 x 700 atlas, with aspect ratio preserved.
    const scale=Math.min((w-30)/worldW,(h-30)/worldH),mx=(w-worldW*scale)/2,my=(h-worldH*scale)/2;
    const toMap=(x,y)=>({x:mx+(x-ox)*scale,y:my+(y-oy)*scale});
    if(!this.mapCanvas){
      this.mapCanvas=canvas(420,420);const m=this.mapCanvas.getContext('2d'),img=m.createImageData(420,420);
      for(let y=0;y<420;y++)for(let x=0;x<420;x++){const col=groundColor((x/420-.5)*48000,(y/420-.5)*48000,true),i=(y*420+x)*4;img.data[i]=col[0];img.data[i+1]=col[1];img.data[i+2]=col[2];img.data[i+3]=255;}m.putImageData(img,0,0);
    }
    g.fillStyle='#1a332d';g.fillRect(0,0,w,h);
    if(isValley)g.drawImage(this.mapCanvas,mx,my,worldW*scale,worldH*scale);
    else{if(!this.caveCanvas)this.buildCave();g.drawImage(this.caveCanvas,mx,my,worldW*scale,worldH*scale);for(const o of CAVE_OBJECTS){const p=toMap(o.x,o.y);ellipse(g,p.x,p.y,2,2,o.kind==='crystal'?(CAVES.find(c=>c.id===state.scene)?.tint??'#bdf'):'#bec5ad');}}
    g.fillStyle='#12362618';g.fillRect(mx,my,worldW*scale,worldH*scale);
    for(let i=0;i<=6;i++){line(g,[[mx+worldW*scale*i/6,my],[mx+worldW*scale*i/6,my+worldH*scale]],'#efedc416',1);line(g,[[mx,my+worldH*scale*i/6],[mx+worldW*scale,my+worldH*scale*i/6]],'#efedc416',1);}
    if(isValley){
      // Trails are deliberately exaggerated on the field map for legibility.
      g.save();g.setLineDash([3,3]);for(const y of [0,-12600,11800]){const a=toMap(-21600,y),b=toMap(21600,y);line(g,[[a.x,a.y],[b.x,b.y]],'#e1cf9866',1);}
      for(const c of CAVES){const a=toMap(c.x,c.y),b=toMap(c.x,c.y<0?-12600:11800);line(g,[[a.x,a.y],[b.x,b.y]],'#e1cf9866',1);}g.restore();
      for(const l of LANDMARKS){const p=toMap(l.x,l.y),discovered=state.discoveries.includes(l.id);g.textAlign='center';g.font='16px Georgia';g.fillStyle=discovered?'#fff0c1':'#e5dfb8';g.shadowColor='#173b32';g.shadowBlur=5;g.fillText(l.kind==='cave'?'△':l.kind==='camp'?'⌂':'·',p.x,p.y);g.font='11px Georgia';g.fillText(l.name,p.x,p.y+15);g.shadowBlur=0;}
      g.font='italic 19px Georgia';g.fillStyle='#e0dec06e';g.textAlign='center';g.fillText('C R O W N   R I D G E',w/2,48);
    }else{const exit=toMap(CAVE_EXIT.x,CAVE_EXIT.y);g.fillStyle='#f1d499';g.font='11px Georgia';g.textAlign='center';g.fillText('↑ Valley exit',exit.x,exit.y+18);}
    const p=toMap(state.player.x,state.player.y);ellipse(g,p.x,p.y,11,11,'#16342fcc');ellipse(g,p.x,p.y,5,5,'#fff0bb');g.strokeStyle='#fff1bb77';g.lineWidth=1;g.beginPath();g.arc(p.x,p.y,12,0,Math.PI*2);g.stroke();
    if(state.waypoint&&isValley){const wp=toMap(state.waypoint.x,state.waypoint.y);g.save();g.setLineDash([3,4]);line(g,[[p.x,p.y],[wp.x,wp.y]],'#f1d08e88',1);g.restore();poly(g,[[wp.x,wp.y-7],[wp.x+5,wp.y],[wp.x,wp.y+7],[wp.x-5,wp.y]],'#f0cd82');}
    this.atlasTransform={mx,my,scale,ox,oy,worldW,worldH};
  }
  atlasPoint(x,y){const t=this.atlasTransform;if(!t)return null;const wx=(x-t.mx)/t.scale+t.ox,wy=(y-t.my)/t.scale+t.oy;if(wx<t.ox||wx>t.ox+t.worldW||wy<t.oy||wy>t.oy+t.worldH)return null;return{x:wx,y:wy};}
}
