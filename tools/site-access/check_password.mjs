// Password is received over stdin, never argv or logs. Cloudflare secret
// deployments can take several seconds to reach the serving edge.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { username, password } = JSON.parse(input);
const origin = `https://upay-bd-ranking${process.argv[2] === 'production' ? '' : '-staging'}.karsol.workers.dev`;
let verified = false;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    const response = await fetch(origin + '/access/login', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
    });
    verified = response.status === 303 && response.headers.get('Location') === '/' &&
      Boolean(response.headers.get('Set-Cookie')?.startsWith('__Host-upay_session='));
    await response.body?.cancel();
    if (verified || response.status === 429) break;
  } catch { /* Retry a brief deployment/network propagation delay. */ }
  if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
}
if (!verified) {
  console.error('密码已保存，但暂未确认网站已切换。请稍后使用本地密码文件里的新密码访问；不要重复改密。');
  process.exitCode = 1;
} else {
  console.log('网站已接受新密码，生效检查通过。');
}
