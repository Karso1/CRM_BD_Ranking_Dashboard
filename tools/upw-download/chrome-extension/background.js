const PREFIXES = {
  cards: "金融卡三方 - 用户卡片",
  transactions: "三方金融卡-交易记录",
  relationships: "代理关系查询-用户代理关系"
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

chrome.action.onClicked.addListener(tab => {
  if (tab.id && tab.url?.startsWith("https://upayv3.alliancebxc.com:31007/")) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }).catch(() => {});
  }
});

async function findDownload({ kind, after, used }) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error("未知导出类型");
  for (let attempt = 0; attempt < 180; attempt++) {
    const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 30 });
    const found = items.find(item =>
      !used.includes(item.id) && item.state === "complete" &&
      Date.parse(item.startTime) >= after &&
      item.filename.split(/[\\/]/).pop().startsWith(prefix) &&
      item.filename.toLowerCase().endsWith(".csv"));
    if (found) return { id: found.id, path: found.filename };
    await delay(1000);
  }
  throw new Error(`${kind} 导出后 3 分钟内未发现完成的 CSV 下载`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FIND_DOWNLOAD") {
    findDownload(message).then(sendResponse, error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message.type === "SAVE_MANIFEST") {
    const encoded = encodeURIComponent(JSON.stringify(message.manifest, null, 2));
    chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encoded}`,
      filename: `UPW/upw-export-${message.manifest.as_of}.json`,
      conflictAction: "uniquify",
      saveAs: false
    }).then(id => sendResponse({ id }), error => sendResponse({ error: String(error) }));
    return true;
  }
});
