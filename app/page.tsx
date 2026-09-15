"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Download,
  Gauge,
  LayoutDashboard,
  RefreshCw,
  Search,
  UsersRound,
  Waypoints,
} from "lucide-react";

type View = "负责人" | "代理商" | "API" | "BD";
type Metric = "充值金额" | "完成率" | "昨日充值";

type RankRow = {
  rank: number;
  name: string;
  owner: string;
  type: Exclude<View, "负责人"> | "负责人";
  target: number;
  recharge: number;
  yesterday: number;
  cards: number;
  change: number;
};

const people: RankRow[] = [
  { rank: 1, name: "Katrina", owner: "Katrina", type: "负责人", target: 1250000, recharge: 2576663, yesterday: 178021, cards: 7187, change: 3 },
  { rank: 2, name: "VICTOR", owner: "VICTOR", type: "负责人", target: 1250000, recharge: 1151662, yesterday: 42423, cards: 1544, change: 1 },
  { rank: 3, name: "RUSLAN", owner: "RUSLAN", type: "负责人", target: 1250000, recharge: 866915, yesterday: 42309, cards: 2996, change: 2 },
  { rank: 4, name: "Richard", owner: "Richard", type: "负责人", target: 1250000, recharge: 338597, yesterday: 6279, cards: 13, change: -1 },
  { rank: 5, name: "Mike", owner: "Mike", type: "负责人", target: 1250000, recharge: 128356, yesterday: 2097, cards: 27, change: -2 },
  { rank: 6, name: "Patrick", owner: "Patrick", type: "负责人", target: 1250000, recharge: 22830, yesterday: 1813, cards: 9, change: -1 },
  { rank: 7, name: "Others", owner: "Others", type: "负责人", target: 3224400, recharge: 1261127, yesterday: 14832, cards: 0, change: 0 },
];

const agents: RankRow[] = [
  { rank: 1, name: "List rentals limited", owner: "OWEN", type: "API", target: 650000, recharge: 920874, yesterday: 68322, cards: 1, change: 2 },
  { rank: 2, name: "Katrina", owner: "KATRINA", type: "代理商", target: 300000, recharge: 322203, yesterday: 9085, cards: 6, change: 1 },
  { rank: 3, name: "UCPay", owner: "LUKE", type: "API", target: 220000, recharge: 179739, yesterday: 10686, cards: 44, change: 3 },
  { rank: 4, name: "Owen", owner: "OWEN", type: "代理商", target: 180000, recharge: 118694, yesterday: 0, cards: 0, change: -1 },
  { rank: 5, name: "Dmitriy ZarGates", owner: "KATRINA", type: "代理商", target: 100000, recharge: 54680, yesterday: 4020, cards: 0, change: 0 },
  { rank: 6, name: "ALEX", owner: "KATRINA", type: "代理商", target: 60000, recharge: 14580, yesterday: 549, cards: 0, change: -2 },
  { rank: 7, name: "JONY ARMY", owner: "LUKE", type: "代理商", target: 45000, recharge: 10000, yesterday: 0, cards: 0, change: -1 },
  { rank: 8, name: "NIHAT SAHIN", owner: "KATRINA", type: "代理商", target: 45000, recharge: 2964, yesterday: 0, cards: 0, change: 0 },
];

const formatMoney = (value: number) => value >= 1000000 ? `${(value / 1000000).toFixed(2)}M` : `${Math.round(value / 1000).toLocaleString()}K`;
const formatNum = (value: number) => value.toLocaleString("en-US");
function progressStatus(rate: number) { if (rate >= 1) return { label: "超目标", tone: "green" }; if (rate >= .7) return { label: "进度正常", tone: "blue" }; if (rate >= .43) return { label: "需关注", tone: "amber" }; return { label: "落后", tone: "red" }; }
function MetricCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) { return <section className="metric-card"><p>{label}</p><strong className={accent ? "accent" : ""}>{value}</strong><span>{hint}</span></section>; }

export default function Home() {
  const [view, setView] = useState<View>("负责人");
  const [metric, setMetric] = useState<Metric>("充值金额");
  const [owner, setOwner] = useState("全部负责人");
  const [search, setSearch] = useState("");
  const [updated, setUpdated] = useState("2026-09-13 10:24");
  const rows = useMemo(() => {
    const source = view === "负责人" ? people : agents.filter((item) => view === "代理商" ? item.type === "代理商" : view === "API" ? item.type === "API" : item.type === "代理商");
    const key = metric === "充值金额" ? "recharge" : metric === "完成率" ? "target" : "yesterday";
    return source.filter((item) => owner === "全部负责人" || item.owner === owner).filter((item) => `${item.name} ${item.owner}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => metric === "完成率" ? b.recharge / b.target - a.recharge / a.target : b[key] - a[key]);
  }, [view, metric, owner, search]);
  const attention = [...people].filter((item) => item.recharge / item.target < .433).sort((a, b) => a.recharge / a.target - b.recharge / b.target).slice(0, 4);
  return <main className="dashboard-shell">
    <aside className="side-nav"><div className="brand-mark">UP<span>•</span></div><nav aria-label="主导航"><a className="nav-link active" href="#ranking"><LayoutDashboard size={18} /><span>业绩看板</span></a><a className="nav-link" href="#ranking"><UsersRound size={18} /><span>团队排名</span></a><a className="nav-link" href="#ranking"><Waypoints size={18} /><span>代理 / API</span></a><a className="nav-link" href="#trend"><BarChart3 size={18} /><span>趋势分析</span></a></nav><div className="nav-footer"><span className="live-dot" />数据已同步</div></aside>
    <div className="workspace">
      <header className="topbar"><div><p className="eyebrow">UP OPERATIONS</p><h1>每日业绩排名</h1></div><div className="topbar-actions"><div className="date-chip"><CalendarDays size={16} /><span>2026/09/01 — 2026/09/13</span><ChevronDown size={15} /></div><button className="refresh-button" onClick={() => setUpdated(new Date().toLocaleString("zh-CN", { hour12: false }))} aria-label="刷新数据"><RefreshCw size={17} /></button><button className="export-button" onClick={() => window.print()}><Download size={16} />导出日报</button></div></header>
      <section className="control-row" aria-label="排名筛选"><div className="filter-group"><label>类别</label><button className="filter-control">全部业务 <ChevronDown size={15} /></button></div><div className="filter-group"><label>负责人</label><select value={owner} onChange={(event) => setOwner(event.target.value)}><option>全部负责人</option><option>Katrina</option><option>VICTOR</option><option>RUSLAN</option><option>Richard</option><option>Mike</option><option>Patrick</option></select></div><div className="filter-group"><label>排名指标</label><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}><option>充值金额</option><option>完成率</option><option>昨日充值</option></select></div><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索负责人、代理或 API" /></div><p className="updated">更新于 {updated}</p></section>
      <section className="metric-grid" aria-label="总体关键指标"><MetricCard label="月目标" value="11.57M" hint="2026 年 9 月目标" /><MetricCard label="累计充值" value="6.35M" hint="较时间进度领先 11.5%" /><MetricCard label="整体完成率" value="54.9%" hint="13 / 30 天" accent /><MetricCard label="后续日均需完成" value="307.3K" hint="距离月末还剩 17 天" /></section>
      <section className="content-grid" id="ranking"><div className="ranking-panel"><div className="panel-header"><div><p className="eyebrow">LEADERBOARD</p><h2>业绩排名</h2></div><div className="view-tabs" role="tablist" aria-label="排名类型">{(["负责人", "代理商", "API", "BD"] as View[]).map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item}</button>)}</div></div><div className="table-wrap"><table><thead><tr><th>排名</th><th>{view === "负责人" ? "负责人" : view === "API" ? "API" : "代理商"}</th><th>归属负责人</th><th>目标</th><th>累计充值</th><th>完成率</th><th>昨日充值</th><th>开卡</th><th>趋势</th><th>状态</th></tr></thead><tbody>{rows.map((row, index) => { const rate = row.recharge / row.target; const status = progressStatus(rate); return <tr key={`${row.name}-${row.owner}`}><td><span className={index < 3 ? "rank rank-top" : "rank"}>{index + 1}</span></td><td className="name-cell"><span className="avatar">{row.name.slice(0, 1).toUpperCase()}</span><b>{row.name}</b></td><td className="owner-cell">{row.owner}</td><td>{formatMoney(row.target)}</td><td className="money">{formatMoney(row.recharge)}</td><td><div className="rate-cell"><b>{(rate * 100).toFixed(1)}%</b><span><i style={{ width: `${Math.min(rate * 100, 100)}%` }} /></span></div></td><td>{formatMoney(row.yesterday)}</td><td>{formatNum(row.cards)}</td><td>{row.change === 0 ? <span className="neutral">—</span> : <span className={row.change > 0 ? "rise" : "fall"}>{row.change > 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{Math.abs(row.change)}</span>}</td><td><span className={`status ${status.tone}`}>{status.label}</span></td></tr>; })}</tbody></table></div></div>
      <aside className="right-rail" id="trend"><section className="trend-panel"><div className="panel-header compact"><div><p className="eyebrow">PERFORMANCE PACE</p><h2>充值趋势</h2></div><Gauge size={20} /></div><div className="chart"><div className="axis y"><span>800K</span><span>400K</span><span>0</span></div><div className="bars">{[38,52,47,64,55,78,65,73,91,84,96,72,61].map((height,index)=><span key={index} style={{height:`${height}%`}} className={index===12?"today-bar":""}/>)}<i className="target-line" /></div></div><div className="chart-note"><span><i className="dot blue" />实际充值</span><span><i className="dash" />日均需 307.3K</span></div></section><section className="attention-panel"><div className="panel-header compact"><div><p className="eyebrow">ACTION QUEUE</p><h2>需要跟进</h2></div><span className="count">{attention.length}</span></div><div className="attention-list">{attention.map((item)=>{const rate=item.recharge/item.target;const required=Math.max(item.target-item.recharge,0)/17;return <article key={item.name}><div><b>{item.name}</b><p>完成 {(rate*100).toFixed(1)}% · 后续需 {formatMoney(required)}/天</p></div><button onClick={()=>setSearch(item.name)}>查看</button></article>})}</div></section></aside></section>
      <p className="data-note">数据示例：UB 每日数据 · 9 月汇总 · 报表日 2026/09/13</p>
    </div>
  </main>;
}
