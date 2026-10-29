// Runs only on the declared UPW origin, inside the user's existing signed-in tab.
// All exports use the site's own visible controls. No cookies or tokens are read.
const ROUTES = {
  cards: "/Business/ThirdDebitCard?tab=用户卡片",
  transactions: "/Business/ThirdDebitCard?tab=交易记录",
  relationships: "/Activity/Promotion/Relationship?tab=用户代理关系"
};
const SEGMENT = 10000;
let running = false;
let cancelled = false;
let activeRequest = null;
let activeCheckpoint = null;
let activeKind = null;
const PAGE_MARKERS = { cards: "用户卡片", transactions: "交易记录", relationships: "用户代理关系" };
let reloadAttempts = 0;
const MAX_PAGE_RELOADS = 3;
const PAGE_READY_TIMEOUT = 15000;
const RELOADING = "UPW_RELOADING";
class PageNotReadyError extends Error {}
const PANEL_ID = "upw-export-progress-panel";
let panelShadow;
const dayFormat = date => date.toISOString().slice(0, 10);
const yesterday = dayFormat(new Date(Date.now() + 8 * 3600000 - 86400000));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = element => element && element.getClientRects().length > 0;
const text = element => element?.innerText?.replace(/\s+/g, " ").trim() || "";
const all = selector => [...document.querySelectorAll(selector)].filter(visible);
const fail = message => { throw new Error(message); };

async function waitFor(predicate, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (cancelled) fail("用户已停止导出任务");
    const value = predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new PageNotReadyError(`等待 ${label} 超时`);
}

function panel() {
  let host = document.getElementById(PANEL_ID);
  if (host) return host;
  host = document.createElement("aside");
  host.id = PANEL_ID;
  host.style.cssText = "position:fixed;right:16px;top:100px;width:310px;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    :host { font: 14px/1.5 system-ui,sans-serif; color:#172033 }
    section { background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:14px;box-shadow:0 8px 30px #0002 }
    header { display:flex;align-items:center;justify-content:space-between;cursor:move;touch-action:none;user-select:none }
    h3 { font-size:16px;margin:0 } button { border:0;border-radius:6px;padding:5px 10px;cursor:pointer }
    #fold { background:#e2e8f0;color:#172033 } #stop { background:#e2e8f0;color:#172033;margin-top:10px }
    #status,#coverage,#preview { background:#f1f5f9;border-radius:6px;margin:10px 0 0;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere }
    #coverage,#preview {font-size:12px} input {box-sizing:border-box;width:100%;padding:6px;margin:4px 0 8px}
    #choose,#auto,#manual {background:#2563eb;color:white;width:100%;margin-top:8px}
    label,summary {display:block;margin-top:10px;cursor:pointer} #stop {width:100%}
    section.folded #body { display:none }
  </style><section><header><h3>UPW 数据导出助手</h3><button id="fold" type="button" title="收起或展开">−</button></header>
    <div id="body"><button id="choose" type="button">选择“UPW-已导入日期.json”</button>
    <div id="coverage">尚未选择日期清单。</div><button id="auto" type="button">1. 自动补齐缺少日期</button>
    <div id="preview">选择清单后计算待下载日期。</div>
    <details><summary>2. 手动指定日期范围</summary><label>开始日期（UTC+8）<input id="start" type="date"></label>
    <label>结束日期（UTC+8）<input id="end" type="date"></label><button id="manual" type="button">下载指定日期范围</button></details>
    <label>代理关系导出段数<input id="relation" type="number" min="1" max="100" value="1"></label>
    <div id="status" role="status">未开始</div><button id="stop" type="button">停止任务</button></div></section>`;
  document.body.appendChild(host);
  panelShadow = shadow;
  shadow.getElementById("start").value = yesterday;
  shadow.getElementById("end").value = yesterday;
  const positionKey = "upw-export-panel-position-v1";
  const clamp = (value, lower, upper) => Math.min(Math.max(value, lower), Math.max(lower, upper));
  function place(x, y) {
    host.style.right = "auto";
    host.style.left = `${clamp(x, 0, innerWidth - host.getBoundingClientRect().width)}px`;
    host.style.top = `${clamp(y, 0, innerHeight - host.getBoundingClientRect().height)}px`;
  }
  function save() {
    const rect = host.getBoundingClientRect();
    try { localStorage.setItem(positionKey, JSON.stringify({ x:rect.x, y:rect.y,
      folded:shadow.querySelector("section").classList.contains("folded") })); } catch {}
  }
  try {
    const prior = JSON.parse(localStorage.getItem(positionKey));
    if (Number.isFinite(prior?.x) && Number.isFinite(prior?.y)) place(prior.x, prior.y);
    if (prior?.folded) shadow.querySelector("section").classList.add("folded");
  } catch {}
  const fold = shadow.getElementById("fold");
  fold.textContent = shadow.querySelector("section").classList.contains("folded") ? "+" : "−";
  fold.onclick = () => { const folded = shadow.querySelector("section").classList.toggle("folded");
    fold.textContent = folded ? "+" : "−"; save(); };
  shadow.getElementById("stop").onclick = () => { if (running) cancelled = true; };
  shadow.getElementById("choose").onclick = chooseCoverage;
  shadow.getElementById("auto").onclick = () => beginExport(false);
  shadow.getElementById("manual").onclick = () => beginExport(true);
  const header = shadow.querySelector("header");
  let drag = null;
  header.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    drag = { id:event.pointerId, dx:event.clientX-rect.x, dy:event.clientY-rect.y };
    header.setPointerCapture(event.pointerId); event.preventDefault();
  });
  header.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) place(event.clientX-drag.dx, event.clientY-drag.dy);
  });
  const endDrag = () => { if (drag) { drag = null; save(); } };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);
  host.setStatus = message => { shadow.getElementById("status").textContent = message; };
  refreshCoverage().catch(error => { shadow.getElementById("coverage").textContent = String(error.message || error); });
  return host;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("upw-export-helper", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedHandle(value) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("files", value ? "readwrite" : "readonly")
        .objectStore("files")[value ? "put" : "get"](...(value ? [value, "coverage"] : ["coverage"]));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function readCoverage(mayAsk = false) {
  const handle = await storedHandle();
  if (!handle) return null;
  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && (!mayAsk || await handle.requestPermission({ mode: "read" }) !== "granted"))
    throw new Error("需要重新授权读取日期清单，请点击“选择日期清单”");
  const file = await handle.getFile();
  const plan = JSON.parse(await file.text());
  if (plan.schema !== "upw-coverage-v1" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.first_date) || !Array.isArray(plan.covered_days))
    throw new Error("所选文件不是 UPW 已导入日期清单");
  return { file, plan };
}

function missingFromCoverage(plan) {
  const covered = new Set(plan.covered_days);
  const result = [];
  for (let current = new Date(`${plan.first_date}T00:00:00Z`), last = new Date(`${yesterday}T00:00:00Z`);
       current <= last; current.setUTCDate(current.getUTCDate() + 1)) {
    const day = dayFormat(current);
    if (!covered.has(day)) result.push(day);
    if (result.length > 3650) fail("缺失日期过多，请检查日期清单");
  }
  return result;
}

async function refreshCoverage(mayAsk = false) {
  const coverage = await readCoverage(mayAsk);
  if (!panelShadow) return;
  const latest = coverage?.plan.covered_days.reduce((max, day) => day > max ? day : max, "");
  panelShadow.getElementById("coverage").textContent = coverage
    ? `已连接：${coverage.file.name}；最新交易日期 ${latest || "未知"}；清单生成 ${coverage.plan.generated_for || "未知"}。`
    : "尚未选择日期清单。";
  const missing = coverage ? missingFromCoverage(coverage.plan) : [];
  panelShadow.getElementById("preview").textContent = coverage
    ? (missing.length ? `缺少 ${missing.length} 天；本次处理前 ${Math.min(missing.length, 90)} 天：${missing[0]} 至 ${missing[Math.min(missing.length, 90) - 1]}。`
      : `截至 ${yesterday} 没有缺少的交易日期；运行时只刷新卡片及代理关系。`)
    : "选择清单后计算待下载日期。";
  return missing;
}

async function chooseCoverage() {
  try {
    const [handle] = await window.showOpenFilePicker({ id:"upw-coverage", multiple:false,
      types:[{ description:"UPW 日期清单", accept:{ "application/json":[".json"] } }] });
    await storedHandle(handle);
    await refreshCoverage(true);
  } catch (error) { if (error.name !== "AbortError") panel().setStatus(String(error.message || error)); }
}

async function beginExport(manual) {
  if (running) { panel().setStatus("已有导出任务正在运行"); return; }
  try {
    const relationSegments = Number(panelShadow.getElementById("relation").value);
    if (!Number.isInteger(relationSegments) || relationSegments < 1 || relationSegments > 100) fail("代理关系段数须为 1–100");
    let downloadDays, end;
    if (manual) {
      const start = panelShadow.getElementById("start").value;
      end = panelShadow.getElementById("end").value;
      if (!start || !end || start > end || end > yesterday) fail("日期范围无效");
      downloadDays = days(start, end);
    } else {
      const missing = await refreshCoverage(true);
      if (!missing) fail("请先选择本地日期清单");
      downloadDays = missing.slice(0, 90);
      end = downloadDays.at(-1) || yesterday;
    }
    await startJob({ downloadDays, end, relationSegments });
  } catch (error) { await progress(`导出失败：${error.message || error}。已下载文件不会自动导入。`); }
}

async function saveCheckpoint() {
  await chrome.storage.local.set({ upwResume: {
    request: activeRequest, retries: reloadAttempts, checkpoint: activeCheckpoint
  } });
}

async function startJob(request, retries = 0, checkpoint = null) {
  if (running) fail("已有导出任务正在运行");
  cancelled = false;
  running = true;
  activeRequest = request;
  activeCheckpoint = checkpoint || {
    used: [], manifest: { as_of: request.end, cards: null, relationships: null, transactions: [] }
  };
  reloadAttempts = retries;
  try {
    await saveCheckpoint();
    await run(request);
    await chrome.storage.local.remove("upwResume");
  } catch (error) {
    if (error instanceof PageNotReadyError && !cancelled) {
      try { await refreshStuckPage(error.message); }
      catch (recoveryError) { error = recoveryError; }
    }
    if (error.message !== RELOADING) {
      await chrome.storage.local.remove("upwResume");
      await progress(`导出失败：${error.message || error}。已下载文件不会自动导入。`);
    }
  } finally { running = false; activeRequest = null; activeCheckpoint = null; }
}

async function refreshStuckPage(reason) {
  if (cancelled) fail("用户已停止导出任务");
  if (!activeRequest || reloadAttempts >= MAX_PAGE_RELOADS)
    fail(`${reason}；自动刷新 ${MAX_PAGE_RELOADS} 次后仍未恢复，请检查后台登录或网络`);
  reloadAttempts += 1;
  await saveCheckpoint();
  await progress(`${reason}；正在自动刷新网页并继续任务（第 ${reloadAttempts}/${MAX_PAGE_RELOADS} 次）。已完成的卡片、代理关系及交易日期会跳过。`);
  if (cancelled) fail("用户已停止导出任务");
  location.reload();
  fail(RELOADING);
}

async function progress(message) {
  panel().setStatus(message);
  await chrome.storage.local.set({ upwProgress: message });
}

function pageScope(kind = activeKind) {
  if (!kind) return document;
  const pane = document.getElementById(`pane-${PAGE_MARKERS[kind]}`);
  return visible(pane) ? pane : null;
}

function button(label, scope = pageScope()) {
  if (!scope) return null;
  return [...scope.querySelectorAll("button")].filter(visible).find(element => text(element) === label);
}

function inputGroup(label) {
  return [...(pageScope()?.querySelectorAll(".el-form-item, .ant-form-item, .form-item") || [])]
    .filter(visible).find(element => text(element).startsWith(label));
}

async function resetFilters() {
  const reset = button("重置");
  if (!reset) throw new PageNotReadyError("找不到当前页的重置按钮");
  reset.click();
  await sleep(700);
  await waitFor(() => [...(pageScope()?.querySelectorAll(".el-form-item input, .ant-form-item input") || [])]
    .filter(visible).every(input => !input.value.trim()) &&
    ![...(pageScope()?.querySelectorAll(".el-form-item .el-select__selected-item:not(.is-transparent):not(.el-select__input-wrapper), .ant-form-item .ant-select-selection-item") || [])]
      .filter(visible).some(item => text(item)), "当前页筛选条件已清空", 10000);
}

function select(label, option) {
  const group = inputGroup(label);
  if (!group) throw new PageNotReadyError(`找不到筛选项：${label}`);
  const control = group.querySelector(".el-select, .ant-select, [role=combobox]");
  if (!control) throw new PageNotReadyError(`找不到 ${label} 下拉框`);
  // Element Plus binds the open handler to its inner wrapper, not the .el-select root.
  const trigger = control.querySelector(".el-select__wrapper, .ant-select-selector, [role=combobox]") || control;
  trigger.click();
  return waitFor(() => all(".el-select-dropdown__item, .ant-select-item-option, [role=option]")
    .find(item => text(item) === option), `${label} → ${option}`).then(async item => {
      item.click();
      await waitFor(() => text(group.querySelector(".el-select__selected-item:not(.el-select__input-wrapper), .ant-select-selection-item")) === option,
        `${label} 已选中 ${option}`);
    });
}

function dateInputs() {
  const group = inputGroup("交易提交时间:") || inputGroup("交易提交时间");
  const inputs = [...(group?.querySelectorAll("input.el-range-input, input") || [])].filter(visible);
  if (inputs.length !== 2) throw new PageNotReadyError("找不到交易提交时间的起止输入框");
  return inputs;
}

function setInput(input, value) {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function commitDateRange(day) {
  const [from, to] = dateInputs();
  if (from.value !== `${day} 00:00:00` || to.value !== `${day} 23:59:59`)
    throw new PageNotReadyError(`${day} 日期范围未完整写入`);
  // Element Plus keeps typed range values separate from its bound query model.
  // Enter commits that model; input/change alone can leave a correct-looking
  // input while the query still uses the old (or unrestricted) date range.
  to.focus();
  for (const type of ["keydown", "keyup"])
    to.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
  to.blur();
  await sleep(250);
  const committed = dateInputs();
  if (committed[0].value !== `${day} 00:00:00` || committed[1].value !== `${day} 23:59:59`)
    throw new PageNotReadyError(`${day} 日期控件未接受范围`);
}

async function route(kind, marker) {
  activeKind = kind;
  location.hash = ROUTES[kind];
  await progress(`正在等待${marker}筛选栏加载；超过 15 秒会自动刷新…`);
  await waitFor(() => filtersReady(kind), `${marker} 筛选栏完整加载`, PAGE_READY_TIMEOUT);
  await sleep(700);
  await progress(`${marker}筛选栏已加载，正在处理筛选与查询…`);
}

function filtersReady(kind) {
  const labels = { cards: ["卡状态"], transactions: ["状态", "交易提交时间"], relationships: ["用户UID"] };
  return pageScope(kind) && button("查询") && button("导出") && labels[kind].every(label => inputGroup(label));
}

function count() {
  const matches = text(activeKind ? pageScope() : document.body).match(/共\s*([\d,]+)\s*条(?!数据)/g) || [];
  if (!matches.length) throw new PageNotReadyError("页面没有显示结果总条数");
  return Number(matches.at(-1).match(/[\d,]+/)[0].replaceAll(",", ""));
}

async function stableCount() {
  let previous = null;
  let since = Date.now();
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (cancelled) fail("用户已停止导出任务");
    let current;
    try { current = count(); }
    catch (error) {
      if (!(error instanceof PageNotReadyError)) throw error;
      previous = null;
      since = Date.now();
      await sleep(250);
      continue;
    }
    if (current !== previous) { previous = current; since = Date.now(); }
    if (Date.now() - since >= 3000 && !all(".el-loading-mask, .ant-spin-spinning").length) return current;
    await sleep(250);
  }
  throw new PageNotReadyError("查询结果一直未加载完成");
}

function firstRow() {
  return [...(pageScope()?.querySelectorAll(".el-table__body tbody tr, .ant-table-tbody tr") || [])]
    .filter(visible).find(row => text(row));
}

async function queryAndVerify(kind, day) {
  const query = button("查询");
  if (!query) throw new PageNotReadyError("找不到查询按钮");
  if (kind === "transactions") await commitDateRange(day);
  query.click();
  await sleep(1200);
  const matchesResult = () => {
    const row = firstRow();
    if (!row) return false;
    if (kind === "cards") return text(row).includes("申请成功");
    if (kind === "transactions") return text(row).includes("已完成") && text(row).includes(day);
    return true;
  };
  try {
    try { await waitFor(matchesResult, `${kind}${day || ""} 筛选后的首行`, kind === "transactions" ? 15000 : 45000); }
    catch (error) {
      if (!(error instanceof PageNotReadyError) || kind !== "transactions" || !filtersReady(kind) || !firstRow()) throw error;
      await progress(`${day} 查询结果尚未匹配日期，正在重新提交日期并查询…`);
      await commitDateRange(day);
      button("查询").click();
      await sleep(1200);
      await waitFor(matchesResult, `${day} 重新查询后的首行`, 45000);
    }
  }
  catch (error) {
    if (error instanceof PageNotReadyError && filtersReady(kind) && !firstRow() &&
        !all(".el-loading-mask, .ant-spin-spinning").length && count() === 0)
      fail(`${kind}${day || ""} 查询结果为 0；需要人工确认后才能记录零数据日`);
    throw error;
  }
  const total = await stableCount();
  if (!total) fail(`${kind}${day || ""} 查询结果为 0；需要人工确认后才能记录零数据日`);
  return total;
}

function dialog() {
  return all(".el-dialog, [role=dialog]").find(element => text(element).includes("选择导出页码"));
}

function selectedSegment(modal) {
  const select = modal.querySelector(".el-select, .ant-select");
  const element = select?.querySelector(".el-select__placeholder, .ant-select-selection-item, .el-input__inner");
  return element?.value || text(element);
}

async function exportPart(kind, total, index, used) {
  if (cancelled) fail("用户已停止导出任务");
  const exportButton = button("导出");
  if (!exportButton) throw new PageNotReadyError("找不到导出按钮");
  exportButton.click();
  const modal = await waitFor(dialog, "导出分段弹窗");
  const modalText = text(modal);
  const segments = Math.ceil(total / SEGMENT);
  if (!modalText.includes(`共 ${total} 条数据`) || !modalText.includes(`分为 ${segments} 个分段导出`)) {
    fail(`导出弹窗条数与查询结果不一致：查询 ${total}，弹窗 ${modalText.slice(0, 150)}`);
  }
  const label = `${index * SEGMENT + 1}-${Math.min((index + 1) * SEGMENT, total)}`;
  if (selectedSegment(modal) !== label) {
    const picker = modal.querySelector(".el-select, .ant-select, [role=combobox]");
    if (!picker) fail("导出弹窗缺少分段选择框");
    (picker.querySelector(".el-select__wrapper, .ant-select-selector, [role=combobox]") || picker).click();
    const option = await waitFor(() => all(".el-select-dropdown__item, .ant-select-item-option, [role=option]")
      .find(element => text(element) === label), `导出分段 ${label}`);
    option.click();
  }
  if (selectedSegment(modal) !== label) fail(`导出弹窗未选中分段 ${label}`);
  const confirm = button("确认", modal);
  if (!confirm) fail("导出弹窗缺少确认按钮");
  const after = Date.now() - 1000;
  confirm.click();
  const found = await chrome.runtime.sendMessage({ type: "FIND_DOWNLOAD", kind, after, used });
  if (found?.error || !found?.path) fail(found?.error || "无法确认下载文件路径");
  used.push(found.id);
  return { path: found.path, count: Math.min(SEGMENT, total - index * SEGMENT) };
}

async function segments(kind, total, number, used) {
  const result = [];
  for (let index = 0; index < number; index++) result.push(await exportPart(kind, total, index, used));
  return result;
}

function days(start, end) {
  const dates = [];
  for (let current = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
       current <= last; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
    if (dates.length > 90) fail("一次最多导出 90 天，请分批执行");
  }
  return dates;
}

async function run({ downloadDays, end, relationSegments }) {
  if (!Array.isArray(downloadDays) || downloadDays.length > 90 ||
      downloadDays.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > end) ||
      [...new Set(downloadDays)].length !== downloadDays.length) fail("待下载日期清单无效");
  const { used, manifest } = activeCheckpoint;
  if (!manifest.cards) {
    await progress("正在筛选全量成功卡片…");
    await route("cards", "用户卡片");
    await resetFilters();
    await select("卡状态:", "申请成功");
    const cardCount = await queryAndVerify("cards");
    if (cardCount > SEGMENT) fail("成功卡片超过 10000 条；当前本地导入器尚不支持卡片分段，请先升级导入器");
    manifest.cards = { ...(await segments("cards", cardCount, 1, used))[0] };
    await saveCheckpoint();
  }

  if (!manifest.relationships) {
    await route("relationships", "用户代理关系");
    await resetFilters();
    const relationTotal = await queryAndVerify("relationships");
    if (relationTotal < 1 || relationSegments > Math.ceil(relationTotal / SEGMENT)) fail("代理关系导出段数超过实际段数");
    await progress(`正在下载代理关系 ${relationSegments} 段…`);
    manifest.relationships = { total: relationTotal, segments: await segments("relationships", relationTotal, relationSegments, used) };
    await saveCheckpoint();
  }

  const remainingDays = downloadDays.filter(day => !manifest.transactions.some(entry => entry.date === day));
  if (remainingDays.length) {
    await route("transactions", "交易记录");
    await resetFilters();
    await select("状态:", "已完成");
    for (const day of remainingDays) {
      if (cancelled) fail("用户已停止导出任务");
      await progress(`正在筛选并下载 ${day} 已完成交易…`);
      const [from, to] = dateInputs();
      // Element Plus rejects a transient reversed range. Extend the end first
      // when advancing; move the start first when going backwards.
      if (from.value.slice(0, 10) < day) {
        setInput(to, `${day} 23:59:59`);
        await sleep(100);
        setInput(from, `${day} 00:00:00`);
      } else {
        setInput(from, `${day} 00:00:00`);
        await sleep(100);
        setInput(to, `${day} 23:59:59`);
      }
      button("查询")?.focus(); // Commit the date range, as Tab does after manual entry.
      await sleep(200);
      if (!from.value.includes(day) || !to.value.includes(day)) throw new PageNotReadyError(`${day} 日期没有写入筛选框`);
      const total = await queryAndVerify("transactions", day);
      await progress(`${day} 查询已完成，共 ${total} 条；正在导出分段…`);
      manifest.transactions.push({ date: day, count: total,
        segments: await segments("transactions", total, Math.ceil(total / SEGMENT), used) });
      await saveCheckpoint();
    }
  }
  const saved = await chrome.runtime.sendMessage({ type: "SAVE_MANIFEST", manifest });
  if (saved?.error || !saved?.id) fail(saved?.error || "无法保存导出清单");
  await progress(`导出完成：${downloadDays.length} 个交易日期（截至 ${end}）。请到下载目录 UPW/ 查找清单，并运行本地导入器校验。网站和原始数据尚未更新。`);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "TOGGLE_PANEL") {
    const existed = !!document.getElementById(PANEL_ID);
    const host = panel();
    host.style.display = !existed || host.style.display === "none" ? "" : "none";
    sendResponse({ shown: host.style.display !== "none" });
    return;
  }
  if (message.type !== "START_EXPORT") return;
  if (running) { sendResponse({ error: "已有导出任务正在执行" }); return; }
  sendResponse({ started: true });
  startJob(message);
});

chrome.storage.local.get("upwResume").then(({ upwResume }) => {
  if (upwResume?.request && !running) {
    progress(`网页已刷新，正在恢复导出（第 ${upwResume.retries}/${MAX_PAGE_RELOADS} 次刷新）…`);
    startJob(upwResume.request, upwResume.retries, upwResume.checkpoint);
  }
});
