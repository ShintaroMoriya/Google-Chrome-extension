/**
 * src/store.js — 状態の保存/読込と、エントリ一覧に対する純粋なリデューサ
 *
 * 候補日時・ページ内パネルの状態を chrome.storage.local に保存する。
 * スキーマ変更時も、過去の候補を安全に引き継ぐ。
 *
 * v3（拡張機能 v2.0.0）:
 *   - エントリに tz（追加した時点の自分のタイムゾーン）を持たせる。v2以前の
 *     エントリは tz を持たず、表示時に「現在の自分のタイムゾーン」として解釈する。
 *   - settings に 相手（recipient: tz / locale）・自分のタイムゾーン（myTz）・
 *     選択中の定型文（templateId）・最近の相手（recentRecipients）・初回ガイド
 *     表示済み（onboarded）を追加。null は「自動」を意味する。
 */
'use strict';

(function () {

const SCHEMA_VERSION = 3;
const MAX_RECENT_RECIPIENTS = 5;
const STORAGE_KEY = 'gcalScheduleMemo.v1';
const MAX_ENTRIES = 3;

function freshState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: [],
    panel: { x: null, y: null, visible: false, pickMode: false },
    settings: defaultSettings()
  };
}

function defaultSettings() {
  return {
    durationMin: 60,
    snapMin: 15,
    chipMode: 'whole',
    myTz: null,
    recipient: { tz: null, locale: null },
    templateId: 'schedule-request',
    recentRecipients: [],
    onboarded: false
  };
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  const src = isPlainObject(raw) ? raw : {};
  const merged = Object.assign({}, base, src);
  merged.recipient = Object.assign({}, base.recipient, isPlainObject(src.recipient) ? src.recipient : {});
  merged.recentRecipients = Array.isArray(src.recentRecipients)
    ? src.recentRecipients.filter(isPlainObject).slice(0, MAX_RECENT_RECIPIENTS)
    : [];
  return merged;
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
    entries: Array.isArray(raw.entries) ? raw.entries.filter(isPlainObject).slice(0, MAX_ENTRIES) : [],
    panel: Object.assign({}, base.panel, isPlainObject(raw.panel) ? raw.panel : {}),
    settings: normalizeSettings(raw.settings)
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
    case 2:
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

/**
 * 相手（タイムゾーン・書式）を部分更新する。null は「自動」。
 * @param {object} state
 * @param {{tz?:?string, locale?:?string}} patch
 */
function setRecipient(state, patch) {
  const recipient = Object.assign({}, state.settings.recipient, patch);
  return setSettings(state, { recipient });
}

/**
 * 最近の相手の先頭に追加する（同じ組合せは先頭へ移動、最大5件）。
 * @param {object} state
 * @param {{tz:string, locale:string}} recipient
 */
function pushRecentRecipient(state, recipient) {
  if (!recipient || !recipient.tz) return state;
  const item = { tz: recipient.tz, locale: recipient.locale || null };
  const rest = (state.settings.recentRecipients || [])
    .filter((r) => !(r.tz === item.tz && (r.locale || null) === item.locale));
  return setSettings(state, { recentRecipients: [item].concat(rest).slice(0, MAX_RECENT_RECIPIENTS) });
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
  MAX_RECENT_RECIPIENTS,
  freshState,
  defaultSettings,
  normalizeSettings,
  stateFromKnownShape,
  migrate,
  isSameSlot,
  addEntry,
  removeEntry,
  clearEntries,
  setPanel,
  setSettings,
  setRecipient,
  pushRecentRecipient,
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
