'use strict';
/* 依存ゼロの単体テスト: node kigen-alert/test/run.js
   date.js（ローカル日付ユーティリティ）と store.js（schemaVersion付き
   永続化・旧形式からの引き継ぎ）を検証する。
   date.jsのテストがあれば、日付キーのUTC/ローカル混在バグ（通知の重複・
   期限初期値のズレ）は入り口で検出できた。 */

const assert = require('assert');
const path = require('path');
const { localDateKey, daysUntil } = require(path.join(__dirname, '..', 'date.js'));
const { SCHEMA_VERSION, freshState, migrate, fromLegacy } = require(path.join(__dirname, '..', 'store.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// --- localDateKey ---------------------------------------------------------

test('localDateKey: 正午JSTを想定した日付をそのまま返す', () => {
  const d = new Date(2026, 6, 25, 12, 0, 0); // 月は0始まり: 6=7月
  assert.strictEqual(localDateKey(d), '2026-07-25');
});

test('localDateKey: 深夜0時台でも当日の日付を返す（UTC変換によるズレが無い）', () => {
  const d = new Date(2026, 6, 25, 0, 30, 0);
  assert.strictEqual(localDateKey(d), '2026-07-25');
});

test('localDateKey: 月・日を2桁ゼロ埋めする', () => {
  const d = new Date(2026, 0, 5, 10, 0, 0); // 2026-01-05
  assert.strictEqual(localDateKey(d), '2026-01-05');
});

// --- daysUntil --------------------------------------------------------------

test('daysUntil: 同日なら0を返す', () => {
  const now = new Date(2026, 6, 25, 9, 0, 0);
  assert.strictEqual(daysUntil('2026-07-25', now), 0);
});

test('daysUntil: 明日なら1、昨日なら-1を返す', () => {
  const now = new Date(2026, 6, 25, 9, 0, 0);
  assert.strictEqual(daysUntil('2026-07-26', now), 1);
  assert.strictEqual(daysUntil('2026-07-24', now), -1);
});

test('回帰: 同時刻でも localDateKey と daysUntil が同じ「今日」を指す（キーのズレ再発防止）', () => {
  // 旧実装は toISOString().slice(0,10) を使っており、UTC基準の日付が
  // ローカル基準の daysUntil とズレるバグがあった。両者は常に同じ
  // 基準（ローカル）で計算されるべき。
  const now = new Date(2026, 6, 25, 8, 0, 0); // 朝8時
  const todayKey = localDateKey(now);
  assert.strictEqual(daysUntil(todayKey, now), 0);
});

// --- store.js ---------------------------------------------------------------

test('freshState: tasksは空配列', () => {
  assert.deepStrictEqual(freshState().tasks, []);
});

test('migrate: 壊れたデータ・未知のバージョンは初期状態にフォールバックする', () => {
  assert.deepStrictEqual(migrate(null), freshState());
  assert.deepStrictEqual(migrate({ schemaVersion: 999 }), freshState());
});

test('migrate: id/title/dueが揃っていないタスクは除去する', () => {
  const s = migrate({
    schemaVersion: SCHEMA_VERSION,
    tasks: [
      { id: '1', title: 'A社見積', due: '2026-07-25', done: false },
      { id: '2', title: 'B社見積' } // due 欠落
    ]
  });
  assert.strictEqual(s.tasks.length, 1);
  assert.strictEqual(s.tasks[0].id, '1');
});

test('fromLegacy: 旧フラットキー(tasks配列)の内容を引き継ぐ（初回移行時に消さない）', () => {
  const s = fromLegacy([{ id: '9', title: 'C社提出', due: '2026-08-01', done: false }]);
  assert.strictEqual(s.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(s.tasks.length, 1);
  assert.strictEqual(s.tasks[0].title, 'C社提出');
});

console.log(`${passed} 件成功`);
if (process.exitCode) {
  console.error('一部のテストが失敗しました');
} else {
  console.log('全テスト成功');
}
