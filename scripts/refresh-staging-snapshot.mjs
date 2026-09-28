// Read only the isolated staging endpoint; never accept production data.
import fs from 'node:fs';
const baseUrl = process.env.STAGING_DASHBOARD_URL || 'https://upay-bd-ranking-staging.karsol.workers.dev';
const payload = { environment: 'staging', updatedAt: new Date().toISOString() };
for (const platform of ['business', 'wallet']) {
  const url = new URL('/api/dashboard', baseUrl);
  url.searchParams.set('platform', platform);
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Staging ${platform} HTTP ${response.status}`);
  const result = await response.json();
  if (result.environment !== 'staging' || result.error || !result[platform]?.periods?.length) {
    throw new Error(`Invalid staging ${platform} response`);
  }
  payload[platform] = result[platform];
  payload.updatedAt = result.updatedAt || payload.updatedAt;
  console.log(platform, result[platform].periods.length, result[platform].periods.at(-1).end);
}
fs.writeFileSync(new URL('../app/staging-dashboard-data.json', import.meta.url), JSON.stringify(payload));
