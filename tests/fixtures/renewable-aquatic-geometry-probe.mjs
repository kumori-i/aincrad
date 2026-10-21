// Dedicated CPU probe of real Ozark geometry, not a native desktop or autonomous-policy test.
// Run: node tests/fixtures/renewable-aquatic-geometry-probe.mjs
import {createOzarkWorldGeometry} from '../../src/ozark-world-geometry.js';import {createOzarkEcology} from '../../src/ozark-ecology.js';import {tickAquaticEcology} from '../../src/aquatic-ecology.js';import {aquaticError,aquaticHabitat,aquaticStockAudit} from '../../src/aquatic-state.js';
const g=createOzarkWorldGeometry(),e=createOzarkEcology(g),deposit=(m,k)=>{e.detritus.massGrams+=m;e.detritus.energyKcal+=k};
const byHabitat=fish=>fish.reduce((out,f)=>{const k=aquaticHabitat(g,f.position)?.waterKind||'invalid';out[k]=(out[k]||0)+1;return out;},{});
const initial=byHabitat(e.aquatic.fish),known=new Set(e.aquatic.initialIds),births={surface:0,pond:0};let lastBirths=0;
for(let step=0;step<36000;step++){
 tickAquaticEcology(e,.5,g,{deposit});e.elapsed+=.5;
 if(e.aquatic.ledger.births!==lastBirths){for(const f of e.aquatic.fish)if(!known.has(f.id)){known.add(f.id);births[aquaticHabitat(g,f.position).waterKind]++;}lastBirths=e.aquatic.ledger.births;}
 if((step+1)%3000===0){const record={hours:(step+1)/300,initial,current:byHabitat(e.aquatic.fish),births,captures:e.aquatic.ledger.captures,deaths:e.aquatic.ledger.naturalDeaths,error:aquaticError(e,g),audit:aquaticStockAudit(e)};console.log(JSON.stringify(record));}
}
console.log('remaining',e.aquatic.fish.map(f=>({id:f.id,position:f.position,age:f.ageHours,fed:f.fedKcal,foodDistance:Math.min(...e.aquatic.patches.map(p=>Math.hypot(p.position.x-f.position.x,p.position.y-f.position.y)))})));
