import { prepareSave } from './save.js';

export const SAVE_PREPARATION=Object.freeze({version:1,maxBytes:64*1024*1024,maxId:1_000_000_000,timeoutMs:30_000});
const validId=value=>Number.isInteger(value)&&value>0&&value<=SAVE_PREPARATION.maxId;
const keysAre=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const failure=(code)=>Object.assign(new Error(`Save preparation: ${code}`),{code});
const enumCode=error=>error?.code==='SAVE_BLOCKED'?'PROTECTED':error?.code==='SAVE_RULES'?'UNSUPPORTED_SAVE':error?.code==='PREPARATION_LIMIT'?'TOO_LARGE':'PREPARE_FAILED';

/** Fixed pure worker protocol. No storage, URLs, code execution or native bridge.
 * The sender must also prevent multiple in-flight snapshots before cloning. */
export function createSavePreparationProtocol({send,prepare=prepareSave,now=()=>performance.now()}={}){
  let pending=null;
  return message=>{
    const identity=message&&validId(message.id)&&validId(message.epoch)&&message.version===1;
    if(message?.type==='release'){
      if(identity&&keysAre(message,['version','type','id','epoch'])&&pending?.id===message.id&&pending.epoch===message.epoch)pending=null;
      return;
    }
    if(!identity)return;
    const base={version:1,id:message.id,epoch:message.epoch};
    if(message.type!=='prepare'||!keysAre(message,['version','type','id','epoch','blocked','state'])||typeof message.blocked!=='boolean'){
      send({...base,type:'prepared',ok:false,code:'INVALID_REQUEST'});return;
    }
    if(pending){send({...base,type:'prepared',ok:false,code:'BUSY'});return;}
    pending={id:message.id,epoch:message.epoch};
    try{
      const start=now(),text=prepare(message.state,{blocked:message.blocked});
      if(typeof text!=='string'||text.length>SAVE_PREPARATION.maxBytes)throw failure('PREPARATION_LIMIT');
      const bytes=new TextEncoder().encode(text).byteLength;
      if(bytes>SAVE_PREPARATION.maxBytes)throw failure('PREPARATION_LIMIT');
      send({...base,type:'prepared',ok:true,text,bytes,prepareMs:Math.max(0,now()-start)});
    }catch(error){send({...base,type:'prepared',ok:false,code:enumCode(error)});}
    // Release is explicit, even on failure. A queued second snapshot cannot
    // mistake completion of this synchronous handler for available capacity.
  };
}

/** Experimental owner-side client. The application does not yet use this path. */
export function createSavePreparer({workerFactory=()=>new Worker(new URL('./save-worker.js',import.meta.url),{type:'module'}),timeoutMs=SAVE_PREPARATION.timeoutMs}={}){
  let worker=null,pending=null,nextId=1,closed=false;
  const stop=(code)=>{closed=true;if(pending){clearTimeout(pending.timer);pending.reject(failure(code));pending=null;}worker?.terminate();worker=null;};
  const start=()=>{
    if(worker)return;
    worker=workerFactory();
    worker.addEventListener('error',event=>{event.preventDefault?.();stop('WORKER_FAILED');});
    worker.addEventListener('messageerror',()=>stop('WORKER_MESSAGE_FAILED'));
    worker.addEventListener('message',event=>{
      const reply=event.data,current=pending;
      if(!current||reply?.version!==1||reply.type!=='prepared'||reply.id!==current.id||reply.epoch!==current.epoch){stop('INVALID_REPLY');return;}
      if(typeof reply.ok!=='boolean'||(reply.ok&&(typeof reply.text!=='string'||reply.text.length>SAVE_PREPARATION.maxBytes||!Number.isInteger(reply.bytes)||reply.bytes<reply.text.length||reply.bytes>3*reply.text.length||reply.bytes>SAVE_PREPARATION.maxBytes||!Number.isFinite(reply.prepareMs)||reply.prepareMs<0))){stop('INVALID_REPLY');return;}
      try{worker.postMessage({version:1,type:'release',id:current.id,epoch:current.epoch});}catch{stop('WORKER_FAILED');return;}
      clearTimeout(current.timer);pending=null;
      if(reply.ok)current.resolve({text:reply.text,bytes:reply.bytes,prepareMs:reply.prepareMs,id:current.id,epoch:current.epoch});
      else current.reject(failure(['PROTECTED','UNSUPPORTED_SAVE','TOO_LARGE','PREPARE_FAILED','INVALID_REQUEST','BUSY'].includes(reply.code)?reply.code:'INVALID_REPLY'));
    });
  };
  return Object.freeze({
    prepare(state,{epoch=1,blocked=false}={}){
      if(closed)return Promise.reject(failure('CLOSED'));
      if(pending)return Promise.reject(failure('BUSY'));
      if(blocked||state?.saveBlocked)return Promise.reject(failure('PROTECTED'));
      if(!validId(epoch)||nextId>SAVE_PREPARATION.maxId)return Promise.reject(failure('INVALID_REQUEST'));
      return new Promise((resolve,reject)=>{
        try{
          start();const id=nextId++;
          const timer=setTimeout(()=>stop('TIMEOUT'),Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(120_000,timeoutMs):SAVE_PREPARATION.timeoutMs);
          pending={id,epoch,resolve,reject,timer};
          worker.postMessage({version:1,type:'prepare',id,epoch,blocked:false,state});
        }catch{const waiting=Boolean(pending);stop('WORKER_FAILED');if(!waiting)reject(failure('WORKER_FAILED'));}
      });
    },
    dispose(){stop('CLOSED');},
    status(){return{closed,busy:Boolean(pending),nextId};},
  });
}
