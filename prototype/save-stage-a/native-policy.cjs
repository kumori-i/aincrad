'use strict';
const WORKER_CSP="default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
const WORKER_PATHS=new Set(['prototype/save-stage-a/worker.js','prototype/save-stage-a/security-probe.js']);
function assetName(raw,allowed){
 try{const u=new URL(raw);if(u.protocol!=='aincrad:'||u.host!=='app'||u.search||u.hash)return null;
 const name=decodeURIComponent(u.pathname).slice(1);return allowed.has(name)?name:null;}catch{return null;}
}
module.exports={WORKER_CSP,WORKER_PATHS,assetName};
