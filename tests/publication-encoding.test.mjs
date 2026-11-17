import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
// Import only the pure serializer. Never invoke the CLI, child commands or GitHub.
import {connectorFile} from '../scripts/publish-github.mjs';
function roundtrip(path,data,encoding){
 const original=Buffer.from(data),file=connectorFile(path,data);
 // Exercise the actual JSON transport as well as the declared connector encoding.
 const transported=JSON.parse(JSON.stringify(file));
 const decoded=Buffer.from(transported.content,transported.encoding==='base64'?'base64':'utf8');
 assert.equal(file.encoding,encoding);assert.equal(file.path,path);assert.equal(file.mode,'100644');
 assert.deepEqual(decoded,original);assert.deepEqual(data,original,'serialization must not mutate source bytes');
 assert.equal(file.size_bytes,decoded.length);
 assert.equal(file.sha,createHash('sha1').update(`blob ${decoded.length}\0`).update(decoded).digest('hex'));
 return decoded;
}
test('valid UTF-8 text remains text, byte-exact including BOM and literal replacement character',()=>{
 for(const text of ['', 'ordinary ASCII\n', 'CRLF\r\n\tindent\r\n', 'café 日本語 🌲\n', '\ufeffBOM retained\n', 'literal \ufffd is valid text'])
  roundtrip('source.mjs',Buffer.from(text,'utf8'),'utf-8');
});
test('invalid UTF-8 is lossless base64 regardless of a text-looking extension',()=>{
 for(const bytes of [[0xff],[0xc3,0x28],[0xe2,0x82],[0xc0,0xaf],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0x61,0x80,0x62]]){
  const data=Buffer.from(bytes);assert.notDeepEqual(Buffer.from(data.toString('utf8'),'utf8'),data,'reproduce the old lossy decode');
  roundtrip('fixture.json',data,'base64');
 }
});
test('binary controls and known binary formats use base64 even when their bytes are valid UTF-8',()=>{
 for(const byte of [0,1,8,11,12,14,31,127])roundtrip('unknown-extension',Buffer.from([65,byte,66]),'base64');
 for(const path of ['image.PNG','image.jpeg','archive.zip','fixture.json.gz','module.wasm','payload.bin'])
  roundtrip(path,Buffer.from('ASCII payload'),'base64');
 roundtrip('unknown-extension',Buffer.from(Array.from({length:256},(_,i)=>i)),'base64');
});
test('compressed JSON regression is transport- and decompression-exact',()=>{
 const source=Buffer.from('{"fixture":"paid action 🌲","bytes":[0,255]}\n');
 const compressed=gzipSync(source);
 assert.notDeepEqual(Buffer.from(compressed.toString('utf8'),'utf8'),compressed);
 assert.deepEqual(gunzipSync(roundtrip('fixture.json.gz',compressed,'base64')),source);
 // Content detection also protects compressed data with a misleading text name.
 roundtrip('fixture.json',compressed,'base64');
});
for(const path of ['fixtures/visual-reference-v1-actual-paid-save.json.gz','fixtures/discovery-candidates/portable-native-regrasp.json.gz']){
 test(`existing immutable gzip fixture remains byte-exact: ${path}`,async()=>{
  const data=await readFile(new URL(path,import.meta.url));
  assert.notDeepEqual(Buffer.from(data.toString('utf8'),'utf8'),data,'old serializer corrupted these bytes');
  roundtrip(`tests/${path}`,data,'base64');
 });
}
test('serializer refuses implicit coercion rather than inventing file bytes',()=>{
 for(const value of ['text',null,undefined,[255],new Uint8Array([255])])assert.throws(()=>connectorFile('file',value),TypeError);
});
