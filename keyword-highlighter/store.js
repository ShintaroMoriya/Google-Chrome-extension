/* キーワード・ハイライター - 状態の保存/読込（content.js / popup.js で共有）
   schemaVersion 付きの1ドキュメントとして永続化する。壊れたデータや
   未知のバージョンは安全側（初期状態）にフォールバックする。
   旧形式（フラットな "keywords" / "enabled" キー）が残っている場合は
   1回だけ新形式へ引き継ぐ（既存ユーザーの登録済みキーワードを消さない）。 */
'use strict';

(function () {

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'keywordHighlighter.v1';
const LEGACY_KEYS = ['keywords', 'enabled'];

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, keywords: [], enabled: true };
}

/**
 * 保存済みデータを現在のスキーマに合わせて安全に読み込む。
 * @param {*} raw
 * @returns {object}
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return freshState();
  switch (raw.schemaVersion) {
    case SCHEMA_VERSION: {
      const base = freshState();
      return {
        schemaVersion: SCHEMA_VERSION,
        keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((k) => k && k.word) : base.keywords,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled
      };
    }
    default:
      return freshState();
  }
}

/**
 * 旧形式（フラットキー）から新形式へ変換する。
 * @param {{keywords?: Array, enabled?: boolean}} legacy
 * @returns {object}
 */
function fromLegacy(legacy) {
  const base = freshState();
  return {
    schemaVersion: SCHEMA_VERSION,
    keywords: Array.isArray(legacy.keywords) ? legacy.keywords.filter((k) => k && k.word) : base.keywords,
    enabled: typeof legacy.enabled === 'boolean' ? legacy.enabled : base.enabled
  };
}

/**
 * 保存済み状態を読み込む。新形式が無ければ旧形式からの引き継ぎを試みる。
 * `isNew` は「保存データが一切無い（初回インストール）」場合だけ true になる。
 * ユーザーが全キーワードを削除した状態（`keywords: []`）とは区別するため、
 * 呼び出し側はこの `isNew` を見て初期値を適用するかどうかを判断する。
 * @returns {Promise<{state: object, isNew: boolean}>}
 */
function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS], (result) => {
      if (result[STORAGE_KEY] !== undefined) {
        resolve({ state: migrate(result[STORAGE_KEY]), isNew: false });
        return;
      }
      if (result.keywords !== undefined || result.enabled !== undefined) {
        resolve({ state: fromLegacy(result), isNew: false });
        return;
      }
      resolve({ state: freshState(), isNew: true });
    });
  });
}

/**
 * 状態を保存する。
 * @param {object} state
 * @returns {Promise<void>}
 */
function save(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, resolve);
  });
}

const api = { SCHEMA_VERSION, STORAGE_KEY, freshState, migrate, fromLegacy, load, save };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.KHStore = api;
}

})();
