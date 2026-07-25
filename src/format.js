/**
 * src/format.js — 出力テキストの整形（純粋関数のみ）
 *
 * 目的:
 *   メモの1エントリを「7月25日(土) 10:00〜11:00」の形式に変換する。
 *   これがこの拡張機能の唯一の出力仕様であり、他のどのファイルからも
 *   直接文字列を組み立てない（書式の正本はここだけに置く）。
 *
 * 呼び出し方:
 *   ブラウザ（コンテンツスクリプト, isolated world）: globalThis.GSM.format
 *   Node（テスト）: require('./format.js')
 *
 * 設計上の制約:
 *   - 月日はゼロ埋めしない（「7月5日」）。時刻はゼロ埋めする（「09:00」）。
 *   - 区切りは全角チルダ（U+FF5E）ではなく波ダッシュ〜（U+301C）。
 *   - 年は出力しない（ユーザー確定仕様。同一年内の日程調整を前提とする）。
 *   - タイムゾーン変換は一切行わない。エントリは「壁時計フィールド」
 *     （y, m, d, sh, sm, eh, em）を直接持ち、ここではその値をそのまま
 *     文字列化するだけ。epoch経由での変換はタイムゾーンのずれを生むため禁止。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

// 波ダッシュ（U+301C）。全角チルダ（U+FF5E, ～）と混同しないこと。
const SEP = '〜';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 0埋めした2桁の文字列を返す。
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * エントリの曜日（日本語1文字）を返す。
 * @param {{y:number, m:number, d:number}} entry
 * @returns {string}
 */
function weekdayOf(entry) {
  const dt = new Date(entry.y, entry.m - 1, entry.d);
  return WEEKDAY_JA[dt.getDay()];
}

/**
 * ソート用のキー（数値、昇順で時系列になる）を返す。
 * @param {{y:number, m:number, d:number, sh:number, sm:number}} entry
 * @returns {number}
 */
function sortKey(entry) {
  return (((entry.y * 100 + entry.m) * 100 + entry.d) * 100 + entry.sh) * 100 + entry.sm;
}

/**
 * 1エントリを「7月25日(土) 10:00〜11:00」形式の文字列に変換する。
 * @param {{y:number,m:number,d:number,sh:number,sm:number,eh:number,em:number}} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const wd = weekdayOf(entry);
  return (
    `${entry.m}月${entry.d}日(${wd}) ` +
    `${pad2(entry.sh)}:${pad2(entry.sm)}${SEP}${pad2(entry.eh)}:${pad2(entry.em)}`
  );
}

/**
 * 複数エントリを時系列昇順に並べ、改行区切りの1文字列にする。
 * これがコピー ボタンで実際にクリップボードへ渡されるテキスト。
 * @param {Array} entries
 * @returns {string}
 */
function formatAll(entries) {
  return entries
    .slice()
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map(formatEntry)
    .join('\n');
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.format / Node: module.exports）
// ---------------------------------------------------------------------------
const api = { SEP, WEEKDAY_JA, pad2, weekdayOf, sortKey, formatEntry, formatAll };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.format = api;
}

})();
