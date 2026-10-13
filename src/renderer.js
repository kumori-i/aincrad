import { CONFIG, CAVES, SPAWN, CAVE_EXIT, LANDMARKS } from './config.js';
import { clamp, lerp, hash, noise, terrain, ridgeValue, objectsInRect, riverWidth, BRIDGES, waterDistance, caveDistance, CAVE_OBJECTS, clockTime } from './world.js';
import { ART_PIXEL, canvas, makeGroundChunk, groundColor, ellipse, line, poly, drawObject, drawAvatar, drawBridge, drawCamp, drawCaveEntrance, drawCaveObject, drawNpc } from './art.js';

/** The world is painted into an art-pixel buffer, then enlarged by an integer factor. */
export class Renderer {
  constructor(target,state){
    this.canvas=target;this.ctx=target.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('A Canvas 2D context is required to run Aincrad.');
    this.pixels=canvas(1,1);this.pixelCtx=this.pixels.getContext('2d',{alpha:false});
    this.camera={x:state.player.x-220,y:state.player.y-70};this.zoom=1.5;this.targetZoom=1.5;
    this.chunks=new Map();this.caveCanvas=null;this.mapCanvas=null;this.scene=state.scene;
    this.followNpc=false;this.inspectorOpen=false;this.viewportOffsetX=0;this.frame=0;this.lastMini=0;this.resize();
  }
  resize(){this.width=window.innerWidth;this.height=window.innerHeight;this.dpr=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);this.ctx.imageSmoothingEnabled=false;}
  snap(p){this.camera={...p};}
  chunk(cx,cy){
    const key=`${cx},${cy}`;if(this.chunks.has(key)){const c=this.chunks.get(key);this.chunks.delete(key);this.chunks.set(key,c);return c;}
    const c=makeGroundChunk(cx,cy,CONFIG.chunkSize);this.chunks.set(key,c);if(this.chunks.size>CONFIG.maxCachedChunks)this.chunks.delete(this.chunks.keys().next().value);return c;
  }
  screenPoint(x,y){
    const camera=this.drawCamera||this.camera,scale=(this.pixelScale||3)/this.dpr;
    return{x:((x-camera.x)/ART_PIXEL+(this.renderCenterX??this.width/2/scale))*scale,y:((y-camera.y)/ART_PIXEL+(this.renderCenterY??this.height/2/scale))*scale};
  }
  render(state,anim,dt,started){
    this.viewportOffsetX=this.inspectorOpen?Math.min(430,this.width*.53)/2:0;
    const p=this.followNpc&&state.scene==='valley'?state.npc.position:state.player;this.frame++;
    if(this.scene!==state.scene){this.scene=state.scene;this.snap(p);this.caveCanvas=null;}
    const target={x:p.x+(started?0:-220),y:p.y+(started?-40:-70)},ease=1-Math.exp(-dt*8);
    this.camera.x=lerp(this.camera.x,target.x,ease);this.camera.y=lerp(this.camera.y,target.y,ease);
    this.pixelScale=Math.max(2,Math.round(this.targetZoom*ART_PIXEL*this.dpr));this.zoom=this.pixelScale/(ART_PIXEL*this.dpr);
    const w=Math.ceil(this.canvas.width/this.pixelScale),h=Math.ceil(this.canvas.height/this.pixelScale);
    if(this.pixels.width!==w||this.pixels.height!==h){this.pixels.width=w;this.pixels.height=h;}
    const g=this.pixelCtx;g.imageSmoothingEnabled=false;g.setTransform(1,0,0,1,0,0);g.fillStyle='#243b2b';g.fillRect(0,0,w,h);
    this.renderCenterX=Math.floor(w/2-this.viewportOffsetX*this.dpr/this.pixelScale);this.renderCenterY=Math.floor(h/2);
    this.drawCamera={x:Math.round(this.camera.x/ART_PIXEL)*ART_PIXEL,y:Math.round(this.camera.y/ART_PIXEL)*ART_PIXEL};
    g.save();g.translate(this.renderCenterX,this.renderCenterY);g.scale(1/ART_PIXEL,1/ART_PIXEL);g.translate(-this.drawCamera.x,-this.drawCamera.y);
    const view={x:this.drawCamera.x-this.renderCenterX*ART_PIXEL-280,y:this.drawCamera.y-this.renderCenterY*ART_PIXEL-320,w:w*ART_PIXEL+560,h:h*ART_PIXEL+650};
    if(state.scene==='valley')this.drawValley(g,state,anim,view);else this.drawCave(g,state,anim,view);g.restore();
    if(state.scene==='valley')this.lighting(g,state);else this.caveLighting(g,state);
    this.ctx.setTransform(1,0,0,1,0,0);this.ctx.imageSmoothingEnabled=false;this.ctx.drawImage(this.pixels,0,0,w*this.pixelScale,h*this.pixelScale);
  }
  drawValley(g,state,anim,v){
    const size=CONFIG.chunkSize;
    for(let cy=Math.floor(v.y/size);cy<=Math.floor((v.y+v.h)/size);cy++)for(let cx=Math.floor(v.x/size);cx<=Math.floor((v.x+v.w)/size);cx++)g.drawImage(this.chunk(cx,cy),cx*size,cy*size,size,size);
    // Two discrete ripple frames keep the river alive without moving its collision boundary.
    const waterFrame=Math.floor(anim.time*2)%4;
    for(let cy=Math.floor(v.y/62);cy<=Math.floor((v.y+v.h)/62);cy++)for(let cx=Math.floor(v.x/72);cx<=Math.floor((v.x+v.w)/72);cx++){
      const x=Math.round((cx*72+hash(cx,cy,370)*42)/ART_PIXEL)*ART_PIXEL,y=Math.round((cy*62+hash(cx,cy,822)*38)/ART_PIXEL)*ART_PIXEL;
      if(waterDistance(x,y)>-23)continue;const phase=(waterFrame+Math.floor(hash(cx,cy,384)*4))%4;if(phase===3)continue;
      line(g,[[x-10,y],[x-2,y],[x,y-2],[x+12,y-2]],phase===0?'#97d1cd':'#6bbdc5',ART_PIXEL);if(phase===1)line(g,[[x-4,y+6],[x+6,y+6]],'#b4e0d5',ART_PIXEL);
    }
    for(const bridge of BRIDGES)if(Math.abs(bridge.x-this.camera.x)<v.w&&Math.abs(bridge.y-this.camera.y)<v.h)drawBridge(g,bridge,riverWidth(bridge.y));
    const objects=objectsInRect(v.x,v.y,v.w,v.h);
    for(let cy=Math.floor(v.y/240);cy<=Math.floor((v.y+v.h+300)/240);cy++)for(let cx=Math.floor(v.x/340);cx<=Math.floor((v.x+v.w)/340);cx++){
      const x=cx*340+hash(cx,cy,992)*32,y=cy*240+hash(cx,cy,199)*48;
      if(ridgeValue(x,y)<1.008||CAVES.some(c=>Math.hypot(x-c.x,y-c.y)<330))continue;
      objects.push({kind:'mountain',x,y,scale:.95+hash(cx,cy,893)*.15,variant:Math.floor(hash(cx,cy,753)*3)});
    }
    objects.push({kind:'camp',x:SPAWN.x,y:SPAWN.y-10});for(const cave of CAVES)objects.push({kind:'cave',x:cave.x,y:cave.y,definition:cave});
    objects.push({kind:'player',x:state.player.x,y:state.player.y});if(state.npc)objects.push({kind:'npc',x:state.npc.position.x,y:state.npc.position.y});objects.sort((a,b)=>a.y-b.y);
    for(const object of objects){
      if(object.x<v.x-420||object.x>v.x+v.w+420||object.y<v.y-100||object.y>v.y+v.h+400)continue;
      if(object.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,state.scene);
      else if(object.kind==='npc')drawNpc(g,state.npc,anim.time);
      else if(object.kind==='camp')drawCamp(g,SPAWN.x,SPAWN.y-10,anim.time);
      else if(object.kind==='cave')drawCaveEntrance(g,object.definition);
      else drawObject(g,object,this.followNpc&&state.npc?state.npc.position:state.player);
    }
    if(state.waypoint){const w=state.waypoint;ellipse(g,w.x,w.y,16,6,'#ecd08955');line(g,[[w.x,w.y],[w.x,w.y-40]],'#554930',4);poly(g,[[w.x+2,w.y-40],[w.x+20,w.y-34],[w.x+2,w.y-27]],'#e5c675');}
  }
  buildCave(){
    const c=canvas(2700/ART_PIXEL,1900/ART_PIXEL),g=c.getContext('2d'),image=g.createImageData(c.width,c.height);
    const floor=[[97,103,109],[106,110,113],[89,98,105],[111,114,117]],wall=[[45,55,66],[57,66,75],[69,75,80],[32,44,55]];
    for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2){
      const wx=x*ART_PIXEL,wy=y*ART_PIXEL,d=caveDistance(wx,wy),tileY=Math.floor(wy/30),tileX=Math.floor((wx+(tileY%2)*30)/64),h=hash(tileX,tileY,621);let color=d<0?floor[Math.floor(h*4)]:wall[Math.floor(h*4)];
      if(d<0&&d>-14)color=[47,62,71];else if(d>=0&&d<50&&Math.floor(wy)%30<4)color=[112,116,111];else if(d>=0&&d<50)color=wall[2];
      else if(d<0&&((wx+(tileY%2)*30)%64<3||wy%30<3)&&h>.48)color=[67,79,88];
      for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){if(x+dx>=c.width||y+dy>=c.height)continue;const i=((y+dy)*c.width+x+dx)*4;image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=255;}
    }
    g.putImageData(image,0,0);
    for(let y=0;y<c.height;y+=13)for(let x=0;x<c.width;x+=17){if(caveDistance(x*ART_PIXEL,y*ART_PIXEL)>-20)continue;const h=hash(x,y,913);g.fillStyle=h>.5?'#c0c1a9':'#4b5f68';g.fillRect(x+Math.floor(h*5),y,1+(h>.8?2:0),1);}
    this.caveCanvas=c;
  }
  drawCave(g,state,anim,v){
    if(!this.caveCanvas)this.buildCave();g.fillStyle='#202d38';g.fillRect(v.x,v.y,v.w,v.h);g.drawImage(this.caveCanvas,0,0,2700,1900);
    const tint=CAVES.find(c=>c.id===state.scene)?.tint||'#83cbc6';
    for(let i=0;i<6;i++){g.fillStyle=i%2?'#c3b98d':'#7c8177';g.fillRect(CAVE_EXIT.x-42,CAVE_EXIT.y-12+i*8,84,6);g.fillStyle='#4f6164';g.fillRect(CAVE_EXIT.x-42,CAVE_EXIT.y-6+i*8,84,2);}
    const objects=[...CAVE_OBJECTS,{...state.player,kind:'player'}].sort((a,b)=>a.y-b.y);
    for(const object of objects){if(object.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,state.scene);else drawCaveObject(g,object,tint);}
    for(const object of CAVE_OBJECTS.filter(o=>o.kind==='crystal')){
      const frame=(Math.floor(anim.time*3)+Math.floor(object.seed*9))%12;if(frame>2)continue;const x=object.x-14+frame*10,y=object.y-48-frame*10;line(g,[[x-2,y],[x+2,y]],'#d8e8ce',ART_PIXEL);line(g,[[x,y-2],[x,y+2]],'#d8e8ce',ART_PIXEL);
    }
  }
  lighting(g,state){
    const clock=clockTime(state.elapsed),hour=clock.hour+clock.minute/60,dark=hour<5||hour>21?.38:hour<7?.38*(7-hour)/2:hour>18?.38*(hour-18)/3:0;
    if(dark>0){g.fillStyle=`rgba(19,29,66,${dark})`;g.fillRect(0,0,this.pixels.width,this.pixels.height);}
    if(hour>16&&hour<20){g.fillStyle=`rgba(235,157,71,${.045*Math.sin((hour-16)/4*Math.PI)})`;g.fillRect(0,0,this.pixels.width,this.pixels.height);}
  }
  caveLighting(g,state){
    const p={x:(state.player.x-this.drawCamera.x)/ART_PIXEL+this.renderCenterX,y:(state.player.y-22-this.drawCamera.y)/ART_PIXEL+this.renderCenterY};
    // Lighting is sampled on the same pixel buffer; the final enlargement never interpolates it.
    const gradient=g.createRadialGradient(p.x,p.y,40,p.x,p.y,200);gradient.addColorStop(0,'#11192d00');gradient.addColorStop(.6,'#11192d22');gradient.addColorStop(1,'#11192d99');g.fillStyle=gradient;g.fillRect(0,0,this.pixels.width,this.pixels.height);
  }
  drawMini(target,state,now) {
    const follow=this.followNpc&&state.scene==='valley'&&!!state.npc,subject=follow?state.npc.position:state.player;
    if(this.lastMiniScene===state.scene&&this.lastMiniFollow===follow&&now-this.lastMini<.7)return;this.lastMini=now;this.lastMiniScene=state.scene;this.lastMiniFollow=follow;
    const g=target.getContext('2d'),w=target.width,h=target.height,scale=state.scene==='valley'?16:4;g.imageSmoothingEnabled=false;
    const sw=70,small=canvas(sw,sw),sg=small.getContext('2d'),img=sg.createImageData(sw,sw);
    for(let y=0;y<sw;y++)for(let x=0;x<sw;x++){
      const wx=subject.x+(x/sw-.5)*w*scale,wy=subject.y+(y/sw-.5)*h*scale;
      const col=state.scene==='valley'?groundColor(wx,wy):caveDistance(wx,wy)<0?[99,121,118]:[36,53,53];
      const i=(y*sw+x)*4;img.data[i]=col[0];img.data[i+1]=col[1];img.data[i+2]=col[2];img.data[i+3]=255;
    }sg.putImageData(img,0,0);g.drawImage(small,0,0,w,h);
    g.fillStyle='#17382d33';g.fillRect(0,0,w,h);
    for(const l of LANDMARKS){if(state.scene!=='valley')break;const x=(l.x-subject.x)/scale+w/2,y=(l.y-subject.y)/scale+h/2;if(x<9||x>w-9||y<9||y>h-9)continue;g.font='13px Georgia';g.textAlign='center';g.fillStyle='#f1dfb0';g.fillText(l.kind==='cave'?'△':l.kind==='camp'?'⌂':'·',x,y);}
    if(state.scene!=='valley'){g.fillStyle='#f0d098';g.fillRect((CAVE_EXIT.x-subject.x)/scale+w/2-3,(CAVE_EXIT.y-subject.y)/scale+h/2-3,6,6);}
    ellipse(g,w/2,h/2,8,8,'#142d27bb');poly(g,[[w/2,h/2-6],[w/2-4,h/2+5],[w/2,h/2+2],[w/2+4,h/2+5]],'#fff1c8');
  }
  drawAtlas(target,state) {
    const g=target.getContext('2d'),w=target.width,h=target.height;g.imageSmoothingEnabled=false;
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
