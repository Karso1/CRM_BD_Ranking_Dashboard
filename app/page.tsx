"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, ChevronDown, Download, Gauge, LayoutDashboard, RefreshCw, Search, UsersRound, Waypoints } from "lucide-react";
import dashboardData from "./dashboard-data.json";

type View = "总体" | "代理商" | "API";
type Metric = "充值金额" | "完成率" | "当日充值";
type Language = "zh" | "en";
type Overall = { name: string; target: number; recharge: number; cards: number; yesterday: number };
type Detail = { name: string; owner: string; type: "代理商" | "API"; recharge: number; consumption: number; cards: number; yesterday: number };
type DailyReport = { date: string; details: Omit<Detail, "yesterday">[] };
type Period = { id: string; label: string; start: string; end: string; overall: Overall[]; details: Detail[]; daily: DailyReport[] };
const periods = dashboardData.periods as Period[];
const money = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${Math.round(v / 1e3).toLocaleString()}K`;
const num = (v: number) => v.toLocaleString("en-US");
const copy = {
  zh: { dashboard: "业绩看板", team: "团队排名", agentsApi: "代理 / API", trends: "趋势分析", imported: "已导入月度数据", title: "每日业绩排名", language: "EN", month: "月份", bd: "BD", allBd: "全部BD", metric: "排名指标", recharge: "充值金额", completion: "完成率", dailyRecharge: "当日充值", averageDailyRecharge: "日均充值", search: "搜索 BD、代理商或 API", refreshed: "刷新于", refresh: "刷新数据", export: "导出日报", target: "月目标", totalRecharge: "累计充值", periodRecharge: "周期充值", totalRate: "整体完成率", periodRate: "周期目标占比", dailyNeed: "后续日均需完成", periodDays: "周期天数", monthlyTarget: "总目标", bdTarget: "的月目标", cards: "开卡", asOf: "截至", leaderboard: "排行榜", overall: "总体", agent: "代理商", api: "API", rank: "排名", owner: "归属 BD", consumption: "累计消费", scope: "数据范围", monthly: "月累计", status: "状态", pace: "月份数据", progress: "各 BD 完成进度", followUp: "需要跟进", view: "查看", source: "数据来源：UB每日数据.xlsx · 可按截至日期查看月累计，或按起止日期查看周期表现", monthlyRank: "月度排名", exceeded: "超目标", onTrack: "进度正常", attention: "需关注", behind: "落后", completed: "完成", dataMode: "统计口径", monthToDate: "截至日期（月累计）", dateRange: "起止日期（周期）", startDate: "开始日期", endDate: "结束日期", dateUnavailable: "该月暂无每日数据" },
  en: { dashboard: "Performance Dashboard", team: "Team Ranking", agentsApi: "Agents / API", trends: "Trend Analysis", imported: "Monthly data imported", title: "Daily Performance Ranking", language: "中文", month: "Month", bd: "BD", allBd: "All BDs", metric: "Ranking metric", recharge: "Recharge", completion: "Achievement rate", dailyRecharge: "Daily recharge", averageDailyRecharge: "Average daily recharge", search: "Search BD, agent, or API", refreshed: "Refreshed", refresh: "Refresh data", export: "Export report", target: "Monthly target", totalRecharge: "Cumulative recharge", periodRecharge: "Period recharge", totalRate: "Overall achievement", periodRate: "Period target share", dailyNeed: "Required daily average", periodDays: "Days in period", monthlyTarget: "total target", bdTarget: " monthly target", cards: "Cards issued", asOf: "As of", leaderboard: "LEADERBOARD", overall: "Overall", agent: "Agents", api: "API", rank: "Rank", owner: "Owner BD", consumption: "Cumulative consumption", scope: "Period", monthly: "Month to date", status: "Status", pace: "MONTHLY PERFORMANCE", progress: "BD achievement progress", followUp: "Needs follow-up", view: "View", source: "Source: UB Daily Data.xlsx · Select an as-of date for month-to-date totals or a date range for period performance", monthlyRank: "Monthly ranking", exceeded: "Above target", onTrack: "On track", attention: "Needs attention", behind: "Behind", completed: "Completed", dataMode: "Calculation basis", monthToDate: "As-of date (month-to-date)", dateRange: "Date range (period)", startDate: "Start date", endDate: "End date", dateUnavailable: "No daily data is available for this month" },
} as const;
const viewLabel = (view: View, language: Language) => view === "总体" ? copy[language].overall : view === "代理商" ? copy[language].agent : "API";
const metricLabel = (metric: Metric, language: Language) => metric === "充值金额" ? copy[language].recharge : metric === "完成率" ? copy[language].completion : copy[language].dailyRecharge;
const periodLabel = (period: Period, language: Language) => language === "zh" ? period.label : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${period.id}-01T00:00:00`));
const getStatus = (r: number | undefined, language: Language) => { const t = copy[language]; return r === undefined ? { label: t.monthlyRank, tone: "blue" } : r >= 1 ? { label: t.exceeded, tone: "green" } : r >= .7 ? { label: t.onTrack, tone: "blue" } : r >= .43 ? { label: t.attention, tone: "amber" } : { label: t.behind, tone: "red" }; };
function MetricCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) { return <section className="metric-card"><p>{label}</p><strong className={accent ? "accent" : ""}>{value}</strong><span>{hint}</span></section>; }

export default function Home() {
  const [language, setLanguage] = useState<Language>("zh");
  const [month, setMonth] = useState(periods.at(-1)?.id ?? "");
  const [dataMode, setDataMode] = useState<"mtd" | "range">("mtd");
  const [startDate, setStartDate] = useState(periods.at(-1)?.start ?? "");
  const [endDate, setEndDate] = useState(periods.at(-1)?.end ?? "");
  const [view, setView] = useState<View>("总体");
  const [metric, setMetric] = useState<Metric>("充值金额");
  const [owner, setOwner] = useState("全部BD");
  const [search, setSearch] = useState("");
  const [updated, setUpdated] = useState("2026-09-14");
  const t = copy[language];
  const period = periods.find((x) => x.id === month) ?? periods.at(-1)!;
  const selectedReports = useMemo(() => period.daily.filter((report) => report.date <= endDate && (dataMode === "mtd" ? report.date >= period.start : report.date >= startDate)), [period, startDate, endDate, dataMode]);
  const aggregateDetails = useMemo(() => {
    // The monthly summary is the source of truth for its final as-of date.
    // Earlier dates and custom ranges are reconstructed from the daily blocks.
    if (dataMode === "mtd" && endDate === period.end) return period.details;
    const endpoint = new Map((selectedReports.at(-1)?.details ?? []).map((x) => [`${x.owner}|${x.type}|${x.name}`, x]));
    const sums = new Map<string, Detail>();
    selectedReports.forEach((report) => report.details.forEach((row) => {
      const key = `${row.owner}|${row.type}|${row.name}`;
      const previous = sums.get(key) ?? { ...row, recharge: 0, consumption: 0, cards: 0, yesterday: 0 };
      previous.recharge += row.recharge;
      previous.consumption += row.consumption;
      previous.cards += row.cards;
      sums.set(key, previous);
    }));
    return [...sums.entries()].map(([key, row]) => ({ ...row, yesterday: dataMode === "mtd" ? (endpoint.get(key)?.recharge ?? 0) : row.recharge / Math.max(selectedReports.length, 1) }));
  }, [selectedReports, dataMode, period, endDate]);
  const bdOptions = useMemo(() => {
    const labels = new Map<string, string>();
    [...period.overall.map((x) => x.name), ...period.details.map((x) => x.owner)].forEach((item) => labels.set(item.toLowerCase(), labels.get(item.toLowerCase()) ?? item));
    return [...labels.values()].sort();
  }, [period]);
  const allOverall = useMemo(() => {
    if (dataMode === "mtd" && endDate === period.end) return period.overall;
    const targetRows = period.overall.map((row) => ({ ...row, recharge: 0, cards: 0, yesterday: 0 }));
    const byOwner = new Map(targetRows.map((row) => [row.name.toLowerCase(), row]));
    aggregateDetails.forEach((row) => {
      const target = byOwner.get(row.owner.toLowerCase()) ?? byOwner.get("others");
      if (target) { target.recharge += row.recharge; target.cards += row.cards; target.yesterday += row.yesterday; }
    });
    return targetRows;
  }, [period, aggregateDetails, dataMode, endDate]);
  const overall = useMemo(() => allOverall.filter((x) => owner === "全部BD" || x.name.toLowerCase() === owner.toLowerCase()), [allOverall, owner]);
  const details = useMemo(() => aggregateDetails.filter((x) => x.type === view && (owner === "全部BD" || x.owner.toLowerCase() === owner.toLowerCase())), [aggregateDetails, owner, view]);
  const rows = useMemo(() => {
    const source: any[] = view === "总体" ? overall.map((x) => ({ ...x, owner: x.name, consumption: 0 })) : details;
    return source.filter((x) => `${x.name} ${x.owner}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => metric === "完成率" ? b.recharge / (b.target || 1) - a.recharge / (a.target || 1) : metric === "当日充值" ? b.yesterday - a.yesterday : b.recharge - a.recharge);
  }, [view, overall, details, metric, search]);
  const totals = useMemo(() => {
    const target = overall.reduce((s, x) => s + x.target, 0), recharge = overall.reduce((s, x) => s + x.recharge, 0), yesterday = overall.reduce((s, x) => s + x.yesterday, 0), cards = overall.reduce((s, x) => s + x.cards, 0);
    const elapsed = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(period.start).getTime()) / 86400000) + 1), days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    return { target, recharge, yesterday, cards, rate: target ? recharge / target : 0, dailyNeed: Math.max(target - recharge, 0) / Math.max(days - elapsed, 1) };
  }, [overall, period, month, endDate]);
  const attention = [...overall].filter((x) => x.target && x.recharge / x.target < .43).sort((a, b) => a.recharge / a.target - b.recharge / b.target).slice(0, 4);
  const changeMonth = (value: string) => { const next = periods.find((x) => x.id === value) ?? period; setMonth(value); setStartDate(next.start); setEndDate(next.end); setOwner("全部BD"); setSearch(""); };
  return <main className="dashboard-shell"><aside className="side-nav"><div className="brand-mark">UP<span>•</span></div><nav aria-label="Main navigation"><a className="nav-link active" href="#ranking"><LayoutDashboard size={18} /><span>{t.dashboard}</span></a><a className="nav-link" href="#ranking"><UsersRound size={18} /><span>{t.team}</span></a><a className="nav-link" href="#ranking"><Waypoints size={18} /><span>{t.agentsApi}</span></a><a className="nav-link" href="#trend"><BarChart3 size={18} /><span>{t.trends}</span></a></nav><div className="nav-footer"><span className="live-dot" />{t.imported}</div></aside><div className="workspace">
    <header className="topbar"><div><p className="eyebrow">UP OPERATIONS</p><h1>{t.title}</h1></div><div className="topbar-actions"><button className="language-button" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} aria-label="Switch language">{t.language}</button><div className="date-chip"><CalendarDays size={16} /><span>{period.start.replaceAll("-", "/")} — {period.end.replaceAll("-", "/")}</span><ChevronDown size={15} /></div><button className="refresh-button" onClick={() => setUpdated(new Date().toLocaleString(language === "zh" ? "zh-CN" : "en-GB", { hour12: false }))} aria-label={t.refresh}><RefreshCw size={17} /></button><button className="export-button" onClick={() => window.print()}><Download size={16} />{t.export}</button></div></header>
    <section className="control-row" aria-label="Ranking filters"><div className="filter-group"><label>{t.month}</label><select value={month} onChange={(e) => changeMonth(e.target.value)}>{periods.map((x) => <option value={x.id} key={x.id}>{periodLabel(x, language)}</option>)}</select></div><div className="filter-group"><label>{t.dataMode}</label><select value={dataMode} onChange={(e) => setDataMode(e.target.value as "mtd" | "range")}><option value="mtd">{t.monthToDate}</option><option value="range">{t.dateRange}</option></select></div>{dataMode === "range" && <div className="filter-group"><label>{t.startDate}</label><input className="date-input" type="date" min={period.start} max={endDate} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>}<div className="filter-group"><label>{dataMode === "mtd" ? t.asOf : t.endDate}</label><input className="date-input" type="date" min={dataMode === "range" ? startDate : period.start} max={period.end} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div><div className="filter-group"><label>{t.bd}</label><select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="全部BD">{t.allBd}</option>{bdOptions.map((x) => <option key={x}>{x}</option>)}</select></div><div className="filter-group"><label>{t.metric}</label><select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}><option value="充值金额">{t.recharge}</option><option value="完成率">{t.completion}</option><option value="当日充值">{dataMode === "mtd" ? t.dailyRecharge : t.averageDailyRecharge}</option></select></div><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} /></div><p className="updated">{t.refreshed} {updated}</p></section>
    <section className="metric-grid" aria-label="Key performance indicators"><MetricCard label={t.target} value={money(totals.target)} hint={owner === "全部BD" ? `${periodLabel(period, language)} ${t.monthlyTarget}` : `${owner}${t.bdTarget}`} /><MetricCard label={dataMode === "mtd" ? t.totalRecharge : t.periodRecharge} value={money(totals.recharge)} hint={`${dataMode === "mtd" ? t.dailyRecharge : t.averageDailyRecharge} ${money(totals.yesterday)}`} /><MetricCard label={dataMode === "mtd" ? t.totalRate : t.periodRate} value={`${(totals.rate * 100).toFixed(1)}%`} hint={`${t.cards} ${num(totals.cards)}`} accent />{dataMode === "mtd" ? <MetricCard label={t.dailyNeed} value={money(totals.dailyNeed)} hint={`${t.asOf} ${endDate}`} /> : <MetricCard label={t.periodDays} value={`${selectedReports.length}`} hint={`${startDate} — ${endDate}`} />}</section>
    <section className="content-grid" id="ranking"><div className="ranking-panel"><div className="panel-header"><div><p className="eyebrow">{t.leaderboard}</p><h2>{owner === "全部BD" ? `${viewLabel(view, language)} ${language === "zh" ? "排名" : "Ranking"}` : `${owner} · ${viewLabel(view, language)}`}</h2></div><div className="view-tabs" role="tablist" aria-label="Ranking type">{(["总体", "代理商", "API"] as View[]).map((x) => <button key={x} role="tab" aria-selected={view === x} className={view === x ? "selected" : ""} onClick={() => setView(x)}>{viewLabel(x, language)}</button>)}</div></div><div className="table-wrap"><table><thead><tr><th>{t.rank}</th><th>{view === "总体" ? "BD" : viewLabel(view, language)}</th><th>{t.owner}</th>{view === "总体" ? <><th>{t.target}</th><th>{dataMode === "mtd" ? t.totalRecharge : t.periodRecharge}</th><th>{dataMode === "mtd" ? t.completion : t.periodRate}</th></> : <><th>{dataMode === "mtd" ? t.totalRecharge : t.periodRecharge}</th><th>{t.consumption}</th><th>{dataMode === "mtd" ? t.monthly : t.scope}</th></>}<th>{dataMode === "mtd" ? t.dailyRecharge : t.averageDailyRecharge}</th><th>{t.cards}</th><th>{t.status}</th></tr></thead><tbody>{rows.map((row, i) => { const rate = view === "总体" && row.target ? row.recharge / row.target : undefined, state = getStatus(rate, language); return <tr key={`${row.name}-${row.owner}`}><td><span className={i < 3 ? "rank rank-top" : "rank"}>{i + 1}</span></td><td className="name-cell"><span className="avatar">{row.name.slice(0, 1).toUpperCase()}</span><b>{row.name}</b></td><td className="owner-cell">{row.owner}</td>{view === "总体" ? <><td>{money(row.target)}</td><td className="money">{money(row.recharge)}</td><td><div className="rate-cell"><b>{(rate! * 100).toFixed(1)}%</b><span><i style={{ width: `${Math.min(rate! * 100, 100)}%` }} /></span></div></td></> : <><td className="money">{money(row.recharge)}</td><td>{money(row.consumption)}</td><td>{dataMode === "mtd" ? t.monthly : `${startDate} — ${endDate}`}</td></>}<td>{money(row.yesterday)}</td><td>{num(row.cards)}</td><td><span className={`status ${state.tone}`}>{state.label}</span></td></tr>; })}</tbody></table></div></div>
    <aside className="right-rail" id="trend"><section className="trend-panel"><div className="panel-header compact"><div><p className="eyebrow">{t.pace}</p><h2>{language === "zh" ? "月份数据" : "Monthly data"}</h2></div><Gauge size={20} /></div><div className="chart"><div className="axis y"><span>{t.target}</span><span>{t.totalRecharge}</span><span>0</span></div><div className="bars">{overall.slice(0, 13).map((x, i) => <span key={x.name} style={{ height: `${Math.min((x.recharge / (x.target || 1)) * 55, 100)}%` }} className={i === 0 ? "today-bar" : ""} />)}<i className="target-line" /></div></div><div className="chart-note"><span><i className="dot blue" />{t.progress}</span><span>{periodLabel(period, language)}</span></div></section><section className="attention-panel"><div className="panel-header compact"><div><p className="eyebrow">ACTION QUEUE</p><h2>{t.followUp}</h2></div><span className="count">{attention.length}</span></div><div className="attention-list">{attention.map((x) => <article key={x.name}><div><b>{x.name}</b><p>{t.completed} {(x.recharge / x.target * 100).toFixed(1)}% · {t.dailyRecharge} {money(x.yesterday)}</p></div><button onClick={() => setSearch(x.name)}>{t.view}</button></article>)}</div></section></aside></section>
    <p className="data-note">{t.source}</p>
  </div></main>;
}
