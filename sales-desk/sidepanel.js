/* セールスデスク - サイドパネル本体ロジック */

// ---------- 初期データ ----------
const DEFAULT_LINKS = [
  { name: "Gmail", url: "https://mail.google.com/", emoji: "✉️" },
  { name: "カレンダー", url: "https://calendar.google.com/", emoji: "📅" },
  { name: "ドライブ", url: "https://drive.google.com/", emoji: "📁" },
  { name: "スプレッドシート", url: "https://sheets.google.com/", emoji: "📊" },
  { name: "ドキュメント", url: "https://docs.google.com/", emoji: "📝" },
  { name: "Meet", url: "https://meet.google.com/", emoji: "🎥" }
];

const DEFAULT_TEMPLATES = [
  {
    title: "アポお礼",
    body: "{会社名}\n{名前}様\n\nお世話になっております。\n本日はお忙しい中、お時間をいただきありがとうございました。\n\n本日お話しした内容をもとに、改めてご提案資料をお送りいたします。\nご不明点があればいつでもご連絡ください。\n\n引き続きよろしくお願いいたします。"
  },
  {
    title: "日程調整",
    body: "{会社名}\n{名前}様\n\nお世話になっております。\nお打ち合わせの候補日をお送りいたします。\n\n・◯月◯日（◯）◯◯:◯◯〜\n・◯月◯日（◯）◯◯:◯◯〜\n・◯月◯日（◯）◯◯:◯◯〜\n\n上記でご都合いかがでしょうか。\n難しい場合は、ご都合のよい日時をいくつかいただけますと幸いです。"
  },
  {
    title: "リマインド（返信なし時）",
    body: "{会社名}\n{名前}様\n\nお世話になっております。\n先日お送りしたご提案の件、その後いかがでしょうか。\n\nご検討にあたり不足している情報などございましたら、\nお気軽にお申し付けください。\n\nお忙しいところ恐れ入りますが、よろしくお願いいたします。"
  }
];

// ---------- ユーティリティ ----------
const $ = (sel) => document.querySelector(sel);
const store = chrome.storage.local;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- 日付表示 ----------
const now = new Date();
const days = ["日", "月", "火", "水", "木", "金", "土"];
$("#todayDate").textContent =
  `${now.getMonth() + 1}/${now.getDate()}（${days[now.getDay()]}）`;

// ---------- タブ切り替え ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    tab.classList.add("is-active");
    $(`#panel-${tab.dataset.tab}`).classList.add("is-active");
  });
});

// ---------- ① ランチャー ----------
let links = [];

function renderLinks() {
  const grid = $("#launcherGrid");
  grid.innerHTML = "";
  links.forEach((link, i) => {
    const card = document.createElement("button");
    card.className = "launch-card";
    card.innerHTML =
      `<span class="emoji">${escapeHtml(link.emoji || "🔗")}</span>` +
      `${escapeHtml(link.name)}` +
      `<span class="del" data-i="${i}" title="削除">✕</span>`;
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) {
        links.splice(Number(e.target.dataset.i), 1);
        store.set({ links });
        renderLinks();
        return;
      }
      chrome.tabs.create({ url: link.url });
    });
    grid.appendChild(card);
  });
}

$("#addLinkBtn").addEventListener("click", () => {
  const name = $("#newLinkName").value.trim();
  const url = $("#newLinkUrl").value.trim();
  if (!name || !url) return;
  links.push({ name, url, emoji: "🔗" });
  store.set({ links });
  $("#newLinkName").value = "";
  $("#newLinkUrl").value = "";
  renderLinks();
});

// ---------- ② テンプレ ----------
let templates = [];

function applyVars(text) {
  const company = $("#varCompany").value.trim();
  const name = $("#varName").value.trim();
  let out = text;
  if (company) out = out.replaceAll("{会社名}", company);
  if (name) out = out.replaceAll("{名前}", name);
  return out;
}

function renderTemplates() {
  const list = $("#templateList");
  list.innerHTML = "";
  templates.forEach((tpl, i) => {
    const card = document.createElement("div");
    card.className = "tpl-card";
    card.innerHTML =
      `<div class="tpl-head">
         <span class="tpl-title">${escapeHtml(tpl.title)}</span>
         <span class="tpl-actions">
           <button class="btn-copy" data-i="${i}">コピー</button>
           <button class="btn-del" data-i="${i}">削除</button>
         </span>
       </div>
       <div class="tpl-body">${escapeHtml(tpl.body)}</div>`;
    list.appendChild(card);
  });

  list.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tpl = templates[Number(btn.dataset.i)];
      await navigator.clipboard.writeText(applyVars(tpl.body));
      btn.textContent = "コピー済み✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "コピー";
        btn.classList.remove("copied");
      }, 1500);
    });
  });

  list.querySelectorAll(".btn-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      templates.splice(Number(btn.dataset.i), 1);
      store.set({ templates });
      renderTemplates();
    });
  });
}

$("#addTplBtn").addEventListener("click", () => {
  const title = $("#newTplTitle").value.trim();
  const body = $("#newTplBody").value.trim();
  if (!title || !body) return;
  templates.push({ title, body });
  store.set({ templates });
  $("#newTplTitle").value = "";
  $("#newTplBody").value = "";
  renderTemplates();
});

// ---------- ③ メモ（自動保存） ----------
let memoTimer = null;
$("#memoArea").addEventListener("input", () => {
  clearTimeout(memoTimer);
  memoTimer = setTimeout(() => {
    store.set({ memo: $("#memoArea").value });
    const st = $("#memoStatus");
    st.textContent = "保存しました ✓";
    setTimeout(() => (st.textContent = ""), 1500);
  }, 400);
});

// ---------- ④ TODO ----------
let todos = [];

function renderTodos() {
  const list = $("#todoList");
  list.innerHTML = "";
  todos.forEach((todo, i) => {
    const li = document.createElement("li");
    if (todo.done) li.classList.add("done");
    li.innerHTML =
      `<input type="checkbox" ${todo.done ? "checked" : ""} data-i="${i}">` +
      `<span>${escapeHtml(todo.text)}</span>`;
    list.appendChild(li);
  });
  list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      todos[Number(cb.dataset.i)].done = cb.checked;
      store.set({ todos });
      renderTodos();
    });
  });
}

function addTodo() {
  const text = $("#newTodoText").value.trim();
  if (!text) return;
  todos.push({ text, done: false });
  store.set({ todos });
  $("#newTodoText").value = "";
  renderTodos();
}
$("#addTodoBtn").addEventListener("click", addTodo);
$("#newTodoText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTodo();
});
$("#clearDoneBtn").addEventListener("click", () => {
  todos = todos.filter((t) => !t.done);
  store.set({ todos });
  renderTodos();
});

// ---------- 起動時ロード ----------
store.get(["links", "templates", "memo", "todos"], (data) => {
  links = data.links?.length ? data.links : DEFAULT_LINKS.slice();
  templates = data.templates?.length ? data.templates : DEFAULT_TEMPLATES.slice();
  todos = data.todos || [];
  $("#memoArea").value = data.memo || "";
  renderLinks();
  renderTemplates();
  renderTodos();
});
