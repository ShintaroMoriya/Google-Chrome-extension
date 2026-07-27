/* 期限みえるくん - 日付ユーティリティ（background.js / popup.js で共有）
   すべての日付計算をローカルタイムゾーン基準に統一する。
   `toISOString().slice(0,10)` はUTC日付を返すため、JST（UTC+9）では
   00:00〜09:00の間だけ日付が1日ズレるバグの原因になっていた。 */
'use strict';

(function () {

/**
 * ローカルタイムゾーンの日付を YYYY-MM-DD 形式で返す。
 * @param {Date} [d]
 * @returns {string}
 */
function localDateKey(d) {
  const date = d || new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 今日からの日数差を返す（0=今日、マイナス=超過）。ローカル日付基準。
 * @param {string} dateStr YYYY-MM-DD
 * @param {Date} [now]
 * @returns {number}
 */
function daysUntil(dateStr, now) {
  const today = now ? new Date(now) : new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

const api = { localDateKey, daysUntil };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.KigenDate = api;
}

})();
