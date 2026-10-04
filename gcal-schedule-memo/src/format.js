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
 *   - formatEntry / formatAll は「壁時計フィールド」（y, m, d, sh, sm, eh, em）を
 *     そのまま文字列化するだけで、タイムゾーン変換を一切行わない（v1からの正本）。
 *
 * v2.0.0: 相手の表示に合わせる出力を追加。
 *   - formatSlot(entry, {locale, targetTz, sourceTz}) は、相手のタイムゾーン・
 *     言語・書式で1行を作る。変換は tz.js にだけ任せる。
 *   - 日本語かつ相手と自分のオフセットが同じ場合は formatEntry と1バイトも
 *     違わない文字列を返す（既存ユーザーの出力を変えない）。
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
// v2.0.0: 相手のタイムゾーン・言語・書式での出力
// ---------------------------------------------------------------------------

// コピー文の書式として選べるロケール。表記の違い（12時間/24時間・日付順）を見本で選ばせる。
const OUTPUT_LOCALES = ['en-US', 'en-GB', 'ja'];
const LOCALES_24H_EN = ['en-GB', 'en-IE'];

function getTzApi() {
  return (typeof module !== 'undefined' && module.exports)
    ? require('./tz.js')
    : globalThis.GSM.tz;
}

/**
 * 任意のロケール文字列を OUTPUT_LOCALES のいずれかに正規化する。
 * @param {string} locale
 * @returns {'en-US'|'en-GB'|'ja'}
 */
function normalizeLocale(locale) {
  const l = String(locale || '').replace('_', '-');
  if (OUTPUT_LOCALES.includes(l)) return l;
  if (/^ja\b/i.test(l)) return 'ja';
  if (LOCALES_24H_EN.some((x) => x.toLowerCase() === l.toLowerCase())) return 'en-GB';
  return 'en-US';
}

/** ロケールに対応する定型文の言語。 */
function langOf(locale) {
  return normalizeLocale(locale) === 'ja' ? 'ja' : 'en';
}

/**
 * 1エントリを epoch とタイムゾーンを伴う形に展開する（表示・並び替え・時刻帯判定の共通土台）。
 * @param {object} entry 壁時計フィールドと、任意の tz（追加時点の自分のタイムゾーン）
 * @param {{targetTz?:string, sourceTz?:string}} [opts]
 */
function computeSlot(entry, opts) {
  const tz = getTzApi();
  const sourceTz = tz.resolveTz(entry.tz || (opts && opts.sourceTz));
  const targetTz = tz.resolveTz((opts && opts.targetTz) || sourceTz);
  const startMs = tz.zonedToEpoch(entry.y, entry.m, entry.d, entry.sh, entry.sm, sourceTz);
  const endMs = tz.zonedToEpoch(entry.y, entry.m, entry.d, entry.eh, entry.em, sourceTz);
  const differs = tz.offsetMinutes(sourceTz, startMs) !== tz.offsetMinutes(targetTz, startMs);
  const start = tz.epochToZoned(startMs, targetTz);
  const end = tz.epochToZoned(endMs, targetTz);
  const dayShift = Math.round(
    (Date.UTC(start.y, start.m - 1, start.d) - Date.UTC(entry.y, entry.m - 1, entry.d)) / 86400000
  );
  const startMin = start.h * 60 + start.mi;
  const durationMin = Math.max(0, Math.round((endMs - startMs) / 60000));
  const crossesDay = start.y !== end.y || start.m !== end.m || start.d !== end.d;
  return {
    startMs, endMs, sourceTz, targetTz, differs, start, end, dayShift, crossesDay, durationMin,
    band: tz.slotBand(startMin, startMin + durationMin)
  };
}

const intlCache = new Map();
function intl(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = intlCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    intlCache.set(key, f);
  }
  return f;
}

// ICU は "9:00 PM" に狭いNBSP(U+202F)、範囲に細いスペース(U+2009)を使う。
// メール本文に貼ったときに崩れないよう、通常のスペースへ揃える。
function plainSpaces(text) {
  return String(text).replace(/[\u202F\u2009\u00A0]/g, ' ');
}

function tzShortName(locale, timeZone, ms) {
  const part = intl(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(ms).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

/**
 * 表示用の部品（日付・時刻・タイムゾーン名）を返す。パネルとコピー文の両方が使う。
 * @param {object} entry
 * @param {{locale?:string, targetTz?:string, sourceTz?:string}} [opts]
 * @returns {{date:string, time:string, tzName:string, slot:object}}
 */
function slotParts(entry, opts) {
  const locale = normalizeLocale(opts && opts.locale);
  const slot = computeSlot(entry, opts);
  const { start, end } = slot;

  if (locale === 'ja') {
    const tzApi = getTzApi();
    return {
      date: `${start.m}月${start.d}日(${WEEKDAY_JA[start.wd]})`,
      time: `${pad2(start.h)}:${pad2(start.mi)}${SEP}${slot.crossesDay ? '翌' : ''}${pad2(end.h)}:${pad2(end.mi)}`,
      tzName: slot.differs ? tzApi.offsetLabel(slot.targetTz, slot.startMs) : '',
      slot
    };
  }

  const timeZone = slot.targetTz;
  const date = intl(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(slot.startMs);
  const timeFmt = intl(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  let time;
  if (!slot.crossesDay) {
    time = timeFmt.formatRange(slot.startMs, slot.endMs);
  } else {
    const endWeekday = intl(locale, { timeZone, weekday: 'short' }).format(slot.endMs);
    time = `${timeFmt.format(slot.startMs)} – ${endWeekday} ${timeFmt.format(slot.endMs)}`;
  }
  return {
    date: plainSpaces(date),
    time: plainSpaces(time),
    tzName: slot.differs ? tzShortName(locale, timeZone, slot.startMs) : '',
    slot
  };
}

/**
 * 相手のタイムゾーン・言語・書式で1行を作る。
 *   ja    : 「8月31日(月) 21:00〜22:00 (GMT-4)」（オフセットが同じなら formatEntry と完全一致）
 *   en-US : 「Mon, Aug 31 · 9:00 – 10:00 PM EDT」
 *   en-GB : 「Mon 31 Aug · 21:00–22:00 GMT-4」
 * @param {object} entry
 * @param {{locale?:string, targetTz?:string, sourceTz?:string}} [opts]
 * @returns {string}
 */
function formatSlot(entry, opts) {
  const locale = normalizeLocale(opts && opts.locale);
  const parts = slotParts(entry, Object.assign({}, opts, { locale }));
  if (locale === 'ja') {
    if (!parts.slot.differs) return formatEntry(entry);
    return `${parts.date} ${parts.time} (${parts.tzName})`;
  }
  return `${parts.date} · ${parts.time}${parts.tzName ? ` ${parts.tzName}` : ''}`;
}

/**
 * 複数エントリを（実時刻の）時系列順に並べ、相手向けの書式で改行区切りにする。
 */
function formatAllFor(entries, opts) {
  return entries
    .map((entry) => ({ entry, at: computeSlot(entry, opts).startMs }))
    .sort((a, b) => a.at - b.at)
    .map(({ entry }) => formatSlot(entry, opts))
    .join('\n');
}

/** 言語・書式シートに出す見本（「Mon, Aug 31 · 9:00 PM」等）。タイムゾーン表記は付けない。 */
function formatSample(locale) {
  const sample = { y: 2026, m: 8, d: 31, sh: 21, sm: 0, eh: 22, em: 0, tz: 'UTC' };
  const parts = slotParts(sample, { locale, targetTz: 'UTC' });
  return normalizeLocale(locale) === 'ja' ? `${parts.date} ${parts.time}` : `${parts.date} · ${parts.time}`;
}

/** 15 → "15m"、90 → "1.5h"（言語をほぼ問わない短い単位表記）。 */
function formatDuration(minutes, locale) {
  const useHours = minutes >= 60;
  return new Intl.NumberFormat(locale || 'en', {
    style: 'unit',
    unit: useHours ? 'hour' : 'minute',
    unitDisplay: 'narrow',
    maximumFractionDigits: 2
  }).format(useHours ? minutes / 60 : minutes);
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.format / Node: module.exports）
// ---------------------------------------------------------------------------
const api = {
  SEP, WEEKDAY_JA, OUTPUT_LOCALES, pad2, weekdayOf, sortKey, formatEntry, formatAll,
  normalizeLocale, langOf, computeSlot, slotParts, formatSlot, formatAllFor, formatSample, formatDuration
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.format = api;
}

})();
