'use strict';
/* 依存ゼロの単体テスト: node sales-desk/test/run.js
   store.js（schemaVersion付き永続化・旧形式からの引き継ぎ）を検証する。 */

const assert = require('assert');
const path = require('path');
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

test('freshState: links/templatesはundefined（呼び出し側が既定値を適用する）、todosは空配列', () => {
  const s = freshState();
  assert.strictEqual(s.links, undefined);
  assert.strictEqual(s.templates, undefined);
  assert.deepStrictEqual(s.todos, []);
  assert.strictEqual(s.memo, '');
});

test('migrate: 壊れたデータ・未知のバージョンは初期状態にフォールバックする', () => {
  assert.deepStrictEqual(migrate(null), freshState());
  assert.deepStrictEqual(migrate({ schemaVersion: 999 }), freshState());
});

test('migrate: ユーザーが全削除した空配列は、undefinedに巻き戻さずそのまま保持する', () => {
  const s = migrate({ schemaVersion: SCHEMA_VERSION, links: [], templates: [], memo: '', todos: [] });
  assert.deepStrictEqual(s.links, []);
  assert.deepStrictEqual(s.templates, []);
});

test('fromLegacy: 旧フラットキーの内容を引き継ぐ（初回移行時に消さない）', () => {
  const s = fromLegacy({
    links: [{ name: 'Gmail', url: 'https://mail.google.com/', emoji: '✉️' }],
    memo: '電話メモ',
    todos: [{ text: 'A社見積', done: false }]
  });
  assert.strictEqual(s.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(s.links.length, 1);
  assert.strictEqual(s.memo, '電話メモ');
  assert.strictEqual(s.todos.length, 1);
});

console.log(`${passed} 件成功`);
if (process.exitCode) {
  console.error('一部のテストが失敗しました');
} else {
  console.log('全テスト成功');
}
