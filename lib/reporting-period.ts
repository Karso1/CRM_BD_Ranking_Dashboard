/** Ignore future target-only months when selecting the default reporting period. */
export function reportingDate(platform:'business'|'wallet',now=new Date()):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:platform==='wallet'?'Asia/Shanghai':'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const field=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${field('year')}-${field('month')}-${field('day')}`;
}
export function defaultReportingPeriod<T extends {id:string;start:string;end:string;daily?:{date:string}[]}>(periods:T[],today:string):T {
 if(!periods.length)throw new Error('No reporting periods');
 const eligible=periods.filter(p=>p.id<=today.slice(0,7)).sort((a,b)=>a.id.localeCompare(b.id));
 return eligible.find(p=>p.id===today.slice(0,7))??eligible.at(-1)??periods[0];
}
export function reportingEnd(period:{start:string;end:string;daily?:{date:string}[]},today:string):string {
 const dates=(period.daily??[]).map(r=>r.date).filter(d=>d>=period.start&&d<=today).sort();
 return dates.at(-1)??(period.end<today?period.end:today);
}

/** MTD compares actuals with the full monthly goal; ranges prorate by calendar days. */
export function periodTargetWeight(month:string,from:string,to:string,mode:'mtd'|'range'):number {
 const [year,number]=month.split('-').map(Number);
 const first=`${month}-01`,days=new Date(Date.UTC(year,number,0)).getUTCDate();
 const last=`${month}-${String(days).padStart(2,'0')}`;
 const start=from>first?from:first,end=to<last?to:last;
 if(start>end)return 0;
 return mode==='mtd'?1:((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000+1)/days;
}
