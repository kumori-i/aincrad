import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('native window activity crosses the sandbox as a boolean without exposing IPC events',async()=>{
  let exposed,channel,listener;const received=[];
  runInNewContext(await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{
    require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,api)=>{exposed=api;}},ipcRenderer:{invoke:()=>{},on:(name,fn)=>{channel=name;listener=fn;}}};},
  });
  exposed.onWindowActive(value=>received.push(value));assert.equal(channel,'aincrad:window-active');
  const privilegedEvent={sender:{},secret:'must stay in preload'};
  listener(privilegedEvent,false);listener(privilegedEvent,true);listener(privilegedEvent,{active:true});listener(privilegedEvent,'true');
  assert.deepEqual(received,[false,true]);assert.equal(exposed.send,undefined);assert.equal(exposed.require,undefined);assert(Object.isFrozen(exposed));
});
