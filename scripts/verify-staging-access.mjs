// Read-only end-to-end checks. Credentials stay in memory; never print bodies.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const environment = process.argv[2] === 'production' ? 'production' : 'staging';
const base = `https://upay-bd-ranking${environment === 'production' ? '' : '-staging'}.karsol.workers.dev`;
const root = new URL('../', import.meta.url);
const passwordText = await readFile(new URL(environment === 'production' ? 'tools/daily-operations/02-正式发布/正式网站访问密码.local.txt' : 'tools/daily-operations/01-测试更新/测试网站访问密码.local.txt', root), 'utf8');
const password = passwordText.match(/^访问密码：(.*)$/m)?.[1];
const username = passwordText.match(/^用户名：(.*)$/m)?.[1];
assert.ok(username);
assert.ok(password, 'Missing local staging password record');
const read = (path, options = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
let response = await read('/');
assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), '/access');
response = await read('/access');
assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /<script|api\/dashboard/);
for (const path of ['/api/dashboard?platform=business', '/api/dashboard?platform=wallet&cacheOnly=1', '/vinext-client-entry-manifest.json']) {
  assert.equal((await read(path)).status, 401, path);
}
const files = await readdir(new URL('dist/client/_next/static/chunks/', root));
const pageAsset = '/_next/static/chunks/' + files.find(file => file.startsWith('page-') && file.endsWith('.js'));
assert.ok(!pageAsset.endsWith('undefined'));
if (environment === 'production') assert.equal((await read(pageAsset)).status, 401);
console.log('PASS anonymous page, API, manifest and bundled dashboard data are protected');
const login = value => read('/access/login', { method: 'POST', headers: { Origin: base,
  'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password: value }) });
assert.equal((await login('deliberately-incorrect-test-password')).status, 401);
response = await login(password);
assert.equal(response.status, 303);
const setCookie = response.headers.get('Set-Cookie');
for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=604800']) assert.ok(setCookie.includes(flag));
const Cookie = setCookie.split(';')[0];
response = await read('/', { headers: { Cookie } });
assert.equal(response.status, 200); assert.match(await response.text(), /Sign out/);
if (environment === 'production') {
  response = await read(pageAsset, { headers: { Cookie } });
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  await response.body.cancel();
}
console.log('PASS password login, dashboard rendering, protected assets and secure cookie');
for (const [platform, folder] of [['business', 'upb'], ['wallet', 'upw']]) {
  const settingsPath = environment === 'production'
    ? `tools/daily-operations/03-原始数据/${folder.toUpperCase()}每日数据/${folder}-daily-pipeline/sync.local.json`
    : `tools/${folder}-daily-pipeline/sync.staging.local.json`;
  const settings = JSON.parse(await readFile(new URL(settingsPath, root), 'utf8'));
  response = await read(`/api/dashboard?platform=${platform}`, { headers: { Cookie } });
  assert.equal(response.status, 200);
  const visitor = await response.json();
  assert.equal(visitor.environment, environment); assert.ok(visitor[platform].profiles.length > 0);
  response = await read(`/api/dashboard?platform=${platform}`, { headers: { Authorization: `Bearer ${settings.key}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), visitor);
  // A viewer session must never authorize the data publication endpoint.
  assert.equal((await read(`/api/dashboard?platform=${platform}&refresh=1`, { headers: { Cookie } })).status, 401);
  console.log(`PASS ${platform}: ${visitor[platform].profiles.length} profiles; visitor/sync snapshots match; viewer cannot publish`);
}
response = await read('/access/logout', { method: 'POST', headers: { Cookie, Origin: base } });
assert.equal(response.status, 303); assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
assert.equal((await read('/api/dashboard?platform=wallet')).status, 401);
console.log('PASS logout clears session and unauthenticated access is blocked');
