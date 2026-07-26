/* 期限みえるくん - ポップアップ */

const $ = (sel) => document.querySelector(sel);
const { daysUntil, localDateKey } = KigenDate;
let tasks = [];
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
  KAStore.save({ schemaVersion: KAStore.SCHEMA_VERSION, tasks });
}

function levelOf(task) {
  const d = daysUntil(task.due);
  if (d <= 0) return "red";
  if (d <= 3) return "yellow";
  return "green";
}

function badgeText(task) {
  const d = daysUntil(task.due);
  if (d < 0) return `${Math.abs(d)}日超過`;
  if (d === 0) return "今日";
  if (d === 1) return "明日";
  return `あと${d}日`;
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

function render() {
  const list = $("#taskList");
  list.innerHTML = "";

  // 未完了を危険度順 → 完了は最後
  const sorted = tasks.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return daysUntil(a.due) - daysUntil(b.due);
  });

  $("#emptyMsg").style.display = sorted.length ? "none" : "block";

  for (const task of sorted) {
    const li = document.createElement("li");
    li.className = `task-item lv-${levelOf(task)}${task.done ? " done" : ""}`;
    li.innerHTML =
      `<input type="checkbox" ${task.done ? "checked" : ""} data-id="${task.id}">` +
      `<div class="t-main">
         <div class="t-title">${escapeHtml(task.title)}</div>
         <div class="t-due">期限：${fmtDate(task.due)}</div>
       </div>` +
      `<span class="t-badge">${badgeText(task)}</span>` +
      `<button class="t-del" data-id="${task.id}" title="削除">✕</button>`;
    list.appendChild(li);
  }

  list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const t = tasks.find((t) => t.id === cb.dataset.id);
      if (t) t.done = cb.checked;
      persist();
      render();
    });
  });

  list.querySelectorAll(".t-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      tasks = tasks.filter((t) => t.id !== btn.dataset.id);
      persist();
      render();
    });
  });
}

$("#addBtn").addEventListener("click", () => {
  const title = $("#taskTitle").value.trim();
  const due = $("#taskDue").value;
  if (!title) {
    showStatus("タイトルを入力してください");
    return;
  }
  if (!due) {
    showStatus("期限日を選択してください");
    return;
  }
  tasks.push({
    id: String(Date.now()),
    title,
    due,
    done: false
  });
  persist();
  $("#taskTitle").value = "";
  render();
});

$("#taskTitle").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addBtn").click();
});

// 破壊的操作は2度押し（1回目で赤く変化し「もう一度押すと片付ける」に変わる。
// 3秒操作が無ければ自動的に元へ戻る）。
let clearArmed = false;
let clearArmedTimer = null;
const clearBtn = $("#clearDoneBtn");
const CLEAR_BTN_DEFAULT_TEXT = clearBtn.textContent;

clearBtn.addEventListener("click", () => {
  if (!clearArmed) {
    clearArmed = true;
    clearBtn.classList.add("danger-armed");
    clearBtn.textContent = "もう一度押すと片付けます";
    clearArmedTimer = setTimeout(() => {
      clearArmed = false;
      clearBtn.classList.remove("danger-armed");
      clearBtn.textContent = CLEAR_BTN_DEFAULT_TEXT;
    }, 3000);
    return;
  }
  clearTimeout(clearArmedTimer);
  clearArmed = false;
  clearBtn.classList.remove("danger-armed");
  clearBtn.textContent = CLEAR_BTN_DEFAULT_TEXT;
  tasks = tasks.filter((t) => !t.done);
  persist();
  render();
});

// 初期表示：日付欄は今日をデフォルトに
$("#taskDue").value = localDateKey();

KAStore.load().then(({ state }) => {
  tasks = state.tasks;
  render();
});
