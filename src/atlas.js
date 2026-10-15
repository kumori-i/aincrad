/** Read-only field-map coordinates. This never changes actor perception or world state. */
export class AtlasViewport {
  constructor({width=840,height=560,bounds={x:-24000,y:-24000,width:48000,height:48000},padding=24,maxZoom=64}={}){
    this.padding=padding;this.maxZoom=maxZoom;this.width=width;this.height=height;this.bounds={...bounds};this.fit();
  }
  fit(){this.zoom=1;this.center={x:this.bounds.x+this.bounds.width/2,y:this.bounds.y+this.bounds.height/2};return this.status();}
  resize(width,height){if(Number.isFinite(width)&&width>0)this.width=width;if(Number.isFinite(height)&&height>0)this.height=height;this.clampCenter();return this.status();}
  setBounds(bounds){if(!bounds||!['x','y','width','height'].every(key=>Number.isFinite(bounds[key]))||bounds.width<=0||bounds.height<=0)return false;this.bounds={...bounds};this.fit();return true;}
  get fitScale(){return Math.max(1e-9,Math.min(Math.max(1,this.width-this.padding*2)/this.bounds.width,Math.max(1,this.height-this.padding*2)/this.bounds.height));}
  get scale(){return this.fitScale*this.zoom;}
  clampCenter(){
    const b=this.bounds,s=this.scale;
    for(const [axis,extent,viewport] of [['x','width',this.width],['y','height',this.height]]){
      const visible=viewport/s;
      this.center[axis]=visible>=b[extent]?b[axis]+b[extent]/2:Math.max(b[axis]+visible/2,Math.min(b[axis]+b[extent]-visible/2,this.center[axis]));
    }
  }
  toCanvas(x,y){return{x:this.width/2+(x-this.center.x)*this.scale,y:this.height/2+(y-this.center.y)*this.scale};}
  toWorld(x,y,{bounded=true}={}){
    if(!Number.isFinite(x)||!Number.isFinite(y))return null;
    const p={x:this.center.x+(x-this.width/2)/this.scale,y:this.center.y+(y-this.height/2)/this.scale},b=this.bounds;
    if(bounded&&(x<0||y<0||x>this.width||y>this.height||p.x<b.x||p.x>b.x+b.width||p.y<b.y||p.y>b.y+b.height))return null;
    return p;
  }
  zoomAt(factor,x=this.width/2,y=this.height/2){
    if(!Number.isFinite(factor)||factor<=0)return this.status();
    const anchor=this.toWorld(x,y,{bounded:false});this.zoom=Math.max(1,Math.min(this.maxZoom,this.zoom*factor));
    this.center={x:anchor.x-(x-this.width/2)/this.scale,y:anchor.y-(y-this.height/2)/this.scale};this.clampCenter();return this.status();
  }
  pan(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return this.status();this.center.x-=dx/this.scale;this.center.y-=dy/this.scale;this.clampCenter();return this.status();}
  centerOn(x,y){if(Number.isFinite(x)&&Number.isFinite(y)){this.center={x,y};this.clampCenter();}return this.status();}
  status(){return{zoom:this.zoom,scale:this.scale,center:{...this.center},width:this.width,height:this.height,bounds:{...this.bounds}};}
}

/** Cave occupants are projected to their entrance on the whole-valley map. */
export function atlasActors(state,caves=[]){
  const agents=Array.isArray(state.agents)&&state.agents.length?state.agents:state.npc?[state.npc]:[];
  return[{id:'you',name:'You',position:state.player,scene:state.scene||'valley',color:'#f6d68b'},...agents.map(agent=>({id:agent.id,name:agent.name||agent.id,position:agent.position,scene:agent.scene||'valley',color:agent.id==='mira'?'#d4b4e5':'#c2df88'}))].map(actor=>{
    const cave=actor.scene==='valley'?null:caves.find(item=>item.id===actor.scene);
    const position=cave?{x:cave.x,y:cave.y}:actor.position;
    return{...actor,position,place:cave?cave.name:actor.scene==='valley'?'Valley':actor.scene,inCave:Boolean(cave)};
  }).filter(actor=>Number.isFinite(actor.position?.x)&&Number.isFinite(actor.position?.y));
}
