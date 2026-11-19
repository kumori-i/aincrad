import {createHash} from 'node:crypto';
export const ARM_LIMIT=Object.freeze({rows:1_200_000,bytes:192*2**20});
// Sink is owned by harness, never passed to simulation or observer hooks.
export function researchJournal(write,{maxRows=ARM_LIMIT.rows,maxBytes=ARM_LIMIT.bytes}={}){
 const hash=createHash('sha256');
 let rows=0,bytes=0,gap=null,done=false;
 return {
  append(batch){
   if(done)throw Error('journal already sealed');
   if(gap)return;
   for(const row of batch.rows){
    const line=JSON.stringify(row)+'\n',size=Buffer.byteLength(line);
    if(rows>=maxRows||bytes+size>maxBytes){gap={reason:'arm-journal-overflow',after:rows};return;}
    write(line);hash.update(line);rows++;bytes+=size;
   }
   if(batch.gap)gap=batch.gap;
  },
  close(){
   if(done)throw Error('journal already sealed');done=true;
   const integrity={rows,bytes,gap,complete:gap===null,sha256:hash.digest('hex')};
   // Manifest has reserved independent storage: overflow never erases its marker.
   return integrity;
  },
 };
}
