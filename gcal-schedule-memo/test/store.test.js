'use strict';

const assert = require('node:assert/strict');
const {
  SCHEMA_VERSION,
  MAX_ENTRIES,
  freshState,
  migrate,
  addEntry,
  removeEntry,
  clearEntries,
  setPanel,
  setSettings,
  createMemoryBackend,
  loadState,
  saveState
} = require('../src/store.js');

function pick(y, m, d, sh, sm, eh, em, confidence) {
  return { y, m, d, sh, sm, eh, em, confidence: confidence || 'high', source: 'chip' };
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `id-${idCounter}`;
}

module.exports = [
  {
    name: 'migrate: undefined/null/壊れたデータは初期状態にフォールバックする',
    fn: () => {
      assert.deepEqual(migrate(undefined), freshState());
      assert.deepEqual(migrate(null), freshState());
      assert.deepEqual(migrate('not-an-object'), freshState());
      assert.deepEqual(migrate({}), freshState());
    }
  },
  {
    name: 'migrate: 未知の将来バージョンは初期状態にフォールバックする（データを壊さず安全側に倒す）',
    fn: () => {
      const future = { schemaVersion: 99, entries: [pick(2026, 7, 25, 10, 0, 11, 0)] };
      assert.deepEqual(migrate(future), freshState());
    }
  },
  {
    name: 'migrate: 現バージョンのデータはそのまま（不足フィールドは既定値で補完）',
    fn: () => {
      const raw = { schemaVersion: SCHEMA_VERSION, entries: [{ id: 'a', ...pick(2026, 7, 25, 10, 0, 11, 0) }] };
      const migrated = migrate(raw);
      assert.equal(migrated.entries.length, 1);
      assert.equal(migrated.panel.visible, false); // 既定値で補完
      assert.equal(migrated.settings.durationMin, 60); // 既定値で補完
    }
  },
  {
    name: 'addEntry: 新規追加で1件増え、resultはadded',
    fn: () => {
      const s0 = freshState();
      const { state: s1, result } = addEntry(s0, pick(2026, 7, 25, 10, 0, 11, 0), nextId);
      assert.equal(result, 'added');
      assert.equal(s1.entries.length, 1);
    }
  },
  {
    name: 'addEntry: 完全一致する日時は重複として弾く（stateは変更しない）',
    fn: () => {
      const s0 = freshState();
      const { state: s1 } = addEntry(s0, pick(2026, 7, 25, 10, 0, 11, 0), nextId);
      const { state: s2, result } = addEntry(s1, pick(2026, 7, 25, 10, 0, 11, 0), nextId);
      assert.equal(result, 'duplicate');
      assert.equal(s2.entries.length, 1);
      assert.equal(s2, s1); // 変更なし（同一参照）
    }
  },
  {
    name: 'addEntry: 開始・終了のどちらかが違えば重複ではない',
    fn: () => {
      const s0 = freshState();
      const { state: s1 } = addEntry(s0, pick(2026, 7, 25, 10, 0, 11, 0), nextId);
      const { state: s2, result } = addEntry(s1, pick(2026, 7, 25, 10, 0, 12, 0), nextId);
      assert.equal(result, 'added');
      assert.equal(s2.entries.length, 2);
    }
  },
  {
    name: `addEntry: ${MAX_ENTRIES}件で上限に達し、6件目はfullとして拒否・追加しない`,
    fn: () => {
      let state = freshState();
      for (let i = 0; i < MAX_ENTRIES; i++) {
        const r = addEntry(state, pick(2026, 7, 25, 8 + i, 0, 9 + i, 0), nextId);
        state = r.state;
        assert.equal(r.result, 'added');
      }
      assert.equal(state.entries.length, MAX_ENTRIES);

      const { state: after, result } = addEntry(state, pick(2026, 7, 25, 20, 0, 21, 0), nextId);
      assert.equal(result, 'full');
      assert.equal(after.entries.length, MAX_ENTRIES); // 変わらない（古いものを押し出さない）
    }
  },
  {
    name: 'removeEntry: 指定IDだけを削除する',
    fn: () => {
      let state = freshState();
      state = addEntry(state, pick(2026, 7, 25, 9, 0, 10, 0), () => 'x').state;
      state = addEntry(state, pick(2026, 7, 26, 9, 0, 10, 0), () => 'y').state;
      const after = removeEntry(state, 'x');
      assert.equal(after.entries.length, 1);
      assert.equal(after.entries[0].id, 'y');
    }
  },
  {
    name: 'clearEntries: 全件削除する',
    fn: () => {
      let state = freshState();
      state = addEntry(state, pick(2026, 7, 25, 9, 0, 10, 0), () => 'x').state;
      const after = clearEntries(state);
      assert.equal(after.entries.length, 0);
    }
  },
  {
    name: 'setPanel / setSettings: 部分更新できる（他フィールドは保持）',
    fn: () => {
      const s0 = freshState();
      const s1 = setPanel(s0, { visible: true });
      assert.equal(s1.panel.visible, true);
      assert.equal(s1.panel.pickMode, false); // 既存値を保持

      const s2 = setSettings(s1, { durationMin: 30 });
      assert.equal(s2.settings.durationMin, 30);
      assert.equal(s2.settings.snapMin, 15); // 既存値を保持
    }
  },
  {
    name: 'メモリバックエンドでの load/save 往復（chrome APIが無い環境の動作確認）',
    fn: async () => {
      const backend = createMemoryBackend();
      const empty = await loadState(backend);
      assert.deepEqual(empty, freshState());

      const withEntry = addEntry(freshState(), pick(2026, 7, 25, 10, 0, 11, 0), () => 'z').state;
      await saveState(backend, withEntry);
      const reloaded = await loadState(backend);
      assert.equal(reloaded.entries.length, 1);
      assert.equal(reloaded.entries[0].id, 'z');
    }
  }
];
