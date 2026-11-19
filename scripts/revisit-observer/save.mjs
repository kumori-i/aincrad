// Exercise the same storage contract as the canonical game save (initially empty).
export function canonicalTerminalSave({writeOzarkSave,OZARK_SAVE_KEY,state,geometry}){
 const data=new Map();
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}};
 const ok=writeOzarkSave(storage,state,geometry);
 const bytes=storage.getItem(OZARK_SAVE_KEY);
 return {ok,bytes:typeof bytes==='string'?Buffer.from(bytes):null};
}
