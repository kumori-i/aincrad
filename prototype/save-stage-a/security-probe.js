// Fixed negative probes outside timed windows. None accesses external services.
const policyEvidence=[];
addEventListener('securitypolicyviolation',event=>policyEvidence.push({effectiveDirective:event.effectiveDirective,blockedURI:event.blockedURI,disposition:event.disposition,originalPolicy:event.originalPolicy}));
const results={nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'};
try{await fetch(new URL('../../icon.svg',import.meta.url));results.fetchBlocked=false;}catch{results.fetchBlocked=true;}
try{(0,eval)('1+1');results.evalBlocked=false;}catch{results.evalBlocked=true;}
try{
 const nested=new Worker(new URL('./preparation.js',import.meta.url),{type:'module'});
 results.nestedWorkerBlocked=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),250);nested.onerror=event=>{event.preventDefault();clearTimeout(timer);resolve(true);};});nested.terminate();
}catch{results.nestedWorkerBlocked=true;}
await new Promise(resolve=>setTimeout(resolve,100));
results.policyConfirmed=['connect-src','script-src','worker-src'].every(d=>policyEvidence.some(e=>e.effectiveDirective===d&&e.disposition==='enforce'));
postMessage({...results,policyEvidence});
