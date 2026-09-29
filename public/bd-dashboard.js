// BD-only client. All data arrives from the server-scoped endpoint, never from bundled snapshots.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { platform: 'business', lang: 'en', payload: null, month: '' };
  const words = {
    en: { subtitle: 'Your own performance, agents and API clients', search: 'Search your agents and API clients', loading: 'Loading your data…', unavailable: 'Your data is temporarily unavailable. Please retry.', empty: 'No agents match this view.', total: 'Total amount', target: 'Monthly target', rate: 'Achievement', cards: 'Cards issued', trend: 'Daily trend', agents: 'Agents and API clients', name: 'Name', type: 'Type', amount: 'Amount', email: 'Email', since: 'Cooperation since', export: 'Export report', signout: 'Sign out', asof: 'Data through', noDate: 'No date recorded', lang: '中文' },
    zh: { subtitle: '仅显示归属您名下的业绩、代理及 API 客户', search: '搜索您的代理或 API 客户', loading: '正在读取数据…', unavailable: '数据暂时无法读取，请稍后重试。', empty: '当前没有符合条件的代理。', total: '总金额', target: '月目标', rate: '完成率', cards: '开卡数', trend: '每日趋势', agents: '代理及 API 客户', name: '名称', type: '类型', amount: '金额', email: '邮箱', since: '合作开始时间', export: '导出报表', signout: '退出登录', asof: '数据截至', noDate: '未记录', lang: 'EN' },
  };
  const format = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const setText = (id, value) => { $(id).textContent = String(value); };
  const current = () => state.payload?.[state.platform]?.periods?.find(period => period.id === state.month);
  const profileFor = row => state.payload?.[state.platform]?.profiles?.find(profile =>
    profile.name.toLocaleLowerCase() === row.name.toLocaleLowerCase() && profile.type === row.type &&
    profile.owner.toLocaleLowerCase() === row.owner.toLocaleLowerCase());
  function draw() {
    const t = words[state.lang], period = current();
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
    setText('subtitle', t.subtitle); setText('language', t.lang); setText('export', t.export); setText('signout', t.signout);
    setText('value-label', t.total); setText('target-label', t.target); setText('rate-label', t.rate);
    setText('cards-label', t.cards); setText('trend-label', t.trend); setText('agents-label', t.agents);
    setText('col-name', t.name); setText('col-type', t.type); setText('col-amount', t.amount);
    setText('col-email', t.email); setText('col-since', t.since); $('search').placeholder = t.search;
    if (!period) return;
    const overall = period.overall?.[0] || {};
    setText('total', format(overall.recharge)); setText('target', format(overall.target));
    setText('rate', overall.target ? `${(100 * (overall.recharge || 0) / overall.target).toFixed(1)}%` : '—');
    setText('cards', format(overall.cards)); setText('asof', `${t.asof} ${period.end}`);
    const days = period.daily || [];
    const amounts = days.map(day => (day.details || []).reduce((sum, row) => sum + Number(row.recharge || 0), 0));
    const max = Math.max(...amounts, 1), chart = $('chart'); chart.replaceChildren();
    amounts.forEach((amount, index) => {
      const wrap = document.createElement('div'), bar = document.createElement('div');
      wrap.className = 'bar-wrap'; bar.className = 'bar'; bar.style.height = `${Math.max(1, amount / max * 100)}%`;
      wrap.title = `${days[index].date}: ${format(amount)}`; wrap.append(bar); chart.append(wrap);
    });
    setText('chart-caption', days.length ? `${days[0].date} — ${days.at(-1).date}` : '');
    const query = $('search').value.trim().toLocaleLowerCase(), rows = $('rows'); rows.replaceChildren();
    const details = [...(period.details || [])].filter(row => row.name.toLocaleLowerCase().includes(query));
    const keys = new Set(details.map(row => `${row.owner}|${row.type}|${row.name}`.toLocaleLowerCase()));
    for (const profile of state.payload?.[state.platform]?.profiles || []) {
      const key = `${profile.owner}|${profile.type}|${profile.name}`.toLocaleLowerCase();
      if (!keys.has(key) && profile.name.toLocaleLowerCase().includes(query)) { details.push({ ...profile, recharge: 0 }); keys.add(key); }
    }
    details.sort((a, b) => Number(b.recharge || 0) - Number(a.recharge || 0));
    if (!details.length) { const tr = rows.insertRow(); const td = tr.insertCell(); td.colSpan = 5; td.className = 'empty'; td.textContent = t.empty; }
    for (const row of details) {
      const profile = profileFor(row), tr = rows.insertRow();
      for (const [index, value] of [row.name, row.type, format(row.recharge), profile?.email || '', profile?.cooperationStart || ''].entries()) {
        const td = tr.insertCell(); td.textContent = value; if (index === 0) td.className = 'name';
      }
    }
  }
  async function load() {
    setText('message', words[state.lang].loading); $('content').hidden = true; $('message').hidden = false;
    try {
      const response = await fetch(`/api/dashboard?platform=${state.platform}&cacheOnly=1`, { cache: 'no-store' });
      if (response.status === 401) { location.replace('/access'); return; }
      if (!response.ok) throw Error('Dashboard unavailable');
      state.payload = await response.json();
      const periods = state.payload?.[state.platform]?.periods;
      if (!Array.isArray(periods) || !periods.length) throw Error('No periods');
      state.month = periods.at(-1).id;
      $('month').replaceChildren();
      for (const period of periods) { const option = document.createElement('option'); option.value = period.id; option.textContent = period.label || period.id; $('month').append(option); }
      $('month').value = state.month; $('message').hidden = true; $('content').hidden = false; draw();
    } catch { setText('message', words[state.lang].unavailable); }
  }
  function exportCsv() {
    const period = current(); if (!period) return;
    const rows = [['Name', 'Type', 'Amount', 'Email', 'Cooperation since']];
    const details = [...(period.details || [])];
    const keys = new Set(details.map(row => `${row.owner}|${row.type}|${row.name}`.toLocaleLowerCase()));
    for (const profile of state.payload?.[state.platform]?.profiles || []) {
      const key = `${profile.owner}|${profile.type}|${profile.name}`.toLocaleLowerCase();
      if (!keys.has(key)) { details.push({ ...profile, recharge: 0 }); keys.add(key); }
    }
    for (const row of details) { const profile = profileFor(row); rows.push([row.name, row.type, row.recharge, profile?.email || '', profile?.cooperationStart || '']); }
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    link.href = url; link.download = `UPay-${state.platform}-${period.id}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const platform of ['business', 'wallet']) $(platform).addEventListener('click', () => {
    state.platform = platform; $('business').classList.toggle('selected', platform === 'business');
    $('wallet').classList.toggle('selected', platform === 'wallet'); load();
  });
  $('month').addEventListener('change', () => { state.month = $('month').value; draw(); });
  $('search').addEventListener('input', draw);
  $('language').addEventListener('click', () => { state.lang = state.lang === 'en' ? 'zh' : 'en'; draw(); });
  $('export').addEventListener('click', exportCsv);
  load();
})();
