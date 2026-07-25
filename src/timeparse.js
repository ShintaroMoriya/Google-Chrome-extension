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
const RE_ALL_DAY = /(終日|all[\s-]?day)/i;

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

  return null;
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
const api = { parseTimeRange, isAllDayLabel, to24hJa, to24hEn };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.timeparse = api;
}

})();
