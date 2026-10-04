/**
 * src/templates.js — 日程調整メール用テンプレート（純粋関数）
 *
 * {{slots}}（日本語文面では従来の {{候補日時}} も可）を候補の箇条書きに置換する。
 * 文面の整形をここに集約し、UI層やクリップボード処理から切り離すことで、
 * テスト可能に保つ。
 *
 * v2.0.0: 英語の文面を追加し、言語（'ja' | 'en'）ごとにテンプレートを持つ。
 *   'list'（候補のみ）もテンプレートの1種として扱い、UIでは同じ並びで選ばせる。
 *   文面の言語は「相手の言語」に従う（UIの言語ではない）。
 */
'use strict';

(function () {

const SLOT_TOKEN = '{{候補日時}}';
const SLOTS_TOKEN = '{{slots}}';
const LIST_TEMPLATE_ID = 'list';
const LANGS = ['ja', 'en'];

// UIの並び順（アイコンのセグメント）。'list' は本文なしで候補行だけをコピーする。
const TEMPLATE_IDS = [LIST_TEMPLATE_ID, 'schedule-request', 'reschedule-request', 'online-meeting-request'];

const BULLET = { ja: '・', en: '• ' };
const EMPTY_SLOT_HINT = { ja: '・候補日時を追加してください', en: '• (add your available times)' };

const TEMPLATES = {
  ja: [
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
  ],
  en: [
    {
      id: 'schedule-request',
      title: 'Propose times',
      body: 'Hi,\n\nHere are a few times that work for me:\n\n{{slots}}\n\nPlease let me know which one works best for you. If none of these suit you, feel free to suggest other times.\n\nBest regards,'
    },
    {
      id: 'reschedule-request',
      title: 'Ask to reschedule',
      body: 'Hi,\n\nThank you for arranging our meeting. Unfortunately, something has come up and I need to reschedule. Would any of these times work for you instead?\n\n{{slots}}\n\nSorry for the inconvenience, and thank you for your understanding.\n\nBest regards,'
    },
    {
      id: 'online-meeting-request',
      title: 'Suggest a video call',
      body: 'Hi,\n\nWould you be available for a short video call? Here are a few times that work for me:\n\n{{slots}}\n\nOnce you pick a time, I will send over a meeting link.\n\nBest regards,'
    }
  ]
};

// v1互換: 日本語テンプレートの一覧
const DEFAULT_TEMPLATES = TEMPLATES.ja;

function normalizeLang(lang) {
  return LANGS.includes(lang) ? lang : 'ja';
}

/**
 * 候補日時一覧をメール向けの箇条書きへ整形する。
 * @param {Array<object>} entries
 * @param {(entries:Array<object>) => string} formatAll 1行1候補の文字列を返す関数
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
function formatSlotsForEmail(entries, formatAll, lang) {
  const bullet = BULLET[normalizeLang(lang)];
  const lines = formatAll(entries).split('\n').filter(Boolean);
  return lines.map((line) => `${bullet}${line}`).join('\n');
}

/**
 * テンプレートを候補日時入りのメール本文へ展開する。
 * 'list' テンプレートは箇条書き記号なしの候補行だけを返す。
 * @param {{id?:string, body?:string}} template
 * @param {Array<object>} entries
 * @param {(entries:Array<object>) => string} formatAll
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
function renderTemplate(template, entries, formatAll, lang) {
  if (template && template.id === LIST_TEMPLATE_ID) return formatAll(entries);
  if (!template || typeof template.body !== 'string') return '';
  const l = normalizeLang(lang);
  const slots = formatSlotsForEmail(entries, formatAll, l) || EMPTY_SLOT_HINT[l];
  return template.body.replaceAll(SLOT_TOKEN, slots).replaceAll(SLOTS_TOKEN, slots);
}

/**
 * IDでテンプレートを取得する。第2引数は言語コード、またはテンプレート配列（v1互換）。
 * @param {string} id
 * @param {'ja'|'en'|Array<object>} [langOrTemplates]
 */
function findTemplate(id, langOrTemplates) {
  if (id === LIST_TEMPLATE_ID) return { id: LIST_TEMPLATE_ID, title: '' };
  const list = Array.isArray(langOrTemplates)
    ? langOrTemplates
    : TEMPLATES[normalizeLang(langOrTemplates)];
  return list.find((template) => template.id === id) || null;
}

const api = {
  SLOT_TOKEN,
  SLOTS_TOKEN,
  LIST_TEMPLATE_ID,
  TEMPLATE_IDS,
  LANGS,
  TEMPLATES,
  DEFAULT_TEMPLATES,
  formatSlotsForEmail,
  renderTemplate,
  findTemplate
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.templates = api;
}

})();
