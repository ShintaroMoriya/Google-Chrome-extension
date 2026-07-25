#!/usr/bin/env node
'use strict';

/**
 * test/run.js — 依存ゼロの簡易テストランナー
 *
 * 目的:
 *   src/*.js の純粋関数群を node:assert だけで検証する。
 *   Playwright等の外部依存を使わずに `node gcal-schedule-memo/test/run.js`
 *   だけで即実行できることを優先する（house の依存ゼロ思想に合わせる）。
 *
 * 呼び出し方:
 *   node gcal-schedule-memo/test/run.js
 *
 * 各 *.test.js は module.exports = [{ name, fn }, ...] の配列を返す。
 * fn は node:assert を使って検証し、失敗時は例外を投げる。
 */

const path = require('node:path');
const fs = require('node:fs');

const TEST_DIR = __dirname;

async function main() {
  const files = fs
    .readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort();

  let total = 0;
  let failed = 0;

  for (const file of files) {
    const cases = require(path.join(TEST_DIR, file));
    for (const { name, fn } of cases) {
      total += 1;
      try {
        // fn は同期・非同期のどちらもありうるため常に await する。
        await fn();
        console.log(`  ok  ${file} › ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`FAIL  ${file} › ${name}`);
        console.error(`      ${err && err.message ? err.message : err}`);
      }
    }
  }

  console.log('');
  console.log(`${total - failed} / ${total} 件成功`);
  if (failed > 0) {
    console.error(`${failed} 件失敗しました`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('テストランナーで想定外のエラー:', err);
  process.exit(1);
});
