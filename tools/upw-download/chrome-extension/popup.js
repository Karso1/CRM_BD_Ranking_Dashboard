const site = "https://upayv3.alliancebxc.com:31007/";
const status = document.querySelector("#status");
const coverageStatus = document.querySelector("#coverage-status");
const autoPreview = document.querySelector("#auto-preview");
const autoButton = document.querySelector("#auto-button");
const format = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const yesterday = format(new Date(Date.now() + 8 * 3600000 - 86400000));
document.querySelector("#start").value = yesterday;
document.querySelector("#end").value = yesterday;
let missingDays = null;

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
      const tx = db.transaction("files", value ? "readwrite" : "readonly");
      const store = tx.objectStore("files");
      const request = value ? store.put(value, "coverage") : store.get("coverage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

function missingFromCoverage(plan, end) {
  if (plan?.schema !== "upw-coverage-v1" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.first_date) || !Array.isArray(plan.covered_days)) {
    throw new Error("所选文件不是 UPW 已导入日期清单");
  }
  const covered = new Set(plan.covered_days);
  const result = [];
  for (let current = new Date(`${plan.first_date}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
       current <= last; current.setUTCDate(current.getUTCDate() + 1)) {
    const day = format(current);
    if (!covered.has(day)) result.push(day);
    if (result.length > 3650) throw new Error("待补日期过多，请检查日期清单");
  }
  return result;
}

async function loadCoverage(handle, mayAsk) {
  const permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && (!mayAsk || await handle.requestPermission({ mode: "read" }) !== "granted")) {
    throw new Error("Chrome 需要重新授权读取日期清单，请点击上方按钮重新选择文件");
  }
  const file = await handle.getFile();
  const plan = JSON.parse(await file.text());
  missingDays = missingFromCoverage(plan, yesterday);
  const selected = missingDays.slice(0, 90);
  coverageStatus.textContent = `已连接：${file.name}；清单日期 ${plan.generated_for || "未知"}。`;
  autoPreview.textContent = missingDays.length
    ? `缺少 ${missingDays.length} 天；本次自动选前 ${selected.length} 天：${selected[0]} 至 ${selected.at(-1)}。已导入的日期会跳过。`
    : `截至 ${yesterday} 没有缺少的交易日期；运行时只刷新卡片及代理关系。`;
  autoButton.disabled = false;
}

document.querySelector("#coverage-button").addEventListener("click", async () => {
  try {
    const [handle] = await window.showOpenFilePicker({
      id: "upw-coverage", multiple: false,
      types: [{ description: "UPW 日期清单", accept: { "application/json": [".json"] } }]
    });
    await storedHandle(handle);
    await loadCoverage(handle, true);
  } catch (error) { coverageStatus.textContent = String(error.message || error); }
});

storedHandle().then(handle => handle && loadCoverage(handle, false)).catch(error => {
  coverageStatus.textContent = String(error.message || error);
});

async function showProgress() {
  const { upwProgress } = await chrome.storage.local.get("upwProgress");
  if (upwProgress) status.textContent = upwProgress;
}
showProgress();
chrome.storage.onChanged.addListener(changes => {
  if (changes.upwProgress) status.textContent = changes.upwProgress.newValue;
});

async function startExport(downloadDays, end) {
  try {
    const relationSegments = Number(document.querySelector("#relation").value);
    if (!Number.isInteger(relationSegments) || relationSegments < 1 || relationSegments > 100) throw new Error("代理关系段数须为 1–100");
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url?.startsWith(site)) throw new Error("请先切到已登录的 UPW 后台标签页");
    const result = await chrome.tabs.sendMessage(tab.id, { type: "START_EXPORT", downloadDays, end, relationSegments });
    if (result?.error) throw new Error(result.error);
    status.textContent = "已启动；可以关闭这个小窗口，稍后重新打开查看进度。";
  } catch (error) { status.textContent = String(error.message || error); }
}

autoButton.addEventListener("click", async () => {
  try {
    const handle = await storedHandle();
    if (!handle) { status.textContent = "请先选择本地日期清单"; return; }
    await loadCoverage(handle, true); // Re-read immediately before starting; never use stale popup state.
    const selected = missingDays.slice(0, 90);
    await startExport(selected, selected.at(-1) || yesterday);
  } catch (error) { status.textContent = String(error.message || error); }
});

document.querySelector("#manual-button").addEventListener("click", () => {
  const start = document.querySelector("#start").value;
  const end = document.querySelector("#end").value;
  if (!start || !end || start > end || end > yesterday) { status.textContent = "日期范围无效"; return; }
  const requested = [];
  for (let current = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
       current <= last; current.setUTCDate(current.getUTCDate() + 1)) {
    requested.push(format(current));
    if (requested.length > 90) { status.textContent = "一次最多 90 天"; return; }
  }
  startExport(requested, end);
});
