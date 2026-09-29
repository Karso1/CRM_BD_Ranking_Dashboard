// Read-only online verification. Passwords remain in ignored local files and are never printed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const base = 'https://upay-bd-ranking-staging.karsol.workers.dev';
const account = JSON.parse(await readFile(new URL('tools/daily-operations/01-测试更新/BD账号.local.txt', root), 'utf8'))
  .find(item => item.username.toLowerCase() === 'katrina');
assert.ok(account);
const adminRecord = await readFile(new URL('tools/daily-operations/01-测试更新/测试网站访问密码.local.txt', root), 'utf8');
const admin = { username: adminRecord.match(/^用户名：(.*)$/m)?.[1], password: adminRecord.match(/^访问密码：(.*)$/m)?.[1] };
assert.ok(admin.username && admin.password);
const read = (path, options = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
const login = async credentials => {
  const response = await read('/access/login', { method: 'POST', headers: { Origin: base,
    'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: credentials.username, password: credentials.password }) });
  assert.equal(response.status, 303);
  return response.headers.get('Set-Cookie').split(';')[0];
};
const adminCookie = await login(admin);
let response = await read('/', { headers: { Cookie: adminCookie } });
assert.equal(response.status, 200); assert.match(await response.text(), /UP OPERATIONS/);
const full = {};
for (const platform of ['business', 'wallet']) {
  response = await read(`/api/dashboard?platform=${platform}&cacheOnly=1`, { headers: { Cookie: adminCookie } });
  assert.equal(response.status, 200); full[platform] = await response.json();
}
const cookie = await login(account);
response = await read('/', { headers: { Cookie: cookie } });
assert.equal(response.status, 200);
const html = await response.text();
assert.match(html, /bd-dashboard\.js/); assert.doesNotMatch(html, /_next\/static|dashboard-data/);
response = await read('/bd-dashboard.js', { headers: { Cookie: cookie } });
assert.equal(response.status, 200);
assert.doesNotMatch(await response.text(), /Ruslan|Richard|dashboard-data\.json/);
for (const platform of ['business', 'wallet']) {
  response = await read(`/api/dashboard?platform=${platform}&cacheOnly=1`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.environment, 'staging');
  assert.equal(Object.keys(payload).filter(key => ['wallet', 'business'].includes(key)).join(''), platform);
  const scope = payload[platform], unfiltered = full[platform][platform];
  assert.equal(scope.periods.length, unfiltered.periods.length);
  for (const period of scope.periods) {
    assert.ok(period.overall.every(row => row.name.toLowerCase() === 'katrina'));
    assert.ok(period.details.every(row => row.owner.toLowerCase() === 'katrina'));
    assert.ok(period.daily.every(day => day.details.every(row => row.owner.toLowerCase() === 'katrina')));
  }
  assert.ok(scope.profiles.every(row => row.owner.toLowerCase() === 'katrina'));
  assert.ok(scope.periods.at(-1).details.length <= unfiltered.periods.at(-1).details.length);
  console.log(`PASS ${platform}: ${scope.periods.length} scoped months; all rows and profiles belong to Katrina`);
}
for (const path of ['/_next/static/chunks/page-DI0g_zEI.js', '/vinext-client-entry-manifest.json',
  '/api/dashboard?platform=business&refresh=1', '/api/dashboard?platform=wallet&refresh=1']) {
  response = await read(path, { headers: { Cookie: cookie } });
  assert.equal(response.status, 403, path);
}
response = await read('/?_rsc=1', { headers: { Cookie: cookie, RSC: '1' } });
assert.equal(response.status, 403);
console.log('PASS BD cannot access admin bundles, RSC data or publication endpoint');
response = await read('/access/logout', { method: 'POST', headers: { Cookie: cookie, Origin: base } });
assert.equal(response.status, 303);
assert.equal((await read('/api/dashboard?platform=business')).status, 401);
console.log('PASS admin view remains available; BD logout restores authentication gate');
