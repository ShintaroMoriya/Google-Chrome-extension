/**
 * src/store.js — 状態の保存/読込と、エントリ一覧に対する純粋なリデューサ
 *
 * 候補日時・ページ内パネルの状態を chrome.storage.local に保存する。
 * スキーマ変更時も、過去の候補を安全に引き継ぐ。
 */
'use strict';

(function () {

const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'gcalScheduleMemo.v1';
const MAX_ENTRIES = 3;

function freshState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    panel: { x: null, y: null, visible: false, pickMode: false },
    settings: { durationMin: 60, snapMin: 15 }
  };
}

/**
 * 各スキーマで共通する、保存済みの安全な読み込み。
 * @param {object} raw
 * @returns {object}
 */
function stateFromKnownShape(raw) {
  const base = freshState();
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: Array.isArray(raw.entries) ? raw.entries.slice(0, MAX_ENTRIES) : [],
    panel: Object.assign({}, base.panel, raw.panel && typeof raw.panel === 'object' ? raw.panel : {}),
    settings: Object.assign({}, base.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {})
  };
}

/**
 * 保存済みデータを現在のスキーマに合わせて安全に読み込む。
 * v1では候補を最大5件保存していたため、時系列ではなく利用者が選んだ順序の
 * 先頭3件を引き継ぐ（意図せず候補を増やさない安全側の移行）。
 * @param {*} raw
 * @returns {object}
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return freshState();

  switch (raw.schemaVersion) {
    case 1:
    case SCHEMA_VERSION:
      return stateFromKnownShape(raw);
    default:
      return freshState();
  }
}

function isSameSlot(a, b) {
  return (
    a.y === b.y && a.m === b.m && a.d === b.d &&
    a.sh === b.sh && a.sm === b.sm && a.eh === b.eh && a.em === b.em
  );
}

/**
 * 抽出結果または手入力結果を状態に追加する。
 * @param {object} state
 * @param {object} pick { y, m, d, sh, sm, eh, em, confidence, source, warning? }
 * @param {() => string} [idGen]
 * @returns {{state: object, result: 'added'|'duplicate'|'full'}}
 */
function addEntry(state, pick, idGen) {
  const dup = state.entries.find((entry) => isSameSlot(entry, pick));
  if (dup) return { state, result: 'duplicate' };
  if (state.entries.length >= MAX_ENTRIES) return { state, result: 'full' };

  const gen = idGen || (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const entry = Object.assign({ id: gen(), addedAt: Date.now() }, pick);
  return {
    state: Object.assign({}, state, { entries: state.entries.concat(entry) }),
    result: 'added'
  };
}

function removeEntry(state, id) {
  return Object.assign({}, state, { entries: state.entries.filter((entry) => entry.id !== id) });
}

function clearEntries(state) {
  return Object.assign({}, state, { entries: [] });
}

function setPanel(state, patch) {
  return Object.assign({}, state, { panel: Object.assign({}, state.panel, patch) });
}

function setSettings(state, patch) {
  return Object.assign({}, state, { settings: Object.assign({}, state.settings, patch) });
}

function createMemoryBackend() {
  let store = {};
  return {
    get(key) { return Promise.resolve(store[key]); },
    set(key, value) {
      store[key] = value;
      return Promise.resolve();
    }
  };
}

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

function createStorage() {
  const hasChromeStorage =
    typeof globalThis.chrome !== 'undefined' &&
    globalThis.chrome.storage &&
    globalThis.chrome.storage.local;
  return hasChromeStorage ? createChromeBackend() : createMemoryBackend();
}

async function loadState(storage) {
  const raw = await storage.get(STORAGE_KEY);
  return migrate(raw);
}

function saveState(storage, state) {
  return storage.set(STORAGE_KEY, state);
}

const api = {
  SCHEMA_VERSION,
  STORAGE_KEY,
  MAX_ENTRIES,
  freshState,
  stateFromKnownShape,
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
