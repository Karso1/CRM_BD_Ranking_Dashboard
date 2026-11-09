import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reporting-period.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date,Error});
const p=(id,end)=>({id,start:id+'-01',end,daily:[{date:end}]});
test('current month wins over future target-only month',()=>{
 const november=p('2026-11','2026-11-08');const rows=[p('2026-10','2026-10-31'),november,p('2026-12','2026-12-01')];
 assert.equal(exports.defaultReportingPeriod(rows,'2026-11-09'),november);
 assert.equal(exports.reportingEnd(november,'2026-11-09'),'2026-11-08');
});
test('when current month is absent, choose latest available past month',()=>assert.equal(exports.defaultReportingPeriod([p('2026-09','2026-09-30'),p('2026-12','2026-12-01')],'2026-11-09').id,'2026-09'));
test('future daily points cannot become the default cutoff',()=>assert.equal(exports.reportingEnd({start:'2026-11-01',end:'2026-12-01',daily:[{date:'2026-11-08'},{date:'2026-12-01'}]},'2026-11-09'),'2026-11-08'));
test('UPW and UPB use their own business date at month boundaries',()=>{
 const now=new Date('2026-10-31T20:00:00Z');assert.equal(exports.reportingDate('wallet',now),'2026-11-01');assert.equal(exports.reportingDate('business',now),'2026-10-31');
});
test('MTD always retains the full monthly target at earlier cutoffs',()=>{
 for(const end of ['2026-11-01','2026-11-07','2026-11-08'])assert.equal(exports.periodTargetWeight('2026-11','2026-11-01',end,'mtd'),1);
});
test('cross-month targets prorate by calendar month, not the last downloaded date',()=>{
 assert.equal(exports.periodTargetWeight('2026-11','2026-11-01','2026-11-08','range'),8/30);
 assert.equal(exports.periodTargetWeight('2026-10','2026-10-30','2026-11-02','range'),2/31);
 assert.equal(exports.periodTargetWeight('2026-11','2026-10-30','2026-11-02','range'),2/30);
 assert.equal(exports.periodTargetWeight('2024-02','2024-02-01','2024-02-29','range'),1);
 assert.equal(exports.periodTargetWeight('2026-12','2026-11-01','2026-11-08','range'),0);
});
