/**
 * src/icons.js — SF Symbols 風のインラインSVGアイコン（外部フォント・外部通信なし）
 *
 * 目的:
 *   文字に頼らず意味が伝わるUIにするため、操作はすべてアイコンで表す。
 *   線幅・角丸を揃えた24pxグリッドの自作パスで、currentColor で着色する。
 *   文字（aria-label / title）は i18n 側で必ず併記する。
 */
'use strict';

(function () {

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // 取得モード（照準）
  scope: `<circle cx="12" cy="12" r="7" ${STROKE}/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" ${STROKE}/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`,
  xmark: `<path d="M7 7l10 10M17 7L7 17" ${STROKE}/>`,
  globe: `<circle cx="12" cy="12" r="8.5" ${STROKE}/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z" ${STROKE}/>`,
  // 言語・表記（吹き出し＋文字）
  lang: `<path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V17h-2A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z" ${STROKE}/><path d="M8.5 14l2.2-5.5 2.2 5.5M9.3 12.3h2.8M14.5 9.2h2.5" ${STROKE}/>`,
  plus: `<path d="M12 5.5v13M5.5 12h13" ${STROKE}/>`,
  minus: `<path d="M6 12h12" ${STROKE}/>`,
  // 候補のみ（箇条書き）
  list: `<circle cx="5.5" cy="7" r="1.3" fill="currentColor"/><circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="5.5" cy="17" r="1.3" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10" ${STROKE}/>`,
  // 候補日を送る（紙飛行機）
  send: `<path d="M20.5 3.5L3.5 10.6l6.8 2.6 2.6 6.8 7.6-16.5zM10.3 13.2l4.4-4.4" ${STROKE}/>`,
  // 再調整（循環矢印）
  reschedule: `<path d="M19 8.5A7.5 7.5 0 0 0 5.6 7M5 15.5A7.5 7.5 0 0 0 18.4 17" ${STROKE}/><path d="M19.5 4v4.8h-4.8M4.5 20v-4.8h4.8" ${STROKE}/>`,
  // オンライン（ビデオ）
  video: `<rect x="3" y="6.5" width="12.5" height="11" rx="2.5" ${STROKE}/><path d="M15.5 10.5l5-3v9l-5-3z" ${STROKE}/>`,
  copy: `<rect x="8" y="8" width="12" height="12" rx="2.5" ${STROKE}/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" ${STROKE}/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  trash: `<path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7M6.5 6.5l.8 12.2c.1 1 .9 1.8 1.9 1.8h5.6c1 0 1.8-.8 1.9-1.8l.8-12.2M10 10.5v6M14 10.5v6" ${STROKE}/>`,
  // 設定（スライダー）
  sliders: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9" ${STROKE}/><circle cx="15" cy="7" r="2.2" ${STROKE}/><circle cx="9" cy="17" r="2.2" ${STROKE}/>`,
  sun: `<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" ${STROKE}/>`,
  sunrise: `<path d="M7.5 16a4.5 4.5 0 0 1 9 0z" fill="currentColor"/><path d="M3 19.5h18M12 6v3M5.6 9.6l1.6 1.6M18.4 9.6l-1.6 1.6M3.5 16h1.5M19 16h1.5" ${STROKE}/>`,
  moon: `<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" fill="currentColor"/>`,
  location: `<path d="M20 4L4 11.2l6.8 2 2 6.8z" fill="currentColor"/>`,
  back: `<path d="M15 5l-7 7 7 7" ${STROKE}/>`,
  chevronRight: `<path d="M9.5 6l6 6-6 6" ${STROKE}/>`,
  search: `<circle cx="10.5" cy="10.5" r="6" ${STROKE}/><path d="M15 15l5 5" ${STROKE}/>`,
  warning: `<path d="M12 3.8L2.8 19.5h18.4z" fill="currentColor"/><path d="M12 9.5v4.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.1" fill="#fff"/>`,
  // 予定クリック: 予定全体 / クリック位置から
  chipWhole: `<rect x="5" y="3.5" width="14" height="17" rx="2.5" ${STROKE}/><rect x="7.5" y="6" width="9" height="12" rx="1.2" fill="currentColor"/>`,
  chipSlice: `<rect x="5" y="3.5" width="14" height="17" rx="2.5" ${STROKE}/><rect x="7.5" y="10" width="9" height="5" rx="1.2" fill="currentColor"/><path d="M2.5 12.5h2" ${STROKE}/>`,
  // 初回ガイド（カーソル）
  cursor: `<path d="M6 3.5l12 7.2-5.3 1.3 3.2 5.9-2.4 1.3-3.2-5.9L6 17.5z" fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`
};

/**
 * アイコンのSVG文字列を返す（装飾扱い: aria-hidden）。
 * @param {string} name
 * @param {number} [size]
 * @returns {string}
 */
function icon(name, size) {
  const s = size || 20;
  const body = PATHS[name] || '';
  return `<svg class="i i-${name}" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const api = { icon, NAMES: Object.keys(PATHS) };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.icons = api;
}

})();
