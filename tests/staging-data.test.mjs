import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';

test('published staging views round-trip without scanning source transactions', () => {
  const blob = (value, contentType) => ({ contentType, getBytes: () => Buffer.from(value), getDataAsString: () => Buffer.from(value).toString() });
  const context = vm.createContext({
    Utilities: {
      newBlob: blob,
      gzip: value => blob(gzipSync(value.getBytes())),
      ungzip: value => {
        assert.equal(value.contentType, 'application/x-gzip');
        return blob(gunzipSync(value.getBytes()));
      },
      base64Encode: value => Buffer.from(value).toString('base64'),
      base64Decode: value => Buffer.from(value, 'base64'),
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../google-apps-script/WalletSync.staging.gs', import.meta.url), 'utf8'), context);
  const tables = {};
  context.writeRows = (name, headers, rows) => { tables[name] = rows.map(row => ({ gzip_base64: row[0] })); };
  context.records = name => {
    assert.ok(name.startsWith('DashboardView_'), 'GET must not rebuild historical sheets');
    return tables[name] || [];
  };
  const rows = [{ date: '2026-09-23', bd: 'BD', agent: 'Agent', consumption: 42, total_amount: 84 }];
  for (const platform of ['wallet', 'business']) {
    context.saveView(platform, rows, []);
    const view = context.readView(platform);
    assert.equal(view.periods[0].end, '2026-09-23');
    assert.equal(view.periods[0].overall[0].recharge, platform === 'wallet' ? 42 : 84);
  }
  assert.throws(() => context.readView('missing'), /Missing published staging view/);
});

test('Google Sheets date-typed months preserve target totals', () => {
  const context = vm.createContext({
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    Utilities: { formatDate: value => value.toISOString().slice(0, 10) },
  });
  vm.runInContext(fs.readFileSync(new URL('../google-apps-script/WalletSync.staging.gs', import.meta.url), 'utf8'), context);
  const sources = {
    DashboardWalletDaily: 'wallet_daily_metrics', DashboardWalletTargets: 'wallet_monthly_targets',
    DashboardBusinessDaily: 'business_daily_metrics', DashboardBusinessTargets: 'business_monthly_targets',
  };
  context.records = name => {
    const [header, ...lines] = fs.readFileSync(new URL(`../tools/staging-fixtures/${sources[name]}.csv`, import.meta.url), 'utf8').trim().split(/\r?\n/);
    const columns = header.split(',');
    return lines.map(line => Object.fromEntries(line.split(',').map((value, i) => [columns[i],
      columns[i] === 'month' ? new Date(`${value}-01T00:00:00Z`) : value])));
  };
  for (const [platform, amount, target] of [['wallet', 59500, 240000], ['business', 144000, 400000]]) {
    const periods = context.buildPeriods(platform);
    assert.equal(periods.length, 1);
    const period = periods[0];
    assert.equal(period.end, '2026-09-22');
    assert.equal(period.overall.reduce((sum, row) => sum + row.target, 0), target);
    assert.equal(period.overall.reduce((sum, row) => sum + row.recharge, 0), amount);
    assert.equal(period.daily.flatMap(day => day.details).reduce((sum, row) => sum + row.recharge, 0), amount);
  }
});
