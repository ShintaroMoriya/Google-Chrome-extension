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

const storeV3 = require('../src/store.js');

module.exports.push(
  {
    name: 'migrate(v2→v3): 候補とパネル位置を保持し、新しい設定は既定値で補完する',
    fn: () => {
      const v2 = {
        schemaVersion: 2,
        entries: [{ id: 'a', y: 2026, m: 7, d: 25, sh: 10, sm: 0, eh: 11, em: 0 }],
        panel: { x: 10, y: 20, visible: true, pickMode: false },
        settings: { durationMin: 30, snapMin: 30, chipMode: 'slice' }
      };
      const s = storeV3.migrate(v2);
      assert.equal(s.schemaVersion, 3);
      assert.equal(s.entries.length, 1);
      assert.equal(s.entries[0].tz, undefined); // 表示時に自分のタイムゾーンとして解釈
      assert.equal(s.panel.x, 10);
      assert.equal(s.settings.durationMin, 30);
      assert.equal(s.settings.chipMode, 'slice');
      assert.deepEqual(s.settings.recipient, { tz: null, locale: null });
      assert.equal(s.settings.templateId, 'schedule-request');
      assert.deepEqual(s.settings.recentRecipients, []);
    }
  },
  {
    name: 'migrate: 壊れた entries / recipient は安全に捨てる',
    fn: () => {
      const s = storeV3.migrate({ schemaVersion: 3, entries: [null, 'x', { id: 'ok' }], settings: { recipient: 'bad', recentRecipients: 'bad' } });
      assert.deepEqual(s.entries, [{ id: 'ok' }]);
      assert.deepEqual(s.settings.recipient, { tz: null, locale: null });
      assert.deepEqual(s.settings.recentRecipients, []);
    }
  },
  {
    name: 'setRecipient / pushRecentRecipient: 重複は先頭へ移動し最大5件',
    fn: () => {
      let s = storeV3.freshState();
      s = storeV3.setRecipient(s, { tz: 'America/New_York' });
      assert.deepEqual(s.settings.recipient, { tz: 'America/New_York', locale: null });
      for (const tz of ['A/1', 'A/2', 'A/3', 'A/4', 'A/5', 'A/6']) s = storeV3.pushRecentRecipient(s, { tz, locale: 'en-US' });
      assert.equal(s.settings.recentRecipients.length, storeV3.MAX_RECENT_RECIPIENTS);
      assert.equal(s.settings.recentRecipients[0].tz, 'A/6');
      s = storeV3.pushRecentRecipient(s, { tz: 'A/4', locale: 'en-US' });
      assert.equal(s.settings.recentRecipients[0].tz, 'A/4');
      assert.equal(s.settings.recentRecipients.filter((r) => r.tz === 'A/4').length, 1);
    }
  }
);
