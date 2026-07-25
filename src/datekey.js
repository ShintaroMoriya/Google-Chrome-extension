/**
 * src/datekey.js — Googleカレンダーの data-datekey の符号化/復号（純粋関数のみ）
 *
 * 目的:
 *   Googleカレンダーのグリッド要素は日付を data-datekey="28921" のような
 *   整数属性で持っている。これはロケール非依存・タイムゾーン非依存であり、
 *   日本語ラベルのパースより堅牢な「日付の第一情報源」として使う。
 *
 * エンコード方式（複数の独立したコミュニティ実装で一致確認済み）:
 *   datekey = ((year - 1970) << 9) | (month << 5) | day     // month は 1-12
 *   検算: 2026-07-25 → (56<<9) + (7<<5) + 25
 *                    = 28672 + 224 + 25 = 28921
 *
 * フォールバック:
 *   data-datekey が取れない場合（月表示のラベル文字列など）に備え、
 *   「2026年7月25日」「7月25日」「May 27, 2025」形式の文字列からも
 *   日付を復元できるようにする（parseDateLabel）。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const MIN_YEAR = 1970;
const MAX_REASONABLE_YEAR = 2100;

/**
 * 年月日から datekey 整数を作る。
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {number}
 */
function encodeDatekey(year, month, day) {
  return ((year - MIN_YEAR) << 9) | (month << 5) | day;
}

/**
 * datekey 整数を { y, m, d } に復号する。
 * 範囲外（月0/13、日0/32、年が非現実的）は妥当性検証のため null を返す。
 * @param {number} key
 * @returns {{y:number,m:number,d:number} | null}
 */
function decodeDatekey(key) {
  if (typeof key !== 'number' || !Number.isFinite(key) || !Number.isInteger(key) || key < 0) {
    return null;
  }
  const day = key & 31;
  const month = (key >> 5) & 15;
  const year = (key >> 9) + MIN_YEAR;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < MIN_YEAR || year > MAX_REASONABLE_YEAR) return null;

  // 実在する日付かどうかも検証する（例: 2月30日は存在しない）。
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return { y: year, m: month, d: day };
}

/**
 * data-datekey 文字列属性を安全にパースして decodeDatekey に渡す。
 * @param {string | null} attrValue
 * @returns {{y:number,m:number,d:number} | null}
 */
function decodeDatekeyAttr(attrValue) {
  if (attrValue == null) return null;
  const n = Number(attrValue);
  if (!Number.isFinite(n)) return null;
  return decodeDatekey(n);
}

// 「2026年7月25日」「7月25日」形式（和暦区切り）。年は省略可能。
const RE_JA_DATE = /(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日/;

// 英語ロケール向け "May 27, 2025" / "May 27" 形式のフォールバック。
const EN_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];
// 月名は EN_MONTHS の実在する名称のみにマッチさせる（"to 3:45pm" のような
// 無関係な「単語+数字」を誤って日付として拾わないため、任意の英字列
// [A-Za-z]+ ではなく月名の union で絞り込む）。
const RE_EN_DATE = new RegExp(`\\b(${EN_MONTHS.join('|')})\\s+(\\d{1,2}),?\\s*(\\d{4})?`, 'i');

/**
 * 日付ラベル文字列から { y, m, d } を推定する（第一情報源が使えない場合の
 * フォールバック）。年が省略された場合は referenceYear（既定は現在年）を使う。
 * @param {string} text
 * @param {number} [referenceYear]
 * @returns {{y:number,m:number,d:number} | null}
 */
function parseDateLabel(text, referenceYear) {
  if (!text) return null;
  const refYear = referenceYear || new Date().getFullYear();

  const ja = RE_JA_DATE.exec(text);
  if (ja) {
    const y = ja[1] ? Number(ja[1]) : refYear;
    const m = Number(ja[2]);
    const d = Number(ja[3]);
    return decodeDatekey(encodeDatekey(y, m, d));
  }

  const en = RE_EN_DATE.exec(text);
  if (en) {
    const monthIdx = EN_MONTHS.indexOf(en[1].toLowerCase());
    if (monthIdx >= 0) {
      const y = en[3] ? Number(en[3]) : refYear;
      const m = monthIdx + 1;
      const d = Number(en[2]);
      return decodeDatekey(encodeDatekey(y, m, d));
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.datekey / Node: module.exports）
// ---------------------------------------------------------------------------
const api = { encodeDatekey, decodeDatekey, decodeDatekeyAttr, parseDateLabel };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.datekey = api;
}

})();
