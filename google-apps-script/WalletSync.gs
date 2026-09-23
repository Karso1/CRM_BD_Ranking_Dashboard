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
const BUSINESS_DAILY_SHEET = 'DashboardBusinessDaily';
const BUSINESS_TARGET_SHEET = 'DashboardBusinessTargets';
const BUSINESS_DAILY_HEADERS = ['date', 'bd', 'agent', 'category', 'total_amount', 'consumption', 'open_card_virtual', 'open_card_physical', 'recharge_amount', 'shared_consumption', 'transaction_count', 'recharge_count'];
const BUSINESS_TARGET_HEADERS = ['month', 'bd', 'target', 'card_target'];

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
    const businessRows = Array.isArray(payload.businessRows) ? payload.businessRows : [];
    const businessTargets = Array.isArray(payload.businessTargets) ? payload.businessTargets : [];
    if (!rows.length && !businessRows.length) return response({ ok: false, error: 'No daily rows received' });
    if (rows.length) {
      writeRows(DAILY_SHEET, DAILY_HEADERS, rows.map(row => DAILY_HEADERS.map(key => row[key] == null ? '' : row[key])));
      writeRows(TARGET_SHEET, TARGET_HEADERS, targets.map(row => TARGET_HEADERS.map(key => row[key] == null ? '' : row[key])));
    }
    if (businessRows.length) {
      writeRows(BUSINESS_DAILY_SHEET, BUSINESS_DAILY_HEADERS, businessRows.map(row => BUSINESS_DAILY_HEADERS.map(key => row[key] == null ? '' : row[key])));
      writeRows(BUSINESS_TARGET_SHEET, BUSINESS_TARGET_HEADERS, businessTargets.map(row => BUSINESS_TARGET_HEADERS.map(key => row[key] == null ? '' : row[key])));
    }
    return response({ ok: true, rows: rows.length, targets: targets.length, businessRows: businessRows.length, businessTargets: businessTargets.length });
  } catch (error) { return response({ ok: false, error: String(error) }); }
}
function doGet(e) {
  if (!authorised(e)) return response({ error: 'Unauthorized' });
  try {
    const payload = { updatedAt: new Date().toISOString(), wallet: { source: 'UW Daily Data.xlsx', metric: 'consumption', periods: buildWallet() } };
    if (records(BUSINESS_DAILY_SHEET).length) payload.business = { source: 'UPB automated daily pipeline', metric: 'total_amount', periods: buildBusinessCanonical() };
    return response(payload);
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
  return { name: name, owner: owner, type: '代理商', recharge: 0, consumption: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
}
function addMetric(target, source) {
  const virtualCards = number(source.open_card_virtual);
  const physicalCards = number(source.open_card_physical);
  target.recharge += number(source.consumption);
  target.consumption += number(source.consumption);
  target.cardsVirtual += virtualCards;
  target.cardsPhysical += physicalCards;
  target.cards += virtualCards + physicalCards;
}
function buildWallet() {
  const periodMap = {};
  records(DAILY_SHEET).forEach(row => {
    const date = isoDate(row.date);
    const month = monthKey(date);
    const owner = clean(row.bd) || 'UPay';
    const rawAgent = clean(row.agent);
    // Unassigned is an attribution fallback, not a separate public agent.
    // Combine it with explicit UPay rows in the agent leaderboard.
    const name = rawAgent.toLowerCase() === 'unassigned' ? 'UPay' : (rawAgent || owner);
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
      detailMap[key].cardsVirtual += row.cardsVirtual;
      detailMap[key].cardsPhysical += row.cardsPhysical;
      const ownerKey = row.owner.toLowerCase();
      if (!overallMap[ownerKey]) overallMap[ownerKey] = { name: row.owner, target: 0, recharge: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
      overallMap[ownerKey].recharge += row.recharge;
      overallMap[ownerKey].cards += row.cards;
      overallMap[ownerKey].cardsVirtual += row.cardsVirtual;
      overallMap[ownerKey].cardsPhysical += row.cardsPhysical;
    });
    return { date: date, details: dailyDetails };
  });
  // A target-only BD (for example Richard before first activity) must count
  // toward the monthly target and appear with zero performance.
  Object.keys(data.targets).forEach(key => {
    const target = data.targets[key];
    if (!overallMap[key]) overallMap[key] = { name: target.name, target: 0, recharge: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
    overallMap[key].name = target.name;
    overallMap[key].target += target.target;
  });
  const end = dates.length ? dates[dates.length - 1] : month + '-01';
  return { id: month, label: month, start: month + '-01', end: end, overall: Object.keys(overallMap).map(key => overallMap[key]), details: Object.keys(detailMap).map(key => detailMap[key]), daily: daily };
}

function businessItem(name, owner, category) {
  return { name: name, owner: owner, type: category === 'API' ? 'API' : '代理商', recharge: 0, consumption: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
}
function addBusinessMetric(target, source) {
  const virtualCards = number(source.open_card_virtual);
  const physicalCards = number(source.open_card_physical);
  target.recharge += number(source.total_amount);
  target.consumption += number(source.consumption);
  target.cardsVirtual += virtualCards;
  target.cardsPhysical += physicalCards;
  target.cards += virtualCards + physicalCards;
}
function buildBusinessCanonical() {
  const periodMap = {};
  records(BUSINESS_DAILY_SHEET).forEach(row => {
    const date = isoDate(row.date), month = monthKey(date);
    const owner = clean(row.bd) || 'UPay', name = clean(row.agent) || 'UPay';
    const category = clean(row.category).toUpperCase() === 'API' ? 'API' : '代理商';
    if (!date || !month) return;
    if (!periodMap[month]) periodMap[month] = { dates: {}, targets: {} };
    if (!periodMap[month].dates[date]) periodMap[month].dates[date] = {};
    const key = owner.toLowerCase() + '|' + category + '|' + name.toLowerCase();
    if (!periodMap[month].dates[date][key]) periodMap[month].dates[date][key] = businessItem(name, owner, category);
    addBusinessMetric(periodMap[month].dates[date][key], row);
  });
  records(BUSINESS_TARGET_SHEET).forEach(row => {
    const month = monthKey(row.month), name = clean(row.bd);
    if (!month || !name) return;
    if (!periodMap[month]) periodMap[month] = { dates: {}, targets: {} };
    const key = name.toLowerCase();
    if (!periodMap[month].targets[key]) periodMap[month].targets[key] = { name: name, target: 0 };
    periodMap[month].targets[key].target += number(row.target);
  });
  return Object.keys(periodMap).sort().map(month => buildBusinessPeriod(month, periodMap[month]));
}
function buildBusinessPeriod(month, data) {
  const dates = Object.keys(data.dates).sort(), detailMap = {}, overallMap = {};
  const daily = dates.map(date => {
    const dailyDetails = Object.keys(data.dates[date]).sort().map(key => data.dates[date][key]);
    dailyDetails.forEach(row => {
      const detailKey = row.owner.toLowerCase() + '|' + row.type + '|' + row.name.toLowerCase();
      if (!detailMap[detailKey]) detailMap[detailKey] = businessItem(row.name, row.owner, row.type);
      detailMap[detailKey].recharge += row.recharge;
      detailMap[detailKey].consumption += row.consumption;
      detailMap[detailKey].cards += row.cards;
      detailMap[detailKey].cardsVirtual += row.cardsVirtual;
      detailMap[detailKey].cardsPhysical += row.cardsPhysical;
      const ownerKey = row.owner.toLowerCase();
      if (!overallMap[ownerKey]) overallMap[ownerKey] = { name: row.owner, target: 0, recharge: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
      overallMap[ownerKey].recharge += row.recharge;
      overallMap[ownerKey].cards += row.cards;
      overallMap[ownerKey].cardsVirtual += row.cardsVirtual;
      overallMap[ownerKey].cardsPhysical += row.cardsPhysical;
    });
    return { date: date, details: dailyDetails };
  });
  Object.keys(data.targets).forEach(key => {
    const target = data.targets[key];
    if (!overallMap[key]) overallMap[key] = { name: target.name, target: 0, recharge: 0, cards: 0, cardsVirtual: 0, cardsPhysical: 0, yesterday: 0 };
    overallMap[key].name = target.name;
    overallMap[key].target += target.target;
  });
  if (dates.length) {
    Object.keys(data.dates[dates[dates.length - 1]]).forEach(key => {
      const row = data.dates[dates[dates.length - 1]][key];
      const detailKey = row.owner.toLowerCase() + '|' + row.type + '|' + row.name.toLowerCase();
      if (detailMap[detailKey]) detailMap[detailKey].yesterday += row.recharge;
      if (overallMap[row.owner.toLowerCase()]) overallMap[row.owner.toLowerCase()].yesterday += row.recharge;
    });
  }
  const end = dates.length ? dates[dates.length - 1] : month + '-01';
  return { id: month, label: month, start: month + '-01', end: end, overall: Object.keys(overallMap).map(key => overallMap[key]), details: Object.keys(detailMap).map(key => detailMap[key]), daily: daily };
}
