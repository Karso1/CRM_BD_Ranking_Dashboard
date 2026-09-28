import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,timingSafeEqual} from 'node:crypto';
import {test} from 'node:test';
const source=ts.transpileModule(fs.readFileSync(new URL('../app/api/dashboard/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const payload={environment:'staging',wallet:{periods:[{end:'2026-09-26'}]}};
function harness(cached, snapshots, deployment='staging',sourcePayload=payload){
 let fetches=0,stored;
 const exports={};
 const env={WALLET_SOURCE_URL:'https://example.test/source?key=valid',...(snapshots?{DASHBOARD_SNAPSHOTS:snapshots}:{})};
 const context=vm.createContext({exports,require:name=>name==='cloudflare:workers'?{env}:{createHash,timingSafeEqual},process:{env:{NEXT_PUBLIC_DEPLOYMENT_ENV:deployment}},URL,Request,Response,AbortSignal,Date,
  caches:{default:{match:async()=>cached?.clone(),delete:async()=>true,put:async(_,value)=>{stored=value}}},
  fetch:async()=>{fetches++;return Response.json(sourcePayload)}
 });vm.runInContext(source,context);
 return {read:(query,headers={})=>exports.GET(new Request(`https://example.test/api/dashboard?platform=wallet${query}`,{headers})),fetches:()=>fetches,stored:()=>stored};
}
test('cold startup probe returns immediately without calling Google',async()=>{
 const h=harness();assert.equal((await h.read('&cacheOnly=1')).status,204);assert.equal(h.fetches(),0);
});
test('stale startup cache is usable immediately and requests a background refresh',async()=>{
 const h=harness(Response.json(payload,{headers:{'X-Validated-At':String(Date.now()-120000)}}));
 const response=await h.read('&cacheOnly=1');assert.equal(response.headers.get('X-Dashboard-Refresh'),'1');assert.equal(h.fetches(),0);assert.deepEqual((await response.json()).wallet,payload.wallet);
});
test('normal stale read updates the retained cache; forced reads always bypass it',async()=>{
 const h=harness(Response.json(payload,{headers:{'X-Validated-At':String(Date.now()-120000)}}));
 assert.equal((await h.read('')).status,200);assert.equal(h.fetches(),1);
 assert.equal(h.stored().headers.get('Cache-Control'),'public, max-age=86400');
 const fresh=harness(Response.json(payload,{headers:{'X-Validated-At':String(Date.now())}}));
 await fresh.read('');assert.equal(fresh.fetches(),0);await fresh.read('&refresh=1',{Authorization:'Bearer valid'});assert.equal(fresh.fetches(),1);
});

test('published staging snapshot serves immediately without a Google request',async()=>{
 let requestedKey;
 const snapshots={get:async(key,options)=>{requestedKey=[key,options];return payload}};
 const h=harness(null,snapshots);
 const response=await h.read('&cacheOnly=1');
 assert.equal(response.status,200);assert.equal(requestedKey[0],'dashboard:wallet:latest');assert.equal(requestedKey[1].type,'json');
 assert.deepEqual((await response.json()).wallet,payload.wallet);assert.equal(h.fetches(),0);
});

test('authenticated pipeline refresh publishes the verified platform snapshot',async()=>{
 let published;
 const snapshots={get:async()=>null,put:async(key,value)=>{published={key,payload:JSON.parse(value)}}};
 const h=harness(null,snapshots);
 const response=await h.read('&refresh=1',{Authorization:'Bearer valid'});
 assert.equal(response.status,200);assert.equal(h.fetches(),1);
 assert.equal(published.key,'dashboard:wallet:latest');assert.deepEqual(published.payload.wallet,payload.wallet);
});

test('unauthenticated refresh cannot contact Google or publish a snapshot',async()=>{
 const h=harness(null,{get:async()=>null,put:async()=>assert.fail('unexpected snapshot write')});
 assert.equal((await h.read('&refresh=1')).status,401);assert.equal(h.fetches(),0);
});

test('production serves only its own published snapshot',async()=>{
 const productionPayload={environment:'production',wallet:{periods:[{end:'2026-09-26'}]}};
 let requestedKey;
 const snapshots={get:async(key)=>{requestedKey=key;return productionPayload}};
 const h=harness(null,snapshots,'production',productionPayload);
 const response=await h.read('&cacheOnly=1');
 assert.equal(response.status,200);assert.equal(requestedKey,'dashboard:wallet:latest');
 assert.equal((await response.json()).environment,'production');assert.equal(h.fetches(),0);
});

test('production pipeline refresh publishes a production-labelled snapshot',async()=>{
 const productionPayload={environment:'production',wallet:{periods:[{end:'2026-09-26'}]}};
 let published;
 const snapshots={get:async()=>null,put:async(key,value)=>{published={key,payload:JSON.parse(value)}}};
 const h=harness(null,snapshots,'production',productionPayload);
 const response=await h.read('&refresh=1',{Authorization:'Bearer valid'});
 assert.equal(response.status,200);assert.equal(h.fetches(),1);
 assert.equal(published.payload.environment,'production');
 assert.deepEqual(published.payload.wallet,productionPayload.wallet);
});
