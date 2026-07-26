/* 期限みえるくん - 状態の保存/読込（background.js / popup.js で共有）
   schemaVersion 付きの1ドキュメントとして永続化する。壊れたデータや
   未知のバージョンは安全側（初期状態）にフォールバックする。
   旧形式（フラットな "tasks" キー）が残っている場合は1回だけ新形式へ
   引き継ぐ（既存ユーザーの登録済みタスクを消さない）。 */
'use strict';

(function () {

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'kigenAlert.v1';

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, tasks: [] };
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
      const tasks = Array.isArray(raw.tasks)
        ? raw.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.due === 'string')
        : [];
      return { schemaVersion: SCHEMA_VERSION, tasks };
    }
    default:
      return freshState();
  }
}

/**
 * 旧形式（フラットな "tasks" 配列）から新形式へ変換する。
 * @param {Array} legacyTasks
 * @returns {object}
 */
function fromLegacy(legacyTasks) {
  return migrate({ schemaVersion: SCHEMA_VERSION, tasks: legacyTasks });
}

/**
 * 保存済み状態を読み込む。新形式が無ければ旧形式からの引き継ぎを試みる。
 * `isNew` は「保存データが一切無い（初回インストール）」場合だけ true になる。
 * @returns {Promise<{state: object, isNew: boolean}>}
 */
function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, 'tasks'], (result) => {
      if (result[STORAGE_KEY] !== undefined) {
        resolve({ state: migrate(result[STORAGE_KEY]), isNew: false });
        return;
      }
      if (result.tasks !== undefined) {
        resolve({ state: fromLegacy(result.tasks), isNew: false });
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
  globalThis.KAStore = api;
}

})();
