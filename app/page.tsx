"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { Activity, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Download, LayoutDashboard, RefreshCw, RotateCcw, Search, UsersRound, Waypoints, Zap } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dashboardData from "./dashboard-data.json";
import walletData from "./wallet-data.json";
import stagingDashboardData from "./staging-dashboard-data.json";
import { DashboardDatePicker, FilterSelect } from "@/components/dashboard-filters";
import { agentActivity, activityKey } from "@/lib/agent-activity";
import { AgentProfileButton } from "@/components/agent-profile";
import { findAgentProfile, compareCooperationStart, type AgentProfile } from "@/lib/agent-profiles";

type View = "总体" | "代理商" | "API";
type Lang = "zh" | "en";
type Platform = "business" | "wallet";
type SortKey = "name" | "owner" | "target" | "recharge" | "completion" | "consumption" | "yesterday" | "cardsVirtual" | "cardsPhysical" | "status" | "cooperationStart";
type CardMetrics = { cards:number; cardsVirtual?:number; cardsPhysical?:number };
type Overall = { name:string; target:number; recharge:number; yesterday:number } & CardMetrics;
type Detail = { name:string; owner:string; type:"代理商"|"API"; recharge:number; consumption:number; yesterday:number } & CardMetrics;
type Report = { date:string; details:Omit<Detail,"yesterday">[] };
type Period = { id:string; label:string; start:string; end:string; overall:Overall[]; details:Detail[]; daily:Report[] };
const isStaging = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "staging";
const fallbackPeriods:Record<Platform,Period[]> = {
 business: (isStaging ? stagingDashboardData.business.periods : dashboardData.periods) as Period[],
 wallet: (isStaging ? stagingDashboardData.wallet.periods : walletData.periods) as Period[],
};
type DashboardPayload = { business?:{periods?:Period[];profiles?:AgentProfile[]}; wallet?:{periods?:Period[];profiles?:AgentProfile[]} };
const colors = ["#58d2a5", "#49a6f2", "#59d4e8", "#9b79e8", "#75889a"];
const money = (v:number) => v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v/1e3).toLocaleString()}K` : Math.round(v).toLocaleString();
const number = (v:number) => v.toLocaleString("en-US",{maximumFractionDigits:0});
const virtualCards = (row:{cardsVirtual?:number}) => row.cardsVirtual ?? 0;
const physicalCards = (row:{cardsPhysical?:number}) => row.cardsPhysical ?? 0;
const words = {
 zh:{title:"趋势洞察",sub:"数据驱动增长 · 洞察成就未来",dashboard:"看板概览",team:"BD 排名",entities:"代理 / API 排名",trends:"趋势分析",imported:"已导入每日数据",export:"导出日报",month:"月份",allPeriods:"全部历史",basis:"统计口径",mtd:"截至日期（月累计）",range:"起止日期（跨月周期）",asOf:"截至",start:"开始日期",end:"结束日期",reset:"重置筛选",bd:"BD",allBd:"全部BD",metric:"排名指标",recharge:"充值金额",completion:"完成率",dailyRecharge:"当日充值",averageDaily:"日均充值",search:"搜索 BD、代理商或 API",target:"月目标",cumulative:"累计充值",period:"周期充值",rate:"整体完成率",dailyNeed:"后续日均需完成",days:"周期天数",targetHint:"本月总目标",dateHint:"当前统计周期",cards:"开卡",virtualCards:"虚拟卡",physicalCards:"实体卡",cumulativeTrend:"累计充值趋势",actual:"实际累计充值",targetPace:"目标进度",contribution:"BD 贡献占比",daily:"每日充值金额",attention:"异常与关注",seeAll:"查看全部",ranking:"总体排名",overall:"总体",agents:"代理商",api:"API",rank:"排名",owner:"归属 BD",consumption:"累计消费",status:"状态",noTarget:"未设目标",monthTotal:"月累计",periodRange:"周期",above:"超目标",onTrack:"进度正常",watch:"需关注",behind:"落后",none:"当前没有需要特别关注的 BD",source:"数据来源：UB每日数据.xlsx · 数据会跟随日期、BD 与类型筛选联动",gap:"预计缺口",compared:"较前一日",language:"EN"},
 en:{title:"Trend Intelligence",sub:"Data-driven growth · Insight for what comes next",dashboard:"Overview",team:"BD Ranking",entities:"Agent / API Ranking",trends:"Trend Analysis",imported:"Daily data imported",export:"Export report",month:"Month",allPeriods:"All history",basis:"Calculation basis",mtd:"As-of date (month-to-date)",range:"Date range (cross-month)",asOf:"As of",start:"Start date",end:"End date",reset:"Reset filters",bd:"BD",allBd:"All BDs",metric:"Ranking metric",recharge:"Recharge",completion:"Achievement rate",dailyRecharge:"Daily recharge",averageDaily:"Daily average",search:"Search BD, agent, or API",target:"Monthly target",cumulative:"Cumulative recharge",period:"Period recharge",rate:"Achievement rate",dailyNeed:"Required daily average",days:"Days in period",targetHint:"Total target this month",dateHint:"Current reporting period",cards:"Cards issued",virtualCards:"Virtual cards",physicalCards:"Physical cards",cumulativeTrend:"Cumulative recharge trend",actual:"Actual recharge",targetPace:"Target pace",contribution:"BD contribution",daily:"Daily recharge",attention:"Anomalies & attention",seeAll:"View all",ranking:"Overall ranking",overall:"Overall",agents:"Agents",api:"API",rank:"Rank",owner:"Owner BD",consumption:"Consumption",status:"Status",noTarget:"No target",monthTotal:"Month to date",periodRange:"Period",above:"Above target",onTrack:"On track",watch:"Needs attention",behind:"Behind",none:"No BDs need special attention right now",source:"Source: UB Daily Data.xlsx · Date, BD, and type filters are linked across the dashboard",gap:"Projected gap",compared:"vs previous day",language:"中文"}
} as const;

function Kpi({label,value,hint,icon,accent=false}:{label:string;value:string;hint:string;icon:React.ReactNode;accent?:boolean}){return <article className="kpi"><div><p>{label}</p><strong className={accent?"accent":""}>{value}</strong><span>{hint}</span></div><i>{icon}</i></article>}

export default function Home(){
 const initialPeriod=fallbackPeriods.business.at(-1)!;
 const [periodSets,setPeriodSets]=useState<Record<Platform,Period[]>>(fallbackPeriods);
 const [profileSets,setProfileSets]=useState<Record<Platform,AgentProfile[]>>({business:[],wallet:[]});
 const [platform,setPlatform]=useState<Platform>("business"),[lang,setLang]=useState<Lang>("en"),[month,setMonth]=useState(initialPeriod.id),[mode,setMode]=useState<"mtd"|"range">("mtd"),[start,setStart]=useState(initialPeriod.start),[end,setEnd]=useState(initialPeriod.end),[owner,setOwner]=useState("全部BD"),[metric,setMetric]=useState("充值金额"),[view,setView]=useState<View>("总体"),[search,setSearch]=useState(""),[nav,setNav]=useState("dashboard"),[syncing,setSyncing]=useState(true),[syncFailed,setSyncFailed]=useState(false),[selectedContribution,setSelectedContribution]=useState<number|null>(null);
 const requestSequence=useRef(0);
 const [columnSort,setColumnSort]=useState<{key:SortKey;direction:"asc"|"desc"}|null>(null);
 const activeRequest=useRef<AbortController|null>(null);
 const lastChecked=useRef<Record<Platform,number>>({business:0,wallet:0});
 const previousLatest=useRef<Record<Platform,string>>({business:fallbackPeriods.business.at(-1)!.end,wallet:fallbackPeriods.wallet.at(-1)!.end});
 const mounted=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 // Render the dated, explicitly labelled snapshot while a live read is pending.
 const syncData=useCallback(async(nextPlatform:Platform=platform,force=false,silent=false)=>{
  if(!force&&Date.now()-lastChecked.current[nextPlatform]<60000){setSyncing(false);return}
  activeRequest.current?.abort();
  const controller=new AbortController();activeRequest.current=controller;
  const requestId=++requestSequence.current;
  const storageKey=`upay-dashboard:${isStaging?"staging":"production"}:${nextPlatform}:v1`;
  const apply=(nextPeriods:Period[])=>setPeriodSets(current=>{
   if((nextPeriods.at(-1)?.end??"")<(current[nextPlatform].at(-1)?.end??""))return current;
   return {...current,[nextPlatform]:nextPeriods};
  });
  // Show the last successful browser copy immediately while checking for newer data.
  if(!force){try{const saved=JSON.parse(localStorage.getItem(storageKey)??"null");if(Array.isArray(saved)&&saved.length&&saved.every((p:Period)=>p.id&&p.end&&Array.isArray(p.daily)&&Array.isArray(p.details)&&Array.isArray(p.overall)))apply(saved)}catch{/* Storage is optional. */}}
  if(!silent)setSyncing(true);
  const timeout=window.setTimeout(()=>controller.abort(),125000);
  try{
   let response:Response;
   if(!force){
    response=await fetch(`/api/dashboard?platform=${nextPlatform}&cacheOnly=1`,{cache:"no-store",signal:controller.signal});
    const needsRefresh=response.headers.get("X-Dashboard-Refresh")==="1";
    if(response.ok&&response.status!==204&&needsRefresh){
     const cached=await response.json() as DashboardPayload;
     if(requestId===requestSequence.current&&cached[nextPlatform]?.periods?.length)apply(cached[nextPlatform]!.periods!);
     response=await fetch(`/api/dashboard?platform=${nextPlatform}`,{cache:"no-store",signal:controller.signal});
    }
    if(response.status===204){
     if(requestId===requestSequence.current)setSyncing(false);
     response=await fetch(`/api/dashboard?platform=${nextPlatform}`,{cache:"no-store",signal:controller.signal});
    }
   }else response=await fetch(`/api/dashboard?platform=${nextPlatform}`,{cache:"no-store",signal:controller.signal});
   if(!response.ok)throw new Error(`Dashboard request failed (${response.status})`);
   const payload=await response.json() as DashboardPayload;
   const nextPeriods=payload[nextPlatform]?.periods;
   if(!nextPeriods?.length)throw new Error(`Dashboard response has no ${nextPlatform} data`);
   if(requestId!==requestSequence.current)return;
   apply(nextPeriods);
   setProfileSets(current=>({...current,[nextPlatform]:payload[nextPlatform]?.profiles??[]}));
   lastChecked.current[nextPlatform]=Date.now();
   try{localStorage.setItem(storageKey,JSON.stringify(nextPeriods))}catch{/* Quota/private mode must not interrupt the dashboard. */}
   setSyncFailed(false);
  }catch{if(requestId===requestSequence.current){setSyncFailed(true)}}
  finally{window.clearTimeout(timeout);if(activeRequest.current===controller)activeRequest.current=null;if(requestId===requestSequence.current)setSyncing(false)}
 },[platform]);
 useEffect(()=>{
  let disposed=false,inFlight=false;
  const update=async()=>{if(disposed||inFlight||activeRequest.current||document.visibilityState==="hidden")return;inFlight=true;await syncData(platform,false,true);inFlight=false};
  const initial=window.setTimeout(()=>void update(),0);
  const interval=window.setInterval(()=>{if(document.visibilityState!=="hidden")void update()},30000);
  window.addEventListener("online",update);document.addEventListener("visibilitychange",update);
  return()=>{disposed=true;requestSequence.current++;activeRequest.current?.abort();activeRequest.current=null;window.clearTimeout(initial);window.clearInterval(interval);window.removeEventListener("online",update);document.removeEventListener("visibilitychange",update)};
 },[syncData,platform]);
 // Entity views have no configured goals; reset the aggregate-only metric.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(view!=="总体"&&metric==="完成率")setMetric("充值金额")},[view,metric]);
 // Keep the default MTD selection following newly synced latest dates.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const latest=periodSets[platform].at(-1)!,oldEnd=previousLatest.current[platform];if(mode==="mtd"&&end===oldEnd&&latest.end!==end){setMonth(latest.id);setStart(latest.start);setEnd(latest.end)}previousLatest.current[platform]=latest.end},[periodSets,platform,mode,month,start,end]);
 const t=words[lang],periods=periodSets[platform],period=periods.find(p=>p.id===month)??periods.at(-1)!;
 const firstDate=periods.at(0)!.start,lastDate=periods.at(-1)!.end;
 const activityAsOf=end<lastDate?end:lastDate;
 const activity=useMemo(()=>agentActivity(periods.flatMap(p=>p.daily),activityAsOf),[periods,activityAsOf]);
 const activityLabels=lang==="zh"?{active:"活跃",attention:"需关注",inactive:"不活跃",observing:"数据观察期"}:{active:"Active",attention:"Needs attention",inactive:"Inactive",observing:"Observing"};
 const isWallet=platform==="wallet";
 const publicWalletBds=new Set(["victor","katrina","ruslan","mike","patrick","richard","upay"]);
 const displayedOwner=(rawOwner:string,name="")=>{
  if(!isWallet||isStaging)return rawOwner;
  // Old snapshots may still contain internal employee or unassigned labels.
  // The public dashboard groups both under the single UPay ownership label.
  if(name.startsWith("UPay · "))return "UPay";
  return publicWalletBds.has(rawOwner.toLowerCase())?rawOwner:"UPay";
 };
 const performanceLabel=isWallet?(lang==="zh"?"消费金额":"Consumption"):(lang==="zh"?"总金额":"Total amount");
 const cumulativeLabel=isWallet?(lang==="zh"?"累计消费":"Cumulative consumption"):(lang==="zh"?"累计总金额":"Cumulative total amount");
 const periodLabel=isWallet?(lang==="zh"?"周期消费":"Period consumption"):(lang==="zh"?"周期总金额":"Period total amount");
 const dailyLabel=isWallet?(lang==="zh"?"当日消费":"Daily consumption"):(lang==="zh"?"当日总金额":"Daily total amount");
 const averageDailyLabel=isWallet?(lang==="zh"?"日均消费":"Average daily consumption"):(lang==="zh"?"日均总金额":"Average daily total amount");
 const availableViews:View[]=isWallet?["总体","代理商"]:["总体","代理商","API"];
 const countDays=(from:string,to:string)=>Math.max(0,Math.floor((new Date(`${to}T00:00:00`).getTime()-new Date(`${from}T00:00:00`).getTime())/86400000)+1);
 const reports=useMemo(()=>{const source=mode==="range"?periods.flatMap(p=>p.daily):period.daily;const from=mode==="range"?start:period.start;return source.filter(r=>r.date>=from&&r.date<=end)},[periods,period,start,end,mode]);
 const details=useMemo(()=>{if(mode==="mtd"&&end===period.end)return period.details;const map=new Map<string,Detail>();reports.forEach(r=>r.details.forEach(x=>{const k=`${x.owner}|${x.type}|${x.name}`,a=map.get(k)??{...x,recharge:0,consumption:0,cards:0,cardsVirtual:0,cardsPhysical:0,yesterday:0};a.recharge+=x.recharge;a.consumption+=x.consumption;a.cards+=x.cards;a.cardsVirtual=(a.cardsVirtual??0)+virtualCards(x);a.cardsPhysical=(a.cardsPhysical??0)+physicalCards(x);map.set(k,a)}));const last=new Map((reports.at(-1)?.details??[]).map(x=>[`${x.owner}|${x.type}|${x.name}`,x.recharge]));return [...map].map(([k,x])=>({...x,yesterday:mode==="mtd"?last.get(k)??0:x.recharge/Math.max(reports.length,1)}))},[period,reports,mode,end]);
 const allOverall=useMemo(()=>{if(mode==="mtd"&&end===period.end)return period.overall;const from=mode==="range"?start:period.start;const grouped=new Map<string,Overall>();periods.forEach(p=>{const overlapStart=from>p.start?from:p.start,overlapEnd=end<p.end?end:p.end;if(overlapStart>overlapEnd)return;const fullDays=countDays(p.start,p.end),coverage=countDays(overlapStart,overlapEnd)/fullDays;p.overall.forEach(x=>{const key=x.name.toLowerCase(),current=grouped.get(key)??{name:x.name,target:0,recharge:0,cards:0,cardsVirtual:0,cardsPhysical:0,yesterday:0};current.target+=x.target*coverage;grouped.set(key,current)})});const fallback=[...grouped.values()].find(x=>x.name.toLowerCase()==="others");details.forEach(x=>{const current=grouped.get(x.owner.toLowerCase())??fallback;if(current){current.recharge+=x.recharge;current.cards+=x.cards;current.cardsVirtual=(current.cardsVirtual??0)+virtualCards(x);current.cardsPhysical=(current.cardsPhysical??0)+physicalCards(x);current.yesterday+=x.yesterday}});return [...grouped.values()]},[periods,period,details,mode,start,end]);
 const displayedOverall=useMemo(()=>{if(!isWallet)return allOverall;const grouped=new Map<string,Overall>();allOverall.forEach(x=>{const name=displayedOwner(x.name),current=grouped.get(name)??{name,target:0,recharge:0,cards:0,cardsVirtual:0,cardsPhysical:0,yesterday:0};current.target+=x.target;current.recharge+=x.recharge;current.cards+=x.cards;current.cardsVirtual=(current.cardsVirtual??0)+virtualCards(x);current.cardsPhysical=(current.cardsPhysical??0)+physicalCards(x);current.yesterday+=x.yesterday;grouped.set(name,current)});return [...grouped.values()]},[allOverall,isWallet]);
 const bds=useMemo(()=>[...new Set([...displayedOverall.map(x=>x.name),...details.map(x=>displayedOwner(x.owner,x.name))])].sort(),[displayedOverall,details]);
 const overall=displayedOverall.filter(x=>owner==="全部BD"||x.name.toLowerCase()===owner.toLowerCase());
 const ownerMatches=(rawOwner:string,name="")=>owner==="全部BD"||displayedOwner(rawOwner,name).toLowerCase()===owner.toLowerCase();
 const source=view==="总体"?overall.map(x=>({...x,owner:x.name,consumption:0})):details.filter(x=>x.type===view&&ownerMatches(x.owner,x.name));
 const profileFor=(row:{name:string;owner:string})=>view==="总体"?undefined:findAgentProfile(profileSets[platform],{name:row.name,owner:row.owner,type:view});
 const sortValue=(row:typeof source[number],key:SortKey):string|number=>{
  const rate="target" in row&&row.target?row.recharge/row.target:0;
  if(key==="name")return row.name;
  if(key==="cooperationStart")return profileFor(row)?.cooperationStart??"";
  if(key==="owner")return displayedOwner(row.owner,row.name);
  if(key==="target")return "target" in row?row.target:0;
  if(key==="completion")return rate;
  if(key==="status")return view==="总体"?rate:({active:3,attention:2,observing:1,inactive:0}[activity.get(activityKey({name:row.name,owner:row.owner,type:view}))?.status??"observing"]);
  return row[key]??0;
 };
 const rows=[...source].filter(x=>`${x.name} ${displayedOwner(x.owner,x.name)}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>{
  const key=columnSort?.key??(metric==="完成率"?"completion":metric==="当日充值"?"yesterday":"recharge"),left=sortValue(a,key),right=sortValue(b,key);
  if(key==="cooperationStart")return compareCooperationStart(String(left),String(right),columnSort?.direction??"desc");
  const result=typeof left==="string"&&typeof right==="string"?left.localeCompare(right):Number(left)-Number(right);
  return (columnSort?.direction==="asc"?1:-1)*result;
 });
 const target=overall.reduce((s,x)=>s+x.target,0),recharge=overall.reduce((s,x)=>s+x.recharge,0),cards=overall.reduce((s,x)=>s+x.cards,0),cardsVirtual=overall.reduce((s,x)=>s+virtualCards(x),0),cardsPhysical=overall.reduce((s,x)=>s+physicalCards(x),0),yesterday=overall.reduce((s,x)=>s+x.yesterday,0),elapsed=mode==="range"?countDays(start,end):countDays(period.start,end),totalDays=mode==="range"?countDays(start,end):new Date(+period.id.slice(0,4),+period.id.slice(5),0).getDate();
 const totals={target,recharge,cards,cardsVirtual,cardsPhysical,yesterday,rate:target?recharge/target:0,dailyNeed:Math.max(target-recharge,0)/Math.max(totalDays-elapsed,1),elapsed,totalDays};
 const daily=reports.map(r=>({date:r.date.slice(5).replace("-","/"),amount:r.details.filter(x=>ownerMatches(x.owner,x.name)).reduce((s,x)=>s+x.recharge,0)}));
 const trend=daily.map((x,i)=>({...x,actual:daily.slice(0,i+1).reduce((sum,row)=>sum+row.amount,0),target:totals.target*(i+1)/totals.totalDays}));
 const contribution=[...overall].sort((a,b)=>b.recharge-a.recharge).map(x=>({...x,share:totals.recharge?x.recharge/totals.recharge:0}));
 const selectedContributionData=selectedContribution==null?undefined:contribution[selectedContribution];
 const attention=[...overall].filter(x=>x.target&&x.recharge/x.target<.7).sort((a,b)=>a.recharge/a.target-b.recharge/b.target).slice(0,5);
 const monthLabel=mode==="range"?`${start} — ${end}`:(lang==="zh"?period.label:new Intl.DateTimeFormat("en-US",{year:"numeric",month:"long"}).format(new Date(`${period.id}-01T00:00:00`)));
 const tip={background:"#0c1c1f",border:"1px solid #203638",borderRadius:8,color:"#e8f5f1"};
 const go=(id:string,v?:View)=>{setNav(id);if(v){setView(v);setColumnSort(null)}document.getElementById(id==="dashboard"?"top":id==="trends"?"trend":"ranking")?.scrollIntoView({behavior:"smooth"})};
 const switchMonth=(id:string)=>{if(id==="all"){setMonth("all");setMode("range");setStart(firstDate);setEnd(lastDate);setOwner("全部BD");return}const next=periods.find(p=>p.id===id)!;setMonth(id);setStart(next.start);setEnd(next.end);setOwner("全部BD")};
 const switchMode=(nextMode:"mtd"|"range")=>{if(nextMode==="range"){setMode("range");setMonth("all");setStart(firstDate);setEnd(lastDate);return}const latest=periods.at(-1)!;setMode("mtd");setMonth(latest.id);setStart(latest.start);setEnd(latest.end)};
 const resetFilters=()=>{const latest=periods.at(-1)!;setMonth(latest.id);setMode("mtd");setStart(latest.start);setEnd(latest.end);setOwner("全部BD");setMetric("充值金额");setColumnSort(null);setSearch("");setView("总体")};
 const switchPlatform=(nextPlatform:Platform)=>{const next=periodSets[nextPlatform].at(-1)!;setPlatform(nextPlatform);setMonth(next.id);setMode("mtd");setStart(next.start);setEnd(next.end);setOwner("全部BD");setMetric("充值金额");setColumnSort(null);setView("总体");setSearch("")};
 const state=(rate?:number)=>rate==null?[t.noTarget,"neutral"]:rate>=1?[t.above,"green"]:rate>=.7?[t.onTrack,"blue"]:rate>=.43?[t.watch,"amber"]:[t.behind,"red"];
 const SortTh=({label,sortKey}:{label:string;sortKey:SortKey})=>{const active=columnSort?.key===sortKey,ascending=active&&columnSort?.direction==="asc",Icon=active?(ascending?ArrowUp:ArrowDown):ArrowUpDown;return <th aria-sort={active?(ascending?"ascending":"descending"):"none"}><button type="button" className={`sort-header ${active?"active":""}`} onClick={()=>setColumnSort({key:sortKey,direction:active?(ascending?"desc":"asc"):(sortKey==="name"||sortKey==="owner"?"asc":"desc")})}><span>{label}</span><Icon size={12}/></button></th>};
 const activityState=(row:{name:string;owner:string;type?:string})=>{
  const value=activity.get(activityKey({name:row.name,owner:row.owner,type:row.type??view}));
  const status=value?.status??"observing";
  const evidence=lang==="zh"?`近30天 ${value?.days??0} 个活跃日 · 最后 ${value?.last??"无记录"}`:`${value?.days??0} active days / 30 · Last ${value?.last??"none"}`;
  const description=lang==="zh"?`截至 ${activityAsOf}，按每日正消费记录判断。近30天至少3天且近14天有消费为活跃；30天无消费为不活跃；其余需关注。数据不足30天时进入观察期。`:`As of ${activityAsOf}, based on positive daily consumption. Active: 3+ days in 30 and activity in the last 14 days. Inactive: no activity in 30 days. Otherwise needs attention; incomplete 30-day coverage is observing.`;
  return {label:activityLabels[status],tone:status==="active"?"green":status==="attention"?"amber":"neutral",evidence,description};
 };
 return <main className="dashboard-shell" id="top"><aside className="side-nav"><div className="brand"><Image src="/upay-logo.png" alt="UPay" width={31} height={31}/><strong>UPay</strong></div><p className="nav-caption">{lang==="zh"?"快速定位":"QUICK JUMP"}</p><nav><button className={`nav-link ${nav==="dashboard"?"active":""}`} onClick={()=>go("dashboard","总体")}><LayoutDashboard size={18}/>{t.dashboard}</button><button className={`nav-link ${nav==="team"?"active":""}`} onClick={()=>go("team","总体")}><UsersRound size={18}/>{t.team}</button><button className={`nav-link ${nav==="entities"?"active":""}`} onClick={()=>go("entities","代理商")}><Waypoints size={18}/>{isWallet?(lang==="zh"?"代理商排名":"Agent ranking"):t.entities}</button><button className={`nav-link ${nav==="trends"?"active":""}`} onClick={()=>go("trends")}><BarChart3 size={18}/>{t.trends}</button></nav></aside>
 <div className="workspace"><header className="topbar"><div className="title-block"><p className="eyebrow">UP OPERATIONS · {isWallet?"UPAY WALLET":"UP BUSINESS"}{isStaging&&<span className="staging-badge">{lang==="zh"?"测试环境":"STAGING"}</span>}</p><h1><em>{lang==="zh"?"趋势":"Trend"}</em> {lang==="zh"?"洞察":"Intelligence"}</h1><p className="subtitle">{t.sub}</p></div><div className="topbar-actions"><div className="platform-switch" aria-label={lang==="zh"?"平台切换":"Platform switch"}><button className={!isWallet?"selected":""} onClick={()=>switchPlatform("business")}>UP Business</button><button className={isWallet?"selected":""} onClick={()=>switchPlatform("wallet")}>UPay Wallet</button></div><button className="language-button" aria-label={lang==="zh"?"切换为英文":"Switch to Chinese"} onClick={()=>setLang(lang==="zh"?"en":"zh")}>{t.language}</button>{syncing&&<span className="sync-status" role="status" aria-live="polite">{lang==="zh"?"正在核对最新数据…":"Checking latest data…"}</span>}<button className="icon-button" aria-label={lang==="zh"?"刷新数据":"Refresh dashboard data"} title={syncFailed?(lang==="zh"?"最新数据暂未核对成功，点击重试；当前保留上次数据":"Latest check failed. Click to retry; previous data is retained."):(lang==="zh"?"重新读取所选平台数据":"Refresh selected platform data")} onClick={()=>void syncData(platform,true)} disabled={syncing}><RefreshCw size={17} className={syncing?"spin":""}/></button><button className="export-button" onClick={()=>window.print()}><Download size={17}/><span>{t.export}</span></button></div></header>
 <section className="control-row">
  <div className="filter-controls">
   <label className="filter-field"><span>{t.month}</span><FilterSelect ariaLabel={t.month} value={month} onChange={switchMonth} options={[{value:"all",label:t.allPeriods},...periods.map(p=>({value:p.id,label:lang==="zh"?p.label:new Intl.DateTimeFormat("en-US",{year:"numeric",month:"long"}).format(new Date(`${p.id}-01T00:00:00`))}))]}/></label>
   <label className="filter-field"><span>{t.basis}</span><FilterSelect ariaLabel={t.basis} value={mode} onChange={value=>switchMode(value as "mtd"|"range")} options={[{value:"mtd",label:t.mtd},{value:"range",label:t.range}]}/></label>
   {mode==="range"&&<div className="date-range-fields"><label className="filter-field"><span>{t.start}</span><DashboardDatePicker value={start} min={firstDate} max={end} onChange={setStart} lang={lang}/></label><span className="date-divider">→</span><label className="filter-field"><span>{t.end}</span><DashboardDatePicker value={end} min={start} max={lastDate} onChange={setEnd} lang={lang}/></label></div>}
   {mode==="mtd"&&<label className="filter-field"><span>{t.asOf}</span><DashboardDatePicker value={end} min={firstDate} max={lastDate} onChange={nextDate=>{const nextPeriod=periods.find(p=>p.id===nextDate.slice(0,7));if(!nextPeriod)return;setMonth(nextPeriod.id);setStart(nextPeriod.start);setEnd(nextDate)}} lang={lang}/></label>}
   <label className="filter-field"><span>{t.bd}</span><FilterSelect ariaLabel={t.bd} value={owner} onChange={setOwner} options={[{value:"全部BD",label:t.allBd},...bds.map(x=>({value:x,label:x}))]}/></label>
   <label className="filter-field"><span>{t.metric}</span><FilterSelect ariaLabel={t.metric} value={metric} onChange={value=>{setMetric(value);setColumnSort(null)}} options={[{value:"充值金额",label:performanceLabel},...(view==="总体"?[{value:"完成率",label:t.completion}]:[]),{value:"当日充值",label:mode==="mtd"?dailyLabel:averageDailyLabel}]}/></label>
  </div>
  <div className="filter-utilities"><div className="filter-actions"><button className="reset-button" onClick={resetFilters}><RotateCcw size={14}/>{t.reset}</button><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={isWallet?(lang==="zh"?"搜索 BD 或代理商":"Search BD or agent"):t.search}/></div></div></div>
 </section>
 <section className="kpi-strip"><Kpi label={t.target} value={money(totals.target)} hint={mode==="range"?`${monthLabel} · ${t.dateHint}`:`${monthLabel} · ${t.targetHint}`} icon={<Activity size={19}/>}/><Kpi label={mode==="mtd"?cumulativeLabel:periodLabel} value={money(totals.recharge)} hint={`${t.asOf} ${end}`} icon={<BarChart3 size={19}/>}/><Kpi label={t.rate} value={`${(totals.rate*100).toFixed(1)}%`} hint={isWallet?`${t.asOf} ${end}`:`${t.virtualCards} ${number(totals.cardsVirtual)} · ${t.physicalCards} ${number(totals.cardsPhysical)}`} icon={<Activity size={19}/>} accent/><Kpi label={mode==="mtd"?t.dailyNeed:t.days} value={mode==="mtd"?money(totals.dailyNeed):String(reports.length)} hint={mode==="mtd"?`${totals.totalDays-totals.elapsed} ${lang==="zh"?"天后截止":"days remaining"}`:t.dateHint} icon={<Zap size={19}/>}/></section>
 <section className="analytics-grid" id="trend"><article className="chart-panel trend-chart"><header><div><p className="eyebrow">PERFORMANCE TREND</p><h2>{isWallet?(lang==="zh"?"累计消费趋势":"Cumulative consumption trend"):(lang==="zh"?"累计总金额趋势":"Cumulative total amount trend")}</h2></div><div className="legend"><span className="actual">{isWallet?(lang==="zh"?"实际累计消费":"Actual consumption"):(lang==="zh"?"实际累计总金额":"Actual total amount")}</span><span className="pace">{t.targetPace}</span></div></header><div className="chart-body">{mounted&&<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><AreaChart data={trend}><CartesianGrid stroke="#173033" vertical={false}/><XAxis dataKey="date" stroke="#71898a" fontSize={11} tickLine={false}/><YAxis stroke="#71898a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v=>`${(v/1e6).toFixed(0)}M`}/><Tooltip contentStyle={tip} formatter={v=>money(Number(v))}/><Area type="monotone" dataKey="target" stroke="#a9bab7" fill="transparent" strokeDasharray="5 5" strokeWidth={2}/><Area type="monotone" dataKey="actual" stroke="#58d2a5" fill="#143b35" strokeWidth={3}/></AreaChart></ResponsiveContainer>}</div><footer><span>{t.target} <b>{money(totals.target)}</b></span><span>{t.gap} <b className={totals.target>totals.recharge?"negative":"positive"}>{money(Math.max(totals.target-totals.recharge,0))}</b></span></footer></article>
 <article className="chart-panel contribution"><header><div><p className="eyebrow">CONTRIBUTION</p><h2>{t.contribution}</h2></div></header><div className="contribution-body"><div className="donut-wrap">{mounted&&<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><PieChart><Pie data={contribution} dataKey="recharge" nameKey="name" innerRadius={38} outerRadius={57} paddingAngle={1} stroke="none" onMouseEnter={(_,index)=>setSelectedContribution(index)}>{contribution.map((_,i)=><Cell key={i} fill={colors[i%colors.length]} opacity={selectedContribution==null||selectedContribution===i?1:.32}/>)}</Pie></PieChart></ResponsiveContainer>}<div><strong>{money(selectedContributionData?.recharge??totals.recharge)}</strong><span>{selectedContributionData?.name??(isWallet?(lang==="zh"?"总消费":"Total consumption"):(lang==="zh"?"总金额":"Total amount"))}</span></div></div><div className="contribution-list">{contribution.map((x,i)=><button type="button" className={selectedContribution===i?"active":""} key={x.name} onClick={()=>setSelectedContribution(selectedContribution===i?null:i)}><i style={{background:colors[i%colors.length]}}/><b title={x.name}>{x.name}</b><span>{(x.share*100).toFixed(1)}%</span><em>{money(x.recharge)}</em></button>)}</div></div></article>
 <article className="chart-panel daily-chart"><header><div><p className="eyebrow">DAILY VELOCITY</p><h2>{isWallet?(lang==="zh"?"每日消费金额":"Daily consumption"):(lang==="zh"?"每日总金额":"Daily total amount")}</h2></div><div className="daily-summary"><strong>{money(totals.yesterday)}</strong><span>{t.compared}</span></div></header><div className="chart-body">{mounted&&<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><BarChart data={daily}><CartesianGrid stroke="#173033" vertical={false}/><XAxis dataKey="date" stroke="#71898a" fontSize={11} tickLine={false}/><YAxis stroke="#71898a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v=>`${Math.round(v/1000)}K`}/><Tooltip contentStyle={tip} formatter={v=>money(Number(v))}/><Bar dataKey="amount" fill="#58d2a5" radius={[2,2,0,0]}/></BarChart></ResponsiveContainer>}</div></article>
 <article className="attention-panel"><header><div><p className="eyebrow">ACTION QUEUE</p><h2>{t.attention}</h2></div><button onClick={()=>go("team","总体")}>{t.seeAll} →</button></header><div className="attention-list">{attention.length?attention.map((x,i)=><button key={x.name} onClick={()=>{setSearch(x.name);go("team","总体")}}><i className={i<2?"high":"medium"}>!</i><span><b>{x.name}</b><small>{lang==="zh"?`月度进度仅 ${(x.recharge/x.target*100).toFixed(1)}%`:`Monthly progress is ${(x.recharge/x.target*100).toFixed(1)}%`}</small></span><time>{end}</time></button>):<p className="empty-note">{t.none}</p>}</div></article></section>
 <section className="ranking-panel" id="ranking"><header><div><p className="eyebrow">LEADERBOARD</p><h2>{t.ranking}</h2></div><div className="view-tabs">{availableViews.map(x=><button key={x} className={view===x?"selected":""} onClick={()=>{setView(x);if(x!=="总体"&&metric==="完成率")setMetric("充值金额")}}>{x==="总体"?t.overall:x==="代理商"?t.agents:t.api}</button>)}</div></header><div className="table-wrap"><table><thead><tr><th>{t.rank}</th><SortTh label={view==="总体"?"BD":view==="代理商"?t.agents:t.api} sortKey="name"/><SortTh label={t.owner} sortKey="owner"/>{view==="总体"?<><SortTh label={t.target} sortKey="target"/><SortTh label={mode==="mtd"?cumulativeLabel:periodLabel} sortKey="recharge"/><SortTh label={t.completion} sortKey="completion"/></>:isWallet?<SortTh label={mode==="mtd"?cumulativeLabel:periodLabel} sortKey="recharge"/>:<><SortTh label={mode==="mtd"?cumulativeLabel:periodLabel} sortKey="recharge"/><SortTh label={t.consumption} sortKey="consumption"/></>}<SortTh label={mode==="mtd"?dailyLabel:averageDailyLabel} sortKey="yesterday"/><SortTh label={t.virtualCards} sortKey="cardsVirtual"/><SortTh label={t.physicalCards} sortKey="cardsPhysical"/><SortTh label={view==="总体"?t.status:lang==="zh"?"活跃度":"Activity"} sortKey="status"/>{view!=="总体"&&<SortTh label={lang==="zh"?"合作开始时间":"Cooperation start"} sortKey="cooperationStart"/>}</tr></thead><tbody>{rows.map((row,i)=>{const rate=view==="总体"&&"target" in row&&row.target?row.recharge/row.target:undefined,[label,tone]=state(rate),entityStatus=activityState(row);return <tr key={`${row.name}-${row.owner}`}><td><span className={`rank ${i<3?"top":""}`}>{i+1}</span></td><td className="name-cell"><i>{row.name[0]?.toUpperCase()}</i>{view==="总体"?<b>{row.name}</b>:<AgentProfileButton name={row.name} owner={displayedOwner(row.owner,row.name)} category={view} profile={profileFor(row)} lang={lang}/>}</td><td>{displayedOwner(row.owner,row.name)}</td>{view==="总体"&&"target" in row?<><td>{money(row.target)}</td><td className="money">{money(row.recharge)}</td><td><div className="rate-cell"><b>{(rate!*100).toFixed(1)}%</b><span><i style={{width:`${Math.min(rate!*100,100)}%`}}/></span></div></td></>:isWallet?<td className="money">{money(row.recharge)}</td>:<><td className="money">{money(row.recharge)}</td><td>{money(row.consumption)}</td></>}<td>{money(row.yesterday)}</td><td>{number(virtualCards(row))}</td><td>{number(physicalCards(row))}</td><td>{view==="总体"?<span className={`status ${tone}`}>{label}</span>:<div title={entityStatus.description}><span className={`status ${entityStatus.tone}`}>{entityStatus.label}</span><small className="activity-evidence">{entityStatus.evidence}</small></div>}</td>{view!=="总体"&&<td className="cooperation-date">{profileFor(row)?.cooperationStart?.slice(0,10)??""}</td>}</tr>})}</tbody></table></div></section><p className="data-note">{lang==="zh"?"运营数据仅供业务参考，具体数据以财务数据为准":"Operational data is for business reference only; please refer to Finance records for official figures."}</p></div></main>
}
