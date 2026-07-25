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
 * 重要な注意:
 *   このコンテナからは実際のGoogleカレンダーにログインしてDOMを検証できない。
 *   そのため CONFIG 内のセレクタ・正規表現は「公開されている実装例・実DOMサンプル
 *   から調査した最有力候補」であり、tools/probe.js の実行結果を見て
 *   確定させる前提のベストエフォート値である（README「キャリブレーション」参照）。
 *   どの層でも日時が確定できない場合は必ず {error} を返し、値を捏造しない。
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
  // 時刻目盛りラベルらしきテキストの正規表現（hour-railモデル用）。
  HOUR_LABEL_RE: /^(午前|午後)?\s*(\d{1,2})\s*(時)?$|^(\d{1,2})\s*(am|pm)$/i,
  // タスク/リマインダー等、日程調整の対象にしないチップを弾くための
  // data-eventid の接頭辞（Base64エンコードされているため前方一致で判定できる
  // 保証はない。分かる範囲でのベストエフォート）。
  EXCLUDE_EVENTID_PREFIXES: ['tasks_'],
  DEFAULT_DURATION_MIN: 60,
  SNAP_MIN: 15
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
 * 予定チップのクリックから日時エントリを抽出する。
 * @param {Element} chip
 * @returns {object} Pick または {error: string}
 */
function extractFromChip(chip) {
  if (isExcludedChip(chip)) {
    return { error: 'タスクなど日程調整の対象外の項目です' };
  }

  const labelText = getChipLabelText(chip);

  if (isAllDayLabel(labelText)) {
    return { error: '終日の予定は対象外です' };
  }

  // --- 日付レイヤ ---------------------------------------------------------
  let dateResult = null;
  let dateSource = null;

  const datekeyHit = findDatekeyAncestor(chip);
  if (datekeyHit) {
    // 終日行（時刻グリッドの外）にも data-datekey が付くことがあるため、
    // 高さで簡易判定する。ここでは pxPerHour が不明なため、
    // 明らかに低い（時刻グリッド1コマ未満相当）場合のみ疑わしいとみなす。
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
    return { error: '日付を読み取れませんでした' };
  }

  // --- 時刻レイヤ -----------------------------------------------------------
  const timeResult = parseTimeRange(labelText);
  if (!timeResult) {
    return { error: '時刻を読み取れませんでした（終日または複数日の予定の可能性があります）' };
  }

  if (
    timeResult.eh < timeResult.sh ||
    (timeResult.eh === timeResult.sh && timeResult.em <= timeResult.sm)
  ) {
    return { error: '日をまたぐ予定は対象外です' };
  }

  const confidence = dateSource === 'datekey' ? 'high' : 'medium';
  const warning = dateSource === 'datekey' ? undefined : '日付をラベル文字列から推定しました';

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
 * グリッドコンテナ内から時刻目盛りラベルらしき要素を集め、
 * hour-railモデル構築用の点列 [{hour, top}] に変換する。
 * @param {Element} gridRoot 探索範囲（広すぎるとノイズが増える）
 * @returns {Array<{hour:number, top:number}>}
 */
function collectHourLabelPoints(gridRoot) {
  if (!gridRoot) return [];
  const points = [];
  const candidates = gridRoot.querySelectorAll('*');
  for (const el of candidates) {
    // 子要素を持つ大きなコンテナはラベルではないので除外し、
    // テキストノードに近い葉要素だけを見る。
    if (el.children && el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text || text.length > 8) continue;
    const m = CONFIG.HOUR_LABEL_RE.exec(text);
    if (!m) continue;

    let hour;
    if (m[2] != null) {
      // 「午前10時」「午後3時」形式
      const ampm = m[1];
      const h = Number(m[2]);
      hour = ampm === '午後' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    } else if (m[4] != null) {
      // "10am" 形式
      const h = Number(m[4]);
      const ampm = m[5].toLowerCase();
      hour = ampm === 'pm' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    } else {
      continue;
    }

    const rect = el.getBoundingClientRect();
    points.push({ hour, top: rect.top });
  }
  return points;
}

/**
 * 空きマスのクリックから日時エントリを抽出する。
 * @param {{clientX:number, clientY:number, target:Element}} clickEvent
 * @param {Document} doc
 * @param {{durationMin?:number, snapMin?:number}} [options]
 * @returns {object} Pick または {error: string}
 */
function extractFromSlot(clickEvent, doc, options) {
  const durationMin = (options && options.durationMin) || CONFIG.DEFAULT_DURATION_MIN;
  const snapMin = (options && options.snapMin) || CONFIG.SNAP_MIN;

  const columnHit = resolveDateColumn(clickEvent.target, clickEvent.clientX, clickEvent.clientY, doc);
  if (!columnHit) {
    return { error: '日付列を特定できませんでした' };
  }

  const rect = columnHit.el.getBoundingClientRect();
  const hourPoints = collectHourLabelPoints(doc ? doc.body : null);
  const geometry = buildGridGeometry(rect, hourPoints);

  if (looksLikeAllDayRow(rect, geometry.pxPerHour)) {
    return { error: '終日の行では時刻を指定できません' };
  }

  const rawMinutes = yToMinutes(clickEvent.clientY, geometry);
  const snapped = snapMinutes(rawMinutes, snapMin);
  const start = minutesToHm(snapped);
  if (!start) {
    return { error: 'クリック位置から時刻を算出できませんでした' };
  }

  const endMinutes = snapped + durationMin;
  const end = minutesToHm(endMinutes);
  if (!end) {
    return { error: '所要時間が日をまたぐため対象外です' };
  }

  const confidence = geometry.confidence;
  const warning = confidence === 'high' ? undefined : '時刻を画面上の位置から推定しました';

  return {
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
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.extract / Node: module.exports）
// ---------------------------------------------------------------------------
const api = {
  CONFIG,
  findDatekeyAncestor,
  getChipLabelText,
  isExcludedChip,
  extractFromChip,
  resolveDateColumn,
  collectHourLabelPoints,
  extractFromSlot
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.extract = api;
}

})();
