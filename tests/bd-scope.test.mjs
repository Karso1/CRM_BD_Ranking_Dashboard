import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/bd-scope.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { scopedDashboard } = exports;

for (const platform of ['business', 'wallet']) {
  test(`${platform} BD snapshot contains Katrina only, including daily rows and profiles`, () => {
    const source = {
      environment: 'staging', updatedAt: '2026-09-29', secretMetadata: 'do not leak',
      [platform]: { hidden: 'other data', profiles: [
        { name: 'K agent', owner: 'Katrina', type: '代理商', email: 'k@example.test' },
        { name: 'Other agent', owner: 'Other', type: '代理商', email: 'other@example.test' },
      ], periods: [{ id: '2026-09', label: 'September', start: '2026-09-01', end: '2026-09-29', hidden: 'not allowed',
        overall: [{ name: 'Katrina', recharge: 3 }, { name: 'Other', recharge: 999 }],
        details: [{ name: 'K agent', owner: 'Katrina', recharge: 3 }, { name: 'Other agent', owner: 'Other', recharge: 999 }],
        daily: [{ date: '2026-09-29', hidden: 'not allowed', details: [
          { name: 'K agent', owner: 'Katrina', recharge: 3 }, { name: 'Other agent', owner: 'Other', recharge: 999 },
        ] }],
      }] },
    };
    const result = scopedDashboard(source, platform, 'katrina');
    const serialized = JSON.stringify(result);
    assert.ok(result); assert.equal(result[platform].periods[0].overall.length, 1);
    assert.equal(result[platform].periods[0].details.length, 1);
    assert.equal(result[platform].periods[0].daily[0].details.length, 1);
    assert.equal(result[platform].profiles.length, 1);
    assert.doesNotMatch(serialized, /Other|999|other@example|hidden|secretMetadata/);
    assert.equal(source[platform].periods[0].details.length, 2);
  });
}
