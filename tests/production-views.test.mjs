import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';

test('production views preserve existing aggregation and GET reads only published views', () => {
  const blob = value => ({ getBytes: () => Buffer.from(value), getDataAsString: () => Buffer.from(value).toString() });
  const context = vm.createContext({
    Utilities: { newBlob: blob, gzip: v => blob(gzipSync(v.getBytes())), ungzip: v => blob(gunzipSync(v.getBytes())),
      base64Encode: v => Buffer.from(v).toString('base64'), base64Decode: v => Buffer.from(v, 'base64') },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '2026-09-25T00:00:00Z' }) }
  });
  for (const name of ['WalletSync.gs', 'ProductionViews.gs']) {
    vm.runInContext(fs.readFileSync(new URL(`../google-apps-script/${name}`, import.meta.url), 'utf8'), context);
  }
  const rows = [{ date: '2026-09-24', bd: 'BD', agent: 'Unassigned', consumption: 42, total_amount: 84, open_card_virtual: 2 }];
  const targets = [{ month: '2026-09', bd: 'BD', target: 100 }, { month: '2026-09', bd: 'ZeroBD', target: 200 }];
  context.records = name => name.endsWith('Targets') ? targets : rows;
  const expected = { wallet: context.buildWallet(), business: context.buildBusinessCanonical() };
  assert.equal(expected.wallet[0].details[0].name, 'UPay');
  assert.equal(expected.wallet[0].overall.find(x => x.name === 'ZeroBD').target, 200);
  const tables = {};
  context.writeRows = (name, headers, values) => { tables[name] = values.map(row => ({ gzip_base64: row[0] })); };
  context.records = name => {
    assert.ok(name.startsWith('DashboardView_'), 'must not scan historical transactions');
    return tables[name] || [];
  };
  context.authorised = e => e?.parameter?.key === 'valid';
  context.response = value => value;
  for (const platform of ['wallet', 'business']) {
    context.saveProductionView(platform, rows, targets);
    const result = context.doGet({ parameter: { key: 'valid', platform } });
    assert.equal(result.environment, 'production');
    assert.equal(JSON.stringify(result[platform].periods), JSON.stringify(expected[platform]));
    assert.equal(result[platform === 'wallet' ? 'business' : 'wallet'], undefined);
  }
  assert.equal(context.doGet({ parameter: {} }).error, 'Unauthorized');
  assert.match(context.doGet({ parameter: { key: 'valid', platform: 'invalid' } }).error, /Unsupported/);
});
