/**
 * src/content.js — Googleカレンダー上の操作と日程アシストパネルの結線
 *
 * パネル表示中だけ、カレンダーの候補取得モードを有効にする。候補はクリック
 * 取得と手入力のどちらでも最大3件まで追加でき、定型メールへ差し込んでコピー
 * できる。外部送信は行わず、データはブラウザ内へ保存する。
 */
'use strict';

(function () {
  const extractApi = globalThis.GSM.extract;
  const formatApi = globalThis.GSM.format;
  const storeApi = globalThis.GSM.store;
  const panelApi = globalThis.GSM.panel;
  const previewApi = globalThis.GSM.preview;
  const templatesApi = globalThis.GSM.templates;

  const storage = storeApi.createStorage();
  let state = storeApi.freshState();
  let panel = null;
  let preview = null;
  let saveTimer = null;
  let previewRaf = null;
  let lastPointerMoveEvent = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storeApi.saveState(storage, state), 200);
  }

  function setState(next) {
    state = next;
    if (panel) panel.render(state);
    applyPickModeAttr();
    if (preview && !state.panel.pickMode) preview.hide();
    scheduleSave();
  }

  function applyPickModeAttr() {
    document.documentElement.setAttribute('data-gsm-pick', state.panel.pickMode ? 'on' : 'off');
  }

  function injectAffordanceStyle() {
    const style = document.createElement('style');
    style.textContent = `
      html[data-gsm-pick="on"] [role="main"] [data-datekey] { cursor: crosshair !important; }
      html[data-gsm-pick="on"] [role="main"] { outline: 2px solid rgba(26,115,232,.45); outline-offset: -2px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // HTTPSコンテキストでも権限の都合で拒否される場合があるため、旧APIへフォールバックする。
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed; left:-9999px; top:0; opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  function isOurs(event) {
    if (!panel) return false;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(panel.host);
  }

  function inGrid(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('[role="dialog"]')) return false;
    if (target.closest('[role="navigation"]')) return false;
    return !!target.closest('[role="main"]');
  }

  /**
   * 候補を状態へ追加し、UIに即時反映する。
   * @param {object} pick
   * @returns {{ok:boolean,message?:string}}
   */
  function addPick(pick) {
    if (pick.error) return { ok: false, message: pick.error };
    const outcome = storeApi.addEntry(state, pick);
    if (outcome.result === 'duplicate') return { ok: false, message: '同じ日時はすでに追加済みです' };
    if (outcome.result === 'full') return { ok: false, message: '候補は3件までです。不要な候補を削除してください' };
    setState(outcome.state);
    const added = outcome.state.entries[outcome.state.entries.length - 1];
    requestAnimationFrame(() => panel.flashEntry(added.id));
    if (pick.warning) panel.showToast(pick.warning);
    return { ok: true };
  }

  function handlePick(event) {
    const chip = event.target.closest ? event.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
    const pick = chip
      ? extractApi.extractFromChip(chip)
      : extractApi.extractFromSlot(
          { clientX: event.clientX, clientY: event.clientY, target: event.target },
          document,
          { durationMin: state.settings.durationMin, snapMin: state.settings.snapMin }
        );
    const result = addPick(pick);
    if (!result.ok) panel.showToast(result.message);
  }

  /**
   * YYYY-MM-DD / HH:MM の手入力を、タイムゾーン変換を伴わない壁時計フィールドへ変換する。
   * @param {{date:string,start:string,end:string}} value
   * @returns {{ok:true,pick:object}|{ok:false,message:string}}
   */
  function parseManualCandidate(value) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date || '');
    const startMatch = /^(\d{2}):(\d{2})$/.exec(value.start || '');
    const endMatch = /^(\d{2}):(\d{2})$/.exec(value.end || '');
    if (!dateMatch || !startMatch || !endMatch) {
      return { ok: false, message: '日付・開始時刻・終了時刻をすべて入力してください' };
    }
    const y = Number(dateMatch[1]);
    const m = Number(dateMatch[2]);
    const d = Number(dateMatch[3]);
    const sh = Number(startMatch[1]);
    const sm = Number(startMatch[2]);
    const eh = Number(endMatch[1]);
    const em = Number(endMatch[2]);
    const date = new Date(y, m - 1, d);
    const validDate = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    const validTime = sh < 24 && eh < 24 && sm < 60 && em < 60;
    if (!validDate || !validTime) return { ok: false, message: '入力した日時を確認してください' };
    if (eh * 60 + em <= sh * 60 + sm) return { ok: false, message: '終了時刻は開始時刻より後にしてください' };
    return {
      ok: true,
      pick: { y, m, d, sh, sm, eh, em, confidence: 'high', source: 'manual' }
    };
  }

  function updatePreview(event) {
    if (!preview) return;
    if (!state.panel.pickMode || isOurs(event) || !inGrid(event.target)) {
      preview.hide();
      return;
    }
    const chip = event.target.closest ? event.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
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
      { clientX: event.clientX, clientY: event.clientY, target: event.target },
      document,
      { durationMin: state.settings.durationMin, snapMin: state.settings.snapMin }
    );
    if (slot.pick.error) {
      preview.hide();
      return;
    }
    preview.showAt(slot.rect, formatApi.formatEntry(slot.pick), slot.pick.confidence);
  }

  function onPointerMove(event) {
    lastPointerMoveEvent = event;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      if (lastPointerMoveEvent) updatePreview(lastPointerMoveEvent);
    });
  }

  function onPointerLeaveDoc() {
    lastPointerMoveEvent = null;
    if (preview) preview.hide();
  }

  function onCapture(event) {
    if (!state.panel.pickMode || isOurs(event) || !inGrid(event.target)) return;
    switch (event.type) {
      case 'pointerdown':
        // pointerdownでpreventDefaultすると互換クリックが消えるため、伝播だけ止める。
        event.stopPropagation();
        event.stopImmediatePropagation();
        break;
      case 'mousedown':
      case 'mouseup':
      case 'dblclick':
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
        break;
      case 'click':
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
        handlePick(event);
        break;
      default:
        break;
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && state.panel.pickMode) {
      event.stopPropagation();
      setState(storeApi.setPanel(state, { pickMode: false }));
    }
  }

  function togglePanelVisible() {
    const visible = !state.panel.visible;
    setState(storeApi.setPanel(state, { visible, pickMode: visible }));
  }

  function ensureAttached() {
    if (panel && !panel.host.isConnected) document.documentElement.appendChild(panel.host);
  }

  function copyCandidates() {
    const text = formatApi.formatAll(state.entries);
    if (!text) return Promise.resolve({ ok: false, message: '候補日時を追加してください' });
    return copyToClipboard(text).then((ok) => ({ ok, message: ok ? '候補日時をコピーしました' : 'コピーに失敗しました' }));
  }

  function copyTemplate(templateId) {
    if (!state.entries.length) return Promise.resolve({ ok: false, message: '先に候補日時を追加してください' });
    const template = templatesApi.findTemplate(templateId);
    const text = templatesApi.renderTemplate(template, state.entries, formatApi.formatAll);
    return copyToClipboard(text).then((ok) => ({ ok, message: ok ? 'メール本文をコピーしました' : 'コピーに失敗しました' }));
  }

  function addManualCandidate(value) {
    const parsed = parseManualCandidate(value);
    if (!parsed.ok) return Promise.resolve(parsed);
    return Promise.resolve(addPick(parsed.pick));
  }

  function bootstrap() {
    injectAffordanceStyle();
    panel = panelApi.createPanel({
      onCopyCandidates: copyCandidates,
      onCopyTemplate: copyTemplate,
      onAddManual: addManualCandidate,
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
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseleave', onPointerLeaveDoc);
    new MutationObserver(ensureAttached).observe(document.documentElement, { childList: true });
    setInterval(ensureAttached, 3000);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'GSM_TOGGLE_PANEL') togglePanelVisible();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Nodeでの純粋関数テスト用。コンテンツスクリプト実行時には公開しない。
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseManualCandidate };
})();
