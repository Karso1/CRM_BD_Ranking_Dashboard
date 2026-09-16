/**
 * Private data endpoint for the UPay performance dashboard.
 *
 * Setup:
 * 1. Create an Apps Script project at script.google.com.
 * 2. Paste this file into Code.gs.
 * 3. In Project Settings > Script properties, set DASHBOARD_API_KEY.
 * 4. Deploy as a Web app (execute as: you; access: anyone), then add
 *    ?key=<DASHBOARD_API_KEY> to its /exec URL in Cloudflare as
 *    DASHBOARD_SOURCE_URL.
 *
 * Only aggregated dashboard fields are returned. The source Google Sheets
 * remain private.
 */

const CONFIG = {
  businessSpreadsheetId: '1rZ6PZBXqBZ7cWJ0RMBh5wtFRpnL-JiwfM-2TjDnQGnM',
  walletSpreadsheetId: '1KW43zosuBwo9_GP27-px2Yw4IhnoVUFliv4XPntAUJk',
  year: 2026,
  cacheSeconds: 300,
};

const BUSINESS_MONTHS = {
  1: ['1月目标进展', '代理日汇总1'], 2: ['2月目标进展', '代理日汇总2'],
  3: ['3月汇总', '代理商日汇总3'], 4: ['4月汇总', '代理商日汇总4'],
  5: ['5月汇总', '代理日汇总5'], 6: ['6月汇总', '代理日汇总6'],
  7: ['7月汇总', '代理日汇总7'], 8: ['8月汇总', '代理日汇总8'],
  9: ['9月汇总', '代理日汇总9'],
};

const WALLET_MONTHS = {
  1: ['UW maintainer汇总1', 'UW代理日汇总数据1'],
  2: ['UW maintainer汇总2', 'UW代理日汇总数据2'],
  3: ['汇总33', 'uw代理商日汇总数据3'],
  4: ['汇总4', 'UW代理商日汇总4'], 5: ['汇总5', '代理日汇总5'],
  6: ['汇总6', '代理日汇总6'], 7: ['汇总7', '代理日汇总7'],
  8: ['汇总8', '代理日汇总8'], 9: ['汇总9', '代理日汇总9'],
};

function doGet(e) {
  const expectedKey = PropertiesService.getScriptProperties().getProperty('DASHBOARD_API_KEY');
  if (!expectedKey || !e.parameter || e.parameter.key !== expectedKey) {
    return json({ error: 'Unauthorized' });
  }
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dashboard-payload');
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const payload = {
    updatedAt: new Date().toISOString(),
    business: { source: 'UP 每日数据（看板数据源）', periods: buildBusiness() },
    wallet: { source: 'UPay Wallet 每日数据（看板数据源）', metric: 'consumption', periods: buildWallet() },
  };
  const output = JSON.stringify(payload);
  cache.put('dashboard-payload', output, CONFIG.cacheSeconds);
  return ContentService.createTextOutput(output).setMimeType(ContentService.MimeType.JSON);
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function clean(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function number(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return isFinite(parsed) ? parsed : 0;
}
function daysInMonth(month) { return new Date(CONFIG.year, month, 0).getDate(); }
function dateFor(month, day) { return `${CONFIG.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function dateFromTitle(value) {
  const match = clean(value).match(/Performance Analysis\s+(\d{4})\/(\d{2})\/(\d{2})/i);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function sheetValues(book, name) {
  const sheet = book.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return sheet.getDataRange().getValues();
}

function buildBusiness() {
  const book = SpreadsheetApp.openById(CONFIG.businessSpreadsheetId);
  return Object.keys(BUSINESS_MONTHS).map((monthText) => {
    const month = Number(monthText);
    const [summaryName, dailyName] = BUSINESS_MONTHS[month];
    const summary = sheetValues(book, summaryName);
    const dailyReports = parseBusinessDaily(sheetValues(book, dailyName));
    const dailyMap = {}, yesterday = {};
    (dailyReports.length ? dailyReports[dailyReports.length - 1].details : []).forEach((row) => {
      const key = `${row.owner}|${row.name}`;
      dailyMap[key] = row.type;
      yesterday[key] = { recharge: row.recharge, cards: row.cards };
    });
    const overall = parseBusinessOverall(summary);
    const details = parseBusinessDetails(summary, dailyMap, yesterday);
    const end = dailyReports.length ? dailyReports[dailyReports.length - 1].date : dateFor(month, daysInMonth(month));
    return { id: `${CONFIG.year}-${String(month).padStart(2, '0')}`, label: `${CONFIG.year} 年 ${month} 月`, start: dateFor(month, 1), end, overall, details, daily: dailyReports };
  });
}

function parseBusinessDaily(rows) {
  const reports = {}, current = { date: null, entries: {} };
  function save() { if (current.date) reports[current.date] = Object.keys(current.entries).map((key) => current.entries[key]); }
  rows.forEach((row) => {
    const date = dateFromTitle(row[0]);
    if (date) { save(); current.date = date; current.entries = {}; return; }
    if (!current.date) return;
    const owner = clean(row[0]).toUpperCase(), category = clean(row[1]).toUpperCase(), name = clean(row[2]);
    if (!owner || !name || !['API', 'AGENT'].includes(category)) return;
    const key = `${owner}|${category}|${name}`;
    current.entries[key] = { name, owner, type: category === 'API' ? 'API' : '代理商', recharge: number(row[5]), consumption: number(row[6]), cards: number(row[4]) };
  });
  save();
  return Object.keys(reports).sort().map((date) => ({ date, details: Object.keys(reports[date]).map((key) => reports[date][key]) }));
}

function parseBusinessOverall(rows) {
  const header = rows.findIndex((row) => clean(row[0]).toLowerCase() === 'maintainer' && clean(row[1]).toLowerCase() === 'target');
  if (header < 0) return [];
  const result = [];
  for (let i = header + 1; i < rows.length; i += 1) {
    const row = rows[i], name = clean(row[0]);
    if (!name) { if (result.length) break; continue; }
    if (name.toLowerCase() === 'total') continue;
    result.push({ name, target: number(row[1]), recharge: number(row[2]), cards: number(row[6]), yesterday: number(row[7]) });
  }
  return result;
}

function parseBusinessDetails(rows, dailyMap, yesterday) {
  const header = rows[0] || [];
  const rechargeColumn = header.findIndex((value, index) => index >= 19 && clean(value).toLowerCase() === 'recharge');
  const result = [];
  if (rechargeColumn >= 0) {
    const maintainerColumn = lastIndex(header.slice(0, rechargeColumn), (value) => clean(value).toLowerCase() === 'maintainer');
    const agentColumn = lastIndex(header.slice(0, rechargeColumn), (value) => clean(value).toLowerCase() === 'agent');
    rows.slice(1).forEach((row) => {
      const owner = clean(row[maintainerColumn]).toUpperCase(), category = clean(row[maintainerColumn + 1]).toUpperCase(), name = clean(row[maintainerColumn + 2]);
      if (!owner || !name || !['API', 'AGENT'].includes(category)) return;
      let cards = 0;
      for (let i = agentColumn + 1; i < rechargeColumn; i += 1) if (clean(header[i]).toLowerCase().includes('open card')) cards += number(row[i]);
      const key = `${owner}|${name}`;
      result.push({ name, owner, type: category === 'API' ? 'API' : '代理商', recharge: number(row[rechargeColumn]), consumption: number(row[rechargeColumn + 1]), cards, yesterday: yesterday[key] ? yesterday[key].recharge : 0 });
    });
  } else {
    rows.slice(1).forEach((row) => {
      const owner = clean(row[9]).toUpperCase(), name = clean(row[10]);
      if (!owner || !name) return;
      const key = `${owner}|${name}`, category = dailyMap[key];
      if (!category) return;
      result.push({ name, owner, type: category, recharge: number(row[13]), consumption: number(row[14]), cards: number(row[11]) + number(row[12]), yesterday: yesterday[key] ? yesterday[key].recharge : 0 });
    });
  }
  return result;
}

function lastIndex(values, predicate) { let found = -1; values.forEach((value, index) => { if (predicate(value)) found = index; }); return found; }

function buildWallet() {
  const book = SpreadsheetApp.openById(CONFIG.walletSpreadsheetId);
  return Object.keys(WALLET_MONTHS).map((monthText) => {
    const month = Number(monthText);
    const [summaryName, dailyName] = WALLET_MONTHS[month];
    const dailyValues = sheetValues(book, dailyName);
    const dailyReports = parseWalletDaily(dailyValues);
    const lastDaily = dailyReports.length ? dailyReports[dailyReports.length - 1].details : [];
    const details = parseWalletDetails(dailyValues, lastDaily);
    const overall = parseWalletOverall(sheetValues(book, summaryName), details);
    const end = dailyReports.length ? dailyReports[dailyReports.length - 1].date : dateFor(month, daysInMonth(month));
    return { id: `${CONFIG.year}-${String(month).padStart(2, '0')}`, label: `${CONFIG.year} 年 ${month} 月`, start: dateFor(month, 1), end, overall, details, daily: dailyReports };
  });
}

function parseWalletDaily(rows) {
  const reports = {}, current = { date: null, entries: {} };
  function save() { if (current.date) reports[current.date] = Object.keys(current.entries).map((key) => current.entries[key]); }
  rows.forEach((row) => {
    const date = dateFromTitle(row[0]);
    if (date) { save(); current.date = date; current.entries = {}; return; }
    if (!current.date) return;
    const owner = clean(row[0]).toUpperCase(), name = clean(row[1]);
    if (!owner || !name || ['maintainer', 'total'].includes(owner.toLowerCase())) return;
    const key = `${owner}|${name}`;
    current.entries[key] = { name, owner, type: '代理商', recharge: number(row[5]), consumption: number(row[5]), cards: number(row[3]) + number(row[4]) };
  });
  save();
  return Object.keys(reports).sort().map((date) => ({ date, details: Object.keys(reports[date]).map((key) => reports[date][key]) }));
}

function parseWalletDetails(rows, lastDaily) {
  const starts = rows.map((row, index) => dateFromTitle(row[0]) ? index : -1).filter((index) => index >= 0);
  const block = starts.length ? rows.slice(starts[starts.length - 1]) : rows;
  const dailyLookup = {};
  lastDaily.forEach((row) => { dailyLookup[`${row.owner}|${row.name}`] = row; });
  const result = [];
  block.slice(2).forEach((row) => {
    const owner = clean(row[0]).toUpperCase(), name = clean(row[1]);
    if (!owner || !name || ['maintainer', 'total'].includes(owner.toLowerCase())) return;
    const key = `${owner}|${name}`;
    const cumulative = number(row[12]), cards = number(row[10]) + number(row[11]);
    result.push({ name, owner, type: '代理商', recharge: cumulative, consumption: cumulative, cards, yesterday: dailyLookup[key] ? dailyLookup[key].recharge : 0 });
  });
  return result;
}

function parseWalletOverall(rows, details) {
  const header = rows.findIndex((row) => clean(row[0]).toLowerCase() === 'maintainer' && clean(row[1]).toLowerCase() === 'target');
  if (header < 0) return [];
  const overall = [];
  for (let i = header + 1; i < rows.length; i += 1) {
    const row = rows[i], name = clean(row[0]);
    if (!name) { if (overall.length) break; continue; }
    if (name.toLowerCase() === 'total') break;
    overall.push({ name, target: number(row[1]), recharge: number(row[2]), cards: 0, yesterday: number(row[6]) });
  }
  const byName = {};
  overall.forEach((row) => { byName[row.name.toLowerCase()] = row; });
  details.forEach((detail) => {
    const target = byName[detail.owner.toLowerCase()] || byName.others || byName.upay;
    if (target) target.cards += detail.cards;
  });
  return overall;
}
