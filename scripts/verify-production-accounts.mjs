// Read-only online verification. Never print passwords or response bodies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dir = new URL('tools/daily-operations/02-正式发布/', root);
const base = 'https://upay-bd-ranking.karsol.workers.dev';
const primaryRecord = await readFile(new URL('正式网站访问密码.local.txt', dir), 'utf8');
const primary = { username: primaryRecord.match(/^用户名：(.*)$/m)?.[1], password: primaryRecord.match(/^访问密码：(.*)$/m)?.[1] };
const bd = JSON.parse(await readFile(new URL('BD账号.local.txt', dir), 'utf8'));
const admins = JSON.parse(await readFile(new URL('其他管理员账号.local.txt', dir), 'utf8'));
assert.ok(primary.username && primary.password && bd.length && Array.isArray(admins));
const read = (path, options = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
const login = async ({ username, password }) => {
  const response = await read('/access/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }) });
  assert.equal(response.status, 303, 'An account did not sign in; no credentials were printed');
  return response.headers.get('Set-Cookie').split(';')[0];
};
const dashboard = async (platform, cookie) => {
  const response = await read(`/api/dashboard?platform=${platform}&cacheOnly=1`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.environment, 'production');
  return data;
};
for (const account of [primary, ...admins]) {
  const cookie = await login(account);
  for (const platform of ['business', 'wallet']) {
    const data = await dashboard(platform, cookie);
    assert.ok(!data.scope);
    assert.ok(data[platform].profiles.length > 20);
  }
}
console.log(`PASS ${1 + admins.length} administrators can read full production data`);
for (const account of bd) {
  const cookie = await login(account);
  for (const platform of ['business', 'wallet']) {
    const data = await dashboard(platform, cookie);
    assert.equal(data.scope.owner, account.owner);
    assert.ok(data[platform].profiles.every(row => row.owner?.toLowerCase() === account.owner.toLowerCase()));
    for (const period of data[platform].periods) {
      assert.ok(period.overall.every(row => row.name?.toLowerCase() === account.owner.toLowerCase()));
      assert.ok(period.details.every(row => row.owner?.toLowerCase() === account.owner.toLowerCase()));
      assert.ok(period.daily.every(day => day.details.every(row => row.owner?.toLowerCase() === account.owner.toLowerCase())));
    }
  }
  const forbidden = await read('/api/dashboard?platform=business&refresh=1', { headers: { Cookie: cookie } });
  assert.equal(forbidden.status, 403);
}
console.log(`PASS ${bd.length} BD accounts see only their own production data and cannot publish`);
assert.equal((await read('/api/dashboard?platform=business')).status, 401);
console.log('PASS anonymous production API access is blocked');
