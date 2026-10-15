import { CONFIG, CAVES, SPAWN, CAVE_EXIT, LANDMARKS, APPLE_PATCHES } from './config.js';
import { lerp, hash, ridgeValue, objectsInRect, riverWidth, BRIDGES, waterDistance, caveDistance, CAVE_OBJECTS, HABITAT_TRAILS } from './world.js';
import { ART_PIXEL, canvas, makeGroundChunk, groundColor, ellipse, line, poly, drawObject, drawAvatar, drawBridge, drawCamp, drawCaveEntrance, drawCaveObject, drawNpc, drawApplePatch, drawFauna, drawEcologyObject, drawShelterLamp, drawFieldNote } from './art.js';

import { environmentConditions, ambientEcology } from './environment.js';
import { foodSource } from './resources.js';
import { renderEcology } from './ecology.js';
import { AtlasViewport, atlasActors } from './atlas.js';

/** The world is painted into an art-pixel buffer, then enlarged by an integer factor. */
export class Renderer {
  constructor(target,state){
    this.canvas=target;this.ctx=target.getContext('2d',{alpha:false});
    if(!this.ctx)throw new Error('A Canvas 2D context is required to run Aincrad.');
    this.pixels=canvas(1,1);this.pixelCtx=this.pixels.getContext('2d',{alpha:false});
    this.camera={x:state.player.x-220,y:state.player.y-70};this.zoom=1.5;this.targetZoom=1.5;
    this.chunks=new Map();this.caveCanvas=null;this.mapCanvas=null;this.scene=state.scene;
    this.atlasView=new AtlasViewport({bounds:{x:-CONFIG.halfSize,y:-CONFIG.halfSize,width:CONFIG.halfSize*2,height:CONFIG.halfSize*2}});this.atlasScene='valley';this.atlasMarkers=[];this.atlasDetail=null;
    this.followNpc=false;this.followId='aster';this.inspectorOpen=false;this.viewportOffsetX=0;this.frame=0;this.lastMini=0;this.resize();
  }
  resize(){this.width=window.innerWidth;this.height=window.innerHeight;this.dpr=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);this.ctx.imageSmoothingEnabled=false;}
  snap(p){this.camera={...p};}
  agents(state){return Array.isArray(state.agents)&&state.agents.length?state.agents:state.npc?[state.npc]:[];}
  selectedAgent(state){return this.agents(state).find(agent=>agent.id===this.followId)||state.npc||this.agents(state)[0]||null;}
  viewScene(state){const agent=this.selectedAgent(state);return this.followNpc&&agent?(agent.scene||'valley'):state.scene;}
  viewSubject(state){const agent=this.selectedAgent(state);return this.followNpc&&agent?agent.position:state.player;}
  conditions(state,scene=this.viewScene(state)){return environmentConditions(state.environment,{position:this.viewSubject(state),scene,wetness:this.followNpc?(this.selectedAgent(state)?.thermal?.wetness||0):0});}
  notes(state,scene){return (state.community?.notes||[]).filter(note=>(note.scene||'valley')===scene&&Number.isFinite(note.position?.x)&&Number.isFinite(note.position?.y));}
  ecosystem(state,scene){return state.simulationMode==='discovery'?renderEcology(state.environment?.ecology,scene):[];}
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
    const p=this.viewSubject(state),scene=this.viewScene(state);this.frame++;
    if(this.scene!==scene){this.scene=scene;this.snap(p);this.caveCanvas=null;}
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
    if(scene==='valley')this.drawValley(g,state,anim,view);else this.drawCave(g,state,anim,view);g.restore();
    if(scene==='valley'){this.weatherOverlay(g,state);this.lighting(g,state);}else this.caveLighting(g,state);
    this.ctx.setTransform(1,0,0,1,0,0);this.ctx.imageSmoothingEnabled=false;this.ctx.drawImage(this.pixels,0,0,w*this.pixelScale,h*this.pixelScale);
  }
  drawValley(g,state,anim,v){
    const size=CONFIG.chunkSize,time=state.environment?.elapsed??state.elapsed;
    for(let cy=Math.floor(v.y/size);cy<=Math.floor((v.y+v.h)/size);cy++)for(let cx=Math.floor(v.x/size);cx<=Math.floor((v.x+v.w)/size);cx++)g.drawImage(this.chunk(cx,cy),cx*size,cy*size,size,size);
    // Two discrete ripple frames keep the river alive without moving its collision boundary.
    const waterFrame=Math.floor(time*2)%4;
    for(let cy=Math.floor(v.y/62);cy<=Math.floor((v.y+v.h)/62);cy++)for(let cx=Math.floor(v.x/72);cx<=Math.floor((v.x+v.w)/72);cx++){
      const x=Math.round((cx*72+hash(cx,cy,370)*42)/ART_PIXEL)*ART_PIXEL,y=Math.round((cy*62+hash(cx,cy,822)*38)/ART_PIXEL)*ART_PIXEL;
      if(waterDistance(x,y)>-23)continue;const phase=(waterFrame+Math.floor(hash(cx,cy,384)*4))%4;if(phase===3)continue;
      line(g,[[x-10,y],[x-2,y],[x,y-2],[x+12,y-2]],phase===0?'#97d1cd':'#6bbdc5',ART_PIXEL);if(phase===1)line(g,[[x-4,y+6],[x+6,y+6]],'#b4e0d5',ART_PIXEL);
    }
    for(const bridge of BRIDGES)if(Math.abs(bridge.x-this.camera.x)<v.w&&Math.abs(bridge.y-this.camera.y)<v.h)drawBridge(g,bridge,riverWidth(bridge.y));
    const objects=objectsInRect(v.x,v.y,v.w,v.h);
    if(state.simulationMode==='discovery')for(const entity of this.ecosystem(state,'valley'))objects.push({kind:'ecosystem',x:entity.x,y:entity.y,entity});
    else{
      for(const patch of APPLE_PATCHES){if(patch.x<v.x-100||patch.x>v.x+v.w+100||patch.y<v.y-100||patch.y>v.y+v.h+100)continue;const resource=foodSource('apple:'+patch.id,state.environment);objects.push({...patch,kind:'apple',stock:resource?.stock??0,capacity:resource?.capacity??patch.capacity});}
      for(const animal of ambientEcology(this.drawCamera,Math.hypot(v.w,v.h)/2+140,state.environment))objects.push({...animal,kind:'fauna',definition:animal});
    }
    for(let cy=Math.floor(v.y/240);cy<=Math.floor((v.y+v.h+300)/240);cy++)for(let cx=Math.floor(v.x/340);cx<=Math.floor((v.x+v.w)/340);cx++){
      const x=cx*340+hash(cx,cy,992)*32,y=cy*240+hash(cx,cy,199)*48;
      if(ridgeValue(x,y)<1.008||CAVES.some(c=>Math.hypot(x-c.x,y-c.y)<330))continue;
      objects.push({kind:'mountain',x,y,scale:.95+hash(cx,cy,893)*.15,variant:Math.floor(hash(cx,cy,753)*3)});
    }
    objects.push({kind:'camp',x:SPAWN.x,y:SPAWN.y-10});for(const cave of CAVES)objects.push({kind:'cave',x:cave.x,y:cave.y,definition:cave});
    for(const note of this.notes(state,'valley'))objects.push({kind:'note',x:note.position.x,y:note.position.y,note});
    if(state.scene==='valley')objects.push({kind:'player',x:state.player.x,y:state.player.y});
    for(const agent of this.agents(state))if((agent.scene||'valley')==='valley')objects.push({kind:'npc',x:agent.position.x,y:agent.position.y,agent});objects.sort((a,b)=>a.y-b.y);
    for(const object of objects){
      if(object.x<v.x-420||object.x>v.x+v.w+420||object.y<v.y-100||object.y>v.y+v.h+400)continue;
      if(object.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,state.scene);
      else if(object.kind==='npc')drawNpc(g,object.agent,time);
      else if(object.kind==='note')drawFieldNote(g,object.note);
      else if(object.kind==='ecosystem')drawEcologyObject(g,object.entity,time,this.viewSubject(state));
      else if(object.kind==='apple')drawApplePatch(g,object,object.stock,object.capacity);
      else if(object.kind==='fauna')drawFauna(g,object.definition,time);
      else if(object.kind==='camp')drawCamp(g,SPAWN.x,SPAWN.y-10,time);
      else if(object.kind==='cave')drawCaveEntrance(g,object.definition);
      else drawObject(g,object,this.viewSubject(state));
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
    const scene=this.viewScene(state),time=state.environment?.elapsed??state.elapsed,tint=CAVES.find(c=>c.id===scene)?.tint||'#83cbc6';
    for(let i=0;i<6;i++){g.fillStyle=i%2?'#c3b98d':'#7c8177';g.fillRect(CAVE_EXIT.x-42,CAVE_EXIT.y-12+i*8,84,6);g.fillStyle='#4f6164';g.fillRect(CAVE_EXIT.x-42,CAVE_EXIT.y-6+i*8,84,2);}
    // Shelter has warm lamps and moss, while its authoritative room geometry stays unchanged.
    drawShelterLamp(g,CAVE_EXIT.x+78,CAVE_EXIT.y-38);drawShelterLamp(g,1160,1150);
    for(let i=0;i<16;i++){const x=1170+hash(i,0,608)*300,y=1380+hash(i,1,821)*95;if(caveDistance(x,y)>-25)continue;ellipse(g,x,y,9+(i%4)*2,4,'#6f806744');line(g,[[x-5,y],[x-2,y-4],[x+2,y]],'#93a46e',ART_PIXEL);}
    const objects=[...CAVE_OBJECTS];if(state.scene===scene)objects.push({...state.player,kind:'player'});
    for(const agent of this.agents(state))if((agent.scene||'valley')===scene)objects.push({...agent.position,kind:'npc',agent});
    for(const entity of this.ecosystem(state,scene))objects.push({kind:'ecosystem',x:entity.x,y:entity.y,entity});
    for(const note of this.notes(state,scene))objects.push({...note.position,kind:'note',note});objects.sort((a,b)=>a.y-b.y);
    for(const object of objects){if(object.kind==='player')drawAvatar(g,state.player,anim.facing,anim.time,anim.moving,scene);else if(object.kind==='npc')drawNpc(g,object.agent,time);else if(object.kind==='note')drawFieldNote(g,object.note);else if(object.kind==='ecosystem')drawEcologyObject(g,object.entity,time,this.viewSubject(state));else drawCaveObject(g,object,tint);}
    for(const object of CAVE_OBJECTS.filter(o=>o.kind==='crystal')){
      const frame=(Math.floor(time*3)+Math.floor(object.seed*9))%12;if(frame>2)continue;const x=object.x-14+frame*10,y=object.y-48-frame*10;line(g,[[x-2,y],[x+2,y]],'#d8e8ce',ART_PIXEL);line(g,[[x,y-2],[x,y+2]],'#d8e8ce',ART_PIXEL);
    }
  }
  weatherOverlay(g,state){
    const conditions=this.conditions(state,'valley'),time=state.environment?.elapsed??state.elapsed,w=this.pixels.width,h=this.pixels.height;
    if(conditions.weather==='cloudy'||conditions.raining){g.fillStyle=conditions.raining?'#34536530':'#3a51611d';g.fillRect(0,0,w,h);}
    if(conditions.raining){
      // Rain follows the saved simulation clock; only an explicit pause freezes it.
      const phase=Math.floor(time*18),wind=Math.min(5,Math.round(conditions.wind||0));
      for(let row=-1;row<=Math.ceil(h/24);row++)for(let col=-1;col<=Math.ceil(w/23);col++){
        const seed=hash(col,row,1786),x=((col*23+Math.floor(seed*17)+Math.floor(phase/3)*wind)% (w+24)+w+24)%(w+24)-12,y=((row*24+Math.floor(hash(col,row,879)*18)+phase)%(h+24)+h+24)%(h+24)-12;
        line(g,[[x,y],[x-wind*.5,y+5+(seed>.7?2:0)]],seed>.75?'#c4d8d975':'#a9c5d34d',1,1);
      }
    }else if(conditions.weather==='windy'){
      const phase=Math.floor(time*10),direction=(Math.floor(time/120)%2)?-1:1;
      for(let i=0;i<9;i++){const x=((hash(i,0,277)*w+phase*direction)%w+w)%w,y=Math.floor(hash(i,1,517)*h);line(g,[[x-8,y],[x+3,y],[x+6,y-1],[x+10,y-1]],'#d0d9b52c',1,1);}
    }
  }
  lighting(g,state){
    const hour=this.conditions(state,'valley').hour,dark=hour<5||hour>21?.53:hour<7?.53*(7-hour)/2:hour>18?.53*(hour-18)/3:0;
    if(dark>0){g.fillStyle=`rgba(19,29,66,${dark})`;g.fillRect(0,0,this.pixels.width,this.pixels.height);}
    if(hour>16&&hour<20){g.fillStyle=`rgba(235,157,71,${.065*Math.sin((hour-16)/4*Math.PI)})`;g.fillRect(0,0,this.pixels.width,this.pixels.height);}
  }
  caveLighting(g,state){
    const subject=this.viewSubject(state),p={x:(subject.x-this.drawCamera.x)/ART_PIXEL+this.renderCenterX,y:(subject.y-22-this.drawCamera.y)/ART_PIXEL+this.renderCenterY};
    // Lighting is sampled on the same pixel buffer; the final enlargement never interpolates it.
    const gradient=g.createRadialGradient(p.x,p.y,40,p.x,p.y,200);gradient.addColorStop(0,'#29251b00');gradient.addColorStop(.6,'#24292518');gradient.addColorStop(1,'#17262d80');g.fillStyle=gradient;g.fillRect(0,0,this.pixels.width,this.pixels.height);
  }
  drawMini(target,state,now) {
    const follow=this.followNpc&&!!this.selectedAgent(state),subject=this.viewSubject(state),scene=this.viewScene(state);
    if(this.lastMiniScene===scene&&this.lastMiniFollow===follow&&this.lastMiniFollowId===this.followId&&now-this.lastMini<.7)return;this.lastMini=now;this.lastMiniScene=scene;this.lastMiniFollow=follow;this.lastMiniFollowId=this.followId;
    const g=target.getContext('2d'),w=target.width,h=target.height,scale=scene==='valley'?16:4;g.imageSmoothingEnabled=false;
    const sw=70,small=canvas(sw,sw),sg=small.getContext('2d'),img=sg.createImageData(sw,sw);
    for(let y=0;y<sw;y++)for(let x=0;x<sw;x++){
      const wx=subject.x+(x/sw-.5)*w*scale,wy=subject.y+(y/sw-.5)*h*scale;
      const col=scene==='valley'?groundColor(wx,wy):caveDistance(wx,wy)<0?[99,121,118]:[36,53,53];
      const i=(y*sw+x)*4;img.data[i]=col[0];img.data[i+1]=col[1];img.data[i+2]=col[2];img.data[i+3]=255;
    }sg.putImageData(img,0,0);g.drawImage(small,0,0,w,h);
    g.fillStyle='#17382d33';g.fillRect(0,0,w,h);
    for(const l of LANDMARKS){if(scene!=='valley')break;const x=(l.x-subject.x)/scale+w/2,y=(l.y-subject.y)/scale+h/2;if(x<9||x>w-9||y<9||y>h-9)continue;g.font='13px Georgia';g.textAlign='center';g.fillStyle='#f1dfb0';g.fillText(l.kind==='cave'?'△':l.kind==='camp'?'⌂':'·',x,y);}
    if(scene!=='valley'){g.fillStyle='#f0d098';g.fillRect((CAVE_EXIT.x-subject.x)/scale+w/2-3,(CAVE_EXIT.y-subject.y)/scale+h/2-3,6,6);}
    for(const note of this.notes(state,scene)){const x=(note.position.x-subject.x)/scale+w/2,y=(note.position.y-subject.y)/scale+h/2;if(x<3||x>w-3||y<3||y>h-3)continue;g.fillStyle='#ecd7a0';g.fillRect(Math.round(x)-1,Math.round(y)-2,3,4);}
    if(state.scene===scene){const x=(state.player.x-subject.x)/scale+w/2,y=(state.player.y-subject.y)/scale+h/2;poly(g,[[x,y-4],[x-3,y+3],[x+3,y+3]],'#f3d399');}
    for(const agent of this.agents(state)){
      if((agent.scene||'valley')!==scene)continue;const x=(agent.position.x-subject.x)/scale+w/2,y=(agent.position.y-subject.y)/scale+h/2;if(x<4||x>w-4||y<4||y>h-4)continue;
      const color=agent.id==='mira'?'#ceb0d7':'#b7d584';poly(g,[[x,y-4],[x+3,y],[x,y+4],[x-3,y]],color);if(follow&&agent===this.selectedAgent(state)){g.strokeStyle='#fff1c8';g.lineWidth=1;g.strokeRect(Math.round(x)-5,Math.round(y)-5,10,10);}
    }
    if(!follow){ellipse(g,w/2,h/2,8,8,'#142d27bb');poly(g,[[w/2,h/2-6],[w/2-4,h/2+5],[w/2,h/2+2],[w/2+4,h/2+5]],'#fff1c8');}
  }
  atlasStatus(){return{...this.atlasView.status(),scene:this.atlasScene};}
  atlasFit(){return this.atlasView.fit();}
  atlasZoom(factor,x,y){return this.atlasView.zoomAt(factor,x,y);}
  atlasPan(dx,dy){return this.atlasView.pan(dx,dy);}
  atlasCenter(id,state){
    const actor=atlasActors(state,CAVES).find(item=>item.id===id);if(!actor)return false;
    if(this.atlasScene!=='valley'){this.atlasScene='valley';this.atlasView.setBounds({x:-CONFIG.halfSize,y:-CONFIG.halfSize,width:CONFIG.halfSize*2,height:CONFIG.halfSize*2});}
    if(this.atlasView.zoom<8)this.atlasView.zoomAt(8/this.atlasView.zoom);
    this.atlasView.centerOn(actor.position.x,actor.position.y);return true;
  }
  atlasMarkerAt(x,y){return [...this.atlasMarkers].reverse().find(marker=>Math.hypot(marker.x-x,marker.y-y)<11||x>=marker.label.x&&x<=marker.label.x+marker.label.w&&y>=marker.label.y&&y<=marker.label.y+marker.label.h)?.id||null;}
  atlasPoint(x,y){return this.atlasView.toWorld(x,y);}
  atlasTerrain(g,w,h){
    const view=this.atlasView,b=view.bounds,scale=view.scale;
    if(!this.mapCanvas){
      this.mapCanvas=canvas(420,420);const m=this.mapCanvas.getContext('2d'),img=m.createImageData(420,420);
      for(let y=0;y<420;y++)for(let x=0;x<420;x++){const col=groundColor((x/420-.5)*CONFIG.halfSize*2,(y/420-.5)*CONFIG.halfSize*2,true),i=(y*420+x)*4;img.data[i]=col[0];img.data[i+1]=col[1];img.data[i+2]=col[2];img.data[i+3]=255;}m.putImageData(img,0,0);
    }
    const corner=view.toCanvas(b.x,b.y);g.drawImage(this.mapCanvas,corner.x,corner.y,b.width*scale,b.height*scale);
    if(view.zoom<=2)return;
    // Sample visible terrain at higher zoom; this is artwork, never a world-rule tick.
    const quantum=32/scale,key=`${Math.round(view.center.x/quantum)},${Math.round(view.center.y/quantum)},${view.zoom},${w},${h}`;
    if(this.atlasDetail?.key!==key){
      const pw=Math.min(500,Math.ceil(w*.6)),ph=Math.min(400,Math.ceil(h*.6)),image=canvas(pw,ph),ig=image.getContext('2d'),pixels=ig.createImageData(pw,ph),ww=w*1.25/scale,wh=h*1.25/scale,ox=view.center.x-ww/2,oy=view.center.y-wh/2;
      for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){const col=groundColor(ox+x/pw*ww,oy+y/ph*wh,true),i=(y*pw+x)*4;pixels.data[i]=col[0];pixels.data[i+1]=col[1];pixels.data[i+2]=col[2];pixels.data[i+3]=255;}ig.putImageData(pixels,0,0);this.atlasDetail={key,image,ox,oy,ww,wh};
    }
    const detail=this.atlasDetail,p=view.toCanvas(detail.ox,detail.oy);g.drawImage(detail.image,p.x,p.y,detail.ww*scale,detail.wh*scale);
  }
  drawAtlas(target,state,{scene='valley'}={}) {
    const size=target.getBoundingClientRect?.();if(size?.width>0&&size?.height>0){const width=Math.round(size.width),height=Math.round(size.height);if(target.width!==width)target.width=width;if(target.height!==height)target.height=height;}
    const g=target.getContext('2d'),w=target.width,h=target.height,isValley=scene==='valley';g.imageSmoothingEnabled=false;
    if(this.atlasScene!==scene){this.atlasScene=scene;this.atlasView.setBounds(isValley?{x:-CONFIG.halfSize,y:-CONFIG.halfSize,width:CONFIG.halfSize*2,height:CONFIG.halfSize*2}:{x:0,y:0,width:2700,height:1900});}
    this.atlasView.resize(w,h);const view=this.atlasView,b=view.bounds,scale=view.scale,toMap=(x,y)=>view.toCanvas(x,y),corner=toMap(b.x,b.y),mx=corner.x,my=corner.y,worldW=b.width,worldH=b.height;
    g.fillStyle='#1a332d';g.fillRect(0,0,w,h);g.save();g.beginPath();g.rect(Math.max(0,mx),Math.max(0,my),Math.min(w,mx+worldW*scale)-Math.max(0,mx),Math.min(h,my+worldH*scale)-Math.max(0,my));g.clip();
    if(isValley)this.atlasTerrain(g,w,h);
    else{if(!this.caveCanvas)this.buildCave();g.drawImage(this.caveCanvas,mx,my,worldW*scale,worldH*scale);for(const o of CAVE_OBJECTS){const p=toMap(o.x,o.y);ellipse(g,p.x,p.y,2,2,o.kind==='crystal'?(CAVES.find(c=>c.id===scene)?.tint??'#bdf'):'#bec5ad');}}
    g.fillStyle='#12362618';g.fillRect(mx,my,worldW*scale,worldH*scale);
    for(let i=0;i<=6;i++){line(g,[[mx+worldW*scale*i/6,my],[mx+worldW*scale*i/6,my+worldH*scale]],'#efedc416',1);line(g,[[mx,my+worldH*scale*i/6],[mx+worldW*scale,my+worldH*scale*i/6]],'#efedc416',1);}
    if(isValley){
      g.save();g.setLineDash([3,3]);for(const y of [0,-12600,11800]){const a=toMap(-21600,y),bp=toMap(21600,y);line(g,[[a.x,a.y],[bp.x,bp.y]],'#e1cf9866',1);}
      for(const c of CAVES){if(c.id==='refuge')continue;const a=toMap(c.x,c.y),bp=toMap(c.x,c.y<0?-12600:11800);line(g,[[a.x,a.y],[bp.x,bp.y]],'#e1cf9866',1);}
      for(const [ax,ay,bx,by] of HABITAT_TRAILS){const a=toMap(ax,ay),bp=toMap(bx,by);line(g,[[a.x,a.y],[bp.x,bp.y]],'#e1cf9888',1);}g.restore();
      for(const l of LANDMARKS){const p=toMap(l.x,l.y);if(p.x<-160||p.x>w+160||p.y<-30||p.y>h+30)continue;const discovered=state.discoveries.includes(l.id);g.textAlign='center';g.font='16px Georgia';g.fillStyle=discovered?'#fff0c1':'#e5dfb8';g.shadowColor='#173b32';g.shadowBlur=5;g.fillText(l.kind==='cave'?'△':l.kind==='camp'?'⌂':'·',p.x,p.y);g.font='11px "Courier New",monospace';g.fillText(l.name,p.x,p.y+15);g.shadowBlur=0;}
    }else{const exit=toMap(CAVE_EXIT.x,CAVE_EXIT.y);g.fillStyle='#f1d499';g.font='11px "Courier New",monospace';g.textAlign='center';g.fillText('↑ Valley exit',exit.x,exit.y+18);}
    for(const note of this.notes(state,scene)){const np=toMap(note.position.x,note.position.y);g.fillStyle='#e7d5a6';g.fillRect(Math.round(np.x)-2,Math.round(np.y)-3,4,6);}
    if(state.waypoint&&isValley){const wp=toMap(state.waypoint.x,state.waypoint.y);poly(g,[[wp.x,wp.y-7],[wp.x+5,wp.y],[wp.x,wp.y+7],[wp.x-5,wp.y]],'#f0cd82');}
    g.restore();
    // Constant-size, labelled markers remain legible when the whole valley is fitted.
    const actors=isValley?atlasActors(state,CAVES):atlasActors(state,CAVES).filter(actor=>actor.scene===scene).map(actor=>({...actor,position:actor.id==='you'?state.player:this.agents(state).find(n=>n.id===actor.id).position}));
    this.atlasMarkers=[];g.font='bold 12px "Courier New",monospace';g.textAlign='left';g.textBaseline='middle';
    for(let index=0;index<actors.length;index++){
      const actor=actors[index],point=toMap(actor.position.x,actor.position.y),outside=point.x<9||point.x>w-9||point.y<9||point.y>h-9,x=Math.max(9,Math.min(w-9,point.x)),y=Math.max(9,Math.min(h-9,point.y)),text=actor.name+(actor.inCave?' · '+actor.place:'')+(outside?' · beyond view':'');
      const labelW=Math.min(w-16,g.measureText(text).width+12),labelH=21;let lx=Math.max(8,Math.min(w-labelW-8,x+(index===0?-labelW-14:14))),ly=Math.max(8,Math.min(h-labelH-8,y+(index===2?15:-28)));
      for(let attempt=0;attempt<8&&this.atlasMarkers.some(other=>lx<other.label.x+other.label.w+3&&lx+labelW+3>other.label.x&&ly<other.label.y+other.label.h+3&&ly+labelH+3>other.label.y);attempt++)ly=Math.max(8,Math.min(h-labelH-8,ly+(index%2?25:-25)));
      const label={x:lx,y:ly,w:labelW,h:labelH};line(g,[[x,y],[lx+(lx<x?labelW:0),ly+labelH/2]],actor.color,1);g.fillStyle='#18362ee8';g.fillRect(lx,ly,labelW,labelH);g.strokeStyle=actor.color;g.lineWidth=1;g.strokeRect(lx+.5,ly+.5,labelW-1,labelH-1);g.fillStyle=actor.color;g.fillText(text,lx+6,ly+labelH/2);
      g.fillStyle='#18362e';g.fillRect(x-6,y-6,12,12);g.fillStyle=actor.color;if(actor.id==='you')poly(g,[[x,y-5],[x-4,y+4],[x+4,y+4]],actor.color);else{g.fillRect(x-4,y-4,8,8);if(actor.inCave){g.strokeStyle='#fff0c9';g.strokeRect(x-6.5,y-6.5,13,13);}}
      this.atlasMarkers.push({id:actor.id,x,y,label,scene:actor.scene,position:{...actor.position}});
    }
    g.textBaseline='alphabetic';
    this.atlasTransform={mx,my,scale,ox:b.x,oy:b.y,worldW,worldH};
  }
}
