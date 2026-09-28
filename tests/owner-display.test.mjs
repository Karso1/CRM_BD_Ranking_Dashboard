import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';

const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/owner-display.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});

test('UPW keeps only official BDs as owners in both environments',()=>{
 for(const name of ['NADIA','Daniel','Luke'])assert.equal(exports.displayedOwner('wallet',name), 'UPay');
 for(const name of ['Victor','Katrina','Ruslan','Mike','Patrick','Richard','Marketing'])assert.equal(exports.displayedOwner('wallet',name).toLowerCase(),name.toLowerCase());
 assert.equal(exports.displayedOwner('wallet','Internal','UPay · Sam'),'UPay');
});

test('UPW roster identities deduplicate against normalized activity rows',()=>{
 assert.equal(exports.entityIdentity('wallet','Agent','NADIA','代理商'),exports.entityIdentity('wallet','Agent','UPay','代理商'));
});

test('UPB owner labels are unchanged',()=>{
 assert.equal(exports.displayedOwner('business','Luke'),'Luke');
});
