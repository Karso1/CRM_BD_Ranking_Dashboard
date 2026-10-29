const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tools/upw-download/chrome-extension/content.js'), 'utf8');

function harness(resume) {
  let now = Date.parse('2026-10-26T00:00:00Z');
  const stored = resume ? { upwResume: structuredClone(resume) } : {};
  const events = { reloads: 0, messages: [], manifests: [] };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, events,
    setTimeout(fn, ms) { now += ms; queueMicrotask(fn); },
    document: { body: { innerText: '' }, querySelectorAll: () => [], getElementById: () => null },
    location: { hash: '', reload() { events.reloads++; } },
    chrome: {
      storage: { local: {
        async get(key) { return { [key]: stored[key] }; },
        async set(value) { Object.assign(stored, structuredClone(value)); },
        async remove(key) { delete stored[key]; }
      } },
      runtime: {
        onMessage: { addListener() {} },
        async sendMessage(message) {
          events.manifests.push(structuredClone(message.manifest)); return { id: 100 };
        }
      }
    }
  });
  vm.runInContext(source + '\nprogress = async message => { events.messages.push(message); };', context);
  return { context, stored, events, evaluate: code => vm.runInContext(code, context) };
}
const request = { downloadDays: ['2026-10-24', '2026-10-25'], end: '2026-10-25', relationSegments: 1 };

test('empty page refreshes after the filter deadline and persists the task', async () => {
  const h = harness();
  h.context.request = request;
  await h.evaluate('startJob(request)');
  assert.equal(h.events.reloads, 1);
  assert.equal(h.stored.upwResume.retries, 1);
  assert.deepEqual(h.stored.upwResume.request, request);
  assert.equal(h.events.manifests.length, 0);
  assert.match(h.events.messages.at(-1), /自动刷新网页/);
});

test('retry limit stops a permanently broken page', async () => {
  const h = harness(); h.context.request = request;
  await h.evaluate('startJob(request, 3)');
  assert.equal(h.events.reloads, 0);
  assert.equal(h.stored.upwResume, undefined);
  assert.match(h.events.messages.at(-1), /刷新 3 次后仍未恢复/);
});

test('unchanged valid counts are accepted', async () => {
  const h = harness();
  h.evaluate('count = () => 8345;');
  assert.equal(await h.evaluate('stableCount()'), 8345);
});

test('cancel and validation failures never trigger page refresh', async () => {
  for (const body of ['cancelled = true; throw new PageNotReadyError("stalled");', 'fail("导出弹窗条数与查询结果不一致");']) {
    const h = harness(); h.context.request = request;
    h.evaluate(`run = async () => { ${body} };`);
    await h.evaluate('startJob(request)');
    assert.equal(h.events.reloads, 0);
    assert.equal(h.stored.upwResume, undefined);
  }
});

test('a genuinely empty loaded result is not refreshed repeatedly', async () => {
  const h = harness(); h.context.request = request;
  h.evaluate(`
    button = () => ({ click() {} }); filtersReady = () => true;
    commitDateRange = async () => {};
    firstRow = () => null; count = () => 0;
    run = async () => queryAndVerify('transactions', '2026-10-25');
  `);
  await h.evaluate('startJob(request)');
  assert.equal(h.events.reloads, 0);
  assert.match(h.events.messages.at(-1), /查询结果为 0/);
});

test('transaction query commits the range before querying the bound model', async () => {
  const h = harness();
  h.evaluate(`
    events.order = [];
    class KeyboardEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } }
    let accepted = false;
    const dateFields = [{value:'2026-10-25 00:00:00'}, {
      value:'2026-10-25 23:59:59', focus(){}, blur(){},
      dispatchEvent(e) { events.order.push(e.type + ':' + e.key); if(e.type === 'keydown' && e.key === 'Enter') accepted = true; }
    }];
    dateInputs = () => dateFields;
    button = () => ({ click() { if(!accepted) throw Error('uncommitted date'); events.order.push('query'); } });
    firstRow = () => ({innerText: accepted ? '已完成 2026-10-25' : '已完成 2026-10-26'});
    count = () => 1687;
  `);
  assert.equal(await h.evaluate("queryAndVerify('transactions', '2026-10-25')"), 1687);
  assert.deepEqual(Array.from(h.events.order), ['keydown:Enter','keyup:Enter','query']);
});

test('a loaded result for the wrong date is requeried locally before any reload', async () => {
  const h = harness();
  h.evaluate(`
    events.queries = 0; events.commits = 0;
    commitDateRange = async () => { events.commits++; };
    button = () => ({ click() { events.queries++; } });
    filtersReady = () => true; count = () => 1687;
    firstRow = () => ({innerText: events.queries > 1 ? '已完成 2026-10-25' : '已完成 2026-10-26'});
  `);
  assert.equal(await h.evaluate("queryAndVerify('transactions', '2026-10-25')"), 1687);
  assert.equal(h.events.queries, 2);
  assert.equal(h.events.commits, 2);
  assert.equal(h.events.reloads, 0);
});

test('automatic startup resumes only the unfinished date and keeps completed files', async () => {
  const checkpoint = { used: [1, 2, 3], manifest: {
    as_of: request.end, cards: { path: 'cards.csv', count: 10 },
    relationships: { total: 10, segments: [{ path: 'relations.csv', count: 10 }] },
    transactions: [{ date: '2026-10-24', count: 10, segments: [{ path: 'day24.csv', count: 10 }] }]
  } };
  const h = harness({ request, retries: 1, checkpoint });
  h.evaluate(`
    events.routes = []; events.days = [];
    route = async kind => events.routes.push(kind); select = async () => {};
    resetFilters = async () => {};
    const inputs = [{value:'2026-10-24 00:00:00'}, {value:'2026-10-24 23:59:59'}];
    dateInputs = () => inputs; setInput = (input, value) => { input.value = value; };
    button = () => ({focus() {}});
    queryAndVerify = async (kind, day) => { events.days.push(day); return 12; };
    segments = async (kind, total, number, used) => {
      if (used.join(',') !== '1,2,3') throw new Error('download IDs not restored');
      used.push(4); return [{path:'day25.csv',count:12}];
    };
  `);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(h.events.routes), ['transactions']);
  assert.deepEqual(Array.from(h.events.days), ['2026-10-25']);
  assert.equal(h.events.manifests.length, 1);
  assert.deepEqual(h.events.manifests[0].cards, checkpoint.manifest.cards);
  assert.equal(h.events.manifests[0].transactions.length, 2);
  assert.equal(h.stored.upwResume, undefined);
});

test('query count comes only from the requested visible tab', () => {
  const h = harness();
  h.evaluate(`
    const pane = {innerText:'共 134506 条',getClientRects:()=>[{}]};
    document.body.innerText = '共 2842 条';
    document.getElementById = id => id === 'pane-用户代理关系' ? pane : null;
    activeKind = 'relationships';
  `);
  assert.equal(h.evaluate('count()'),134506);
  h.evaluate("activeKind = 'cards'");
  assert.equal(h.evaluate('pageScope()'),null);
});

test('relationship export clears filters and queries before taking the total', async () => {
  const h = harness(); h.context.request = {...request,downloadDays:[]};
  h.evaluate(`
    events.steps = [];
    route = async kind => events.steps.push('route:'+kind);
    resetFilters = async () => events.steps.push('reset');
    queryAndVerify = async kind => {events.steps.push('query:'+kind); return 134506;};
    segments = async(kind,total) => {events.steps.push('export:'+total);return [{path:'relations.csv',count:10000}];};
    const checkpoint = {used:[],manifest:{cards:{path:'cards.csv',count:8363},relationships:null,transactions:[]}};
  `);
  await h.evaluate('startJob(request,0,checkpoint)');
  assert.deepEqual(Array.from(h.events.steps),['route:relationships','reset','query:relationships','export:134506']);
});
