/** Offline drawing of a proposed landscape. This file is not a game map. */
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {generateOzarkPreview} from './ozark-preview-model.mjs';

const CANVAS={width:1340,height:915,mapX:42,mapY:153,cell:9};
const INK='#e9e6ce',MUTED='#b5bfab',PANEL='#18352f',EDGE='#698072';
const COLORS={
  'dry-rocky-glade':'#b1ad78',
  'open-clearing':'#c7bb89',
  'oak-pine-woodland':'#799466',
  'shaded-cove':'#426c61',
  'wet-terrace':'#73a47c',
  'river-channel':'#9ab9a4',
  'spring-seep':'#79a99d',
  'sinkhole-basin':'#8b9a83',
};

function xml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function n(value){return Number(value).toFixed(2).replace(/\.00$/,'');}
function point(index,model){
  if(!Number.isInteger(index)||index<0||index>=model.cells.length)throw new RangeError('Feature cell index outside preview grid');
  const {x,y}=model.cells[index];
  return {x:CANVAS.mapX+(x+.5)*CANVAS.cell,y:CANVAS.mapY+(y+.5)*CANVAS.cell};
}
function pathFrom(indices,model){
  if(!Array.isArray(indices)||indices.length<2)return '';
  return indices.map((index,i)=>{const p=point(index,model);return `${i?'L':'M'}${n(p.x)} ${n(p.y)}`;}).join(' ');
}
function downstream(indices,model){
  if(!Array.isArray(indices))return [];
  const copy=[...indices];
  if(copy.length>1&&model.cells[copy[0]].height<model.cells[copy.at(-1)].height)copy.reverse();
  return copy;
}
function flowArrow(indices,model,fraction,color='#d9eff0'){
  if(indices.length<3)return '';
  const mid=Math.max(1,Math.min(indices.length-2,Math.floor((indices.length-1)*fraction)));
  const a=point(indices[mid-1],model),b=point(indices[mid+1],model),c=point(indices[mid],model);
  const angle=Math.atan2(b.y-a.y,b.x-a.x),cos=Math.cos(angle),sin=Math.sin(angle);
  const tip={x:c.x+cos*6,y:c.y+sin*6};
  const left={x:c.x-cos*5-sin*4,y:c.y-sin*5+cos*4};
  const right={x:c.x-cos*5+sin*4,y:c.y-sin*5-cos*4};
  return `<path data-feature="flow-arrow" d="M${n(tip.x)} ${n(tip.y)} L${n(left.x)} ${n(left.y)} L${n(right.x)} ${n(right.y)} Z" fill="${color}" stroke="#28566b" stroke-width="1"/>`;
}
function callout(index,model,label,{dx=25,dy=-22,color='#c7e4d7',side='right'}={}){
  const p=point(index,model),endX=p.x+dx,endY=p.y+dy,anchor=side==='left'?'end':'start';
  const textX=endX+(side==='left'?-5:5);
  const labelWidth=label.length*8.2+12,backX=side==='left'?textX-labelWidth+4:textX-4;
  return `<g class="callout"><path d="M${n(p.x)} ${n(p.y)} L${n(endX)} ${n(endY)}" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="${n(p.x)}" cy="${n(p.y)}" r="4" fill="${color}" stroke="#16352f" stroke-width="1.5"/><rect x="${n(backX)}" y="${n(endY-20)}" width="${n(labelWidth)}" height="22" rx="2" fill="#17352f" fill-opacity=".9"/><text x="${n(textX)}" y="${n(endY-4)}" text-anchor="${anchor}" fill="${INK}" font-size="13" letter-spacing=".06em">${xml(label)}</text></g>`;
}
function swatch(x,y,color,label){return `<rect x="${x}" y="${y-11}" width="18" height="13" fill="${color}"/><text x="${x+28}" y="${y}" fill="${INK}" font-size="15">${xml(label)}</text>`;}

/** Render a deterministic, self-contained SVG from a version 1 design descriptor. */
export function renderOzarkPreview(model){
  if(model?.previewVersion!==1||!Number.isInteger(model.width)||!Number.isInteger(model.height)||model.width<1||model.height<1||model.width>128||model.height>128||model.cells?.length!==model.width*model.height)throw new TypeError('Expected a bounded version 1 Ozark preview descriptor');
  const {width,height,cells}=model,{mapX,mapY,cell}=CANVAS;
  const mapWidth=width*cell,mapHeight=height*cell;
  if(mapWidth>864||mapHeight>648)throw new RangeError('Preview grid exceeds drawing panel');
  const paint=new Map();
  for(let i=0;i<cells.length;i++){
    const c=cells[i];
    if(!Number.isInteger(c.x)||!Number.isInteger(c.y)||c.x!==i%width||c.y!==Math.floor(i/width)||!Number.isFinite(c.height))throw new TypeError('Malformed preview cell');
    if(!Object.hasOwn(COLORS,c.habitat))throw new TypeError(`Unknown preview habitat: ${c.habitat}`);
    const key=c.habitat;
    const bucket=paint.get(key)||[];
    const x=mapX+c.x*cell,y=mapY+c.y*cell;
    bucket.push(`M${x} ${y}h${cell}v${cell}h-${cell}z`);
    paint.set(key,bucket);
  }
  const land=[...paint].map(([key,paths])=>`<path data-habitat="${xml(key)}" d="${paths.join('')}" fill="${COLORS[key]}"/>`).join('\n');
  const main=downstream(model.mainChannel,model);
  const tributaries=(model.tributaries||[]).map(t=>downstream(t.cells,model));
  const branch=downstream(model.spring?.branchCells||[],model);
  const riverD=pathFrom(main,model),branchD=pathFrom(branch,model);
  const tributaryPaths=tributaries.map((cells,i)=>`<path data-feature="tributary" data-tributary="${xml(model.tributaries[i].id)}" d="${pathFrom(cells,model)}" fill="none" stroke="#5aa4b2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n');
  const outlet=point(model.outlet.cell,model),spring=point(model.spring.poolCell,model);
  const sinkhole=model.sinkhole,sp=sinkhole?point(sinkhole.cell,model):null;
  const sinkholeSvg=sinkhole?`<g data-feature="internal-sinkhole"><circle cx="${n(sp.x)}" cy="${n(sp.y)}" r="${Math.max(9,Math.min(28,sinkhole.radius*cell))}" fill="#607d76" fill-opacity=".55" stroke="#e6c79d" stroke-width="2.5" stroke-dasharray="4 4"/><circle cx="${n(sp.x)}" cy="${n(sp.y)}" r="4" fill="#e6c79d"/><path d="M${n(sp.x-4)} ${n(sp.y+9)}v7l-4-4m4 4 4-4" fill="none" stroke="#e6c79d" stroke-width="2"/></g>`:'';
  const scaleCells=model.relativeScale?.barCells;
  if(!Number.isInteger(scaleCells)||scaleCells<1||scaleCells>width)throw new TypeError('Invalid relative preview scale');
  const relativeWidth=scaleCells*cell;
  const scaleX=mapX+mapWidth-relativeWidth-60;
  const scaleLabel=`${scaleCells} relative cells`;
  const labels=[
    callout(model.spring.poolCell,model,'BLUFF SPRING',{dx:spring.x>mapX+mapWidth*.68?-25:24,dy:-26,side:spring.x>mapX+mapWidth*.68?'left':'right'}),
    sinkhole?callout(sinkhole.cell,model,'INTERNAL SINKHOLE',{dx:sp.x>mapX+mapWidth*.65?-24:24,dy:35,side:sp.x>mapX+mapWidth*.65?'left':'right',color:'#e6c79d'}):'',
    callout(model.outlet.cell,model,'OUTLET',{dx:outlet.x>mapX+mapWidth*.7?-22:22,dy:-25,side:outlet.x>mapX+mapWidth*.7?'left':'right'}),
  ].join('\n');
  const flow=[flowArrow(main,model,.25),flowArrow(main,model,.58),flowArrow(main,model,.84),...tributaries.map(t=>flowArrow(t,model,.58)),flowArrow(branch,model,.6,'#ecf2df')].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" width="${CANVAS.width}" height="${CANVAS.height}" role="img" aria-labelledby="title desc">
<title id="title">Aincrad fictional Ozark tributary — design preview, seed ${xml(model.seed)}</title>
<desc id="desc">Offline terrain, drainage, and habitat sketch. Not playable and not scientifically calibrated. The spring connects to the river.${sinkhole?' The internal sinkhole has no surface outlet.':''}</desc>
<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="#102a25"/>
<rect x="24" y="24" width="1292" height="867" rx="4" fill="${PANEL}" stroke="${EDGE}" stroke-width="1"/>
<text x="42" y="61" fill="#e4c78e" font-size="15" font-weight="700" letter-spacing=".22em">DESIGN PREVIEW</text>
<text x="42" y="99" fill="${INK}" font-size="31" font-family="Georgia,serif">A fictional Ozark tributary valley</text>
<text x="43" y="123" fill="${MUTED}" font-size="14">Seed ${xml(model.seed)} · preview v${model.previewVersion} · ${width} × ${height} relative cells · authored drainage, seeded landform detail</text>
<rect x="${mapX-2}" y="${mapY-2}" width="${mapWidth+4}" height="${mapHeight+4}" fill="#667e6c" stroke="#b6c5ac" stroke-width="2"/>
<g shape-rendering="crispEdges">${land}</g>
<g data-feature="surface-water" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="${riverD}" stroke="#b8d1ba" stroke-width="12" opacity=".8"/>
<path data-feature="main-channel" d="${riverD}" stroke="#347e9b" stroke-width="8"/>
${tributaryPaths}
<path data-feature="spring-branch" d="${branchD}" stroke="#85cad0" stroke-width="4"/>
</g>
<circle data-feature="spring-pool" cx="${n(spring.x)}" cy="${n(spring.y)}" r="10" fill="#7bc0cb" stroke="#dce5cb" stroke-width="2"/>
${sinkholeSvg}
${flow}
${labels}
<rect x="${scaleX}" y="${mapY+mapHeight-55}" width="${relativeWidth+38}" height="42" fill="#18352f" fill-opacity=".9" stroke="#c2c9ac" stroke-opacity=".55"/>
<path d="M${scaleX+12} ${mapY+mapHeight-35}h${relativeWidth}" stroke="${INK}" stroke-width="3"/><path d="M${scaleX+12} ${mapY+mapHeight-40}v10m${relativeWidth} -10v10" stroke="${INK}" stroke-width="2"/>
<text x="${scaleX+12}" y="${mapY+mapHeight-18}" fill="${INK}" font-size="11">0</text><text x="${scaleX+12+relativeWidth}" y="${mapY+mapHeight-18}" fill="${INK}" text-anchor="end" font-size="11">${xml(scaleLabel)}</text>
<rect x="936" y="153" width="365" height="648" fill="#17332e" stroke="#60796d"/>
<text x="957" y="184" fill="#e4c78e" font-size="15" font-weight="700" letter-spacing=".12em">TERRAIN → DRAINAGE → HABITAT</text>
<text x="957" y="212" fill="${MUTED}" font-size="13">Authored relief directs surface runoff.</text>
<text x="957" y="231" fill="${MUTED}" font-size="13">Soil, moisture and exposure shape patches.</text>
<path d="M957 250h324" stroke="#536f62"/>
<text x="957" y="278" fill="#d8d9bd" font-size="13" font-weight="700" letter-spacing=".12em">RELIEF + GROUND COVER</text>
${swatch(957,307,COLORS['dry-rocky-glade'],'dry rocky glade / thin soil')}
${swatch(957,332,COLORS['open-clearing'],'open clearing / exposed soil')}
${swatch(957,357,COLORS['oak-pine-woodland'],'oak / pine woodland')}
${swatch(957,382,COLORS['shaded-cove'],'shaded cove')}
${swatch(957,407,COLORS['wet-terrace'],'wet low terrace')}
${swatch(957,432,COLORS['spring-seep'],'spring seep / moist ground')}
${swatch(957,457,COLORS['sinkhole-basin'],'internal sinkhole basin')}
<path d="M957 478h324" stroke="#536f62"/>
<text x="957" y="507" fill="#d8d9bd" font-size="13" font-weight="700" letter-spacing=".12em">WATER CONNECTION</text>
<path d="M957 531h25" stroke="#347e9b" stroke-width="8"/><text x="992" y="536" fill="${INK}" font-size="14">winding main river → outlet</text>
<path d="M957 563h25" stroke="#5aa4b2" stroke-width="5"/><text x="992" y="568" fill="${INK}" font-size="14">tributary runoff → river</text>
<path d="M957 595h25" stroke="#85cad0" stroke-width="4"/><text x="992" y="600" fill="${INK}" font-size="14">spring pool → short outflow</text>
<circle cx="970" cy="627" r="9" fill="#607d76" stroke="#e6c79d" stroke-width="2" stroke-dasharray="3 3"/><text x="992" y="632" fill="${INK}" font-size="14">${sinkhole?'internal sinkhole; no surface outlet':'optional sinkhole; absent in this seed'}</text>
<path d="M957 653h324" stroke="#536f62"/>
<text x="957" y="682" fill="#d8d9bd" font-size="13" font-weight="700" letter-spacing=".12em">READING THIS MAP</text>
<text x="957" y="709" fill="${MUTED}" font-size="13">Arrows show modeled downhill direction.</text>
<text x="957" y="732" fill="${MUTED}" font-size="13">Colors show site context, not resources.</text>
<text x="957" y="755" fill="${MUTED}" font-size="13">No routes or crossing ability are modeled.</text>
<text x="43" y="836" fill="#e4c78e" font-size="14" font-weight="700" letter-spacing=".1em">NOT PLAYABLE · NOT SCIENTIFICALLY CALIBRATED</text>
<text x="43" y="861" fill="${MUTED}" font-size="13">Authored channel alignment; habitat colors are site hypotheses, not simulated ecology. Existing worlds remain unchanged.</text>
</svg>\n`;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=new URL('../docs/map-design/ozark-preview-seed74193.svg',import.meta.url);
  await mkdir(dirname(fileURLToPath(output)),{recursive:true});
  await writeFile(output,renderOzarkPreview(generateOzarkPreview(74193)),'utf8');
  process.stdout.write(`Wrote ${fileURLToPath(output)}\n`);
}
