"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronDown, Download, Gauge, LayoutDashboard, RefreshCw, Search, UsersRound, Waypoints } from "lucide-react";
import dashboardData from "./dashboard-data.json";

type View = "总体" | "代理商" | "API";
type Metric = "充值金额" | "完成率" | "当日充值";
type Overall = { name: string; target: number; recharge: number; cards: number; yesterday: number };
type Detail = { name: string; owner: string; type: "代理商" | "API"; recharge: number; consumption: number; cards: number; yesterday: number };
type Period = { id: string; label: string; start: string; end: string; overall: Overall[]; details: Detail[] };
const periods = dashboardData.periods as Period[];
const money = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${Math.round(v / 1e3).toLocaleString()}K`;
const num = (v: number) => v.toLocaleString("en-US");
const getStatus = (r?: number) => r === undefined ? { label: "月度排名", tone: "blue" } : r >= 1 ? { label: "超目标", tone: "green" } : r >= .7 ? { label: "进度正常", tone: "blue" } : r >= .43 ? { label: "需关注", tone: "amber" } : { label: "落后", tone: "red" };
function MetricCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) { return <section className="metric-card"><p>{label}</p><strong className={accent ? "accent" : ""}>{value}</strong><span>{hint}</span></section>; }

export default function Home() {
  const [month, setMonth] = useState(periods.at(-1)?.id ?? "");
  const [view, setView] = useState<View>("总体");
  const [metric, setMetric] = useState<Metric>("充值金额");
  const [owner, setOwner] = useState("全部BD");
  const [search, setSearch] = useState("");
  const [updated, setUpdated] = useState("2026-09-14");
  const period = periods.find((x) => x.id === month) ?? periods.at(-1)!;
  const bdOptions = useMemo(() => {
    const labels = new Map<string, string>();
    [...period.overall.map((x) => x.name), ...period.details.map((x) => x.owner)].forEach((item) => labels.set(item.toLowerCase(), labels.get(item.toLowerCase()) ?? item));
    return [...labels.values()].sort();
  }, [period]);
  const overall = useMemo(() => period.overall.filter((x) => owner === "全部BD" || x.name.toLowerCase() === owner.toLowerCase()), [period, owner]);
  const details = useMemo(() => period.details.filter((x) => x.type === view && (owner === "全部BD" || x.owner.toLowerCase() === owner.toLowerCase())), [period, owner, view]);
  const rows = useMemo(() => {
    const source: any[] = view === "总体" ? overall.map((x) => ({ ...x, owner: x.name, consumption: 0 })) : details;
    return source.filter((x) => `${x.name} ${x.owner}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => metric === "完成率" ? b.recharge / (b.target || 1) - a.recharge / (a.target || 1) : metric === "当日充值" ? b.yesterday - a.yesterday : b.recharge - a.recharge);
  }, [view, overall, details, metric, search]);
  const totals = useMemo(() => {
    const target = overall.reduce((s, x) => s + x.target, 0), recharge = overall.reduce((s, x) => s + x.recharge, 0), yesterday = overall.reduce((s, x) => s + x.yesterday, 0), cards = overall.reduce((s, x) => s + x.cards, 0);
    const elapsed = Math.max(1, Math.round((new Date(period.end).getTime() - new Date(period.start).getTime()) / 86400000) + 1), days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    return { target, recharge, yesterday, cards, rate: target ? recharge / target : 0, dailyNeed: Math.max(target - recharge, 0) / Math.max(days - elapsed, 1) };
  }, [overall, period, month]);
  const attention = [...overall].filter((x) => x.target && x.recharge / x.target < .43).sort((a, b) => a.recharge / a.target - b.recharge / b.target).slice(0, 4);
  const changeMonth = (value: string) => { setMonth(value); setOwner("全部BD"); setSearch(""); };
  return <main className="dashboard-shell"><aside className="side-nav"><div className="brand-mark">UP<span>•</span></div><nav aria-label="主导航"><a className="nav-link active" href="#ranking"><LayoutDashboard size={18} /><span>业绩看板</span></a><a className="nav-link" href="#ranking"><UsersRound size={18} /><span>团队排名</span></a><a className="nav-link" href="#ranking"><Waypoints size={18} /><span>代理 / API</span></a><a className="nav-link" href="#trend"><BarChart3 size={18} /><span>趋势分析</span></a></nav><div className="nav-footer"><span className="live-dot" />已导入月度数据</div></aside><div className="workspace">
    <header className="topbar"><div><p className="eyebrow">UP OPERATIONS</p><h1>每日业绩排名</h1></div><div className="topbar-actions"><div className="date-chip"><CalendarDays size={16} /><span>{period.start.replaceAll("-", "/")} — {period.end.replaceAll("-", "/")}</span><ChevronDown size={15} /></div><button className="refresh-button" onClick={() => setUpdated(new Date().toLocaleString("zh-CN", { hour12: false }))} aria-label="刷新数据"><RefreshCw size={17} /></button><button className="export-button" onClick={() => window.print()}><Download size={16} />导出日报</button></div></header>
    <section className="control-row" aria-label="排名筛选"><div className="filter-group"><label>月份</label><select value={month} onChange={(e) => changeMonth(e.target.value)}>{periods.map((x) => <option value={x.id} key={x.id}>{x.label}</option>)}</select></div><div className="filter-group"><label>BD</label><select value={owner} onChange={(e) => setOwner(e.target.value)}><option>全部BD</option>{bdOptions.map((x) => <option key={x}>{x}</option>)}</select></div><div className="filter-group"><label>排名指标</label><select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}><option>充值金额</option><option>完成率</option><option>当日充值</option></select></div><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 BD、代理商或 API" /></div><p className="updated">刷新于 {updated}</p></section>
    <section className="metric-grid" aria-label="总体关键指标"><MetricCard label="月目标" value={money(totals.target)} hint={owner === "全部BD" ? `${period.label} 总目标` : `${owner} 的月目标`} /><MetricCard label="累计充值" value={money(totals.recharge)} hint={`当日充值 ${money(totals.yesterday)}`} /><MetricCard label="整体完成率" value={`${(totals.rate * 100).toFixed(1)}%`} hint={`开卡 ${num(totals.cards)}`} accent /><MetricCard label="后续日均需完成" value={money(totals.dailyNeed)} hint={`截至 ${period.end}`} /></section>
    <section className="content-grid" id="ranking"><div className="ranking-panel"><div className="panel-header"><div><p className="eyebrow">LEADERBOARD</p><h2>{owner === "全部BD" ? `${view}排名` : `${owner} · ${view}`}</h2></div><div className="view-tabs" role="tablist" aria-label="排名类型">{(["总体", "代理商", "API"] as View[]).map((x) => <button key={x} role="tab" aria-selected={view === x} className={view === x ? "selected" : ""} onClick={() => setView(x)}>{x}</button>)}</div></div><div className="table-wrap"><table><thead><tr><th>排名</th><th>{view === "总体" ? "BD" : view}</th><th>归属 BD</th>{view === "总体" ? <><th>目标</th><th>累计充值</th><th>完成率</th></> : <><th>累计充值</th><th>累计消费</th><th>数据范围</th></>}<th>当日充值</th><th>开卡</th><th>状态</th></tr></thead><tbody>{rows.map((row, i) => { const rate = view === "总体" && row.target ? row.recharge / row.target : undefined, state = getStatus(rate); return <tr key={`${row.name}-${row.owner}`}><td><span className={i < 3 ? "rank rank-top" : "rank"}>{i + 1}</span></td><td className="name-cell"><span className="avatar">{row.name.slice(0, 1).toUpperCase()}</span><b>{row.name}</b></td><td className="owner-cell">{row.owner}</td>{view === "总体" ? <><td>{money(row.target)}</td><td className="money">{money(row.recharge)}</td><td><div className="rate-cell"><b>{(rate! * 100).toFixed(1)}%</b><span><i style={{ width: `${Math.min(rate! * 100, 100)}%` }} /></span></div></td></> : <><td className="money">{money(row.recharge)}</td><td>{money(row.consumption)}</td><td>月累计</td></>}<td>{money(row.yesterday)}</td><td>{num(row.cards)}</td><td><span className={`status ${state.tone}`}>{state.label}</span></td></tr>; })}</tbody></table></div></div>
    <aside className="right-rail" id="trend"><section className="trend-panel"><div className="panel-header compact"><div><p className="eyebrow">PERFORMANCE PACE</p><h2>月份数据</h2></div><Gauge size={20} /></div><div className="chart"><div className="axis y"><span>目标</span><span>累计</span><span>0</span></div><div className="bars">{overall.slice(0, 13).map((x, i) => <span key={x.name} style={{ height: `${Math.min((x.recharge / (x.target || 1)) * 55, 100)}%` }} className={i === 0 ? "today-bar" : ""} />)}<i className="target-line" /></div></div><div className="chart-note"><span><i className="dot blue" />各 BD 完成进度</span><span>{period.label}</span></div></section><section className="attention-panel"><div className="panel-header compact"><div><p className="eyebrow">ACTION QUEUE</p><h2>需要跟进</h2></div><span className="count">{attention.length}</span></div><div className="attention-list">{attention.map((x) => <article key={x.name}><div><b>{x.name}</b><p>完成 {(x.recharge / x.target * 100).toFixed(1)}% · 当日 {money(x.yesterday)}</p></div><button onClick={() => setSearch(x.name)}>查看</button></article>)}</div></section></aside></section>
    <p className="data-note">数据来源：UB每日数据.xlsx · 月份切换使用对应的月度汇总和代理/API 日汇总</p>
  </div></main>;
}
