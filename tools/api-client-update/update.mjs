import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2), option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const inputDir=option('--input-dir');
const checkOnly=args.includes('--check-only');
const namespace='0f6940e225fd4cc68efe030644fa58a4'; // Dedicated staging namespace; no production option.
const env={...process.env,WRANGLER_LOG_PATH:join(root,'.wrangler/logs'),WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
function run(binary,args){const r=spawnSync(binary,args,{cwd:root,env,encoding:'utf8',maxBuffer:20_000_000,timeout:120000});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr.trim()||'命令未完成');return r.stdout;}
const compiled=ts.transpileModule(readFileSync(join(root,'lib/api-clients.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateClients,CLIENT_KEY}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const wranglerArgs=['--config',join(root,'tools/site-access/staging.wrangler.jsonc'),'--namespace-id',namespace,'--remote'];
function get(){return JSON.parse(run(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'kv','key','get',CLIENT_KEY,...wranglerArgs,'--text']));}
function put(key,path){run(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'kv','key','put',key,...wranglerArgs,'--path',path]);}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
try {
 if(!inputDir)throw new Error('缺少表格目录 --input-dir。');
 const files=readdirSync(inputDir).filter(n=>n.toLowerCase().endsWith('.xlsx')&&!n.startsWith('~$')).map(n=>join(inputDir,n)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
 if(!files.length)throw new Error('请先把最新的 Lark 导出 Excel 放入「01-放入最新表格」文件夹。');
 const file=files[0];
 if(statSync(file).size>2_000_000)throw new Error('表格超过 2 MB，请检查导出文件。');
 console.log('目标：测试网站 API 客户更新');
 console.log('使用表格：'+file);
 if(files.length>1)console.log('目录有多份表格，使用最后修改的一份。');
 const python=join(root,'tools/upb-download/.venv/bin/python');
 const incoming=validateClients(JSON.parse(run(python,[join(root,'tools/api-client-update/export_excel.py'),file])));
 console.log(`校验通过：${incoming.length} 条申请。`);
 if(checkOnly){console.log('仅校验完成，未修改网站。');process.exit(0);}
 console.log('正在读取测试网站现有数据…');
 const previous=get();validateClients(previous.records);
 const merged=new Map(previous.records.map(r=>[r['Request No.'],r]));
 incoming.forEach(r=>merged.set(r['Request No.'],r));
 const records=validateClients([...merged.values()]);
 const stamp=new Date().toISOString();
 const snapshot={records,source:file.split('/').at(-1),updatedAt:stamp};
 const backup=join(root,'tools/api-client-update/.local',stamp.replace(/[:.]/g,'-'));
 mkdirSync(backup,{recursive:true,mode:0o700});
 const oldPath=join(backup,'before.json'),newPath=join(backup,'after.json');
 writeFileSync(oldPath,JSON.stringify(previous),{mode:0o600});writeFileSync(newPath,JSON.stringify(snapshot),{mode:0o600});
 copyFileSync(file,join(backup,'source.xlsx'));
 put(CLIENT_KEY+':previous',oldPath);
 console.log('备份完成，正在更新测试网站…');
 put(CLIENT_KEY,newPath);
 let verified=false;
 for(let i=0;i<3;i++){try{if(hash(get())===hash(snapshot)){verified=true;break;}}catch{/* Retry readback only; never repeat a write. */}if(i<2)await new Promise(r=>setTimeout(r,2000));}
 if(!verified)throw new Error('数据已提交，但读回核验未确认。请保留本次备份并联系检查，暂勿重复更新。');
 console.log(`更新成功：共 ${records.length} 条申请；本次新增 ${records.length-previous.records.length} 条，其余按申请编号更新。`);
 console.log('备份目录：'+backup);
 console.log('打开测试站 → API 客户更新 → 点击右上角刷新。');
 console.log('https://staging.upaydashboard.com/');
} catch(error){console.error('未完成：'+error.message);process.exitCode=1;}
