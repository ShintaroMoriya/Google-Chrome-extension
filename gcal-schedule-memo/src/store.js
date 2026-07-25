/**
 * src/store.js — 状態の保存/読込と、エントリ一覧に対する純粋なリデューサ
 *
 * 目的:
 *   メモの中身（最大5件のエントリ）とパネルの表示状態を
 *   chrome.storage.local に永続化する。wardrobe/index.html の
 *   schemaVersion 方式を踏襲し、将来の形式変更に安全に備える。
 *
 * 設計上の制約:
 *   - 状態を書き換えるロジック（追加/削除/上限判定/重複判定）は
 *     ストレージ層から切り離した純粋関数にする。これにより
 *     Node上でchrome API無しに完全にテストできる。
 *   - ストレージバックエンドは chrome.storage.local が無い環境
 *     （Node実行時、Playwrightのフィクスチャページ等）では
 *     メモリ上のバックエンドに自動フォールバックする
 *     （storageShim）。これによりパネルUI全体を拡張機能の外でも
 *     動作検証できる。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'gcalScheduleMemo.v1';
const MAX_ENTRIES = 5;

/**
 * 初期状態（データが無い/壊れている場合の安全な既定値）。
 * @returns {object}
 */
function freshState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    panel: { x: null, y: null, visible: false, pickMode: false },
    settings: { durationMin: 60, snapMin: 15 }
  };
}

/**
 * 保存済みデータを現在のスキーマに合わせて安全に読み込む。
 * 不明な形式・壊れたデータはすべて既定値にフォールバックする
 * （データを部分的に壊した状態で使い続けさせない）。
 * @param {*} raw
 * @returns {object}
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return freshState();

  switch (raw.schemaVersion) {
    case SCHEMA_VERSION: {
      const base = freshState();
      const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, MAX_ENTRIES) : [];
      return {
        schemaVersion: SCHEMA_VERSION,
        entries,
        panel: Object.assign({}, base.panel, raw.panel && typeof raw.panel === 'object' ? raw.panel : {}),
        settings: Object.assign({}, base.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {})
      };
    }
    default:
      // 未知のバージョン（将来の形式 or 壊れたデータ）は安全側に倒して初期化する。
      return freshState();
  }
}

/**
 * 2エントリが同一の日時レンジかどうか。
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function isSameSlot(a, b) {
  return (
    a.y === b.y && a.m === b.m && a.d === b.d &&
    a.sh === b.sh && a.sm === b.sm && a.eh === b.eh && a.em === b.em
  );
}

/**
 * 抽出結果(pick)を状態に追加する。
 * @param {object} state
 * @param {object} pick { y, m, d, sh, sm, eh, em, confidence, source, warning? }
 * @param {() => string} [idGen]
 * @returns {{state: object, result: 'added'|'duplicate'|'full'}}
 */
function addEntry(state, pick, idGen) {
  const dup = state.entries.find((e) => isSameSlot(e, pick));
  if (dup) {
    return { state, result: 'duplicate' };
  }
  if (state.entries.length >= MAX_ENTRIES) {
    return { state, result: 'full' };
  }
  const gen = idGen || (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const entry = Object.assign({ id: gen(), addedAt: Date.now() }, pick);
  return {
    state: Object.assign({}, state, { entries: state.entries.concat(entry) }),
    result: 'added'
  };
}

/**
 * 指定IDのエントリを1件削除する。
 * @param {object} state
 * @param {string} id
 * @returns {object}
 */
function removeEntry(state, id) {
  return Object.assign({}, state, { entries: state.entries.filter((e) => e.id !== id) });
}

/**
 * 全エントリを削除する。
 * @param {object} state
 * @returns {object}
 */
function clearEntries(state) {
  return Object.assign({}, state, { entries: [] });
}

/**
 * パネルの表示状態（位置・表示/非表示・取得モード）を部分更新する。
 * @param {object} state
 * @param {object} patch
 * @returns {object}
 */
function setPanel(state, patch) {
  return Object.assign({}, state, { panel: Object.assign({}, state.panel, patch) });
}

/**
 * 設定（既定所要時間・スナップ単位）を部分更新する。
 * @param {object} state
 * @param {object} patch
 * @returns {object}
 */
function setSettings(state, patch) {
  return Object.assign({}, state, { settings: Object.assign({}, state.settings, patch) });
}

// ---------------------------------------------------------------------------
// ストレージバックエンド（chrome.storage.local が無ければメモリにフォールバック）
// ---------------------------------------------------------------------------

/**
 * メモリ上のバックエンド。Node実行時やPlaywrightのフィクスチャページなど、
 * chrome.storage が存在しない環境でパネルUIを動かすために使う。
 */
function createMemoryBackend() {
  let store = {};
  return {
    get(key) {
      return Promise.resolve(store[key]);
    },
    set(key, value) {
      store[key] = value;
      return Promise.resolve();
    }
  };
}

/**
 * chrome.storage.local を Promise ベースの薄いインターフェースにラップする。
 */
function createChromeBackend() {
  return {
    get(key) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => resolve(result[key]));
      });
    },
    set(key, value) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }
  };
}

/**
 * 実行環境に応じたストレージバックエンドを1つ作る。
 * @returns {{get:(key:string)=>Promise<*>, set:(key:string, value:*)=>Promise<void>}}
 */
function createStorage() {
  const hasChromeStorage =
    typeof globalThis.chrome !== 'undefined' &&
    globalThis.chrome.storage &&
    globalThis.chrome.storage.local;
  return hasChromeStorage ? createChromeBackend() : createMemoryBackend();
}

/**
 * 保存済み状態を読み込む（無ければ初期状態）。
 * @param {{get:(key:string)=>Promise<*>}} storage
 * @returns {Promise<object>}
 */
async function loadState(storage) {
  const raw = await storage.get(STORAGE_KEY);
  return migrate(raw);
}

/**
 * 状態を保存する。
 * @param {{set:(key:string, value:*)=>Promise<void>}} storage
 * @param {object} state
 * @returns {Promise<void>}
 */
function saveState(storage, state) {
  return storage.set(STORAGE_KEY, state);
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.store / Node: module.exports）
// ---------------------------------------------------------------------------
const api = {
  SCHEMA_VERSION,
  STORAGE_KEY,
  MAX_ENTRIES,
  freshState,
  migrate,
  isSameSlot,
  addEntry,
  removeEntry,
  clearEntries,
  setPanel,
  setSettings,
  createMemoryBackend,
  createChromeBackend,
  createStorage,
  loadState,
  saveState
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.store = api;
}

})();
