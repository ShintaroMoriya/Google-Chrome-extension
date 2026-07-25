/**
 * src/content.js — コンテンツスクリプトのエントリポイント
 *
 * 目的:
 *   1) 拡張アイコンのクリックでパネルの表示/非表示を切り替える
 *   2) パネル表示中（＝取得モードON）は、Googleカレンダーの予定チップ/
 *      空きマスのクリックを横取りし、日時を抽出してメモに追加する
 *   3) 通常のカレンダー操作（詳細表示・予定作成）は、取得モードOFFの間は
 *      一切妨げない
 *   4) 取得モード中はカーソル移動に合わせて「これから追加される時間帯」を
 *      枠でプレビュー表示する（preview.js）。クリック確定時はプレビューと
 *      同じ計算関数（extract.js の resolveSlotPreview/extractFromChip）を
 *      使い、見えていた枠と結果が食い違わないようにする（WYSIWYG）。
 *
 * 設計上の制約（クリック横取りの安全策）:
 *   - `pointerdown` に `preventDefault()` は絶対に呼ばない。
 *     Pointer Events仕様上、pointerdownの既定動作を止めると
 *     互換マウスイベント(mousedown/click)が発火しなくなり、
 *     このスクリプト自身の抽出処理（clickで実行）が動かなくなる。
 *     横取りは `stopImmediatePropagation()` だけで十分（Googleのjsactionは
 *     バブルフェーズで待つため、captureフェーズで止めれば先回りできる）。
 *   - 抽出は `click`（＝ドラッグではない確定クリック）でのみ行う。
 *   - 自パネル（Shadow DOMホスト）内のクリックは素通しする。
 *   - ダイアログ・ナビゲーション領域では横取りしない。
 *   - パネルが非表示の間は、横取りを一切行わない
 *     （「知らないうちに横取りされている」状態を作らない）。
 */
'use strict';

(function () {
  const extractApi = globalThis.GSM.extract;
  const formatApi = globalThis.GSM.format;
  const storeApi = globalThis.GSM.store;
  const panelApi = globalThis.GSM.panel;
  const previewApi = globalThis.GSM.preview;

  const storage = storeApi.createStorage();
  let state = storeApi.freshState();
  let panel = null;
  let preview = null;
  let saveTimer = null;
  let previewRaf = null;
  let lastPointerMoveEvent = null;

  /**
   * 状態の保存をデバウンスする（連続クリック時に毎回書き込まない）。
   */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeApi.saveState(storage, state), 200);
  }

  /**
   * 状態を更新し、パネル再描画・保存・取得モードの見た目反映を行う。
   * @param {object} next
   */
  function setState(next) {
    state = next;
    if (panel) panel.render(state);
    applyPickModeAttr();
    // 取得モードOFF（パネル非表示を含む）になったら、プレビューも必ず消す
    // （「知らないうちに横取りされている」状態を作らないのと同じ理由）。
    if (preview && !state.panel.pickMode) preview.hide();
    scheduleSave();
  }

  /**
   * 取得モードのON/OFFを、メインDOM側の属性として反映する
   * （crosshairカーソルやグリッドのアウトラインはこの属性をトリガに出す）。
   */
  function applyPickModeAttr() {
    document.documentElement.setAttribute('data-gsm-pick', state.panel.pickMode ? 'on' : 'off');
  }

  /**
   * 取得モード中の視覚的アフォーダンス（カーソル・アウトライン）を
   * メインドキュメントに注入する。Shadow DOM内のスタイルはメインDOM側の
   * 要素には効かないため、これだけは意図的にShadow外に置く。
   */
  function injectAffordanceStyle() {
    const style = document.createElement('style');
    style.textContent = `
      html[data-gsm-pick="on"] [role="main"] [data-datekey] { cursor: crosshair !important; }
      html[data-gsm-pick="on"] [role="main"] { outline: 2px solid rgba(26,115,232,.45); outline-offset: -2px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * クリップボードへコピーする。navigator.clipboard が使えない/失敗する
   * 場合は textarea + execCommand('copy') にフォールバックする。
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // フォールバックへ
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed; left:-9999px; top:0; opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  /**
   * イベントが自パネル（Shadow DOMホスト）由来かどうか。
   * @param {Event} e
   * @returns {boolean}
   */
  function isOurs(e) {
    if (!panel) return false;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.includes(panel.host);
  }

  /**
   * イベントがカレンダーのメイングリッド内で、かつダイアログ/ナビゲーション
   * 領域の外かどうか。
   * @param {EventTarget} target
   * @returns {boolean}
   */
  function inGrid(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('[role="dialog"]')) return false;
    if (target.closest('[role="navigation"]')) return false;
    return !!target.closest('[role="main"]');
  }

  /**
   * 確定クリック(click)から日時を抽出し、メモに追加する。
   * @param {MouseEvent} e
   */
  function handlePick(e) {
    const chip = e.target.closest ? e.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
    const pick = chip
      ? extractApi.extractFromChip(chip)
      : extractApi.extractFromSlot(
          { clientX: e.clientX, clientY: e.clientY, target: e.target },
          document,
          { durationMin: state.settings.durationMin, snapMin: state.settings.snapMin }
        );

    if (pick.error) {
      panel.showToast(pick.error);
      return;
    }

    const { state: nextState, result } = storeApi.addEntry(state, pick);
    if (result === 'duplicate') {
      panel.showToast('すでに追加済みです');
      return;
    }
    if (result === 'full') {
      panel.showToast('上限5件です。不要な候補を削除してください');
      return;
    }

    setState(nextState);
    const added = nextState.entries[nextState.entries.length - 1];
    requestAnimationFrame(() => panel.flashEntry(added.id));
    if (pick.warning) panel.showToast(pick.warning);
  }

  /**
   * カーソル位置から「クリックしたら追加される内容」を計算し、枠でプレビュー
   * 表示する。extractFromChip / resolveSlotPreview はクリック確定時にも
   * 使う同一の関数なので、ここで見えている枠・時刻がそのままクリック結果に
   * なる（別ロジックを持たないことでWYSIWYGを保証している）。
   * @param {{clientX:number, clientY:number, target:Element}} e
   */
  function updatePreview(e) {
    if (!preview) return;
    if (!state.panel.pickMode || isOurs(e) || !inGrid(e.target)) {
      preview.hide();
      return;
    }

    const chip = e.target.closest ? e.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
    if (chip) {
      const pick = extractApi.extractFromChip(chip);
      if (pick.error) {
        preview.hide();
        return;
      }
      preview.showAt(chip.getBoundingClientRect(), formatApi.formatEntry(pick), pick.confidence);
      return;
    }

    const slot = extractApi.resolveSlotPreview(
      { clientX: e.clientX, clientY: e.clientY, target: e.target },
      document,
      { durationMin: state.settings.durationMin, snapMin: state.settings.snapMin }
    );
    if (slot.pick.error) {
      preview.hide();
      return;
    }
    preview.showAt(slot.rect, formatApi.formatEntry(slot.pick), slot.pick.confidence);
  }

  /**
   * pointermove を requestAnimationFrame でスロットルする。
   * 幾何計算（時刻目盛りラベルの走査を含む）を毎フレーム行っても
   * 数msのコストなので、キャッシュはせず常に最新のDOMから再計算する
   * （スクロール・リサイズ・ビュー切替を気にしなくてよい設計にするため）。
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    lastPointerMoveEvent = e;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      if (lastPointerMoveEvent) updatePreview(lastPointerMoveEvent);
    });
  }

  /**
   * カーソルがページ外に出たらプレビューを隠す。
   */
  function onPointerLeaveDoc() {
    lastPointerMoveEvent = null;
    if (preview) preview.hide();
  }

  /**
   * captureフェーズの横取りハンドラ本体。
   * @param {Event} e
   */
  function onCapture(e) {
    if (!state.panel.pickMode) return;
    if (isOurs(e)) return;
    if (!inGrid(e.target)) return;

    switch (e.type) {
      case 'pointerdown':
        // 既定動作は止めない（上部コメント参照）。
        e.stopPropagation();
        e.stopImmediatePropagation();
        break;
      case 'mousedown':
      case 'mouseup':
      case 'dblclick':
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        break;
      case 'click':
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        handlePick(e);
        break;
      default:
        break;
    }
  }

  /**
   * ESCキーで取得モードだけをOFFにする（パネル自体は開いたまま）。
   * @param {KeyboardEvent} e
   */
  function onKeydown(e) {
    if (e.key === 'Escape' && state.panel.pickMode) {
      e.stopPropagation();
      setState(storeApi.setPanel(state, { pickMode: false }));
    }
  }

  /**
   * アイコンクリックで呼ばれる。パネルを表示すると同時に取得モードもONにし、
   * 非表示にすると同時に取得モードも必ずOFFにする
   * （非表示中は横取りが起きない状態を保証する）。
   */
  function togglePanelVisible() {
    const visible = !state.panel.visible;
    setState(storeApi.setPanel(state, { visible, pickMode: visible }));
  }

  /**
   * SPA遷移等でパネルのホスト要素がDOMから外れた場合に再アタッチする。
   */
  function ensureAttached() {
    if (panel && !panel.host.isConnected) {
      document.documentElement.appendChild(panel.host);
    }
  }

  function bootstrap() {
    injectAffordanceStyle();

    panel = panelApi.createPanel({
      onCopy: () => copyToClipboard(formatApi.formatAll(state.entries)),
      onRemove: (id) => setState(storeApi.removeEntry(state, id)),
      onClearAll: () => setState(storeApi.clearEntries(state)),
      onPickModeToggle: (on) => setState(storeApi.setPanel(state, { pickMode: on })),
      onMoveEnd: (x, y) => setState(storeApi.setPanel(state, { x, y })),
      onCloseClick: () => setState(storeApi.setPanel(state, { visible: false, pickMode: false }))
    });

    preview = previewApi.createPreview();

    storeApi.loadState(storage).then((loaded) => {
      state = loaded;
      panel.render(state);
      applyPickModeAttr();
    });

    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
      window.addEventListener(type, onCapture, { capture: true });
    });
    window.addEventListener('keydown', onKeydown, { capture: true });

    // プレビューはクリックを一切妨げないため、捕捉フェーズではなく通常の
    // パッシブリスナーでよい（preventDefault/stopPropagationを一切呼ばない）。
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeaveDoc);

    new MutationObserver(ensureAttached).observe(document.documentElement, { childList: true });
    // SPAナビゲーションの保険（コストは無視できる）。
    setInterval(ensureAttached, 3000);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'GSM_TOGGLE_PANEL') {
          togglePanelVisible();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
