// Promote staging's precomputed views while preserving production aggregation.
function saveProductionView(platform, rows, targets) {
  const value = {
    source: platform === 'wallet' ? 'UW Daily Data.xlsx' : 'UPB automated daily pipeline',
    metric: platform === 'wallet' ? 'consumption' : 'total_amount',
    periods: platform === 'wallet' ? buildWallet(rows, targets) : buildBusinessCanonical(rows, targets)
  };
  const encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(value))).getBytes());
  writeRows('DashboardView_' + platform, ['gzip_base64'], (encoded.match(/.{1,40000}/g) || []).map(value => [value]));
}
function readProductionView(platform) {
  const chunks = records('DashboardView_' + platform);
  if (!chunks.length) throw new Error('Missing published production view: ' + platform);
  const encoded = chunks.map(row => row.gzip_base64).join('');
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(encoded), 'application/x-gzip')).getDataAsString());
}
function doGet(e) {
  if (!authorised(e)) return response({ environment: 'production', error: 'Unauthorized' });
  try {
    const platform = e && e.parameter && e.parameter.platform;
    const payload = { environment: 'production', updatedAt: PropertiesService.getScriptProperties().getProperty('PRODUCTION_PUBLISHED_AT') };
    if (!platform || platform === 'wallet') payload.wallet = readProductionView('wallet');
    if (!platform || platform === 'business') payload.business = readProductionView('business');
    if (platform && platform !== 'wallet' && platform !== 'business') throw new Error('Unsupported platform');
    return response(payload);
  } catch (error) { return response({ environment: 'production', error: String(error) }); }
}
function doPost(e) {
  if (!authorised(e)) return response({ environment: 'production', ok: false, error: 'Unauthorized' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return response({ environment: 'production', ok: false, error: 'Another production sync is running' });
  try {
    const result = JSON.parse(legacyDoPost(e).getContent());
    if (!result.ok) return response(result);
    const payload = JSON.parse(e.postData.contents);
    if (payload.rows && payload.rows.length) saveProductionView('wallet', payload.rows, payload.targets || []);
    if (payload.businessRows && payload.businessRows.length) saveProductionView('business', payload.businessRows, payload.businessTargets || []);
    PropertiesService.getScriptProperties().setProperty('PRODUCTION_PUBLISHED_AT', new Date().toISOString());
    return response(Object.assign({ environment: 'production' }, result));
  } catch (error) { return response({ environment: 'production', ok: false, error: String(error) }); }
  finally { lock.releaseLock(); }
}
// Run once against the existing production rows; does not upload or replace them.
function initializeProductionViews() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another production sync is running');
  try {
    ['wallet', 'business'].forEach(platform => saveProductionView(platform));
    PropertiesService.getScriptProperties().setProperty('PRODUCTION_PUBLISHED_AT', new Date().toISOString());
    console.log('Production views published from existing production data.');
  } finally { lock.releaseLock(); }
}
