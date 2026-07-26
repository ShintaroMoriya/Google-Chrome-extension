'use strict';
/* 依存ゼロの単体テスト: node keyword-highlighter/test/run.js
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

test('freshState: 初期状態はkeywordsが空でenabled=true', () => {
  const s = freshState();
  assert.deepStrictEqual(s.keywords, []);
  assert.strictEqual(s.enabled, true);
});

test('migrate: 壊れたデータは初期状態にフォールバックする', () => {
  assert.deepStrictEqual(migrate(null), freshState());
  assert.deepStrictEqual(migrate('broken'), freshState());
  assert.deepStrictEqual(migrate({ schemaVersion: 999 }), freshState());
});

test('migrate: word の無いエントリは除去する', () => {
  const s = migrate({ schemaVersion: SCHEMA_VERSION, keywords: [{ word: '至急', color: '#fff' }, { color: '#000' }], enabled: false });
  assert.strictEqual(s.keywords.length, 1);
  assert.strictEqual(s.enabled, false);
});

test('fromLegacy: 旧フラットキーの内容を引き継ぐ（初回インストール時に消さない）', () => {
  const s = fromLegacy({ keywords: [{ word: 'クレーム', color: '#f00' }], enabled: false });
  assert.strictEqual(s.schemaVersion, SCHEMA_VERSION);
  assert.deepStrictEqual(s.keywords, [{ word: 'クレーム', color: '#f00' }]);
  assert.strictEqual(s.enabled, false);
});

console.log(`${passed} 件成功`);
if (process.exitCode) {
  console.error('一部のテストが失敗しました');
} else {
  console.log('全テスト成功');
}
