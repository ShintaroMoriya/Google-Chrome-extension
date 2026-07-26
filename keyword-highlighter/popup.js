/* キーワード・ハイライター - 設定ポップアップ */

const $ = (sel) => document.querySelector(sel);

const DEFAULT_KEYWORDS = [
  { word: "至急", color: "#FFB3B3" },
  { word: "クレーム", color: "#FFB3B3" },
  { word: "期限", color: "#FFE066" },
  { word: "見積", color: "#B3E5C9" }
];

let keywords = [];
let enabled = true;
let statusTimer = null;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function showStatus(message) {
  clearTimeout(statusTimer);
  const el = $("#inputStatus");
  el.textContent = message;
  statusTimer = setTimeout(() => { el.textContent = ""; }, 2200);
}

function persist() {
  KHStore.save({ schemaVersion: KHStore.SCHEMA_VERSION, keywords, enabled });
}

function render() {
  const list = $("#kwList");
  list.innerHTML = "";
  $("#emptyMsg").style.display = keywords.length ? "none" : "block";

  keywords.forEach((kw, i) => {
    const li = document.createElement("li");
    li.className = "kw-item";
    li.innerHTML =
      `<span class="kw-sample" style="background:${escapeHtml(kw.color)}">${escapeHtml(kw.word)}</span>` +
      `<span class="grow"></span>` +
      `<button class="kw-del" data-i="${i}" title="削除">✕</button>`;
    list.appendChild(li);
  });

  list.querySelectorAll(".kw-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      keywords.splice(Number(btn.dataset.i), 1);
      persist();
      render();
    });
  });
}

$("#addBtn").addEventListener("click", () => {
  const word = $("#newWord").value.trim();
  const color = $("#newColor").value;
  if (!word) {
    showStatus("キーワードを入力してください");
    return;
  }
  if (keywords.some((k) => k.word === word)) {
    showStatus(`「${word}」はすでに登録済みです`);
    return;
  }
  keywords.push({ word, color });
  persist();
  $("#newWord").value = "";
  render();
});

$("#newWord").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addBtn").click();
});

$("#enabledToggle").addEventListener("change", (e) => {
  enabled = e.target.checked;
  persist();
});

KHStore.load().then(({ state, isNew }) => {
  // 初期セットを適用するのは「保存データが一切無い初回インストール時」だけ。
  // ユーザーが全キーワードを削除した状態（keywords: []）とは区別する。
  if (isNew) {
    keywords = DEFAULT_KEYWORDS.slice();
    enabled = true;
    persist();
  } else {
    keywords = state.keywords;
    enabled = state.enabled;
  }
  $("#enabledToggle").checked = enabled;
  render();
});
