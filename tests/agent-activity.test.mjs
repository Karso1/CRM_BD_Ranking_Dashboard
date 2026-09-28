import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agentActivity, activityKey} from '../lib/agent-activity.ts';
const entity = {name:'Example',type:'代理商',consumption:10};
const key=activityKey(entity);
const history=()=>Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2026,7,2+i)).toISOString().slice(0,10),details:[{...entity,consumption:0}]}));
function activate(days){const reports=history();for(const date of days)reports.find(r=>r.date===date).details[0].consumption=10;return reports;}
test('counts distinct days using consumption rather than funding; separates equal names across owners',()=>{
 const reports=activate(['2026-09-01','2026-09-02','2026-09-17']);
 reports.find(r=>r.date==='2026-09-17').details.push({...entity,owner:'New owner'});
 reports.find(r=>r.date==='2026-09-17').details.push({...entity});
 reports.at(-1).details[0].recharge=100000;
 const result=agentActivity(reports,'2026-09-30').get(key);
 assert.equal(result.days,3);assert.equal(result.last,'2026-09-17');assert.equal(result.status,'active');
 assert.equal(agentActivity(reports,'2026-09-30').get(activityKey({...entity,owner:'New owner'})).days,1);
});
test('three active days with last activity outside the last 14 days needs attention',()=>{
 assert.equal(agentActivity(activate(['2026-09-01','2026-09-02','2026-09-16']),'2026-09-30').get(key).status,'attention');
});
test('30-day cutoff excludes older activity and ignores future transactions',()=>{
 const reports=activate(['2026-08-31']);reports.push({date:'2026-10-01',details:[entity]});
 const result=agentActivity(reports,'2026-09-30').get(key);
 assert.equal(result.status,'inactive');assert.equal(result.last,'2026-08-31');assert.equal(result.days,0);
});
test('missing daily coverage cannot establish inactivity',()=>{
 assert.equal(agentActivity(history().slice(-10),'2026-09-30').get(key).status,'observing');
});
test('historical views never use future activity or mix Agent and API identities',()=>{
 const reports=activate(['2026-09-28','2026-09-29','2026-09-30']);
 reports.at(-1).details.push({...entity,type:'API'});
 assert.equal(agentActivity(reports,'2026-09-27').get(key).status,'inactive');
 assert.equal(agentActivity(reports,'2026-09-30').get(activityKey({...entity,type:'API'})).days,1);
});
