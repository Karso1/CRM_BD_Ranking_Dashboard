import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';

const exports = {};
const source = ts.transpileModule(readFileSync(new URL('../lib/site-access.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { exports, require: name => {
  assert.equal(name, 'node:crypto'); return crypto;
}, Request, Response, Headers, URL, URLSearchParams, TextDecoder });
const { accessResponse, createSession, validSession, SESSION_COOKIE, SESSION_SECONDS } = exports;
const origin = 'https://staging.example.test';
const env = () => ({ DASHBOARD_USERNAME: 'upay', DASHBOARD_PASSWORD: 'Test-password-123', DASHBOARD_SESSION_SECRET: 'random-test-signing-secret',
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }, WALLET_SOURCE_URL: 'https://source.example.test?key=sync-key' });
const req = (path = '/', init = {}) => new Request(origin + path, init);
const login = (password, headers = {}) => req('/access/login', { method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ username: 'upay', password }) });
const cookieReq = (token, path = '/') => req(path, { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });

test('anonymous visitors cannot read dashboard, API, fallback scripts or RSC payloads', async () => {
  const page = await accessResponse(req('/'), env());
  assert.equal(page.status, 303); assert.equal(page.headers.get('Location'), '/access');
  for (const path of ['/api/dashboard?platform=business', '/api/dashboard?platform=wallet&cacheOnly=1',
    '/assets/page.js', '/assets/page.js.map', '/dashboard-data.json']) {
    const response = await accessResponse(req(path), env());
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  assert.equal((await accessResponse(req('/?_rsc=1', { headers: { RSC: '1' } }), env())).status, 401);
});

test('login page contains no dashboard code or data and wrong password sets no cookie', async () => {
  const page = await accessResponse(req('/access'), env());
  const html = await page.text();
  assert.match(html, /type="password"/); assert.doesNotMatch(html, /<script|api\/dashboard|Test-password/);
  const wrong = await accessResponse(login('wrong'), env());
  assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('Set-Cookie'), null);
});

test('correct password grants seven-day session for pages and data, with secure cookie flags', async () => {
  const settings = env();
  const response = await accessResponse(login(settings.DASHBOARD_PASSWORD), settings);
  assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), '/');
  const cookie = response.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${SESSION_SECONDS}`]) assert.ok(cookie.includes(flag));
  for (const path of ['/', '/api/dashboard?platform=wallet', '/assets/page.js']) {
    assert.equal(await accessResponse(req(path, { headers: { Cookie: cookie.split(';')[0] } }), settings), null);
  }
});

test('expired, forged, duplicate, future and password-rotated cookies are rejected', () => {
  const settings = env(), now = Date.now(), token = createSession(settings, now);
  assert.equal(validSession(cookieReq(token), settings, now), true);
  assert.equal(validSession(cookieReq(token), settings, now + (SESSION_SECONDS + 1) * 1000), false);
  assert.equal(validSession(cookieReq(token.slice(0, -3) + 'xyz'), settings, now), false);
  assert.equal(validSession(cookieReq(token), { ...settings, DASHBOARD_USERNAME: 'changed' }, now), false);
  assert.equal(validSession(cookieReq(token), { ...settings, DASHBOARD_PASSWORD: 'New-password-456' }, now), false);
  assert.equal(validSession(cookieReq(token), { ...settings, DASHBOARD_SESSION_SECRET: 'new-secret' }, now), false);
  assert.equal(validSession(cookieReq(createSession(settings, now + 86400000)), settings, now), false);
  assert.equal(validSession(req('/', { headers: { Cookie: `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}` } }), settings), false);
});

test('missing configuration fails closed and rate-limited login returns 429', async () => {
  assert.equal((await accessResponse(req('/'), {})).status, 503);
  const limited = { ...env(), LOGIN_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await accessResponse(login('Test-password-123'), limited);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal((await accessResponse(login('Test-password-123'), { ...env(), LOGIN_RATE_LIMITER: undefined })).status, 503);
});

test('cross-origin login/logout, GET login and oversized bodies are blocked', async () => {
  assert.equal((await accessResponse(login('Test-password-123', { Origin: 'https://other.test' }), env())).status, 403);
  assert.equal((await accessResponse(req('/access/logout', { method: 'POST', headers: { Origin: 'https://other.test' } }), env())).status, 403);
  assert.equal((await accessResponse(req('/access/login'), env())).status, 405);
  assert.equal((await accessResponse(login('a'.repeat(5000)), env())).status, 413);
});

test('existing sync key allows only the dashboard API; wrong or missing keys fail', async () => {
  for (const method of ['GET', 'POST']) {
    const request = req('/api/dashboard?platform=wallet&refresh=1', { method, headers: { Authorization: 'Bearer sync-key' } });
    assert.equal(await accessResponse(request, env()), null);
  }
  assert.equal(await accessResponse(req('/api/dashboard?platform=business', { headers: { Authorization: 'Bearer sync-key' } }), env()), null);
  assert.equal((await accessResponse(req('/api/dashboard?refresh=1', { headers: { Authorization: 'Bearer wrong' } }), env())).status, 401);
  assert.equal((await accessResponse(req('/assets/page.js', { headers: { Authorization: 'Bearer sync-key' } }), env())).status, 401);
});

test('logout clears the session and local cached data', async () => {
  const response = await accessResponse(req('/access/logout', { method: 'POST', headers: { Origin: origin } }), env());
  assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), '/access');
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.match(response.headers.get('Clear-Site-Data'), /storage/);
});

test('language switch defaults to English, shows real logo and no footer; username is required', async () => {
 const en = await (await accessResponse(req('/access'), env())).text();
 assert.match(en, /<html lang="en">/); assert.match(en, /name="username"/);
 assert.match(en, /src="\/upay-logo.png"/); assert.doesNotMatch(en, /No account needed|保持登录|<span class="mark"/);
 const zh = await (await accessResponse(req('/access?lang=zh'), env())).text();
 assert.match(zh, /用户名/); assert.doesNotMatch(zh, /Welcome to UPay|Sign in/);
 assert.equal(await accessResponse(req('/upay-logo.png'), env()), null);
 const missing = req('/access/login', {method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:env().DASHBOARD_PASSWORD})});
 assert.equal((await accessResponse(missing, env())).status,401);
 const wrong = req('/access/login?lang=zh', {method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'wrong',password:env().DASHBOARD_PASSWORD})});
 const response = await accessResponse(wrong,env()); assert.equal(response.status,401); assert.match(await response.text(),/用户名或密码不正确/);
});
