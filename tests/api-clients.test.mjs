import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/api-clients.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Request,Response,URL,JSON,Map,Set,TextDecoder,Date,Error});
const row={'Request No.':'001',Status:'Under Review','Legal Entity Name':'Test Company'};
test('reject duplicate, missing and invalid fields',()=>{
 assert.throws(()=>exports.validateClients([row,row]),/Duplicate/);
 assert.throws(()=>exports.validateClients([{Status:'Approved'}]),/Required/);
 assert.throws(()=>exports.validateClients([{...row,Extra:123}]),/Invalid field/);
});
test('import updates same application and keeps records outside current export with backup',async()=>{
 const old={records:[row, {...row,'Request No.':'002'}],updatedAt:'old',source:'old'};
 const writes=new Map();const store={get:async()=>old,put:async(k,v)=>writes.set(k,JSON.parse(v))};
 const response=await exports.clientResponse(new Request('https://test/api/api-clients',{method:'POST',headers:{Origin:'https://test'},body:JSON.stringify({records:[{...row,Status:'Approved'}],source:'test.xlsx'})}),store);
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.records.length,2);assert.equal(result.records[0].Status,'Approved');assert.equal(writes.get(exports.CLIENT_KEY+':previous').updatedAt,'old');
});
test('cross-origin writes are rejected',async()=>{
 const response=await exports.clientResponse(new Request('https://test/api/api-clients',{method:'POST',headers:{Origin:'https://other'}}),{});
 assert.equal(response.status,403);
});
test('spreadsheet imports reject duplicate headers rather than silently losing a column',()=>{
 assert.throws(()=>exports.clientsFromRows([['Request No.','Status','Legal Entity Name','Status'],['001','Approved','Company','Rejected']]),/unique/);
 assert.throws(()=>exports.clientsFromRows([['Request No.','','Legal Entity Name'],['001','Approved','Company']]),/non-empty/);
 const parsed=exports.clientsFromRows([[' Request No. ','Status','Legal Entity Name'],['001','Approved','Company'],[' ','','']]);
 assert.equal(parsed.length,1);assert.equal(parsed[0]['Request No.'],'001');
 assert.throws(()=>exports.validateClients([{...row,Status:'   '}]),/Required/);
});
