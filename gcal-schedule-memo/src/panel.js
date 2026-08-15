/**
 * src/panel.js — ページ内フローティングパネルのUI（Shadow DOMで隔離）
 *
 * カレンダー上の候補取得に加え、手入力した候補と定型メールのコピーを扱う。
 * 状態の更新とクリップボード操作は呼び出し元に委譲し、UIは描画とイベント通知
 * だけを担う。
 */
'use strict';

(function () {

const Z_INDEX = 2147483000;
const CONFIDENCE_LABEL = { high: null, medium: null, low: '要確認' };

function getFormatApi() {
  return (typeof module !== 'undefined' && module.exports)
    ? require('./format.js')
    : globalThis.GSM.format;
}

function getTemplateApi() {
  return (typeof module !== 'undefined' && module.exports)
    ? require('./templates.js')
    : globalThis.GSM.templates;
}

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed; width: 342px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
    font-size: 13px; color: #202124; background: #fff; border-radius: 12px;
    box-shadow: 0 4px 18px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06); overflow: auto; z-index: ${Z_INDEX};
  }
  @media (prefers-color-scheme: dark) {
    .panel { background: #2a2b2e; color: #e8eaed; box-shadow: 0 4px 18px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
  }
  .header { display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:move; user-select:none; background:#f1f3f4; border-bottom:1px solid rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .header { background:#35363a; border-bottom-color:rgba(255,255,255,.08); } }
  .header.pick-on { background:#e8f0fe; }
  @media (prefers-color-scheme: dark) { .header.pick-on { background:#2c3d66; } }
  .title { font-weight:600; flex:1; }
  .pick-toggle { font-size:11px; padding:3px 8px; border-radius:999px; border:1px solid rgba(0,0,0,.15); background:transparent; cursor:pointer; color:inherit; }
  .pick-toggle.on { background:#1a73e8; border-color:#1a73e8; color:#fff; }
  .close-btn { border:none; background:transparent; cursor:pointer; color:inherit; opacity:.6; font-size:16px; line-height:1; padding:2px 4px; }
  .close-btn:hover { opacity:1; }
  .body { padding:10px 12px 12px; }
  .section-title { margin:0 0 6px; font-size:11px; font-weight:700; letter-spacing:.02em; color:#5f6368; }
  @media (prefers-color-scheme: dark) { .section-title { color:#bdc1c6; } }
  .empty { opacity:.65; padding:8px 0; text-align:center; line-height:1.5; }
  ul.list { list-style:none; margin:0; padding:0; }
  li.entry { display:flex; align-items:center; gap:6px; padding:6px 4px; border-bottom:1px solid rgba(0,0,0,.06); }
  @media (prefers-color-scheme: dark) { li.entry { border-bottom-color:rgba(255,255,255,.08); } }
  li.entry:last-child { border-bottom:none; }
  li.entry.flash { animation:flash-bg .6s ease; }
  @keyframes flash-bg { 0% { background:rgba(26,115,232,.25); } 100% { background:transparent; } }
  .entry-text { flex:1; }
  .badge { font-size:10px; padding:1px 6px; border-radius:999px; background:#fdd663; color:#3c2f00; }
  .entry-remove { border:none; background:transparent; cursor:pointer; color:inherit; opacity:.55; font-size:14px; min-width:24px; min-height:24px; }
  .entry-remove:hover { opacity:1; }
  .manual { margin-top:9px; padding:9px; border-radius:8px; background:#f8f9fa; }
  @media (prefers-color-scheme: dark) { .manual { background:#35363a; } }
  .manual-row { display:grid; grid-template-columns:1fr 72px 72px 42px; gap:5px; align-items:center; }
  .manual input { min-width:0; box-sizing:border-box; height:30px; border:1px solid rgba(0,0,0,.2); border-radius:6px; padding:3px 5px; background:#fff; color:#202124; font:inherit; }
  @media (prefers-color-scheme: dark) { .manual input { background:#2a2b2e; color:#e8eaed; border-color:rgba(255,255,255,.25); } }
  .manual button { height:30px; padding:0; border:1px solid #1a73e8; border-radius:6px; background:#fff; color:#1a73e8; cursor:pointer; font-size:11px; }
  @media (prefers-color-scheme: dark) { .manual button { background:#2a2b2e; } }
  .actions { display:flex; gap:8px; margin-top:9px; }
  button.action { flex:1; padding:7px 6px; border-radius:8px; border:1px solid rgba(0,0,0,.15); background:transparent; color:inherit; cursor:pointer; font-size:12px; }
  @media (prefers-color-scheme: dark) { button.action { border-color:rgba(255,255,255,.2); } }
  button.action.primary { background:#1a73e8; border-color:#1a73e8; color:#fff; }
  button.action:disabled, .template-btn:disabled { opacity:.42; cursor:default; }
  button.action.danger-armed { background:#d93025; border-color:#d93025; color:#fff; }
  .divider { height:1px; margin:12px 0; background:rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .divider { background:rgba(255,255,255,.1); } }
  .template-list { display:grid; gap:6px; }
  .template-btn { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 9px; border:1px solid rgba(0,0,0,.15); border-radius:8px; background:transparent; color:inherit; cursor:pointer; text-align:left; font:inherit; }
  @media (prefers-color-scheme: dark) { .template-btn { border-color:rgba(255,255,255,.2); } }
  .template-btn:hover:not(:disabled) { background:rgba(26,115,232,.08); border-color:#1a73e8; }
  .template-action { font-size:11px; color:#1a73e8; white-space:nowrap; }
  .hint { font-size:11px; opacity:.65; padding-top:7px; text-align:center; line-height:1.35; }
  .toast { position:fixed; z-index:${Z_INDEX + 1}; max-width:280px; padding:8px 14px; border-radius:8px; background:#202124; color:#fff; font-size:12px; box-shadow:0 2px 8px rgba(0,0,0,.3); opacity:0; transition:opacity .15s ease; }
  .toast.show { opacity:1; }
`;

function clampToViewport(x, y, w, h) {
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}

/**
 * @param {object} callbacks
 * @param {() => Promise<{ok:boolean,message?:string}>} callbacks.onCopyCandidates
 * @param {(templateId:string) => Promise<{ok:boolean,message?:string}>} callbacks.onCopyTemplate
 * @param {(value:{date:string,start:string,end:string}) => Promise<{ok:boolean,message?:string}>} callbacks.onAddManual
 * @param {(id:string) => void} callbacks.onRemove
 * @param {() => void} callbacks.onClearAll
 * @param {(on:boolean) => void} callbacks.onPickModeToggle
 * @param {(x:number,y:number) => void} callbacks.onMoveEnd
 * @param {() => void} callbacks.onCloseClick
 */
function createPanel(callbacks) {
  const format = getFormatApi();
  const templateApi = getTemplateApi();
  const templates = templateApi.DEFAULT_TEMPLATES;

  const host = document.createElement('div');
  host.id = 'gcal-schedule-memo-host';
  host.style.cssText = `all:initial; position:fixed; top:0; left:0; z-index:${Z_INDEX};`;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  const panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.innerHTML = `
    <div class="header">
      <span class="title">日程アシスト</span>
      <button class="pick-toggle" type="button">取得モード</button>
      <button class="close-btn" type="button" aria-label="閉じる">&times;</button>
    </div>
    <div class="body">
      <p class="section-title">候補日時</p>
      <div class="list-wrap"></div>
      <div class="manual" aria-label="候補日時を手入力">
        <div class="manual-row">
          <input data-manual="date" type="date" aria-label="日付">
          <input data-manual="start" type="time" aria-label="開始時刻">
          <input data-manual="end" type="time" aria-label="終了時刻">
          <button type="button" data-action="manual-add">追加</button>
        </div>
      </div>
      <div class="actions">
        <button class="action" type="button" data-action="clear">全消去</button>
        <button class="action primary" type="button" data-action="copy-candidates">候補のみコピー</button>
      </div>
      <div class="divider"></div>
      <p class="section-title">定型文（候補日時を自動で差し込み）</p>
      <div class="template-list"></div>
      <div class="hint"></div>
    </div>
  `;
  root.appendChild(panelEl);
  document.documentElement.appendChild(host);

  const headerEl = panelEl.querySelector('.header');
  const pickToggleEl = panelEl.querySelector('.pick-toggle');
  const closeBtnEl = panelEl.querySelector('.close-btn');
  const listWrapEl = panelEl.querySelector('.list-wrap');
  const clearBtnEl = panelEl.querySelector('[data-action="clear"]');
  const copyCandidatesBtnEl = panelEl.querySelector('[data-action="copy-candidates"]');
  const templateListEl = panelEl.querySelector('.template-list');
  const manualDateEl = panelEl.querySelector('[data-manual="date"]');
  const manualStartEl = panelEl.querySelector('[data-manual="start"]');
  const manualEndEl = panelEl.querySelector('[data-manual="end"]');
  const manualAddBtnEl = panelEl.querySelector('[data-action="manual-add"]');
  const hintEl = panelEl.querySelector('.hint');
  let clearArmed = false;
  let clearArmedTimer = null;

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    const rect = panelEl.getBoundingClientRect();
    toast.style.left = `${Math.max(8, rect.left)}px`;
    toast.style.top = `${Math.min(window.innerHeight - 45, rect.bottom + 8)}px`;
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 200);
    }, 2400);
  }

  function renderEntries(entries) {
    listWrapEl.innerHTML = '';
    const canCopy = entries.length > 0;
    copyCandidatesBtnEl.disabled = !canCopy;
    templateListEl.querySelectorAll('button').forEach((button) => { button.disabled = !canCopy; });
    hintEl.textContent = canCopy
      ? `${entries.length} / 3 件。コピー後、メール本文で貼り付けてください。`
      : 'カレンダーの空き枠をクリックするか、下で日時を入力してください。';

    if (!canCopy) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '候補を最大3件まで追加できます';
      listWrapEl.appendChild(empty);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'list';
    const sorted = entries.slice().sort((a, b) => format.sortKey(a) - format.sortKey(b));
    for (const entry of sorted) {
      const li = document.createElement('li');
      li.className = 'entry';
      li.dataset.id = entry.id;
      const textEl = document.createElement('span');
      textEl.className = 'entry-text';
      textEl.textContent = format.formatEntry(entry);
      li.appendChild(textEl);
      const badgeLabel = CONFIDENCE_LABEL[entry.confidence];
      if (badgeLabel) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = badgeLabel;
        if (entry.warning) badge.title = entry.warning;
        li.appendChild(badge);
      }
      const removeBtn = document.createElement('button');
      removeBtn.className = 'entry-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', '削除');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => callbacks.onRemove(entry.id));
      li.appendChild(removeBtn);
      ul.appendChild(li);
    }
    listWrapEl.appendChild(ul);
  }

  function renderTemplateButtons() {
    templateListEl.innerHTML = '';
    for (const template of templates) {
      const button = document.createElement('button');
      button.className = 'template-btn';
      button.type = 'button';
      button.dataset.templateId = template.id;
      button.innerHTML = `<span>${template.title}</span><span class="template-action">メール全文をコピー</span>`;
      button.addEventListener('click', async () => {
        const result = await callbacks.onCopyTemplate(template.id);
        if (result.ok) {
          const original = button.innerHTML;
          button.textContent = 'コピーしました';
          setTimeout(() => { button.innerHTML = original; }, 1200);
        } else {
          showToast(result.message || 'コピーに失敗しました');
        }
      });
      templateListEl.appendChild(button);
    }
  }

  function render(state) {
    host.style.display = state.panel.visible ? 'block' : 'none';
    if (state.panel.x != null && state.panel.y != null) {
      const clamped = clampToViewport(state.panel.x, state.panel.y, panelEl.offsetWidth || 342, panelEl.offsetHeight || 120);
      panelEl.style.left = `${clamped.x}px`;
      panelEl.style.top = `${clamped.y}px`;
      panelEl.style.right = 'auto';
    } else {
      panelEl.style.right = '24px';
      panelEl.style.top = '96px';
      panelEl.style.left = 'auto';
    }
    headerEl.classList.toggle('pick-on', !!state.panel.pickMode);
    pickToggleEl.classList.toggle('on', !!state.panel.pickMode);
    pickToggleEl.textContent = state.panel.pickMode ? '取得中' : '取得モード';
    renderEntries(state.entries);
  }

  function flashEntry(id) {
    const li = listWrapEl.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 650);
  }

  pickToggleEl.addEventListener('click', () => callbacks.onPickModeToggle(!pickToggleEl.classList.contains('on')));
  closeBtnEl.addEventListener('click', () => callbacks.onCloseClick());

  copyCandidatesBtnEl.addEventListener('click', async () => {
    const result = await callbacks.onCopyCandidates();
    if (result.ok) {
      const original = copyCandidatesBtnEl.textContent;
      copyCandidatesBtnEl.textContent = 'コピーしました';
      setTimeout(() => { copyCandidatesBtnEl.textContent = original; }, 1200);
    } else {
      showToast(result.message || 'コピーに失敗しました');
    }
  });

  manualAddBtnEl.addEventListener('click', async () => {
    const result = await callbacks.onAddManual({ date: manualDateEl.value, start: manualStartEl.value, end: manualEndEl.value });
    if (result.ok) {
      manualDateEl.value = '';
      manualStartEl.value = '';
      manualEndEl.value = '';
    } else {
      showToast(result.message || '日時を確認してください');
    }
  });

  clearBtnEl.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtnEl.classList.add('danger-armed');
      clearBtnEl.textContent = 'もう一度で消去';
      clearArmedTimer = setTimeout(() => {
        clearArmed = false;
        clearBtnEl.classList.remove('danger-armed');
        clearBtnEl.textContent = '全消去';
      }, 3000);
      return;
    }
    clearTimeout(clearArmedTimer);
    clearArmed = false;
    clearBtnEl.classList.remove('danger-armed');
    clearBtnEl.textContent = '全消去';
    callbacks.onClearAll();
  });

  let dragState = null;
  headerEl.addEventListener('pointerdown', (event) => {
    if (event.target !== headerEl && event.target.closest('button')) return;
    const rect = panelEl.getBoundingClientRect();
    dragState = { startX: event.clientX, startY: event.clientY, baseLeft: rect.left, baseTop: rect.top };
    headerEl.setPointerCapture(event.pointerId);
  });
  headerEl.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const nextX = dragState.baseLeft + (event.clientX - dragState.startX);
    const nextY = dragState.baseTop + (event.clientY - dragState.startY);
    const clamped = clampToViewport(nextX, nextY, panelEl.offsetWidth, panelEl.offsetHeight);
    panelEl.style.left = `${clamped.x}px`;
    panelEl.style.top = `${clamped.y}px`;
    panelEl.style.right = 'auto';
  });
  headerEl.addEventListener('pointerup', () => {
    if (!dragState) return;
    dragState = null;
    const rect = panelEl.getBoundingClientRect();
    callbacks.onMoveEnd(Math.round(rect.left), Math.round(rect.top));
  });

  renderTemplateButtons();
  return { host, render, showToast, flashEntry, destroy() { host.remove(); } };
}

const api = { createPanel, clampToViewport, Z_INDEX };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.panel = api;
}

})();
