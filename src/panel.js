/**
 * src/panel.js — ページ内フローティングパネルのUI（Shadow DOMで隔離）
 *
 * 目的:
 *   Googleカレンダーのページ上に、メモ一覧・コピー・削除・取得モードの
 *   トグルを持つ小さなパネルを描画する。標準のブラウザアクションの
 *   ポップアップは「ページをクリックした瞬間に閉じる」ため使えず、
 *   代わりにコンテンツスクリプトが注入するページ内パネルにしている。
 *
 * 設計上の制約:
 *   - Shadow DOM（mode: 'open'）でGoogle側のCSSと相互干渉しないようにする。
 *     ホスト要素は `all: initial` でリセットする。
 *   - このファイルはDOM操作関数を定義するだけで、requireされた時点では
 *     何もDOMを触らない（createPanel() を呼ぶまで実行しない）。
 *     そのため document が存在しないNode環境でも require 自体は安全。
 *   - 状態の書き換えロジックは一切持たない（store.js の仕事）。
 *     ここはあくまで「今の状態をどう描画し、どのボタンが押されたら
 *     どのコールバックを呼ぶか」だけを担当する。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const Z_INDEX = 2147483000;

const CONFIDENCE_LABEL = { high: null, medium: '推定', low: '要確認' };

/**
 * 波ダッシュ等の書式ユーティリティを取得する（ブラウザ/Node両対応）。
 */
function getFormatApi() {
  return (typeof module !== 'undefined' && module.exports)
    ? require('./format.js')
    : globalThis.GSM.format;
}

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed;
    width: 300px;
    max-width: calc(100vw - 24px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
    font-size: 13px;
    color: #202124;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 4px 18px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06);
    overflow: hidden;
    z-index: ${Z_INDEX};
  }
  @media (prefers-color-scheme: dark) {
    .panel { background: #2a2b2e; color: #e8eaed; box-shadow: 0 4px 18px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
  }
  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; cursor: move; user-select: none;
    background: #f1f3f4; border-bottom: 1px solid rgba(0,0,0,.08);
  }
  @media (prefers-color-scheme: dark) {
    .header { background: #35363a; border-bottom-color: rgba(255,255,255,.08); }
  }
  .header.pick-on { background: #e8f0fe; }
  @media (prefers-color-scheme: dark) {
    .header.pick-on { background: #2c3d66; }
  }
  .title { font-weight: 600; flex: 1; }
  .pick-toggle {
    font-size: 11px; padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(0,0,0,.15);
    background: transparent; cursor: pointer; color: inherit;
  }
  .pick-toggle.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .close-btn {
    border: none; background: transparent; cursor: pointer; color: inherit; opacity: .6;
    font-size: 16px; line-height: 1; padding: 2px 4px;
  }
  .close-btn:hover { opacity: 1; }
  .body { padding: 8px 12px 12px; }
  .empty { opacity: .6; padding: 12px 0; text-align: center; }
  ul.list { list-style: none; margin: 0; padding: 0; }
  li.entry {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 4px; border-bottom: 1px solid rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme: dark) {
    li.entry { border-bottom-color: rgba(255,255,255,.08); }
  }
  li.entry:last-child { border-bottom: none; }
  li.entry.flash { animation: flash-bg .6s ease; }
  @keyframes flash-bg { 0%{ background: rgba(26,115,232,.25);} 100%{ background: transparent; } }
  .entry-text { flex: 1; }
  .badge {
    font-size: 10px; padding: 1px 6px; border-radius: 999px; background: #fdd663; color: #3c2f00;
  }
  .entry-remove {
    border: none; background: transparent; cursor: pointer; color: inherit; opacity: .55;
    font-size: 14px; min-width: 24px; min-height: 24px;
  }
  .entry-remove:hover { opacity: 1; }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  button.action {
    flex: 1; padding: 7px 0; border-radius: 8px; border: 1px solid rgba(0,0,0,.15);
    background: transparent; color: inherit; cursor: pointer; font-size: 12px;
  }
  @media (prefers-color-scheme: dark) {
    button.action { border-color: rgba(255,255,255,.2); }
  }
  button.action.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  button.action.primary:disabled { opacity: .4; cursor: default; }
  button.action.danger-armed { background: #d93025; border-color: #d93025; color: #fff; }
  .hint { font-size: 11px; opacity: .6; padding-top: 6px; text-align: center; }
  .toast {
    position: fixed; z-index: ${Z_INDEX + 1};
    padding: 8px 14px; border-radius: 8px; background: #202124; color: #fff;
    font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.3);
    opacity: 0; transition: opacity .15s ease;
  }
  .toast.show { opacity: 1; }
`;

/**
 * ビューポート内に収まるよう座標をクランプする。
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @returns {{x:number, y:number}}
 */
function clampToViewport(x, y, w, h) {
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}

/**
 * パネルを作る。DOMへの追加はこの呼び出し時点で行う。
 * @param {object} callbacks
 * @param {(text:string) => Promise<boolean>} callbacks.onCopy
 * @param {(id:string) => void} callbacks.onRemove
 * @param {() => void} callbacks.onClearAll
 * @param {(on:boolean) => void} callbacks.onPickModeToggle
 * @param {(x:number, y:number) => void} callbacks.onMoveEnd
 * @param {() => void} callbacks.onCloseClick
 * @returns {object} パネル操作用API
 */
function createPanel(callbacks) {
  const format = getFormatApi();

  const host = document.createElement('div');
  host.id = 'gcal-schedule-memo-host';
  host.style.cssText = `all: initial; position: fixed; top:0; left:0; z-index: ${Z_INDEX};`;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  const panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.innerHTML = `
    <div class="header">
      <span class="title">日程メモ</span>
      <button class="pick-toggle" type="button">取得モード</button>
      <button class="close-btn" type="button" aria-label="閉じる">&times;</button>
    </div>
    <div class="body">
      <div class="list-wrap"></div>
      <div class="actions">
        <button class="action" type="button" data-action="clear">全消去</button>
        <button class="action primary" type="button" data-action="copy">コピー</button>
      </div>
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
  const copyBtnEl = panelEl.querySelector('[data-action="copy"]');
  const hintEl = panelEl.querySelector('.hint');

  let clearArmed = false;
  let clearArmedTimer = null;

  // --- 一覧描画 --------------------------------------------------------------
  function renderEntries(entries) {
    listWrapEl.innerHTML = '';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'カレンダーの予定や空き枠をクリックすると、ここに追加されます';
      listWrapEl.appendChild(empty);
      hintEl.textContent = '';
      copyBtnEl.disabled = true;
      return;
    }
    copyBtnEl.disabled = false;
    hintEl.textContent = `${entries.length} / 5 件`;

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

  /**
   * 新規追加されたエントリの行を一瞬光らせる（重複クリック時の視認性向上）。
   */
  function flashEntry(id) {
    const li = listWrapEl.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 650);
  }

  // --- 全体描画 --------------------------------------------------------------
  function render(state) {
    host.style.display = state.panel.visible ? 'block' : 'none';
    if (state.panel.x != null && state.panel.y != null) {
      const clamped = clampToViewport(state.panel.x, state.panel.y, panelEl.offsetWidth || 300, panelEl.offsetHeight || 120);
      panelEl.style.left = `${clamped.x}px`;
      panelEl.style.top = `${clamped.y}px`;
    } else {
      panelEl.style.right = '24px';
      panelEl.style.top = '96px';
    }
    headerEl.classList.toggle('pick-on', !!state.panel.pickMode);
    pickToggleEl.classList.toggle('on', !!state.panel.pickMode);
    renderEntries(state.entries);
  }

  // --- トースト --------------------------------------------------------------
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    const rect = panelEl.getBoundingClientRect();
    toast.style.left = `${Math.max(8, rect.left)}px`;
    toast.style.top = `${rect.bottom + 8}px`;
    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 200);
    }, 2200);
  }

  // --- イベント配線 ------------------------------------------------------------
  pickToggleEl.addEventListener('click', () => {
    const next = !pickToggleEl.classList.contains('on');
    callbacks.onPickModeToggle(next);
  });

  closeBtnEl.addEventListener('click', () => callbacks.onCloseClick());

  copyBtnEl.addEventListener('click', async () => {
    const ok = await callbacks.onCopy();
    if (ok) {
      const original = copyBtnEl.textContent;
      copyBtnEl.textContent = 'コピーしました ✓';
      setTimeout(() => { copyBtnEl.textContent = original; }, 1200);
    } else {
      showToast('コピーに失敗しました。手動で選択してコピーしてください');
    }
  });

  clearBtnEl.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtnEl.classList.add('danger-armed');
      clearBtnEl.textContent = 'もう一度押すと消去';
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

  // --- ドラッグ移動（ヘッダのみ） ------------------------------------------------
  let dragState = null;
  headerEl.addEventListener('pointerdown', (e) => {
    // トグルボタン等の子要素クリックはドラッグにしない。
    if (e.target !== headerEl && e.target.closest('button')) return;
    const rect = panelEl.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, baseLeft: rect.left, baseTop: rect.top };
    headerEl.setPointerCapture(e.pointerId);
  });
  headerEl.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const nx = dragState.baseLeft + (e.clientX - dragState.startX);
    const ny = dragState.baseTop + (e.clientY - dragState.startY);
    const clamped = clampToViewport(nx, ny, panelEl.offsetWidth, panelEl.offsetHeight);
    panelEl.style.left = `${clamped.x}px`;
    panelEl.style.top = `${clamped.y}px`;
    panelEl.style.right = 'auto';
  });
  headerEl.addEventListener('pointerup', (e) => {
    if (!dragState) return;
    dragState = null;
    const rect = panelEl.getBoundingClientRect();
    callbacks.onMoveEnd(Math.round(rect.left), Math.round(rect.top));
  });

  return {
    host,
    render,
    showToast,
    flashEntry,
    destroy() { host.remove(); }
  };
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.panel / Node: module.exports）
// ---------------------------------------------------------------------------
const api = { createPanel, clampToViewport, Z_INDEX };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.panel = api;
}

})();
