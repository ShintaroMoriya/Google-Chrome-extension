/**
 * src/tz.js — タイムゾーン変換（純粋関数のみ・外部ライブラリなし）
 *
 * 目的:
 *   候補は「自分のカレンダー上の壁時計（y,m,d,sh,sm,eh,em）＋そのタイムゾーン」で
 *   保持する。相手に送る文面を相手のタイムゾーンで出すため、壁時計 ⇔ epoch の
 *   変換をここに集約する。ブラウザ標準の Intl（ICU）だけを使うので、
 *   夏時間（DST）の切り替えも正しく扱える。
 *
 * 設計上の制約:
 *   - 変換はこのファイル以外で行わない（format.js / panel.js はここを呼ぶ）。
 *   - 不正なタイムゾーン名は localTz() にフォールバックし、例外を外へ出さない。
 */
'use strict';

(function () {

const FALLBACK_TZ = 'UTC';

// 相手の時刻帯の判定（分単位）。日中=業務時間、朝夕=早朝/夜の会議許容帯、それ以外=夜間。
const DAY_START = 9 * 60;
const DAY_END = 18 * 60;
const EDGE_START = 7 * 60;
const EDGE_END = 22 * 60;
const BAND_ORDER = { day: 0, edge: 1, night: 2 };

const dtfCache = new Map();

function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch (_) {
    return FALLBACK_TZ;
  }
}

function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

function resolveTz(tz) {
  return isValidTz(tz) ? tz : localTz();
}

function partsFormatter(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/**
 * epoch(ms) を指定タイムゾーンの壁時計に変換する。
 * @param {number} ms
 * @param {string} tz
 * @returns {{y:number,m:number,d:number,h:number,mi:number,wd:number}} wd は 0=日曜
 */
function epochToZoned(ms, tz) {
  const parts = partsFormatter(resolveTz(tz)).formatToParts(new Date(ms));
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const h = get('hour') % 24;
  const mi = get('minute');
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, h, mi, wd };
}

/**
 * その瞬間のUTCからのオフセット（分、東が正）。
 * @param {string} tz
 * @param {number} ms
 * @returns {number}
 */
function offsetMinutes(tz, ms) {
  const z = epochToZoned(ms, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi);
  const floored = Math.floor(ms / 60000) * 60000;
  return Math.round((asUtc - floored) / 60000);
}

/**
 * 指定タイムゾーンの壁時計を epoch(ms) に変換する。
 * 2パスでオフセットを補正し、DST切替日の前後でも正しい瞬間を返す。
 * （存在しない時刻=春の時計飛びの場合は、直後の有効な瞬間に寄る）
 */
function zonedToEpoch(y, m, d, h, mi, tz) {
  const zone = resolveTz(tz);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = offsetMinutes(zone, guess);
  let ms = guess - off1 * 60000;
  const off2 = offsetMinutes(zone, ms);
  if (off2 !== off1) ms = guess - off2 * 60000;
  return ms;
}

/**
 * 「GMT+9」「GMT-4」「GMT+5:30」「GMT」形式のラベル。言語に依存しない。
 */
function offsetLabel(tz, ms) {
  const off = offsetMinutes(resolveTz(tz), ms == null ? Date.now() : ms);
  if (off === 0) return 'GMT';
  const sign = off > 0 ? '+' : '-';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `GMT${sign}${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

// ICU が旧名で返すタイムゾーンの、現在の都市名表記
const CITY_ALIASES = {
  'Asia/Calcutta': 'Kolkata',
  'Asia/Saigon': 'Ho Chi Minh City',
  'Asia/Katmandu': 'Kathmandu',
  'Asia/Rangoon': 'Yangon',
  'Europe/Kiev': 'Kyiv',
  'America/Godthab': 'Nuuk'
};

/** "America/New_York" → "New York"、"UTC" → "UTC" */
function cityOf(tz) {
  if (CITY_ALIASES[tz]) return CITY_ALIASES[tz];
  const segs = String(tz || '').split('/');
  return segs[segs.length - 1].replace(/_/g, ' ');
}

function regionOf(tz) {
  const segs = String(tz || '').split('/');
  return segs.length > 1 ? segs[0] : '';
}

function listTimeZones() {
  let zones = [];
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone');
  } catch (_) {
    zones = [];
  }
  if (!zones.length) zones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris'];
  if (!zones.includes('UTC')) zones = zones.concat('UTC');
  return zones;
}

// 検索用の索引（略称 "EST"/"PST" や総称 "Eastern Time" でも引けるように）。初回のみ作る。
let searchIndex = null;
function buildSearchIndex(nowMs) {
  return listTimeZones().map((tz) => {
    let shortName = '';
    let genericName = '';
    try {
      shortName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(nowMs).find((p) => p.type === 'timeZoneName').value;
      genericName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' })
        .formatToParts(nowMs).find((p) => p.type === 'timeZoneName').value;
    } catch (_) {
      // 一部の環境で longGeneric 未対応。検索語が減るだけなので無視する。
    }
    const hay = [tz, cityOf(tz), shortName, genericName].join(' ').toLowerCase().replace(/[_/]/g, ' ');
    return { tz, city: cityOf(tz), region: regionOf(tz), hay };
  });
}

function normalizeQuery(q) {
  return String(q || '').trim().toLowerCase().replace(/[_/]/g, ' ').replace(/\s+/g, ' ');
}

/**
 * 都市名・ID・略称・GMTオフセットで検索する。
 * @param {string} query
 * @param {{limit?:number, nowMs?:number}} [opts]
 * @returns {Array<{tz:string, city:string, region:string, offset:string}>}
 */
function searchTimeZones(query, opts) {
  const limit = (opts && opts.limit) || 50;
  const nowMs = (opts && opts.nowMs) || Date.now();
  if (!searchIndex) searchIndex = buildSearchIndex(nowMs);
  const q = normalizeQuery(query);
  const results = [];
  for (const item of searchIndex) {
    const offset = offsetLabel(item.tz, nowMs);
    if (q) {
      const inHay = item.hay.includes(q);
      const inOffset = offset.toLowerCase().replace(/\s+/g, '').startsWith(q.replace(/\s+/g, '')) && q.startsWith('gmt');
      if (!inHay && !inOffset) continue;
    }
    results.push({ tz: item.tz, city: item.city, region: item.region, offset });
  }
  const starts = (r) => (q && r.city.toLowerCase().startsWith(q) ? 0 : 1);
  results.sort((a, b) => starts(a) - starts(b) || a.city.localeCompare(b.city));
  return results.slice(0, limit);
}

/**
 * 分（0〜1439）を時刻帯に分類する。
 * @returns {'day'|'edge'|'night'}
 */
function bandOfMinutes(min) {
  if (min >= DAY_START && min < DAY_END) return 'day';
  if (min >= EDGE_START && min < EDGE_END) return 'edge';
  return 'night';
}

/**
 * 開始〜終了のうち最も「悪い」時刻帯を返す（終了ちょうどは含めない）。
 * @param {number} startMin 0:00からの分
 * @param {number} endMin 0:00からの分（日をまたぐ場合は1440以上でもよい）
 */
function slotBand(startMin, endMin) {
  const lastMin = Math.max(startMin, endMin - 1);
  const a = bandOfMinutes(((startMin % 1440) + 1440) % 1440);
  const b = bandOfMinutes(((lastMin % 1440) + 1440) % 1440);
  return BAND_ORDER[a] >= BAND_ORDER[b] ? a : b;
}

/**
 * Googleカレンダー左上の "GMT+09" "GMT-04:30" "UTC+9" "GMT" を分に変換する。該当しなければ null。
 */
function parseGmtLabel(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 12) return null;
  const m = /^(?:GMT|UTC)(?:\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?)?$/i.exec(t);
  if (!m) return null;
  if (!m[1]) return 0;
  const h = Number(m[2]);
  const mm = m[3] ? Number(m[3]) : 0;
  if (h > 14 || mm > 59) return null;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (h * 60 + mm);
}

const api = {
  FALLBACK_TZ,
  localTz,
  isValidTz,
  resolveTz,
  epochToZoned,
  offsetMinutes,
  zonedToEpoch,
  offsetLabel,
  cityOf,
  regionOf,
  listTimeZones,
  searchTimeZones,
  bandOfMinutes,
  slotBand,
  parseGmtLabel
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.tz = api;
}

})();
