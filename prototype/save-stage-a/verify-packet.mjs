import{readFile,realpath,lstat}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyFrozenFiles(packet,sourceRoot){
 const required=['prototype/save-stage-a/native-policy.cjs','prototype/save-stage-a/native-runner.cjs'];
 if(!Array.isArray(packet.executables)||packet.executables.length!==2||JSON.stringify(packet.executables.map(f=>f.path).sort())!==JSON.stringify(required))throw Error('Missing/invalid privileged executable inventory');
 for(const f of packet.sources){const b=await readFile(resolve(sourceRoot,f.path));if(sha(b)!==f.sha256||b.length!==f.bytes)throw Error('Source changed: '+f.path);}
 for(const f of [...packet.assets,...packet.executables]){const path=resolve(packet.rendererRoot,f.path);if(!(await lstat(path)).isFile()||await realpath(path)!==path)throw Error('Frozen file is not a regular nonsymlink path: '+f.path);const b=await readFile(path);if(sha(b)!==f.sha256||b.length!==f.bytes)throw Error('Frozen executable/asset changed: '+f.path);}
 for(const f of packet.executables)if(packet.allowedPaths.includes(f.path))throw Error('Privileged executable may not be renderer-served');
}
