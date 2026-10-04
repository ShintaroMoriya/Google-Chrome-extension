/**
 * src/i18n.js — UI文言の取得（chrome.i18n の薄いラッパー）
 *
 * 目的:
 *   UIはアイコン中心で、文字は aria-label / title / 短い通知だけに使う。
 *   その文言を _locales/<lang>/messages.json から引く。ブラウザでは
 *   chrome.i18n.getMessage（ブラウザのUI言語で自動選択）を使い、Node の
 *   テストでは JSON を直接読む。
 *
 * 注意:
 *   UIの言語（ブラウザの言語）と、コピーする文面の言語（相手の言語）は別物。
 *   文面の言語は format.js / templates.js 側で扱い、ここでは扱わない。
 */
'use strict';

(function () {

const isNode = typeof module !== 'undefined' && module.exports;
let nodeLang = 'en';
const nodeCache = {};

function nodeMessages(lang) {
  if (!nodeCache[lang]) {
    // eslint-disable-next-line global-require
    nodeCache[lang] = require(`../_locales/${lang}/messages.json`);
  }
  return nodeCache[lang];
}

/**
 * messages.json の1件を、Chrome と同じ規則（$name$ → placeholders → $1..$9）で展開する。
 */
function expand(entry, subs) {
  if (!entry || typeof entry.message !== 'string') return '';
  const list = subs == null ? [] : [].concat(subs).map(String);
  let text = entry.message;
  const placeholders = entry.placeholders || {};
  text = text.replace(/\$([a-zA-Z0-9_@]+)\$/g, (whole, name) => {
    const ph = placeholders[name.toLowerCase()] || placeholders[name];
    return ph ? ph.content : whole;
  });
  return text.replace(/\$(\d)/g, (whole, n) => (list[Number(n) - 1] != null ? list[Number(n) - 1] : ''));
}

function hasChromeI18n() {
  return typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function';
}

/**
 * UI文言を取得する。見つからなければ空文字（呼び出し側でフォールバックする）。
 * @param {string} key
 * @param {string|number|Array<string|number>} [subs]
 * @returns {string}
 */
function t(key, subs) {
  if (!isNode && hasChromeI18n()) {
    const list = subs == null ? undefined : [].concat(subs).map(String);
    return chrome.i18n.getMessage(key, list) || '';
  }
  return expand(nodeMessages(nodeLang)[key], subs);
}

/** ブラウザのUI言語（例: 'ja', 'en-US'）。 */
function uiLang() {
  if (!isNode && hasChromeI18n() && typeof chrome.i18n.getUILanguage === 'function') {
    return chrome.i18n.getUILanguage();
  }
  if (isNode) return nodeLang;
  return (typeof navigator !== 'undefined' && navigator.language) || 'en';
}

/** テスト用: Node で使う言語を切り替える。 */
function setNodeLang(lang) {
  nodeLang = lang;
}

const api = { t, uiLang, setNodeLang, expand };
if (isNode) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.i18n = api;
}

})();
