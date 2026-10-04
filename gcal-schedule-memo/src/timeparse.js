/**
 * src/timeparse.js — 予定チップのラベル文字列から時刻レンジを取り出す（純粋関数のみ）
 *
 * 目的:
 *   Googleカレンダーの予定チップは、可視テキストとは別に
 *   スクリーンリーダー用の非表示テキスト（例: 子要素 .XuJrye）に
 *   「午前10:00～午前11:00、打ち合わせ、…」のような文字列を持つ。
 *   これを解析し { sh, sm, eh, em } の24時間表記に変換する。
 *
 * 設計上の制約:
 *   - Googleの実際の日本語ロケール表記（区切り文字が ～/〜/-/から のどれか）は
 *     このコンテナからは確認できない。そのため区切り文字は候補を総当たりで
 *     受け付ける「表駆動」設計にし、tools/probe.js で得た実測ラベルを
 *     test/fixtures/labels.ja.json に反映して確定させる運用とする
 *     （README「うまく動かないとき」参照）。
 *   - 終日 (終日 / all day / All-day) は明示的に検出し、呼び出し側で
 *     「対象外」として弾けるようにする（時刻を捏造しない）。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

// 終日イベントの判定（日本語・英語の両表記に対応）。
const RE_ALL_DAY = /(終日|all[\s-]?day|全天|종일|ganztägig|toute la journée|todo el día|dia inteiro)/i;

// 区切り文字の候補: 全角/半角ハイフン・ダッシュ類・波ダッシュ・全角チルダ・"から"・"to"。
const RANGE_SEP = '(?:[-–—〜～]|から|to)';

// 「午前10:00〜午後3:45」「午前10時00分〜午後3時45分」など、
// 午前/午後付きの日本語表記。分の省略（「午前10時」）にも対応。
const RE_JA_AMPM_RANGE = new RegExp(
  '(午前|午後)\\s*(\\d{1,2})[:：時]\\s*(\\d{1,2})?\\s*分?\\s*' +
  RANGE_SEP +
  '\\s*(午前|午後)?\\s*(\\d{1,2})[:：時]\\s*(\\d{1,2})?\\s*分?'
);

// 「10:00〜11:00」のような24時間表記（午前/午後なし）。
const RE_24H_RANGE = new RegExp(
  '(\\d{1,2}):(\\d{2})\\s*' + RANGE_SEP + '\\s*(\\d{1,2}):(\\d{2})'
);

// 英語ロケール向け "12pm to 3:45pm" / "10 – 11:30am" 形式。
// 分は省略可能。開始側の ampm 省略時は終了側の ampm を継承する
// （Googleの実サンプル "12pm to 3:45pm" のような、開始のみ ampm 付きのケースにも
//  対応できるよう、両端どちらかにあれば使う）。
const RE_EN_AMPM_RANGE = new RegExp(
  '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*' +
  RANGE_SEP +
  '\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?',
  'i'
);

/**
 * 午前/午後 + 時 を24時間表記の時に変換する。
 * @param {string} ampm '午前' | '午後' | undefined
 * @param {number} hour 1-12（午前/午後指定時）または 0-23
 * @returns {number}
 */
function to24hJa(ampm, hour) {
  if (!ampm) return hour;
  if (ampm === '午前') return hour === 12 ? 0 : hour;
  // 午後
  return hour === 12 ? 12 : hour + 12;
}

/**
 * am/pm + 時 を24時間表記の時に変換する。
 * @param {string} ampm 'am' | 'pm' | undefined
 * @param {number} hour 1-12（am/pm指定時）または 0-23
 * @returns {number}
 */
function to24hEn(ampm, hour) {
  if (!ampm) return hour;
  const lower = ampm.toLowerCase();
  if (lower === 'am') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/**
 * ラベル文字列から時刻レンジを抽出する。
 * どのパターンにもマッチしなければ null（＝呼び出し側は「読み取れない」扱い）。
 * @param {string} text
 * @returns {{sh:number, sm:number, eh:number, em:number} | null}
 */
function parseTimeRange(text) {
  if (!text) return null;

  const ja = RE_JA_AMPM_RANGE.exec(text);
  if (ja) {
    const [, ampm1, h1, m1, ampm2raw, h2, m2] = ja;
    // 終了側に午前/午後の指定が無ければ開始側を継承する
    // （「午前10時〜11時」のような省略表記に対応）。
    const ampm2 = ampm2raw || ampm1;
    return {
      sh: to24hJa(ampm1, Number(h1)),
      sm: m1 ? Number(m1) : 0,
      eh: to24hJa(ampm2, Number(h2)),
      em: m2 ? Number(m2) : 0
    };
  }

  const en = RE_EN_AMPM_RANGE.exec(text);
  if (en) {
    const [, h1, m1, ampm1, h2, m2, ampm2raw] = en;
    // 開始側に ampm が無ければ終了側から継承する
    // （"12 to 3:45pm" のような、終了側だけ ampm 付きのケースに対応）。
    const ampm2 = ampm2raw || ampm1;
    const ampm1resolved = ampm1 || ampm2raw;
    if (ampm1resolved || ampm2) {
      return {
        sh: to24hEn(ampm1resolved, Number(h1)),
        sm: m1 ? Number(m1) : 0,
        eh: to24hEn(ampm2, Number(h2)),
        em: m2 ? Number(m2) : 0
      };
    }
  }

  const h24 = RE_24H_RANGE.exec(text);
  if (h24) {
    const [, h1, m1, h2, m2] = h24;
    return { sh: Number(h1), sm: Number(m1), eh: Number(h2), em: Number(m2) };
  }

  return parseTimeRangeGeneric(text);
}

// ---------------------------------------------------------------------------
// v2.0.0: 言語を問わない汎用パーサ（上の3パターンで読めない表記の救済）
//   "10h00 à 11h00" / "10.00–11.00" / "10:00 bis 11:00" / "上午10:00至上午11:00" /
//   "오전 10:00~오전 11:00" / "10 a.m. – 11 a.m." など。
//   2つの時刻トークンが、数字を含まない短い区切り（8文字以内）で並んでいるものだけを採る。
//   それでも読めない場合は extract.js がチップの位置（幾何）から時刻を求める。
// ---------------------------------------------------------------------------
const PRE_MARK = '(午前|午後|上午|下午|中午|오전|오후)?';
const POST_MARK = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?';
const TIME_TOKEN = `${PRE_MARK}\\s*(\\d{1,2})(?:\\s*[:.h時时시]\\s*(\\d{2})?)?\\s*(?:分|분)?\\s*${POST_MARK}`;
const RE_GENERIC_RANGE = new RegExp(`${TIME_TOKEN}\\s*([^\\d\\n]{1,8}?)\\s*${TIME_TOKEN}`, 'i');
const PM_MARKS = ['午後', '下午', '오후'];
const AM_MARKS = ['午前', '上午', '오전'];

function markOf(pre, post) {
  if (pre) {
    if (PM_MARKS.includes(pre) || pre === '中午') return 'pm';
    if (AM_MARKS.includes(pre)) return 'am';
  }
  if (post) return /^p/i.test(post) ? 'pm' : 'am';
  return null;
}

function applyMark(mark, hour) {
  if (!mark) return hour;
  if (mark === 'am') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

/**
 * 言語を問わない時刻レンジの抽出。読めなければ null（捏造しない）。
 * @param {string} text
 * @returns {{sh:number, sm:number, eh:number, em:number} | null}
 */
function parseTimeRangeGeneric(text) {
  if (!text) return null;
  const m = RE_GENERIC_RANGE.exec(text);
  if (!m) return null;
  const [, pre1, h1, m1, post1, sep, pre2, h2, m2, post2] = m;
  // 区切りが「、」「,」だけなら別の情報（日付等）の連続とみなす。
  if (/^[,、，]+$/.test(sep.trim())) return null;
  const hasMinute1 = m1 != null;
  const hasMinute2 = m2 != null;
  let mark1 = markOf(pre1, post1);
  let mark2 = markOf(pre2, post2);
  // 時刻らしさ: 分か午前/午後の印のどちらかが両端に必要（"28 - 30" のような日付範囲を拾わない）。
  if (!(hasMinute1 || mark1 || mark2) || !(hasMinute2 || mark2 || mark1)) return null;
  if (!mark2) mark2 = mark1;
  if (!mark1) mark1 = mark2;
  const sh = applyMark(mark1, Number(h1));
  const eh = applyMark(mark2, Number(h2));
  const sm = hasMinute1 ? Number(m1) : 0;
  const em = hasMinute2 ? Number(m2) : 0;
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null;
  return { sh, sm, eh: eh === 24 ? 0 : eh, em };
}

/**
 * ラベル文字列が終日イベントを表しているかどうか。
 * @param {string} text
 * @returns {boolean}
 */
function isAllDayLabel(text) {
  return !!text && RE_ALL_DAY.test(text);
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.timeparse / Node: module.exports）
// ---------------------------------------------------------------------------
const api = { parseTimeRange, parseTimeRangeGeneric, isAllDayLabel, to24hJa, to24hEn };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.timeparse = api;
}

})();
