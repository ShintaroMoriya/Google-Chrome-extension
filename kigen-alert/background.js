/* 期限みえるくん - バックグラウンド
   30分ごとに期限をチェックして、バッジの色・数字・通知を更新します。 */

importScripts('date.js', 'store.js');
const { daysUntil, localDateKey } = KigenDate;

const CHECK_ALARM = "kigen-check";

async function updateBadge() {
  const { state } = await KAStore.load();
  const open = state.tasks.filter((t) => !t.done);

  const overdueOrToday = open.filter((t) => daysUntil(t.due) <= 0);
  const soon = open.filter((t) => {
    const d = daysUntil(t.due);
    return d > 0 && d <= 3;
  });

  if (overdueOrToday.length > 0) {
    // 赤：今日が期限 or 超過 → 件数を表示
    chrome.action.setBadgeBackgroundColor({ color: "#D7263D" });
    chrome.action.setBadgeText({ text: String(overdueOrToday.length) });
  } else if (soon.length > 0) {
    // 黄：3日以内 → 件数を表示
    chrome.action.setBadgeBackgroundColor({ color: "#E8A100" });
    chrome.action.setBadgeText({ text: String(soon.length) });
  } else if (open.length > 0) {
    // 緑：余裕あり → ドット代わりに件数
    chrome.action.setBadgeBackgroundColor({ color: "#1F7A4D" });
    chrome.action.setBadgeText({ text: String(open.length) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

async function notifyIfNeeded() {
  const { state } = await KAStore.load();
  const { notified = {} } = await chrome.storage.local.get(["notified"]);
  const todayKey = localDateKey();

  for (const t of state.tasks) {
    if (t.done) continue;
    const d = daysUntil(t.due);
    // 当日と前日に1回ずつ通知（同日中の重複通知は防ぐ）
    if (d === 0 || d === 1) {
      const nKey = `${t.id}-${todayKey}`;
      if (!notified[nKey]) {
        chrome.notifications.create(nKey, {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: d === 0 ? "⚠️ 今日が期限です" : "🔔 明日が期限です",
          message: t.title,
          priority: 2
        });
        notified[nKey] = true;
      }
    }
  }

  // 古い通知記録を掃除（当日分以外は捨てる）
  const cleaned = {};
  for (const key of Object.keys(notified)) {
    if (key.endsWith(todayKey)) cleaned[key] = true;
  }
  await chrome.storage.local.set({ notified: cleaned });
}

async function runCheck() {
  await updateBadge();
  await notifyIfNeeded();
}

// インストール時・起動時・30分ごと
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 30 });
  runCheck();
});
chrome.runtime.onStartup.addListener(runCheck);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) runCheck();
});

// ポップアップでタスクが変わったら即反映
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KAStore.STORAGE_KEY]) updateBadge();
});
