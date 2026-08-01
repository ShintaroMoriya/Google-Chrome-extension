/* セールスデスク - 状態の保存/読込
   schemaVersion 付きの1ドキュメントとして永続化する。壊れたデータや
   未知のバージョンは安全側（初期状態）にフォールバックする。
   旧形式（フラットな "links" / "templates" / "memo" / "todos" キー）が
   残っている場合は1回だけ新形式へ引き継ぐ（既存ユーザーのデータを消さない）。
   「未設定（undefined）」と「ユーザーが意図的に空にした」を区別するため、
   各フィールドの既定値適用は呼び出し側（sidepanel.js）の責務とする
   （このファイルは保存されている値をそのまま運ぶだけ）。 */
'use strict';

(function () {

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'salesDesk.v1';
const LEGACY_KEYS = ['links', 'templates', 'memo', 'todos'];

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, links: undefined, templates: undefined, memo: '', todos: [] };
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
      return {
        schemaVersion: SCHEMA_VERSION,
        links: Array.isArray(raw.links) ? raw.links : undefined,
        templates: Array.isArray(raw.templates) ? raw.templates : undefined,
        memo: typeof raw.memo === 'string' ? raw.memo : '',
        todos: Array.isArray(raw.todos) ? raw.todos : []
      };
    }
    default:
      return freshState();
  }
}

/**
 * 旧形式（フラットキー）から新形式へ変換する。
 * @param {{links?: Array, templates?: Array, memo?: string, todos?: Array}} legacy
 * @returns {object}
 */
function fromLegacy(legacy) {
  return {
    schemaVersion: SCHEMA_VERSION,
    links: Array.isArray(legacy.links) ? legacy.links : undefined,
    templates: Array.isArray(legacy.templates) ? legacy.templates : undefined,
    memo: typeof legacy.memo === 'string' ? legacy.memo : '',
    todos: Array.isArray(legacy.todos) ? legacy.todos : []
  };
}

/**
 * 保存済み状態を読み込む。新形式が無ければ旧形式からの引き継ぎを試みる。
 * @returns {Promise<object>}
 */
function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS], (result) => {
      if (result[STORAGE_KEY] !== undefined) {
        resolve(migrate(result[STORAGE_KEY]));
        return;
      }
      const hasLegacy = LEGACY_KEYS.some((k) => result[k] !== undefined);
      resolve(hasLegacy ? fromLegacy(result) : freshState());
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
    chrome.storage.local.set({ [STORAGE_KEY]: Object.assign({ schemaVersion: SCHEMA_VERSION }, state) }, resolve);
  });
}

const api = { SCHEMA_VERSION, STORAGE_KEY, freshState, migrate, fromLegacy, load, save };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.SDStore = api;
}

})();
