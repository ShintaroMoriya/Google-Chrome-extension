/**
 * src/content.js — Googleカレンダー上の操作と日程アシストパネルの結線
 *
 * パネル表示中だけ、カレンダーの候補取得モードを有効にする。候補はクリック
 * 取得と手入力のどちらでも最大3件まで追加でき、選んだ定型文に差し込んで
 * コピーできる。外部送信は行わず、データはブラウザ内へ保存する。
 *
 * v2.0.0:
 *   - 「相手の表示に合わせる」: 相手のタイムゾーン・言語・書式（state.settings.recipient）
 *     でコピー文を作る。自分のタイムゾーンは自動（ブラウザ）か手動指定。
 *   - 言葉に頼らないフィードバック: 上限・重複はシェイク、3件そろったらコピーを脈動。
 *   - スピード: ショートカット（Alt+Shift+S で開閉、Alt+Shift+C でコピー）。
 *     座標キャッシュはスクロール/リサイズで破棄する。
 *   - Googleカレンダーの表示タイムゾーン（左上の GMT±hh）と自分のタイムゾーンが
 *     食い違う場合は、候補を「推定」扱いにして設定に警告を出す（誤送信防止）。
 */
'use strict';

(function () {
const extractApi = globalThis.GSM.extract;
const formatApi = globalThis.GSM.format;
const storeApi = globalThis.GSM.store;
const panelApi = globalThis.GSM.panel;
const previewApi = globalThis.GSM.preview;
const templatesApi = globalThis.GSM.templates;
const tzApi = globalThis.GSM.tz;
const i18n = globalThis.GSM.i18n;
const icons = globalThis.GSM.icons;
const { t } = i18n;

// パネルから選べる設定値（これ以外は保存しない）
const ALLOWED_SNAP_MIN = [15, 30, 60];
const ALLOWED_DURATION_MIN = [30, 60, 90, 120];
const ALLOWED_CHIP_MODE = ['whole', 'slice'];
const BAND_ICON = { day: 'sun', edge: 'sunrise', night: 'moon' };
const CALENDAR_OFFSET_TTL_MS = 10000;

const storage = storeApi.createStorage();
let state = storeApi.freshState();
let panel = null;
let preview = null;
let saveTimer = null;
let previewRaf = null;
let lastPointerMoveEvent = null;
let calendarOffsetCache = { at: 0, value: null };

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storeApi.saveState(storage, state), 200);
}

// ---------------------------------------------------------------------------
// タイムゾーン・言語の解決
// ---------------------------------------------------------------------------

function defaultOutLocale() {
  const ui = i18n.uiLang();
  if (/^ja/i.test(ui)) return 'ja';
  return formatApi.normalizeLocale((typeof navigator !== 'undefined' && navigator.language) || ui);
}

function calendarOffset() {
  const now = Date.now();
  if (now - calendarOffsetCache.at > CALENDAR_OFFSET_TTL_MS) {
    calendarOffsetCache = { at: now, value: extractApi.detectCalendarOffset(document) };
  }
  return calendarOffsetCache.value;
}

/**
 * 描画・コピーに使う文脈を state から解決する。
 * @param {boolean} [lite] true ならカレンダー表示TZの検出を省く（ホバー用）
 * @returns {{myTz:string, targetTz:string, recipientIsMe:boolean, outLocale:string, uiLocale:string, tzMismatchLabel:?string}}
 */
function resolveContext(lite) {
  const settings = state.settings || {};
  const myTz = tzApi.resolveTz(settings.myTz || tzApi.localTz());
  const recipient = settings.recipient || {};
  const recipientTz = recipient.tz && tzApi.isValidTz(recipient.tz) ? recipient.tz : null;
  // ホバー（pointermove）では重いDOM走査を避けるため、食い違い検出を省く。
  const calOff = lite ? null : calendarOffset();
  let tzMismatchLabel = null;
  if (calOff != null && calOff !== tzApi.offsetMinutes(myTz, Date.now())) {
    const sign = calOff >= 0 ? '+' : '-';
    const abs = Math.abs(calOff);
    tzMismatchLabel = `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`;
  }
  return {
    myTz,
    targetTz: recipientTz || myTz,
    recipientIsMe: !recipientTz,
    outLocale: formatApi.normalizeLocale(recipient.locale || defaultOutLocale()),
    uiLocale: i18n.uiLang(),
    tzMismatchLabel
  };
}

function setState(next) {
  state = next;
  if (panel) panel.render(state, resolveContext());
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
    html[data-gsm-pick="on"] [role="main"] { outline: 2px solid rgba(10,132,255,.5); outline-offset: -2px; }
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

/** 抽出エラー/警告コードを表示文言へ。v1で保存された日本語の文字列はそのまま出す。 */
function errorText(code) {
  const isCode = /^[A-Za-z0-9_]+$/.test(code || '');
  return (isCode && t(`err_${code}`)) || String(code || '');
}

/**
 * 現在の設定を、extract.js に渡すオプションへ変換する。
 * @returns {{durationMin:number, snapMin:number, chipMode:string}}
 */
function pickOptions() {
  const s = state.settings || {};
  return {
    durationMin: s.durationMin,
    snapMin: s.snapMin,
    chipMode: ALLOWED_CHIP_MODE.includes(s.chipMode) ? s.chipMode : extractApi.CONFIG.DEFAULT_CHIP_MODE
  };
}

/**
 * 追加時点の自分のタイムゾーンを付け、カレンダー表示TZとの食い違いを確度に反映する。
 */
function withTimeZone(pick, ctx) {
  const next = Object.assign({}, pick, { tz: ctx.myTz });
  if (pick.source !== 'manual') {
    const calOff = calendarOffset();
    if (calOff != null) {
      const startMs = tzApi.zonedToEpoch(pick.y, pick.m, pick.d, pick.sh, pick.sm, ctx.myTz);
      if (calOff !== tzApi.offsetMinutes(ctx.myTz, startMs)) {
        next.warning = extractApi.WARN.TZ_MISMATCH;
        if (next.confidence === 'high') next.confidence = 'medium';
      }
    }
  }
  return next;
}

/**
 * 候補を状態へ追加し、UIに即時反映する。
 * @param {object} pick
 * @returns {{ok:boolean,message?:string,shake?:boolean}}
 */
function addPick(pick) {
  if (pick.error) return { ok: false, message: errorText(pick.error) };
  const ctx = resolveContext();
  const outcome = storeApi.addEntry(state, withTimeZone(pick, ctx));
  if (outcome.result === 'duplicate') {
    const dup = state.entries.find((entry) => storeApi.isSameSlot(entry, pick));
    if (panel) panel.shake(dup && dup.id);
    return { ok: false, message: t('toastDuplicate') };
  }
  if (outcome.result === 'full') {
    if (panel) panel.shake();
    return { ok: false, message: t('toastFull'), shake: true };
  }
  let next = outcome.state;
  if (!next.settings.onboarded) next = storeApi.setSettings(next, { onboarded: true });
  setState(next);
  const added = next.entries[next.entries.length - 1];
  requestAnimationFrame(() => {
    panel.flashEntry(added.id);
    if (next.entries.length >= storeApi.MAX_ENTRIES) panel.pulseCopy();
  });
  if (added.warning === extractApi.WARN.TZ_MISMATCH) panel.showToast(t('warn_tzMismatch'));
  return { ok: true };
}

function handlePick(event) {
  const chip = event.target.closest ? event.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
  const pick = chip
    ? extractApi.resolveChipPreview(chip, { clientY: event.clientY }, pickOptions()).pick
    : extractApi.extractFromSlot(
        { clientX: event.clientX, clientY: event.clientY, target: event.target },
        document,
        pickOptions()
      );
  const result = addPick(pick);
  if (!result.ok) panel.showToast(result.message);
}

/**
 * パネルの設定変更を検証して保存する。許可値以外は無視する。
 * @param {{snapMin?:number, durationMin?:number, chipMode?:string, myTz?:?string}} patch
 */
function changeSettings(patch) {
  const next = {};
  if (ALLOWED_SNAP_MIN.includes(patch.snapMin)) next.snapMin = patch.snapMin;
  if (ALLOWED_DURATION_MIN.includes(patch.durationMin)) next.durationMin = patch.durationMin;
  if (ALLOWED_CHIP_MODE.includes(patch.chipMode)) next.chipMode = patch.chipMode;
  if ('myTz' in patch && (patch.myTz === null || tzApi.isValidTz(patch.myTz))) next.myTz = patch.myTz;
  if (!Object.keys(next).length) return;
  setState(storeApi.setSettings(state, next));
}

function changeRecipient(patch) {
  const next = {};
  if ('tz' in patch && (patch.tz === null || tzApi.isValidTz(patch.tz))) next.tz = patch.tz;
  if ('locale' in patch && (patch.locale === null || formatApi.OUTPUT_LOCALES.includes(patch.locale))) next.locale = patch.locale;
  if (!Object.keys(next).length) return;
  setState(storeApi.setRecipient(state, next));
}

function changeTemplate(templateId) {
  if (!templatesApi.TEMPLATE_IDS.includes(templateId)) return;
  setState(storeApi.setSettings(state, { templateId }));
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
    return { ok: false, message: t('err_invalidManual') };
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
  if (!validDate || !validTime) return { ok: false, message: t('err_invalidManual') };
  if (eh * 60 + em <= sh * 60 + sm) return { ok: false, message: t('err_endBeforeStart') };
  return {
    ok: true,
    pick: { y, m, d, sh, sm, eh, em, confidence: 'high', source: 'manual' }
  };
}

// ---------------------------------------------------------------------------
// ホバープレビュー
// ---------------------------------------------------------------------------

function previewExtra(pick, ctx) {
  const extra = {};
  if (state.entries.length >= storeApi.MAX_ENTRIES) {
    extra.full = true;
    extra.countText = `${state.entries.length}/${storeApi.MAX_ENTRIES}`;
  }
  if (!ctx.recipientIsMe) {
    const entry = Object.assign({}, pick, { tz: ctx.myTz });
    const parts = formatApi.slotParts(entry, { locale: ctx.outLocale, targetTz: ctx.targetTz, sourceTz: ctx.myTz });
    extra.their = {
      text: `${parts.time}${parts.tzName ? ` ${parts.tzName}` : ''}`,
      band: parts.slot.band,
      iconSvg: icons.icon(BAND_ICON[parts.slot.band], 13)
    };
  }
  return extra;
}

function showPreviewFor(rect, pick) {
  const ctx = resolveContext(true);
  const uiLoc = formatApi.normalizeLocale(ctx.uiLocale);
  const text = formatApi.formatSlot(Object.assign({}, pick, { tz: ctx.myTz }), { locale: uiLoc, targetTz: ctx.myTz });
  preview.showAt(rect, text, pick.confidence, previewExtra(pick, ctx));
}

function updatePreview(event) {
  if (!preview) return;
  if (!state.panel.pickMode || isOurs(event) || !inGrid(event.target)) {
    preview.hide();
    return;
  }
  const chip = event.target.closest ? event.target.closest(extractApi.CONFIG.CHIP_SELECTOR) : null;
  if (chip) {
    const hit = extractApi.resolveChipPreview(chip, { clientY: event.clientY }, pickOptions());
    if (hit.pick.error || !hit.rect) {
      preview.hide();
      return;
    }
    showPreviewFor(hit.rect, hit.pick);
    return;
  }
  const slot = extractApi.resolveSlotPreview(
    { clientX: event.clientX, clientY: event.clientY, target: event.target },
    document,
    pickOptions()
  );
  if (slot.pick.error) {
    preview.hide();
    return;
  }
  showPreviewFor(slot.rect, slot.pick);
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

function onLayoutChange() {
  extractApi.invalidateCaches();
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
  if (event.key !== 'Escape') return;
  // Esc は「シートを閉じる」→「取得モードを止める」の順に1段ずつ戻る。
  if (panel && state.panel.visible && panel.isSheetOpen()) {
    event.stopPropagation();
    panel.closeSheet();
    return;
  }
  if (state.panel.pickMode) {
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

// ---------------------------------------------------------------------------
// コピー
// ---------------------------------------------------------------------------

function buildCopyText() {
  const ctx = resolveContext(true);
  const lang = formatApi.langOf(ctx.outLocale);
  const formatAll = (list) => formatApi.formatAllFor(list, { locale: ctx.outLocale, targetTz: ctx.targetTz, sourceTz: ctx.myTz });
  const templateId = templatesApi.TEMPLATE_IDS.includes(state.settings.templateId) ? state.settings.templateId : 'schedule-request';
  const template = templatesApi.findTemplate(templateId, lang);
  return { text: templatesApi.renderTemplate(template, state.entries, formatAll, lang), ctx };
}

async function copyCurrent() {
  if (!state.entries.length) return { ok: false, message: t('toastNeedSlots') };
  const { text, ctx } = buildCopyText();
  const ok = await copyToClipboard(text);
  if (ok && !ctx.recipientIsMe) {
    // 実際に使った相手だけを「最近」に残す（次回はワンタップで呼び出せる）。
    setState(storeApi.pushRecentRecipient(state, { tz: ctx.targetTz, locale: state.settings.recipient.locale || null }));
  }
  return { ok, message: ok ? t('copied') : t('copyFailed') };
}

async function copyFromShortcut() {
  if (!state.panel.visible) setState(storeApi.setPanel(state, { visible: true }));
  const result = await copyCurrent();
  if (panel) panel.showToast(result.message, result.ok ? 'ok' : 'error');
  if (!result.ok && !state.entries.length && panel) panel.shake();
}

function addManualCandidate(value) {
  const parsed = parseManualCandidate(value);
  if (!parsed.ok) return Promise.resolve(parsed);
  return Promise.resolve(addPick(parsed.pick));
}

function bootstrap() {
  injectAffordanceStyle();
  panel = panelApi.createPanel({
    onCopy: copyCurrent,
    onAddManual: addManualCandidate,
    onRemove: (id) => setState(storeApi.removeEntry(state, id)),
    onClearAll: () => setState(storeApi.clearEntries(state)),
    onPickModeToggle: (on) => setState(storeApi.setPanel(state, { pickMode: on })),
    onTemplateChange: changeTemplate,
    onRecipientChange: changeRecipient,
    onSettingsChange: changeSettings,
    onMoveEnd: (x, y) => setState(storeApi.setPanel(state, { x, y })),
    onCloseClick: () => setState(storeApi.setPanel(state, { visible: false, pickMode: false }))
  });
  preview = previewApi.createPreview();

  storeApi.loadState(storage).then((loaded) => {
    state = loaded;
    panel.render(state, resolveContext());
    applyPickModeAttr();
  });

  ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => {
    window.addEventListener(type, onCapture, { capture: true });
  });
  window.addEventListener('keydown', onKeydown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('scroll', onLayoutChange, { capture: true, passive: true });
  window.addEventListener('resize', onLayoutChange, { passive: true });
  document.addEventListener('mouseleave', onPointerLeaveDoc);
  new MutationObserver(ensureAttached).observe(document.documentElement, { childList: true });
  setInterval(ensureAttached, 3000);

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === 'GSM_TOGGLE_PANEL') togglePanelVisible();
      if (message.type === 'GSM_COPY') copyFromShortcut();
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
