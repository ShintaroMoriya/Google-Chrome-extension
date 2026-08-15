/**
 * src/templates.js — 日程調整メール用テンプレート（純粋関数）
 *
 * {{候補日時}} を候補の箇条書きに置換する。文面の整形をここに集約し、
 * UI層やクリップボード処理から切り離すことで、テスト可能に保つ。
 */
'use strict';

(function () {

const SLOT_TOKEN = '{{候補日時}}';

const DEFAULT_TEMPLATES = [
  {
    id: 'schedule-request',
    title: '候補日を送る',
    body: 'お世話になっております。\n\nお打ち合わせの候補日をお送りいたします。\n\n{{候補日時}}\n\n上記でご都合はいかがでしょうか。\nご都合が合わない場合は、恐れ入りますが別の候補をいくつかお知らせください。\n\n何卒よろしくお願いいたします。'
  },
  {
    id: 'reschedule-request',
    title: '再調整をお願いする',
    body: 'お世話になっております。\n\n先日は日程のご調整をいただき、ありがとうございます。\n恐れ入りますが、都合により再調整をお願いできますでしょうか。\n\n{{候補日時}}\n\nお手数をおかけして申し訳ございません。\nご都合のよい日時がございましたらお知らせください。\n\n何卒よろしくお願いいたします。'
  },
  {
    id: 'online-meeting-request',
    title: 'オンライン打合せを提案',
    body: 'お世話になっております。\n\nオンラインで30分ほどお打ち合わせのお時間を頂戴できればと存じます。\n下記の候補日時はいかがでしょうか。\n\n{{候補日時}}\n\nご都合のよいお時間をご指定いただけますと幸いです。\n\n何卒よろしくお願いいたします。'
  }
];

/**
 * 候補日時一覧をメール向けの中黒箇条書きへ整形する。
 * @param {Array<object>} entries
 * @param {(entries:Array<object>) => string} formatAll
 * @returns {string}
 */
function formatSlotsForEmail(entries, formatAll) {
  const lines = formatAll(entries).split('\n').filter(Boolean);
  return lines.map((line) => `・${line}`).join('\n');
}

/**
 * テンプレートを候補日時入りのメール本文へ展開する。
 * @param {{body:string}} template
 * @param {Array<object>} entries
 * @param {(entries:Array<object>) => string} formatAll
 * @returns {string}
 */
function renderTemplate(template, entries, formatAll) {
  if (!template || typeof template.body !== 'string') return '';
  const slots = formatSlotsForEmail(entries, formatAll);
  return template.body.replaceAll(SLOT_TOKEN, slots || '・候補日時を追加してください');
}

function findTemplate(id, templates) {
  return (templates || DEFAULT_TEMPLATES).find((template) => template.id === id) || null;
}

const api = { SLOT_TOKEN, DEFAULT_TEMPLATES, formatSlotsForEmail, renderTemplate, findTemplate };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.templates = api;
}

})();
