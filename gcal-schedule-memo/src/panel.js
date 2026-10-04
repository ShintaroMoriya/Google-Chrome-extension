/**
 * src/panel.js — ページ内フローティングパネルのUI（Shadow DOMで隔離・iOS風）
 *
 * 設計方針（v2.0.0）:
 *   - 文字に頼らない。操作はアイコン、状態は色と動きで伝える。文字は aria-label /
 *     title と短い通知（HUD）だけに使う。
 *   - 候補は「3つの枠」で表す。点線の空き枠が残数を、揺れ（シェイク）が上限・重複を、
 *     緑のチェックがコピー成功を、それぞれ言葉なしで伝える。
 *   - 各候補には自分の時刻と、相手の時刻（☀ / 朝夕 / 🌙 アイコン付き）を並べる。
 *   - 相手のタイムゾーン・言語、設定はパネル内の「シート」で切り替える。
 *
 * 状態の更新とクリップボード操作は呼び出し元（content.js）に委譲し、UIは描画と
 * イベント通知だけを担う。表示用の文字列はすべて format.js / tz.js から得る。
 */
'use strict';

(function () {

const Z_INDEX = 2147483000;
const MAX_SLOTS = 3;
const PANEL_WIDTH = 320;

const SNAP_OPTIONS = [15, 30, 60];
const DURATION_OPTIONS = [30, 60, 90, 120];
const CHIP_MODE_OPTIONS = [
  { value: 'whole', icon: 'chipWhole', label: 'chipWhole' },
  { value: 'slice', icon: 'chipSlice', label: 'chipSlice' }
];
const TEMPLATE_BUTTONS = [
  { id: 'list', icon: 'list', label: 'tpl_list' },
  { id: 'schedule-request', icon: 'send', label: 'tpl_propose' },
  { id: 'reschedule-request', icon: 'reschedule', label: 'tpl_reschedule' },
  { id: 'online-meeting-request', icon: 'video', label: 'tpl_online' }
];
const LOCALE_CHIP = { 'en-US': 'EN 12h', 'en-GB': 'EN 24h', ja: '日本語' };
const BAND_ICON = { day: 'sun', edge: 'sunrise', night: 'moon' };
const DEFAULT_SETTINGS = { snapMin: 15, durationMin: 60, chipMode: 'whole' };

function lib(name, file) {
  return (typeof module !== 'undefined' && module.exports) ? require(file) : globalThis.GSM[name];
}

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    --blue:#007aff; --green:#34c759; --orange:#ff9500; --red:#ff3b30; --indigo:#5856d6; --yellow:#ffcc00;
    --label:#1c1c1e; --label2:rgba(60,60,67,.62); --label3:rgba(60,60,67,.32);
    --fill:rgba(120,120,128,.12); --fill2:rgba(120,120,128,.07); --sep:rgba(60,60,67,.16);
    --bg:rgba(246,246,248,.82); --card:#fff; --tile:#fff; --hud:rgba(28,28,30,.86);
    --shadow:0 12px 40px rgba(0,0,0,.18), 0 0 0 .5px rgba(0,0,0,.14);
    --spring:cubic-bezier(.34,1.56,.64,1); --ease:cubic-bezier(.2,.8,.2,1);
    position: fixed; width: ${PANEL_WIDTH}px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
    box-sizing: border-box; overflow: hidden auto; z-index: ${Z_INDEX};
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, Roboto, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans", sans-serif;
    font-size: 13px; line-height: 1.3; color: var(--label); font-variant-numeric: tabular-nums;
    background: var(--bg); border-radius: 20px; box-shadow: var(--shadow);
    -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
    -webkit-font-smoothing: antialiased;
    animation: panel-in .32s var(--spring);
  }
  @media (prefers-color-scheme: dark) {
    .panel {
      --blue:#0a84ff; --green:#30d158; --orange:#ff9f0a; --red:#ff453a; --indigo:#7d7aff; --yellow:#ffd60a;
      --label:#fff; --label2:rgba(235,235,245,.62); --label3:rgba(235,235,245,.3);
      --fill:rgba(120,120,128,.28); --fill2:rgba(120,120,128,.16); --sep:rgba(84,84,88,.55);
      --bg:rgba(30,30,32,.84); --card:rgba(58,58,60,.9); --tile:#2c2c2e; --hud:rgba(242,242,247,.92);
      --shadow:0 12px 40px rgba(0,0,0,.55), 0 0 0 .5px rgba(255,255,255,.12);
    }
    .hud { color:#1c1c1e !important; }
  }
  @keyframes panel-in { from { opacity:0; transform: scale(.94) translateY(-6px); } to { opacity:1; transform:none; } }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; margin: 0; }
  button:focus-visible, input:focus-visible { outline: 2.5px solid var(--blue); outline-offset: 2px; }
  .i { display:block; flex:none; }

  .header { display:grid; grid-template-columns: 40px 1fr 40px; align-items:center; height:44px; padding:0 8px; cursor:grab; user-select:none; touch-action:none; }
  .header:active { cursor:grabbing; }
  .grabber { justify-self:center; width:36px; height:5px; border-radius:3px; background:var(--label3); }
  .round { width:30px; height:30px; border-radius:50%; border:none; display:grid; place-items:center; cursor:pointer; background:var(--fill); color:var(--label2); padding:0; transition: background .2s, color .2s, transform .2s var(--spring); }
  .round:hover { color:var(--label); }
  .round:active { transform: scale(.9); }
  .pick-toggle.on { background:var(--blue); color:#fff; animation: ring 2s ease-out infinite; }
  @keyframes ring { 0% { box-shadow:0 0 0 0 rgba(10,132,255,.45); } 70%,100% { box-shadow:0 0 0 9px rgba(10,132,255,0); } }
  .close-btn { justify-self:end; width:26px; height:26px; }

  .chips { display:flex; gap:6px; padding:0 12px; }
  .chip { height:32px; border-radius:16px; border:none; background:var(--fill); display:flex; align-items:center; gap:6px; padding:0 11px 0 9px; cursor:pointer; min-width:0; transition: transform .2s var(--spring), background .2s; }
  .chip:active { transform: scale(.96); }
  .chip.tz { flex:1; }
  .chip.set { background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue); }
  .chip .t { font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .chip .s { font-size:12px; color:var(--label2); white-space:nowrap; }
  .chip.set .s { color: color-mix(in srgb, var(--blue) 75%, var(--label2)); }
  .chip .warn-dot { width:8px; height:8px; border-radius:50%; background:var(--orange); flex:none; }

  ul.slots { list-style:none; margin:10px 0 0; padding:0 12px; display:grid; grid-template-columns:minmax(0,1fr); gap:8px; }
  .slot { position:relative; height:60px; border-radius:15px; display:flex; align-items:center; gap:11px; padding:0 8px 0 9px; }
  .slot.filled { background:var(--card); box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .slot.filled.new { animation: pop .42s var(--spring); }
  .slot.empty { border:1.5px dashed var(--label3); color:var(--label3); }
  .slot.empty.next { border-color: color-mix(in srgb, var(--blue) 55%, transparent); color: color-mix(in srgb, var(--blue) 70%, transparent); }
  @keyframes pop { from { opacity:0; transform: scale(.9); } to { opacity:1; transform:none; } }
  .slot.flash { animation: flash .7s var(--ease); }
  @keyframes flash { 0% { box-shadow:0 0 0 3px color-mix(in srgb, var(--blue) 55%, transparent); } 100% { box-shadow:0 0 0 0 transparent; } }
  .shake { animation: shake .42s cubic-bezier(.36,.07,.19,.97); }
  @keyframes shake { 10%,90% { transform:translateX(-2px); } 20%,80% { transform:translateX(4px); } 30%,50%,70% { transform:translateX(-7px); } 40%,60% { transform:translateX(7px); } }
  .tile { width:40px; height:44px; flex:none; border-radius:10px; background:var(--tile); box-shadow:0 0 0 .5px var(--sep), 0 1px 3px rgba(0,0,0,.08); display:flex; flex-direction:column; align-items:center; overflow:hidden; }
  .tile .m { width:100%; text-align:center; font-size:9px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--red); padding-top:4px; }
  .tile .d { font-size:21px; font-weight:500; line-height:1; margin-top:2px; }
  .info { flex:1; min-width:0; display:grid; gap:3px; }
  .own { display:flex; align-items:baseline; gap:6px; white-space:nowrap; }
  .own .wd { font-size:12px; color:var(--label2); font-weight:600; }
  .own .time { font-size:16px; font-weight:600; letter-spacing:-.01em; overflow:hidden; text-overflow:ellipsis; }
  .own .flag { align-self:center; }
  .flag.medium { color:var(--orange); }
  .flag.low { color:var(--red); }
  .their { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--label2); white-space:nowrap; overflow:hidden; }
  .their .tt { overflow:hidden; text-overflow:ellipsis; }
  .band-day { color:var(--green); }
  .band-edge { color:var(--orange); }
  .band-night { color:var(--indigo); }
  .shift { font-size:10px; font-weight:700; padding:1px 5px; border-radius:6px; background:var(--fill); color:var(--label2); }
  .remove { width:26px; height:26px; flex:none; border-radius:50%; border:none; background:transparent; color:var(--label3); display:grid; place-items:center; cursor:pointer; padding:0; transition: background .15s, color .15s; }
  .slot:hover .remove, .remove:focus-visible { color:var(--label2); }
  .remove:hover { background:var(--red); color:#fff !important; }
  .slot.empty .num { width:24px; height:24px; border-radius:50%; border:1.5px solid currentColor; display:grid; place-items:center; font-size:12px; font-weight:700; flex:none; margin-left:8px; }
  .slot.empty .hint { flex:1; display:flex; align-items:center; gap:8px; min-width:0; }
  .slot.empty .line { flex:1; height:6px; border-radius:3px; background:currentColor; opacity:.25; }
  .slot.empty .add { width:28px; height:28px; border-radius:50%; border:none; background:var(--fill); color:var(--blue); display:grid; place-items:center; cursor:pointer; padding:0; flex:none; }
  .slot.empty .add:hover { background:var(--blue); color:#fff; }
  .guide { position:absolute; left:46px; top:16px; color:var(--blue); animation: tap 1.8s var(--ease) infinite; pointer-events:none; }
  .guide::after { content:""; position:absolute; left:2px; top:0; width:14px; height:14px; border-radius:50%; border:2px solid var(--blue); opacity:0; animation: ripple 1.8s var(--ease) infinite; }
  @keyframes tap { 0%,100% { transform: translate(60px,8px); } 45%,60% { transform: translate(0,0); } }
  @keyframes ripple { 0%,50% { opacity:0; transform:scale(.4); } 58% { opacity:.9; } 100% { opacity:0; transform:scale(2.2); } }

  .manual { margin:8px 12px 0; padding:8px; border-radius:15px; background:var(--card); display:grid; grid-template-columns: 1fr 66px 66px; gap:6px; animation: pop .35s var(--spring); }
  .manual input { min-width:0; height:32px; border:none; border-radius:9px; padding:0 6px; background:var(--fill); color:var(--label); font:inherit; font-size:13px; color-scheme: light dark; }
  .manual .row2 { grid-column: 1 / -1; display:flex; justify-content:flex-end; gap:6px; }
  .manual .row2 button { height:30px; min-width:44px; border-radius:15px; border:none; cursor:pointer; display:grid; place-items:center; padding:0 12px; }
  .manual .cancel { background:var(--fill); color:var(--label2); }
  .manual .ok { background:var(--blue); color:#fff; }

  .seg { display:flex; padding:2px; border-radius:11px; background:var(--fill); gap:2px; }
  .seg button { flex:1; min-width:0; height:32px; border:none; border-radius:9px; background:transparent; cursor:pointer; display:grid; place-items:center; color:var(--label2); padding:0 4px; font-size:12px; font-weight:600; transition: background .2s, color .2s, box-shadow .2s; white-space:nowrap; }
  .seg button.on { background:var(--card); color:var(--label); box-shadow:0 1px 3px rgba(0,0,0,.14), 0 0 0 .5px rgba(0,0,0,.04); }
  .templates { margin:12px 12px 0; }
  .templates button.on { color:var(--blue); }

  .copy-btn { margin:10px 12px 0; width:calc(100% - 24px); height:46px; border-radius:13px; border:none; background:var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; cursor:pointer; transition: background .25s, transform .25s var(--spring); }
  .copy-btn:active:not(:disabled) { transform: scale(.97); }
  .copy-btn:disabled { background:var(--fill); color:var(--label3); cursor:default; }
  .copy-btn.done { background:var(--green); }
  .copy-btn.done .i { animation: pop .4s var(--spring); }
  .copy-btn.pulse { animation: pulse .9s var(--ease) 2; }
  @keyframes pulse { 0%,100% { transform:none; } 40% { transform:scale(1.035); box-shadow:0 0 0 6px color-mix(in srgb, var(--blue) 22%, transparent); } }

  .footer { display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; padding:8px 12px 12px; }
  .footer .clear { justify-self:start; height:30px; width:auto; min-width:30px; border-radius:15px; padding:0 7px; display:flex; gap:6px; align-items:center; background:transparent; }
  .footer .clear.armed { background:var(--red); color:#fff; padding:0 12px 0 9px; font-size:12px; font-weight:600; animation: pop .3s var(--spring); }
  .footer .open-settings { justify-self:end; background:transparent; }
  .dots { display:flex; gap:5px; }
  .dots span { width:6px; height:6px; border-radius:50%; background:var(--label3); transition: background .2s, transform .3s var(--spring); }
  .dots span.on { background:var(--blue); transform:scale(1.15); }
  .dots.full span.on { background:var(--green); }

  .hud { position:absolute; left:50%; bottom:66px; transform:translate(-50%, 8px) scale(.96); max-width:calc(100% - 32px); display:flex; align-items:center; gap:7px; padding:9px 14px; border-radius:14px; background:var(--hud); color:#fff; font-size:12.5px; font-weight:500; line-height:1.35; opacity:0; pointer-events:none; transition: opacity .2s, transform .3s var(--spring); box-shadow:0 6px 20px rgba(0,0,0,.25); z-index:2; }
  .hud.show { opacity:1; transform:translate(-50%, 0) scale(1); }

  .sheet { padding:0 12px 12px; animation: sheet-in .3s var(--spring); }
  @keyframes sheet-in { from { opacity:0; transform: translateX(18px); } to { opacity:1; transform:none; } }
  .sheet-head { display:grid; grid-template-columns: 36px 1fr 36px; align-items:center; margin-bottom:8px; }
  .sheet-head .title { text-align:center; font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .search { display:flex; align-items:center; gap:6px; height:36px; border-radius:10px; background:var(--fill); padding:0 10px; color:var(--label2); }
  .search input { flex:1; min-width:0; border:none; background:transparent; font:inherit; font-size:14px; color:var(--label); outline:none; }
  .list { margin-top:8px; max-height:300px; overflow:auto; border-radius:13px; background:var(--card); }
  .section { font-size:11px; font-weight:600; color:var(--label2); text-transform:uppercase; letter-spacing:.04em; padding:10px 12px 4px; }
  .row { width:100%; min-height:44px; display:flex; align-items:center; gap:10px; padding:6px 12px; border:none; background:transparent; text-align:left; cursor:pointer; border-bottom:.5px solid var(--sep); }
  .row:last-child { border-bottom:none; }
  .row:hover { background:var(--fill2); }
  .row .main { flex:1; min-width:0; display:grid; }
  .row .a { font-size:14px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .b { font-size:11.5px; color:var(--label2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .r { font-size:12.5px; color:var(--label2); white-space:nowrap; }
  .row .ck { width:18px; color:var(--blue); visibility:hidden; }
  .row.sel .ck { visibility:visible; }
  .row .lead { color:var(--blue); }
  .row.sample .a { font-size:15px; font-weight:600; }
  .empty-list { padding:16px; text-align:center; color:var(--label2); }
  .group { background:var(--card); border-radius:13px; padding:10px 12px; display:grid; gap:12px; }
  .field { display:grid; gap:6px; }
  .field .lbl { font-size:12px; color:var(--label2); font-weight:600; }
  .mytz { display:flex; align-items:center; gap:8px; width:100%; border:none; background:var(--fill); border-radius:10px; min-height:36px; padding:0 10px; cursor:pointer; text-align:left; }
  .mytz .a { flex:1; font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mytz .r { color:var(--label2); font-size:12px; }
  .note { display:flex; gap:6px; align-items:flex-start; font-size:11.5px; color:var(--orange); line-height:1.4; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  [hidden] { display:none !important; }

  @media (prefers-reduced-motion: reduce) {
    .panel, .panel * { animation: none !important; transition: none !important; }
  }
`;

function clampToViewport(x, y, w, h) {
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {object} callbacks
 * @param {(on:boolean) => void} callbacks.onPickModeToggle
 * @param {() => void} callbacks.onCloseClick
 * @param {(x:number,y:number) => void} callbacks.onMoveEnd
 * @param {(id:string) => void} callbacks.onRemove
 * @param {() => void} callbacks.onClearAll
 * @param {(value:{date:string,start:string,end:string}) => Promise<{ok:boolean,message?:string}>} callbacks.onAddManual
 * @param {() => Promise<{ok:boolean,message?:string}>} callbacks.onCopy
 * @param {(templateId:string) => void} callbacks.onTemplateChange
 * @param {(patch:{tz?:?string, locale?:?string}) => void} callbacks.onRecipientChange
 * @param {(patch:object) => void} callbacks.onSettingsChange
 */
function createPanel(callbacks) {
  const format = lib('format', './format.js');
  const tzApi = lib('tz', './tz.js');
  const { t } = lib('i18n', './i18n.js');
  const { icon } = lib('icons', './icons.js');

  const host = document.createElement('div');
  host.id = 'gcal-schedule-memo-host';
  host.style.cssText = `all:initial; position:fixed; top:0; left:0; z-index:${Z_INDEX};`;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  root.appendChild(style);

  const panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-label', t('extName'));
  panelEl.innerHTML = `
    <div class="header">
      <button class="round pick-toggle" type="button" data-action="pick" aria-pressed="false">${icon('scope', 19)}</button>
      <div class="grabber" title="${escapeHtml(t('drag'))}"></div>
      <button class="round close-btn" type="button" data-action="close" aria-label="${escapeHtml(t('close'))}" title="${escapeHtml(t('close'))}">${icon('xmark', 14)}</button>
    </div>
    <div class="view-main">
      <div class="chips">
        <button class="chip tz" type="button" data-action="open-tz"></button>
        <button class="chip lang" type="button" data-action="open-lang"></button>
      </div>
      <ul class="slots"></ul>
      <div class="manual" hidden>
        <input data-manual="date" type="date" aria-label="${escapeHtml(t('manualDate'))}">
        <input data-manual="start" type="time" step="300" aria-label="${escapeHtml(t('manualStart'))}">
        <input data-manual="end" type="time" step="300" aria-label="${escapeHtml(t('manualEnd'))}">
        <div class="row2">
          <button type="button" class="cancel" data-action="manual-cancel" aria-label="${escapeHtml(t('cancel'))}" title="${escapeHtml(t('cancel'))}">${icon('xmark', 16)}</button>
          <button type="button" class="ok" data-action="manual-add" aria-label="${escapeHtml(t('add'))}" title="${escapeHtml(t('add'))}">${icon('check', 18)}</button>
        </div>
      </div>
      <div class="seg templates" role="radiogroup"></div>
      <button class="copy-btn" type="button" data-action="copy"></button>
      <div class="footer">
        <button class="round clear" type="button" data-action="clear" aria-label="${escapeHtml(t('clear'))}" title="${escapeHtml(t('clear'))}">${icon('trash', 18)}</button>
        <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <button class="round open-settings" type="button" data-action="open-settings" aria-label="${escapeHtml(t('settings'))}" title="${escapeHtml(t('settings'))}">${icon('sliders', 19)}</button>
      </div>
    </div>
    <div class="view-sheet" hidden></div>
    <div class="hud" role="status" aria-live="polite"></div>
  `;
  root.appendChild(panelEl);
  document.documentElement.appendChild(host);

  const $ = (sel) => panelEl.querySelector(sel);
  const headerEl = $('.header');
  const pickToggleEl = $('.pick-toggle');
  const mainView = $('.view-main');
  const sheetView = $('.view-sheet');
  const tzChipEl = $('.chip.tz');
  const langChipEl = $('.chip.lang');
  const slotsEl = $('.slots');
  const manualEl = $('.manual');
  const manualDateEl = $('[data-manual="date"]');
  const manualStartEl = $('[data-manual="start"]');
  const manualEndEl = $('[data-manual="end"]');
  const templatesEl = $('.templates');
  const copyBtnEl = $('.copy-btn');
  const clearBtnEl = $('.clear');
  const dotsEl = $('.dots');
  const hudEl = $('.hud');

  let lastState = null;
  let lastCtx = null;
  let sheet = null; // null | 'tz' | 'mytz' | 'lang' | 'settings'
  let sheetOpener = null;
  let tzQuery = '';
  let clearArmed = false;
  let clearArmedTimer = null;
  let hudTimer = null;
  let copyResetTimer = null;
  let renderedIds = null; // 直前に描画した候補ID（新しく増えた行だけを弾ませるため）

  // ---- テンプレート（アイコンのセグメント） -----------------------------------
  templatesEl.innerHTML = TEMPLATE_BUTTONS.map((b) => `
    <button type="button" role="radio" data-template-id="${b.id}" aria-label="${escapeHtml(t(b.label))}" title="${escapeHtml(t(b.label))}">${icon(b.icon, 19)}</button>
  `).join('');

  function setCopyLabel(done) {
    copyBtnEl.classList.toggle('done', !!done);
    copyBtnEl.innerHTML = done
      ? `${icon('check', 20)}<span>${escapeHtml(t('copied'))}</span>`
      : `${icon('copy', 19)}<span>${escapeHtml(t('copy'))}</span>`;
  }
  setCopyLabel(false);

  // ---- HUD（短い通知） ------------------------------------------------------
  function showToast(message, kind) {
    if (!message) return;
    const iconName = kind === 'ok' ? 'check' : 'warning';
    hudEl.innerHTML = `${icon(iconName, 16)}<span>${escapeHtml(message)}</span>`;
    hudEl.classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hudEl.classList.remove('show'), 2400);
  }

  function shake(id) {
    const target = id ? slotsEl.querySelector(`li[data-id="${CSS.escape(id)}"]`) : slotsEl;
    if (!target) return;
    target.classList.remove('shake');
    void target.offsetWidth; // アニメーションを再始動する
    target.classList.add('shake');
    setTimeout(() => target.classList.remove('shake'), 450);
  }

  function pulseCopy() {
    copyBtnEl.classList.remove('pulse');
    void copyBtnEl.offsetWidth;
    copyBtnEl.classList.add('pulse');
    setTimeout(() => copyBtnEl.classList.remove('pulse'), 1900);
  }

  function flashEntry(id) {
    const li = slotsEl.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 750);
  }

  // ---- 表示用の文字列 -------------------------------------------------------
  function uiDisplayLocale(ctx) {
    return format.normalizeLocale(ctx.uiLocale);
  }

  function intlSafe(locale, options, ms) {
    try {
      return new Intl.DateTimeFormat(locale, options).format(ms);
    } catch (_) {
      return '';
    }
  }

  function renderChips(state, ctx) {
    const nowMs = Date.now();
    const recipientSet = !ctx.recipientIsMe;
    const tz = ctx.targetTz;
    tzChipEl.classList.toggle('set', recipientSet);
    tzChipEl.innerHTML = `${icon(recipientSet ? 'globe' : 'location', 16)}<span class="t">${escapeHtml(tzApi.cityOf(tz))}</span><span class="s">${escapeHtml(tzApi.offsetLabel(tz, nowMs))}</span>`;
    const tzLabel = `${t('recipientTz')}: ${tzApi.cityOf(tz)} (${tzApi.offsetLabel(tz, nowMs)})`;
    tzChipEl.setAttribute('aria-label', tzLabel);
    tzChipEl.title = tzLabel;

    langChipEl.innerHTML = `${icon('lang', 16)}<span class="t">${escapeHtml(LOCALE_CHIP[ctx.outLocale] || ctx.outLocale)}</span>`;
    const langLabel = `${t('recipientLocale')}: ${format.formatSample(ctx.outLocale)}`;
    langChipEl.setAttribute('aria-label', langLabel);
    langChipEl.title = langLabel;
  }

  function filledSlotHtml(entry, ctx, isNew) {
    const uiLoc = uiDisplayLocale(ctx);
    const own = format.slotParts(entry, { locale: uiLoc, targetTz: ctx.myTz, sourceTz: ctx.myTz });
    const ownLine = format.formatSlot(entry, { locale: uiLoc, targetTz: ctx.myTz, sourceTz: ctx.myTz });
    const z = own.slot.start;
    const intlLoc = uiLoc === 'ja' ? 'ja' : uiLoc;
    const monthMs = Date.UTC(z.y, z.m - 1, 15);
    const month = intlSafe(intlLoc, { month: 'short', timeZone: 'UTC' }, monthMs);
    const weekday = intlSafe(intlLoc, { weekday: 'short', timeZone: 'UTC' }, Date.UTC(z.y, z.m - 1, z.d));

    const theirOpts = { locale: ctx.outLocale, targetTz: ctx.targetTz, sourceTz: ctx.myTz };
    const their = format.slotParts(entry, theirOpts);
    const theirLine = format.formatSlot(entry, theirOpts);

    let flag = '';
    if (entry.confidence === 'low' || entry.warning) {
      const level = entry.confidence === 'low' ? 'low' : 'medium';
      // v1で保存された警告は日本語の文章そのもの。コード（英数字）のときだけ i18n を引く。
      const isCode = /^[A-Za-z0-9_]+$/.test(entry.warning || '');
      const warnText = entry.warning
        ? ((isCode && t(`warn_${entry.warning}`)) || entry.warning)
        : t('warn_timeFromPosition');
      flag = `<span class="flag ${level}" title="${escapeHtml(warnText)}" aria-label="${escapeHtml(warnText)}">${icon('warning', 14)}</span>`;
    }

    let theirHtml = '';
    if (!ctx.recipientIsMe) {
      const band = their.slot.band;
      const shift = their.slot.dayShift;
      const shiftHtml = shift
        ? `<span class="shift" title="${escapeHtml(t(shift > 0 ? 'dayNext' : 'dayPrev'))}">${shift > 0 ? '+1' : '−1'}</span>`
        : '';
      theirHtml = `
        <div class="their" title="${escapeHtml(`${t('theirTime')}: ${theirLine}`)}">
          <span class="band-${band}" title="${escapeHtml(t(`band_${band}`))}" aria-label="${escapeHtml(t(`band_${band}`))}">${icon(BAND_ICON[band], 14)}</span>
          <span class="tt">${escapeHtml(their.time)}${their.tzName ? ` ${escapeHtml(their.tzName)}` : ''}</span>${shiftHtml}
        </div>`;
    }

    return `
      <li class="slot filled entry${isNew ? ' new' : ''}" data-id="${escapeHtml(entry.id)}" title="${escapeHtml(theirLine)}">
        <div class="tile" aria-hidden="true"><span class="m">${escapeHtml(month)}</span><span class="d">${z.d}</span></div>
        <div class="info">
          <span class="entry-text sr">${escapeHtml(ownLine)}</span>
          <div class="own" aria-hidden="true"><span class="wd">${escapeHtml(weekday)}</span><span class="time">${escapeHtml(own.time)}</span>${flag}</div>
          ${theirHtml}
        </div>
        <button class="remove entry-remove" type="button" data-action="remove" aria-label="${escapeHtml(t('remove'))}" title="${escapeHtml(t('remove'))}">${icon('minus', 16)}</button>
      </li>`;
  }

  function emptySlotHtml(index, isNext, showGuide) {
    return `
      <li class="slot empty${isNext ? ' next' : ''}" data-slot="${index + 1}" title="${escapeHtml(t('slotEmpty'))}">
        <span class="num" aria-hidden="true">${index + 1}</span>
        <span class="hint" aria-hidden="true"><span class="line"></span></span>
        <button class="add" type="button" data-action="manual-open" aria-label="${escapeHtml(t('addManual'))}" title="${escapeHtml(t('addManual'))}">${icon('plus', 16)}</button>
        ${showGuide ? `<span class="guide" aria-hidden="true">${icon('cursor', 18)}</span>` : ''}
      </li>`;
  }

  function sortedEntries(entries, ctx) {
    return entries
      .map((entry) => ({ entry, at: format.computeSlot(entry, { sourceTz: ctx.myTz }).startMs }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.entry);
  }

  function renderSlots(state, ctx) {
    const entries = sortedEntries(state.entries, ctx);
    const showGuide = !state.settings.onboarded && state.panel.pickMode && entries.length === 0;
    let html = '';
    for (let i = 0; i < MAX_SLOTS; i += 1) {
      html += entries[i]
        ? filledSlotHtml(entries[i], ctx, !!renderedIds && !renderedIds.has(entries[i].id))
        : emptySlotHtml(i, i === entries.length, showGuide && i === 0);
    }
    renderedIds = new Set(entries.map((e) => e.id));
    slotsEl.innerHTML = html;
    slotsEl.setAttribute('aria-label', `${entries.length} / ${MAX_SLOTS}`);
    const dots = dotsEl.querySelectorAll('span');
    dots.forEach((d, i) => d.classList.toggle('on', i < entries.length));
    dotsEl.classList.toggle('full', entries.length >= MAX_SLOTS);
    copyBtnEl.disabled = entries.length === 0;
  }

  function renderTemplates(state) {
    const current = state.settings.templateId || 'schedule-request';
    templatesEl.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.templateId === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  // ---- シート ---------------------------------------------------------------
  function sheetHead(title) {
    return `
      <div class="sheet-head">
        <button class="round" type="button" data-action="sheet-back" aria-label="${escapeHtml(t('back'))}" title="${escapeHtml(t('back'))}">${icon('back', 16)}</button>
        <div class="title">${escapeHtml(title)}</div>
        <span></span>
      </div>`;
  }

  function tzRow(tz, selected, extra) {
    const nowMs = Date.now();
    return `
      <button class="row${selected ? ' sel' : ''}" type="button" data-tz="${escapeHtml(tz)}"${extra && extra.locale ? ` data-locale="${escapeHtml(extra.locale)}"` : ''}>
        <span class="main"><span class="a">${escapeHtml(tzApi.cityOf(tz))}</span><span class="b">${escapeHtml(extra && extra.sub ? extra.sub : tz.replace(/_/g, ' '))}</span></span>
        <span class="r">${escapeHtml(tzApi.offsetLabel(tz, nowMs))}</span>
        <span class="ck">${icon('check', 18)}</span>
      </button>`;
  }

  function renderTzList(listEl, mode) {
    const state = lastState;
    const ctx = lastCtx;
    const selectedTz = mode === 'mytz' ? state.settings.myTz : state.settings.recipient.tz;
    let html = '';
    if (!tzQuery) {
      const autoLabel = mode === 'mytz' ? t('auto') : t('sameAsMe');
      const autoSub = mode === 'mytz' ? tzApi.localTz() : ctx.myTz;
      html += `
        <button class="row${!selectedTz ? ' sel' : ''}" type="button" data-tz="">
          <span class="lead">${icon('location', 18)}</span>
          <span class="main"><span class="a">${escapeHtml(autoLabel)}</span><span class="b">${escapeHtml(tzApi.cityOf(autoSub))} · ${escapeHtml(tzApi.offsetLabel(autoSub))}</span></span>
          <span class="ck">${icon('check', 18)}</span>
        </button>`;
      const recent = mode === 'tz' ? (state.settings.recentRecipients || []).filter((r) => tzApi.isValidTz(r.tz)) : [];
      if (recent.length) {
        html += `<div class="section">${escapeHtml(t('recent'))}</div>`;
        for (const r of recent) {
          html += tzRow(r.tz, false, { locale: r.locale || '', sub: `${r.tz.replace(/_/g, ' ')}${r.locale ? ` · ${LOCALE_CHIP[r.locale] || r.locale}` : ''}` });
        }
        html += `<div class="section">${escapeHtml(t('recipientTz'))}</div>`;
      }
    }
    const results = tzApi.searchTimeZones(tzQuery, { limit: 60 });
    if (!results.length) {
      html += `<div class="empty-list">${escapeHtml(t('noResults'))}</div>`;
    }
    for (const r of results) html += tzRow(r.tz, r.tz === selectedTz, { sub: r.region ? `${r.region} · ${r.tz.replace(/_/g, ' ')}` : r.tz });
    listEl.innerHTML = html;
  }

  function renderSheet() {
    if (!sheet || !lastState) return;
    const state = lastState;
    const ctx = lastCtx;
    if (sheet === 'tz' || sheet === 'mytz') {
      const title = sheet === 'mytz' ? t('setMyTz') : t('recipientTz');
      const hadFocus = sheetView.querySelector('input[data-role="tz-search"]') === root.activeElement;
      if (!sheetView.querySelector('input[data-role="tz-search"]') || sheetView.dataset.kind !== sheet) {
        sheetView.dataset.kind = sheet;
        sheetView.innerHTML = `
          <div class="sheet">
            ${sheetHead(title)}
            <label class="search">${icon('search', 16)}<input data-role="tz-search" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('searchTz'))}" aria-label="${escapeHtml(t('searchTz'))}"></label>
            <div class="list" role="list"></div>
          </div>`;
        const input = sheetView.querySelector('input');
        input.value = tzQuery;
        input.addEventListener('input', () => {
          tzQuery = input.value;
          renderTzList(sheetView.querySelector('.list'), sheet);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            const first = sheetView.querySelector('.list .row');
            if (first) first.click();
          }
        });
      }
      renderTzList(sheetView.querySelector('.list'), sheet);
      if (hadFocus) sheetView.querySelector('input').focus();
      return;
    }
    sheetView.dataset.kind = sheet;
    if (sheet === 'lang') {
      const display = (() => {
        try { return new Intl.DisplayNames([ctx.uiLocale], { type: 'language' }); } catch (_) { return null; }
      })();
      const rows = format.OUTPUT_LOCALES.map((loc) => {
        const name = (display && display.of(loc)) || loc;
        return `
          <button class="row sample${loc === ctx.outLocale ? ' sel' : ''}" type="button" data-locale="${loc}">
            <span class="main"><span class="a">${escapeHtml(format.formatSample(loc))}</span><span class="b">${escapeHtml(name)}</span></span>
            <span class="ck">${icon('check', 18)}</span>
          </button>`;
      }).join('');
      sheetView.innerHTML = `<div class="sheet">${sheetHead(t('recipientLocale'))}<div class="list">${rows}</div></div>`;
      return;
    }
    if (sheet === 'settings') {
      const s = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
      const uiLoc = ctx.uiLocale;
      const seg = (key, values, labelFn) => `<div class="seg" role="radiogroup">${values.map((v) => `
        <button type="button" role="radio" data-setting="${key}" data-value="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}" aria-checked="${String(s[key]) === String(v)}">${labelFn(v)}</button>`).join('')}</div>`;
      const chipSeg = `<div class="seg" role="radiogroup">${CHIP_MODE_OPTIONS.map((o) => `
        <button type="button" role="radio" data-setting="chipMode" data-value="${o.value}" class="${s.chipMode === o.value ? 'on' : ''}" aria-checked="${s.chipMode === o.value}" aria-label="${escapeHtml(t(o.label))}" title="${escapeHtml(t(o.label))}">${icon(o.icon, 19)}</button>`).join('')}</div>`;
      const myTz = ctx.myTz;
      const mismatch = ctx.tzMismatchLabel
        ? `<div class="note">${icon('warning', 14)}<span>${escapeHtml(t('tzMismatch', ctx.tzMismatchLabel))}</span></div>`
        : '';
      sheetView.innerHTML = `
        <div class="sheet">
          ${sheetHead(t('settings'))}
          <div class="group">
            <div class="field"><span class="lbl">${escapeHtml(t('setDuration'))}</span>${seg('durationMin', DURATION_OPTIONS, (v) => escapeHtml(format.formatDuration(v, uiLoc)))}</div>
            <div class="field"><span class="lbl">${escapeHtml(t('setSnap'))}</span>${seg('snapMin', SNAP_OPTIONS, (v) => escapeHtml(format.formatDuration(v, uiLoc)))}</div>
            <div class="field"><span class="lbl">${escapeHtml(t('setChipMode'))}</span>${chipSeg}</div>
            <div class="field"><span class="lbl">${escapeHtml(t('setMyTz'))}</span>
              <button class="mytz" type="button" data-action="open-mytz">${icon(s.myTz ? 'globe' : 'location', 16)}<span class="a">${escapeHtml(s.myTz ? tzApi.cityOf(myTz) : `${t('auto')} · ${tzApi.cityOf(myTz)}`)}</span><span class="r">${escapeHtml(tzApi.offsetLabel(myTz))}</span>${icon('chevronRight', 14)}</button>
              ${mismatch}
            </div>
          </div>
        </div>`;
    }
  }

  function hideToast() {
    clearTimeout(hudTimer);
    hudEl.classList.remove('show');
  }

  function openSheet(kind, opener) {
    hideToast();
    sheet = kind;
    if (opener) sheetOpener = opener;
    if (kind === 'tz' || kind === 'mytz') tzQuery = '';
    sheetView.innerHTML = '';
    sheetView.dataset.kind = '';
    mainView.hidden = true;
    sheetView.hidden = false;
    renderSheet();
    const focusTarget = sheetView.querySelector('input[data-role="tz-search"]') || sheetView.querySelector('.row.sel') || sheetView.querySelector('button');
    if (focusTarget) focusTarget.focus();
  }

  function closeSheet() {
    if (!sheet) return false;
    // 自分のタイムゾーンの選択は設定シートから開くので、閉じたら設定へ戻る。
    if (sheet === 'mytz') {
      openSheet('settings');
      return true;
    }
    hideToast();
    sheet = null;
    sheetView.hidden = true;
    sheetView.innerHTML = '';
    mainView.hidden = false;
    if (sheetOpener && sheetOpener.isConnected) sheetOpener.focus();
    sheetOpener = null;
    return true;
  }

  sheetView.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'sheet-back') {
      closeSheet();
      return;
    }
    if (btn.dataset.action === 'open-mytz') {
      openSheet('mytz');
      return;
    }
    if (btn.dataset.setting) {
      const key = btn.dataset.setting;
      const value = key === 'chipMode' ? btn.dataset.value : Number(btn.dataset.value);
      callbacks.onSettingsChange({ [key]: value });
      return;
    }
    if (sheet === 'lang' && btn.dataset.locale) {
      callbacks.onRecipientChange({ locale: btn.dataset.locale });
      closeSheet();
      return;
    }
    if ((sheet === 'tz' || sheet === 'mytz') && btn.hasAttribute('data-tz')) {
      const tz = btn.dataset.tz || null;
      if (sheet === 'mytz') {
        callbacks.onSettingsChange({ myTz: tz });
      } else {
        const patch = { tz };
        if (btn.dataset.locale) patch.locale = btn.dataset.locale;
        callbacks.onRecipientChange(patch);
      }
      closeSheet();
    }
  });

  // ---- 描画 -----------------------------------------------------------------
  /**
   * @param {object} state
   * @param {{myTz:string, targetTz:string, recipientIsMe:boolean, outLocale:string, uiLocale:string, tzMismatchLabel:?string}} ctx
   */
  function render(state, ctx) {
    lastState = state;
    lastCtx = ctx;
    host.style.display = state.panel.visible ? 'block' : 'none';
    if (state.panel.x != null && state.panel.y != null) {
      const clamped = clampToViewport(state.panel.x, state.panel.y, panelEl.offsetWidth || PANEL_WIDTH, panelEl.offsetHeight || 360);
      panelEl.style.left = `${clamped.x}px`;
      panelEl.style.top = `${clamped.y}px`;
      panelEl.style.right = 'auto';
    } else {
      panelEl.style.right = '24px';
      panelEl.style.top = '88px';
      panelEl.style.left = 'auto';
    }
    const pickOn = !!state.panel.pickMode;
    pickToggleEl.classList.toggle('on', pickOn);
    pickToggleEl.setAttribute('aria-pressed', pickOn ? 'true' : 'false');
    const pickLabel = t(pickOn ? 'pickOn' : 'pickOff');
    pickToggleEl.setAttribute('aria-label', pickLabel);
    pickToggleEl.title = pickLabel;

    renderChips(state, ctx);
    renderSlots(state, ctx);
    renderTemplates(state);
    if (sheet) renderSheet();
  }

  // ---- イベント -------------------------------------------------------------
  pickToggleEl.addEventListener('click', () => callbacks.onPickModeToggle(!pickToggleEl.classList.contains('on')));
  $('.close-btn').addEventListener('click', () => {
    closeSheet();
    callbacks.onCloseClick();
  });
  tzChipEl.addEventListener('click', () => openSheet('tz', tzChipEl));
  langChipEl.addEventListener('click', () => openSheet('lang', langChipEl));
  $('.open-settings').addEventListener('click', (event) => openSheet('settings', event.currentTarget));

  templatesEl.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-template-id]');
    if (btn) callbacks.onTemplateChange(btn.dataset.templateId);
  });

  slotsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.action === 'remove') {
      const li = btn.closest('li[data-id]');
      if (li) callbacks.onRemove(li.dataset.id);
    } else if (btn.dataset.action === 'manual-open') {
      manualEl.hidden = false;
      manualDateEl.focus();
    }
  });

  copyBtnEl.addEventListener('click', async () => {
    const result = await callbacks.onCopy();
    if (result.ok) {
      setCopyLabel(true);
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => setCopyLabel(false), 1400);
    } else {
      showToast(result.message || t('copyFailed'));
    }
  });

  function resetManual() {
    manualDateEl.value = '';
    manualStartEl.value = '';
    manualEndEl.value = '';
    manualEl.hidden = true;
  }

  manualStartEl.addEventListener('change', () => {
    // 開始を入れたら、終了を「開始＋既定の長さ」で自動補完する（入力の手数を減らす）。
    if (!manualStartEl.value || manualEndEl.value || !lastState) return;
    const [h, m] = manualStartEl.value.split(':').map(Number);
    const end = h * 60 + m + (lastState.settings.durationMin || 60);
    if (end < 1440) manualEndEl.value = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  });

  $('[data-action="manual-cancel"]').addEventListener('click', resetManual);
  $('[data-action="manual-add"]').addEventListener('click', async () => {
    const result = await callbacks.onAddManual({ date: manualDateEl.value, start: manualStartEl.value, end: manualEndEl.value });
    if (result.ok) {
      resetManual();
    } else {
      showToast(result.message || t('err_invalidManual'));
      if (result.shake) shake();
    }
  });
  manualEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('[data-action="manual-add"]').click();
  });

  function disarmClear() {
    clearTimeout(clearArmedTimer);
    clearArmed = false;
    clearBtnEl.classList.remove('armed');
    clearBtnEl.innerHTML = icon('trash', 18);
  }
  clearBtnEl.addEventListener('click', () => {
    if (!clearArmed) {
      if (!lastState || !lastState.entries.length) return;
      clearArmed = true;
      clearBtnEl.classList.add('armed');
      clearBtnEl.innerHTML = `${icon('trash', 16)}<span>${escapeHtml(t('clearConfirm'))}</span>`;
      clearArmedTimer = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    callbacks.onClearAll();
  });

  // パネル内のキー操作をページ（Googleカレンダーのショートカット）へ漏らさない。
  ['keydown', 'keyup', 'keypress'].forEach((type) => {
    panelEl.addEventListener(type, (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    });
  });

  // ---- ドラッグ移動 ---------------------------------------------------------
  let dragState = null;
  headerEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
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

  return {
    host,
    render,
    showToast,
    flashEntry,
    shake,
    pulseCopy,
    closeSheet,
    isSheetOpen: () => !!sheet,
    destroy() { host.remove(); }
  };
}

const api = { createPanel, clampToViewport, Z_INDEX, MAX_SLOTS };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.panel = api;
}

})();
