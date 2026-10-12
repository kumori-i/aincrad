/** Tiny, project-specific ES-module bundler. No external build dependency.
 * Only named imports/exports in this project's six modules are supported.
 * Output uses exact CSP hashes, not unsafe-inline or an external CDN.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function buildBundle(destination=resolve(ROOT,'play.html')){
  let code='(()=>{\nconst __modules=Object.create(null);\n';
  for(const name of ['config','npc-state','world','resources','perception','navigation','npc-memory','npc','controller','save','art','renderer','npc-panel','main']){
    let source=(await readFile(resolve(ROOT,`src/${name}.js`),'utf8')).replace(/\r\n?/g,'\n');
    const exports=[...source.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g)].map(m=>m[1]);
    source=source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?/g,(_m,names,dependency)=>`const {${names}}=__modules.${dependency};`);
    source=source.replace(/export\s+(?=(?:const|function|class)\s)/g,'');
    code+=`__modules.${name}=(()=>{\n${source}\nreturn {${exports.join(',')}};\n})();\n`;
  }
  code+='})();';
  const css=(await readFile(resolve(ROOT,'style.css'),'utf8')).replace(/\r\n?/g,'\n');
  const hash=s=>createHash('sha256').update(s).digest('base64');
  const csp=`default-src 'none'; script-src 'sha256-${hash(code)}'; style-src 'sha256-${hash(css)}'; img-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const icon=(await readFile(resolve(ROOT,'icon.svg'))).toString('base64');
  let html=(await readFile(resolve(ROOT,'index.html'),'utf8')).replace(/\r\n?/g,'\n');
  html=html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,`<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`)
    .replace('href="./icon.svg"',`href="data:image/svg+xml;base64,${icon}"`)
    .replace('<script type="module" src="./src/main.js"></script>',`<script>${code}</script>`);
  await writeFile(destination,html);
  return destination;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('Built self-contained game:',await buildBundle());
