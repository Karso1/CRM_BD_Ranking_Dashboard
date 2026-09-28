import fs from 'node:fs';
import assert from 'node:assert/strict';

const snapshot = process.argv.includes('--snapshot');
const platformArg = process.argv.find((arg) => arg.startsWith('--platform='));
const platforms = platformArg ? [platformArg.slice('--platform='.length)] : ['wallet', 'business'];
if (platforms.some((platform) => !['wallet', 'business'].includes(platform))) {
  throw new Error('Use --platform=wallet or --platform=business');
}
async function readSourceWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!response.ok) {
        lastError = new Error(`Source HTTP ${response.status}`);
      } else {
        const payload = await response.json();
        if (payload.error) throw new Error('Production source returned an error');
        return payload;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw lastError ?? new Error('Production source unavailable');
}
for (const platform of platforms) {
  const settingsPath = platform === 'wallet'
    ? '/Users/admin/Desktop/upay/UPW每日数据/upw-daily-pipeline/sync.local.json'
    : '/Users/admin/Desktop/upay/UPB每日数据/upb-daily-pipeline/sync.local.json';
  const config = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const source = new URL(config.endpoint);
  source.searchParams.set('key', config.key);
  source.searchParams.set('platform', platform);
  const started = Date.now();
  const payload = await readSourceWithRetry(source);
  assert.equal(payload.environment, 'production');
  const periods = payload[platform]?.periods;
  assert.ok(periods?.length, 'Missing periods');
  const latest = periods.reduce((a, p) => p.end > a ? p.end : a, '');
  const pipeline = platform === 'wallet' ? 'UPW每日数据/upw-daily-pipeline' : 'UPB每日数据/upb-daily-pipeline';
  const csv = fs.readFileSync(`/Users/admin/Desktop/upay/${pipeline}/outputs/history/${platform}_daily_metrics.csv`, 'utf8');
  const localLatest = csv.split(/\r?\n/).slice(1).reduce((a, row) => /^\d{4}-\d{2}-\d{2},/.test(row) && row.slice(0,10) > a ? row.slice(0,10) : a, '');
  assert.equal(latest, localLatest, `${platform} local/cloud latest date differs`);
  console.log(JSON.stringify({platform, phase:'source', months:periods.length, latest, seconds:(Date.now()-started)/1000}));
  if (snapshot) {
    const path = new URL(platform === 'wallet' ? '../app/wallet-data.json' : '../app/dashboard-data.json', import.meta.url);
    fs.writeFileSync(path, JSON.stringify(payload[platform]));
  } else {
    for (const refresh of [true, false]) {
      const start = Date.now();
      const url = `https://upay-bd-ranking.karsol.workers.dev/api/dashboard?platform=${platform}${refresh?'&refresh=1':''}`;
      const result = await fetch(url, { signal: AbortSignal.timeout(65000),
        ...(refresh ? { headers: { Authorization: `Bearer ${config.key}` } } : {}) });
      assert.ok(result.ok, `Website HTTP ${result.status}`);
      const website = await result.json();
      assert.deepEqual(website[platform]?.periods, periods, `${platform}: website/source mismatch`);
      console.log(JSON.stringify({platform, phase:refresh?'website-refresh':'website-cached', latest, matches:true, seconds:(Date.now()-start)/1000}));
    }
  }
}
