import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as fflate from 'fflate';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/read-client-xlsx.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='fflate'?fflate:{},Uint8Array,Error});
const file=bytes=>({size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
test('rejects an Excel archive whose compressed size hides excessive expanded data',async()=>{
 const bytes=fflate.zipSync({'xl/worksheets/sheet1.xml':new Uint8Array(32_000_001)});
 assert.ok(bytes.byteLength<2_000_000);
 await assert.rejects(exports.readClientXlsx(file(bytes)),/contents are too large/);
});
test('rejects an archive with an excessive number of entries before parsing it',async()=>{
 const bytes=fflate.zipSync(Object.fromEntries(Array.from({length:513},(_,i)=>[`xl/${i}.xml`,new Uint8Array()])));
 await assert.rejects(exports.readClientXlsx(file(bytes)),/contents are too large/);
});
