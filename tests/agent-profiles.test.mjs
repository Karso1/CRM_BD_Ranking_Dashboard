import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/agent-profiles.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const profile={name:'Katrina',owner:'BD',type:'代理商',email:'test@example.test',cooperationStart:'2024-09-22 07:53'};
test('profiles match case-insensitively, never across type or ambiguous owner',()=>{
 assert.equal(exports.findAgentProfile([profile],{name:'katrina',owner:'BD',type:'代理商'}),profile);
 assert.equal(exports.findAgentProfile([profile],{...profile,type:'API'}),undefined);
 assert.equal(exports.findAgentProfile([profile,{...profile,owner:'Other'}],{...profile,owner:'UPay'}),undefined);
 assert.equal(exports.findAgentProfile([] ,profile),undefined);
});
test('cooperation dates sort chronologically with missing values last in both directions',()=>{
 const dates=['','2025-01-01','2024-12-02 06:45'];
 assert.deepEqual([...dates].sort((a,b)=>exports.compareCooperationStart(a,b,'asc')),['2024-12-02 06:45','2025-01-01','']);
 assert.deepEqual([...dates].sort((a,b)=>exports.compareCooperationStart(a,b,'desc')),['2025-01-01','2024-12-02 06:45','']);
});
