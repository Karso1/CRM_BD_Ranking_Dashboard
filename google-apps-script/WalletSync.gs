/**
 * UPay Wallet daily-data endpoint.
 *
 * The local `upw-daily-pipeline` posts daily rows plus monthly targets into
 * two private tabs in one Google Sheet.  This endpoint returns only the
 * aggregated dashboard payload.  Crucially, `buildPeriod` adds every target
 * owner to `overall`, even if that BD has zero transactions in the month.
 */
const SPREADSHEET_ID = '1SsaFkI79ZML6ulVuJHQsVYA1Lq13jbg6fgaKhitOY-M';
const DAILY_SHEET = 'DashboardWalletDaily';
const TARGET_SHEET = 'DashboardWalletTargets';
const DAILY_HEADERS = ['date', 'bd', 'agent', 'register', 'open_card_virtual', 'open_card_physical', 'consumption', 'transaction_count'];
const TARGET_HEADERS = ['month', 'bd', 'target'];

function response(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function authorised(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('WALLET_SYNC_KEY');
  return Boolean(expected && e && e.parameter && e.parameter.key === expected);
}
function sheet(name) {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  return book.getSheetByName(name) || book.insertSheet(name);
}
function number(value) {
  const parsed = Number(String(value == null ? 0 : value).replace(/,/g, ''));
  return isFinite(parsed) ? parsed : 0;
}
function clean(value) { return String(value == null ? '' : value).trim(); }
function writeRows(name, headers, rows) {
  const target = sheet(name);
  target.clearContents();
  target.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) target.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
function doPost(e) {
  if (!authorised(e)) return response({ ok: false, error: 'Unauthorized' });
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if (!rows.length) return response({ ok: false, error: 'No daily rows received' });
    writeRows(DAILY_SHEET, DAILY_HEADERS, rows.map(row => DAILY_HEADERS.map(key => row[key] == null ? '' : row[key])));
    writeRows(TARGET_SHEET, TARGET_HEADERS, targets.map(row => TARGET_HEADERS.map(key => row[key] == null ? '' : row[key])));
    return response({ ok: true, rows: rows.length, targets: targets.length });
  } catch (error) { return response({ ok: false, error: String(error) }); }
}
function doGet(e) {
  if (!authorised(e)) return response({ error: 'Unauthorized' });
  try {
    return response({ updatedAt: new Date().toISOString(), wallet: { source: 'UW Daily Data.xlsx', metric: 'consumption', periods: buildWallet() } });
  } catch (error) { return response({ error: String(error) }); }
}
function values(name) {
  const target = sheet(name);
  return target.getLastRow() ? target.getDataRange().getValues() : [];
}
function records(name) {
  const rows = values(name);
  if (!rows.length) return [];
  const headers = rows[0].map(value => clean(value));
  return rows.slice(1).filter(row => row.some(value => clean(value))).map(row => {
    const result = {};
    headers.forEach((header, index) => { result[header] = row[index]; });
    return result;
  });
}
function isoDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Etc/GMT', 'yyyy-MM-dd');
  }
  const text = clean(value);
  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) return ymd[1] + '-' + ('0' + ymd[2]).slice(-2) + '-' + ('0' + ymd[3]).slice(-2);
  return '';
}
function monthKey(value) {
  const text = clean(value);
  const matched = text.match(/^(\d{4})[-/]?(\d{1,2})/);
  if (matched) return matched[1] + '-' + ('0' + matched[2]).slice(-2);
  const date = isoDate(value);
  return date ? date.slice(0, 7) : '';
}
function item(name, owner) {
  return { name: name, owner: owner, type: '代理商', recharge: 0, consumption: 0, cards: 0, yesterday: 0 };
}
function addMetric(target, source) {
  target.recharge += number(source.consumption);
  target.consumption += number(source.consumption);
  target.cards += number(source.open_card_virtual) + number(source.open_card_physical);
}
function buildWallet() {
  const periodMap = {};
  records(DAILY_SHEET).forEach(row => {
    const date = isoDate(row.date);
    const month = monthKey(date);
    const owner = clean(row.bd) || 'UPay';
    const name = clean(row.agent) || owner;
    if (!date || !month) return;
    if (!periodMap[month]) periodMap[month] = { dates: {}, targets: {} };
    if (!periodMap[month].dates[date]) periodMap[month].dates[date] = {};
    const key = owner.toLowerCase() + '|' + name.toLowerCase();
    if (!periodMap[month].dates[date][key]) periodMap[month].dates[date][key] = item(name, owner);
    addMetric(periodMap[month].dates[date][key], row);
  });
  records(TARGET_SHEET).forEach(row => {
    const month = monthKey(row.month);
    const name = clean(row.bd);
    if (!month || !name) return;
    if (!periodMap[month]) periodMap[month] = { dates: {}, targets: {} };
    const key = name.toLowerCase();
    if (!periodMap[month].targets[key]) periodMap[month].targets[key] = { name: name, target: 0 };
    periodMap[month].targets[key].target += number(row.target);
  });
  return Object.keys(periodMap).sort().map(month => buildPeriod(month, periodMap[month]));
}
function buildPeriod(month, data) {
  const dates = Object.keys(data.dates).sort();
  const detailMap = {};
  const overallMap = {};
  const daily = dates.map(date => {
    const dailyDetails = Object.keys(data.dates[date]).sort().map(key => data.dates[date][key]);
    dailyDetails.forEach(row => {
      const key = row.owner.toLowerCase() + '|' + row.name.toLowerCase();
      if (!detailMap[key]) detailMap[key] = item(row.name, row.owner);
      detailMap[key].recharge += row.recharge;
      detailMap[key].consumption += row.consumption;
      detailMap[key].cards += row.cards;
      const ownerKey = row.owner.toLowerCase();
      if (!overallMap[ownerKey]) overallMap[ownerKey] = { name: row.owner, target: 0, recharge: 0, cards: 0, yesterday: 0 };
      overallMap[ownerKey].recharge += row.recharge;
      overallMap[ownerKey].cards += row.cards;
    });
    return { date: date, details: dailyDetails };
  });
  // A target-only BD (for example Richard before first activity) must count
  // toward the monthly target and appear with zero performance.
  Object.keys(data.targets).forEach(key => {
    const target = data.targets[key];
    if (!overallMap[key]) overallMap[key] = { name: target.name, target: 0, recharge: 0, cards: 0, yesterday: 0 };
    overallMap[key].name = target.name;
    overallMap[key].target += target.target;
  });
  const end = dates.length ? dates[dates.length - 1] : month + '-01';
  return { id: month, label: month, start: month + '-01', end: end, overall: Object.keys(overallMap).map(key => overallMap[key]), details: Object.keys(detailMap).map(key => detailMap[key]), daily: daily };
}
