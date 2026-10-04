/**
 * src/extract.js — DOM要素から日時エントリを取り出す（階層フォールバック＋確信度算出）
 *
 * 目的:
 *   予定チップ、または空きマスのクリックから
 *   { y, m, d, sh, sm, eh, em, confidence, source, warning? } を作る。
 *   このファイルだけが実DOM（Googleカレンダーの構造）に依存する。
 *   クラス名など変わりやすい情報は最後のフォールバックとしてのみ使い、
 *   data-datekey / data-eventid / role / インラインstyle という
 *   比較的安定した層を主軸に置く。
 *
 * v1.2.0 の変更点:
 *   - 時刻目盛りラベルの判定を厳密化（"28" "1" などの日付数字を拾わない）。
 *     これが「クリック位置から時刻を算出できませんでした」の原因だった。
 *   - 空きマスのクリックは、クリック位置を含む枠（snapMin 単位）に切り捨てる。
 *   - 予定ブロックのクリックを2モードに対応:
 *       chipMode 'whole' : 予定全体（従来どおり）
 *       chipMode 'slice' : クリックした位置を含む durationMin 分だけを切り出す
 *     プレビューと確定値は resolveChipPreview 1箇所で計算し、ずれない。
 *
 * v2.0.0 の変更点:
 *   - エラー/警告は言語に依存しないコード（ERR / WARN）で返し、文言は i18n 側で引く。
 *   - チップのラベルがどの言語でも読めない場合、チップ自身の矩形を所属列の
 *     グリッド幾何（buildGridGeometry）で時刻に換算する（確度 medium）。
 *     これで Google カレンダーの表示言語を問わず時刻を取得できる。
 *   - 時刻目盛りの探索を TreeWalker（短いテキストノードだけ）に変え、結果を
 *     キャッシュする（スクロール/リサイズ時は invalidateCaches() で破棄）。
 *     以前は pointermove のたびに全要素の矩形を取得しており重かった。
 *
 * どの層でも日時が確定できない場合は必ず {error} を返し、値を捏造しない。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言（require()で分割代入するdecodeDatekeyAttr等を含む）が
// 他ファイルの同名のトップレベル宣言と衝突しないようにする。
(function () {

const { decodeDatekeyAttr, parseDateLabel } = (typeof module !== 'undefined')
  ? require('./datekey.js')
  : globalThis.GSM.datekey;
const { parseTimeRange, isAllDayLabel } = (typeof module !== 'undefined')
  ? require('./timeparse.js')
  : globalThis.GSM.timeparse;
const { buildGridGeometry, yToMinutes, snapMinutes, minutesToHm, looksLikeAllDayRow } =
  (typeof module !== 'undefined') ? require('./geometry.js') : globalThis.GSM.geometry;

// ---------------------------------------------------------------------------
// キャリブレーション対象の設定値（probe.js の結果を見て調整する）
// ---------------------------------------------------------------------------
const CONFIG = {
  // 予定チップと判定する要素のセレクタ。
  CHIP_SELECTOR: '[data-eventid]',
  // 日付を符号化した属性を持つ要素のセレクタ。
  DATEKEY_SELECTOR: '[data-datekey]',
  // sr-only（スクリーンリーダー専用）ラベルを持つ子要素の候補セレクタ。
  // 先頭から順に試し、最初に非空のテキストが取れたものを使う。
  CHIP_LABEL_SELECTORS: ['.XuJrye', '[aria-hidden="false"]'],
  // 時刻目盛りラベルを探す範囲。広すぎると日付数字などのノイズを拾う。
  GRID_ROOT_SELECTOR: '[role="main"]',
  // タスク/リマインダー等、日程調整の対象にしないチップを弾くための
  // data-eventid の接頭辞（Base64エンコードされているため前方一致で判定できる
  // 保証はない。分かる範囲でのベストエフォート）。
  EXCLUDE_EVENTID_PREFIXES: ['tasks_'],
  DEFAULT_DURATION_MIN: 60,
  SNAP_MIN: 15,
  // 予定ブロッククリック時の既定モード: 'whole'（予定全体）| 'slice'（クリック位置のdurationMin分）
  DEFAULT_CHIP_MODE: 'whole',
  // ラベルが読めないチップを位置から換算するときの丸め単位（分）
  CHIP_GEOMETRY_SNAP_MIN: 5,
  // 時刻目盛りキャッシュの寿命（ms）。スクロール/リサイズでは即時破棄する。
  HOUR_CACHE_TTL_MS: 500
};

// エラーコード（文言は _locales の err_* を引く）
const ERR = {
  EXCLUDED: 'excluded',
  ALL_DAY: 'allDay',
  NO_DATE: 'noDate',
  NO_TIME: 'noTime',
  MULTI_DAY: 'multiDay',
  NO_COLUMN: 'noColumn',
  ALL_DAY_ROW: 'allDayRow',
  NO_TIME_AT_POINT: 'noTimeAtPoint',
  CROSSES_MIDNIGHT: 'crossesMidnight'
};

// 警告コード（文言は _locales の warn_* を引く）
const WARN = {
  DATE_FROM_LABEL: 'dateFromLabel',
  TIME_FROM_POSITION: 'timeFromPosition',
  TZ_MISMATCH: 'tzMismatch'
};

/**
 * クリック地点から最も近い data-datekey 祖先を探す。
 * @param {Element} el
 * @returns {{el: Element, decoded: {y:number,m:number,d:number}} | null}
 */
function findDatekeyAncestor(el) {
  let cur = el;
  while (cur) {
    if (cur.hasAttribute && cur.hasAttribute('data-datekey')) {
      const decoded = decodeDatekeyAttr(cur.getAttribute('data-datekey'));
      if (decoded) return { el: cur, decoded };
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * チップのアクセシブルなラベルテキストを取得する。
 * .XuJrye 等の候補セレクタ→aria-label→textContent の順に試す。
 * @param {Element} chip
 * @returns {string}
 */
function getChipLabelText(chip) {
  for (const sel of CONFIG.CHIP_LABEL_SELECTORS) {
    const found = chip.querySelector(sel);
    if (found && found.textContent && found.textContent.trim()) {
      return found.textContent.trim();
    }
  }
  const ariaLabel = chip.getAttribute && chip.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  return (chip.textContent || '').trim();
}

/**
 * このチップが日程調整の対象外（タスク等）かどうか。
 * @param {Element} chip
 * @returns {boolean}
 */
function isExcludedChip(chip) {
  const eventId = chip.getAttribute && chip.getAttribute('data-eventid');
  if (!eventId) return false;
  return CONFIG.EXCLUDE_EVENTID_PREFIXES.some((p) => eventId.toLowerCase().startsWith(p));
}

/**
 * ラベルが読めないチップの時刻を、チップの矩形と所属列のグリッド幾何から求める。
 * 列の高さが24時間分として妥当（column-span モデルが成立）な場合だけ使う。
 * @param {Element} chip
 * @param {?Element} columnEl data-datekey を持つ列要素
 * @returns {{sh:number,sm:number,eh:number,em:number} | null}
 */
function timeFromChipGeometry(chip, columnEl) {
  if (!chip || !columnEl || typeof chip.getBoundingClientRect !== 'function') return null;
  const chipRect = chip.getBoundingClientRect();
  const colRect = columnEl.getBoundingClientRect();
  if (!(chipRect.height > 0)) return null;
  const geometry = buildGridGeometry(colRect, []);
  if (geometry.model !== 'column-span') return null;
  const snap = CONFIG.CHIP_GEOMETRY_SNAP_MIN;
  const startMin = snapMinutes(yToMinutes(chipRect.top, geometry), snap, 'nearest');
  const endMin = snapMinutes(yToMinutes(chipRect.top + chipRect.height, geometry), snap, 'nearest');
  const s = minutesToHm(startMin);
  const e = minutesToHm(endMin);
  if (!s || !e || endMin <= startMin) return null;
  return { sh: s.h, sm: s.m, eh: e.h, em: e.m };
}

/**
 * 予定チップのクリックから日時エントリ（予定全体）を抽出する。
 * @param {Element} chip
 * @returns {object} Pick または {error: string}
 */
function extractFromChip(chip) {
  if (isExcludedChip(chip)) {
    return { error: ERR.EXCLUDED };
  }

  const labelText = getChipLabelText(chip);

  if (isAllDayLabel(labelText)) {
    return { error: ERR.ALL_DAY };
  }

  // --- 日付レイヤ ---------------------------------------------------------
  let dateResult = null;
  let dateSource = null;

  const datekeyHit = findDatekeyAncestor(chip);
  if (datekeyHit) {
    dateResult = datekeyHit.decoded;
    dateSource = 'datekey';
  } else {
    const parsed = parseDateLabel(labelText);
    if (parsed) {
      dateResult = parsed;
      dateSource = 'label';
    }
  }

  if (!dateResult) {
    return { error: ERR.NO_DATE };
  }

  // --- 時刻レイヤ -----------------------------------------------------------
  let timeResult = parseTimeRange(labelText);
  let timeSource = 'label';
  if (!timeResult && datekeyHit) {
    timeResult = timeFromChipGeometry(chip, datekeyHit.el);
    timeSource = 'geometry';
  }
  if (!timeResult) {
    return { error: ERR.NO_TIME };
  }

  if (
    timeResult.eh < timeResult.sh ||
    (timeResult.eh === timeResult.sh && timeResult.em <= timeResult.sm)
  ) {
    return { error: ERR.MULTI_DAY };
  }

  const confident = dateSource === 'datekey' && timeSource === 'label';
  const confidence = confident ? 'high' : 'medium';
  let warning;
  if (dateSource !== 'datekey') warning = WARN.DATE_FROM_LABEL;
  else if (timeSource !== 'label') warning = WARN.TIME_FROM_POSITION;

  return {
    y: dateResult.y,
    m: dateResult.m,
    d: dateResult.d,
    sh: timeResult.sh,
    sm: timeResult.sm,
    eh: timeResult.eh,
    em: timeResult.em,
    confidence,
    source: 'chip',
    warning
  };
}

/**
 * 予定ブロックのクリックから、追加される値(pick)とハイライト矩形(rect)を返す。
 *
 * chipMode 'whole': 予定全体（rect はチップ自身の矩形）。
 * chipMode 'slice': チップ内のクリック位置を時刻に換算し、snapMin 単位に切り捨てた
 *                   位置から durationMin 分だけを切り出す。
 *                   チップ自身の矩形が「開始〜終了」を線形に表している性質を使うので、
 *                   時刻目盛りや列の矩形（DOM構造）に依存しない。
 *                   予定が durationMin 以下なら予定全体を返す。
 *                   切り出しは常に予定の範囲内に収め、長さは durationMin を保つ。
 * @param {Element} chip
 * @param {{clientY:number}} pointer
 * @param {{chipMode?:string, durationMin?:number, snapMin?:number}} [options]
 * @returns {{pick: object, rect: ?{top:number,left:number,width:number,height:number}}}
 */
function resolveChipPreview(chip, pointer, options) {
  const mode = (options && options.chipMode) || CONFIG.DEFAULT_CHIP_MODE;
  const durationMin = (options && options.durationMin) || CONFIG.DEFAULT_DURATION_MIN;
  const snapMin = (options && options.snapMin) || CONFIG.SNAP_MIN;

  const whole = extractFromChip(chip);
  if (whole.error) return { pick: whole, rect: null };

  const chipRect = chip.getBoundingClientRect();
  const wholeRect = {
    left: chipRect.left, top: chipRect.top, width: chipRect.width, height: chipRect.height
  };
  if (mode !== 'slice') return { pick: whole, rect: wholeRect };

  const startMin = whole.sh * 60 + whole.sm;
  const endMin = whole.eh * 60 + whole.em;
  const spanMin = endMin - startMin;

  // 予定が切り出し長以下、または矩形が不正なら、切り出さず全体を返す。
  if (spanMin <= durationMin || !(chipRect.height > 0) || !pointer || !Number.isFinite(pointer.clientY)) {
    return { pick: whole, rect: wholeRect };
  }

  const ratio = Math.min(1, Math.max(0, (pointer.clientY - chipRect.top) / chipRect.height));
  const clickedMin = startMin + ratio * spanMin;
  const rawStart = snapMinutes(clickedMin, snapMin, 'floor');
  const sliceStart = Math.min(Math.max(rawStart, startMin), endMin - durationMin);
  const sliceEnd = sliceStart + durationMin;

  const s = minutesToHm(sliceStart);
  const e = minutesToHm(sliceEnd);
  if (!s || !e) return { pick: whole, rect: wholeRect };

  const pick = Object.assign({}, whole, {
    sh: s.h, sm: s.m, eh: e.h, em: e.m,
    source: 'chip-slice'
  });
  const rect = {
    left: chipRect.left,
    width: chipRect.width,
    top: chipRect.top + ((sliceStart - startMin) / spanMin) * chipRect.height,
    height: (durationMin / spanMin) * chipRect.height
  };
  return { pick, rect };
}

/**
 * clientX/Y から、対応する日付列の要素を解決する。
 * closest → elementsFromPoint の順でフォールバックする。
 * @param {Element} directTarget e.target（既に closest 済みの場合はそのまま使う）
 * @param {number} clientX
 * @param {number} clientY
 * @param {Document} doc
 * @returns {{el: Element, decoded: {y:number,m:number,d:number}} | null}
 */
function resolveDateColumn(directTarget, clientX, clientY, doc) {
  const direct = findDatekeyAncestor(directTarget);
  if (direct) return direct;

  if (doc && typeof doc.elementsFromPoint === 'function') {
    const stack = doc.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      const hit = findDatekeyAncestor(el);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 時刻目盛りラベルの文字列を 0-23 の時に変換する。該当しなければ null。
 * 受け付ける形式（"28" のような数字だけの文字列は意図的に受け付けない）:
 *   "09:00" / "9:00"   24時間表記（ロケール「日本語」の既定）
 *   "午前9時" / "午後3時" / "午前9" / "午後3"
 *   "9時"
 *   "9am" / "3 pm"
 * @param {string} text
 * @returns {number | null}
 */
function parseHourLabel(text) {
  const t = (text || '').trim();
  if (!t || t.length > 8) return null;

  let m = /^(\d{1,2}):00$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : null;
  }

  m = /^(午前|午後)\s*(\d{1,2})\s*時?$/.exec(t);
  if (m) {
    const h = Number(m[2]);
    if (h < 0 || h > 12) return null;
    return m[1] === '午後' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
  }

  m = /^(\d{1,2})\s*時$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : null;
  }

  m = /^(\d{1,2})\s*(am|pm|a\.\s?m\.|p\.\s?m\.)$/i.exec(t);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    return /^p/i.test(m[2]) ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
  }

  // 中国語・韓国語ロケール: "上午10点" "下午3點" "오전 10시"
  m = /^(上午|下午|中午|오전|오후)\s*(\d{1,2})\s*(点|點|时|時|시)?$/.exec(t);
  if (m) {
    const h = Number(m[2]);
    if (h < 0 || h > 12) return null;
    const pm = m[1] === '下午' || m[1] === '오후' || m[1] === '中午';
    return pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
  }

  // "10 Uhr" / "10 h"（独・仏）
  m = /^(\d{1,2})\s*(uhr|h)$/i.exec(t);
  if (m) {
    const h = Number(m[1]);
    return h >= 0 && h <= 23 ? h : null;
  }

  return null;
}

// 時刻目盛りの点列キャッシュ（同じ grid root・寿命内なら使い回す）
let hourCache = null;

/** スクロール・リサイズ・ビュー切替時に呼び、座標キャッシュを破棄する。 */
function invalidateCaches() {
  hourCache = null;
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/**
 * 時刻目盛りラベルらしい要素を集める（キャッシュなしの実体）。
 * ブラウザでは TreeWalker で「短いテキストノード」だけを見るので、
 * 全要素の矩形を取る旧実装より大幅に軽い。Nodeのテスト用スタブでは querySelectorAll を使う。
 */
function scanHourLabelPoints(gridRoot) {
  const points = [];
  const doc = gridRoot.ownerDocument;
  const canWalk = doc && typeof doc.createTreeWalker === 'function' && typeof NodeFilter !== 'undefined';
  if (canWalk) {
    const walker = doc.createTreeWalker(gridRoot, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue;
      if (text && text.length <= 12) {
        const hour = parseHourLabel(text);
        const parent = node.parentElement;
        if (hour != null && parent && parent.children.length === 0) {
          points.push({ hour, top: parent.getBoundingClientRect().top });
        }
      }
      node = walker.nextNode();
    }
    return points;
  }
  const candidates = gridRoot.querySelectorAll('*');
  for (const el of candidates) {
    // 子要素を持つ大きなコンテナはラベルではないので除外し、
    // テキストノードに近い葉要素だけを見る。
    if (el.children && el.children.length > 0) continue;
    const hour = parseHourLabel(el.textContent);
    if (hour == null) continue;
    const rect = el.getBoundingClientRect();
    points.push({ hour, top: rect.top });
  }
  return points;
}

/**
 * グリッドコンテナ内から時刻目盛りラベルらしき要素を集め、
 * hour-railモデル構築用の点列 [{hour, top}] に変換する（短時間キャッシュ付き）。
 * @param {Element} gridRoot 探索範囲（広すぎるとノイズが増える）
 * @returns {Array<{hour:number, top:number}>}
 */
function collectHourLabelPoints(gridRoot) {
  if (!gridRoot) return [];
  const t = nowMs();
  if (hourCache && hourCache.root === gridRoot && t - hourCache.at < CONFIG.HOUR_CACHE_TTL_MS) {
    return hourCache.points;
  }
  const points = scanHourLabelPoints(gridRoot);
  hourCache = { root: gridRoot, at: t, points };
  return points;
}

/**
 * Googleカレンダーが表示しているタイムゾーン（週/日表示の左上 "GMT+09" 等）を読む。
 * 見つからなければ null。候補追加時だけ呼ぶ（pointermove では呼ばない）。
 * @param {Document} doc
 * @returns {number | null} UTCからのオフセット（分）
 */
function detectCalendarOffset(doc) {
  if (!doc || !doc.body || typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return null;
  const tzApi = (typeof module !== 'undefined') ? require('./tz.js') : globalThis.GSM.tz;
  const root = doc.querySelector(CONFIG.GRID_ROOT_SELECTOR) || doc.body;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let scanned = 0;
  while (node && scanned < 20000) {
    scanned += 1;
    const text = node.nodeValue;
    if (text && text.length <= 12 && /^(?:\s*)(GMT|UTC)/i.test(text)) {
      const off = tzApi.parseGmtLabel(text);
      if (off != null) return off;
    }
    node = walker.nextNode();
  }
  return null;
}

/**
 * 空きマスの clientX/Y から、追加される予定の値(pick)と、それを画面上で
 * ハイライト表示するための矩形(rect)を1回の幾何計算でまとめて返す。
 *
 * extractFromSlot（クリック確定）とホバープレビュー（preview.js）の両方が
 * この関数だけを呼ぶことで、"プレビューで見えていた時刻" と
 * "クリックで実際に追加される時刻" が計算上ずれることのないようにしている
 * （幾何モデルを2箇所に実装しないことでWYSIWYGを保証する）。
 *
 * 開始時刻はクリック位置を含む snapMin 単位の枠に切り捨てる
 * （1時間単位なら 10:23 のクリック → 10:00〜11:00）。
 * @param {{clientX:number, clientY:number, target:Element}} clickEvent
 * @param {Document} doc
 * @param {{durationMin?:number, snapMin?:number}} [options]
 * @returns {{pick: object, rect: ?{top:number,left:number,width:number,height:number}}}
 *   pick は Pick または {error: string}。エラー時 rect は null。
 */
function resolveSlotPreview(clickEvent, doc, options) {
  const durationMin = (options && options.durationMin) || CONFIG.DEFAULT_DURATION_MIN;
  const snapMin = (options && options.snapMin) || CONFIG.SNAP_MIN;

  const columnHit = resolveDateColumn(clickEvent.target, clickEvent.clientX, clickEvent.clientY, doc);
  if (!columnHit) {
    return { pick: { error: ERR.NO_COLUMN }, rect: null };
  }

  const rect = columnHit.el.getBoundingClientRect();
  const gridRoot = doc
    ? ((typeof doc.querySelector === 'function' && doc.querySelector(CONFIG.GRID_ROOT_SELECTOR)) || doc.body)
    : null;
  const hourPoints = collectHourLabelPoints(gridRoot);
  const geometry = buildGridGeometry(rect, hourPoints);

  if (looksLikeAllDayRow(rect, geometry.pxPerHour)) {
    return { pick: { error: ERR.ALL_DAY_ROW }, rect: null };
  }

  const rawMinutes = yToMinutes(clickEvent.clientY, geometry);
  const snapped = snapMinutes(rawMinutes, snapMin, 'floor');
  const start = minutesToHm(snapped);
  if (!start) {
    return { pick: { error: ERR.NO_TIME_AT_POINT }, rect: null };
  }

  const endMinutes = snapped + durationMin;
  const end = minutesToHm(endMinutes);
  if (!end) {
    return { pick: { error: ERR.CROSSES_MIDNIGHT }, rect: null };
  }

  const confidence = geometry.confidence;
  const warning = confidence === 'high' ? undefined : WARN.TIME_FROM_POSITION;

  const pick = {
    y: columnHit.decoded.y,
    m: columnHit.decoded.m,
    d: columnHit.decoded.d,
    sh: start.h,
    sm: start.m,
    eh: end.h,
    em: end.m,
    confidence,
    source: 'slot',
    warning
  };

  const boxRect = {
    left: rect.left,
    width: rect.width,
    top: geometry.originY + (snapped / 60) * geometry.pxPerHour,
    height: (durationMin / 60) * geometry.pxPerHour
  };

  return { pick, rect: boxRect };
}

/**
 * 空きマスのクリックから日時エントリを抽出する。
 * @param {{clientX:number, clientY:number, target:Element}} clickEvent
 * @param {Document} doc
 * @param {{durationMin?:number, snapMin?:number}} [options]
 * @returns {object} Pick または {error: string}
 */
function extractFromSlot(clickEvent, doc, options) {
  return resolveSlotPreview(clickEvent, doc, options).pick;
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.extract / Node: module.exports）
// ---------------------------------------------------------------------------
const api = {
  CONFIG,
  ERR,
  WARN,
  timeFromChipGeometry,
  invalidateCaches,
  detectCalendarOffset,
  findDatekeyAncestor,
  getChipLabelText,
  isExcludedChip,
  extractFromChip,
  resolveChipPreview,
  resolveDateColumn,
  parseHourLabel,
  collectHourLabelPoints,
  resolveSlotPreview,
  extractFromSlot
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.extract = api;
}

})();
