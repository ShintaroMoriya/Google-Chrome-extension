/* キーワード・ハイライター - 設定ポップアップ */

const $ = (sel) => document.querySelector(sel);
const store = chrome.storage.local;

const DEFAULT_KEYWORDS = [
  { word: "至急", color: "#FFB3B3" },
  { word: "クレーム", color: "#FFB3B3" },
  { word: "期限", color: "#FFE066" },
  { word: "見積", color: "#B3E5C9" }
];

let keywords = [];

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
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
      store.set({ keywords });
      render();
    });
  });
}

$("#addBtn").addEventListener("click", () => {
  const word = $("#newWord").value.trim();
  const color = $("#newColor").value;
  if (!word) return;
  if (keywords.some((k) => k.word === word)) return;
  keywords.push({ word, color });
  store.set({ keywords });
  $("#newWord").value = "";
  render();
});

$("#newWord").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addBtn").click();
});

$("#enabledToggle").addEventListener("change", (e) => {
  store.set({ enabled: e.target.checked });
});

store.get(["keywords", "enabled"], (data) => {
  if (data.keywords === undefined) {
    keywords = DEFAULT_KEYWORDS.slice();
    store.set({ keywords });
  } else {
    keywords = data.keywords;
  }
  $("#enabledToggle").checked = data.enabled !== false;
  render();
});
