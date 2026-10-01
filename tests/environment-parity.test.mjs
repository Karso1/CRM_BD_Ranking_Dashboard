import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

test('production and generated staging aggregate identical inputs identically', () => {
  const context = () => vm.createContext({
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    Utilities: { formatDate: value => value.toISOString().slice(0, 10) },
  });
  const production = context(), staging = context();
  vm.runInContext(fs.readFileSync(new URL('../google-apps-script/WalletSync.gs', import.meta.url), 'utf8'), production);
  const stageSource = fs.readFileSync(new URL('../google-apps-script/WalletSync.staging.gs', import.meta.url), 'utf8');
  vm.runInContext(stageSource, staging);
  assert.ok(!stageSource.includes("const SPREADSHEET_ID ="), 'staging must not embed the production sheet ID');
  const rows = [
    {date:'2026-09-23', bd:'BD', agent:'Unassigned', consumption:100, total_amount:120, recharge_amount:120, open_card_virtual:2},
    {date:'2026-09-24', bd:'BD', agent:'UPay', consumption:-20, total_amount:-20, recharge_amount:0, open_card_physical:1},
    {date:'2026-09-24', bd:'BD', agent:'Agent', category:'API', consumption:30, total_amount:40, recharge_amount:0},
  ];
  const targets = [{month:new Date('2026-09-01T00:00:00Z'), bd:'BD', target:1000}, {month:'2026-09', bd:'Zero', target:200}];
  for (const name of ['buildWallet', 'buildBusinessCanonical']) {
    const left = JSON.parse(JSON.stringify(production[name](rows, targets)));
    const right = JSON.parse(JSON.stringify(staging[name](rows, targets)));
    assert.deepEqual(left, right);
    assert.equal(left[0].overall.reduce((sum,row)=>sum+row.target,0),1200);
    assert.equal(left[0].overall.find(row=>row.name==='BD').yesterday, name==='buildWallet'?10:20);
  }
  assert.equal(production.buildWallet(rows, targets)[0].details.filter(row=>row.name==='UPay').length,1);
  const business = production.buildBusinessCanonical(rows, targets)[0];
  assert.equal(business.overall.find(row=>row.name==='BD').rechargeAmount,120);
  assert.equal(business.overall.find(row=>row.name==='BD').consumption,110);
  assert.equal(business.details.find(row=>row.name==='Agent').rechargeAmount,0);
  assert.equal(business.details.find(row=>row.name==='Agent').consumption,30);
});
