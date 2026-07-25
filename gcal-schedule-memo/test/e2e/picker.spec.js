#!/usr/bin/env node
'use strict';

/**
 * test/e2e/picker.spec.js — Playwrightによる拡張機能のE2Eテスト
 *
 * 目的:
 *   Googleアカウントにログインできないこの開発環境でも、拡張機能を実際に
 *   Chromiumへロードし、test/fixtures/week-view.html（Googleカレンダー週表示を
 *   模した静的HTML）に対してクリック横取り・日時抽出・パネルUIが
 *   一気通貫で動くことを検証する。
 *
 *   これは「Googleカレンダーの実DOMに対して動く」保証にはならない
 *   （fixtureは自作の模造品のため）。実機での確認は README.md の
 *   チェックリストに従ってユーザーが行う。
 *
 * 呼び出し方:
 *   拡張機能のロードには画面（ヘッドフルChromium）が必要なため、
 *   xvfbで仮想ディスプレイを立てて実行する。
 *
 *     xvfb-run -a node gcal-schedule-memo/test/e2e/picker.spec.js
 *
 *   事前に test/e2e/ で `npm install` するか、既存のグローバル
 *   playwright を `node_modules/playwright` にシンボリックリンクしておくこと。
 *
 * 設計上の制約:
 *   - manifest.json の content_scripts.matches / host_permissions は
 *     本番同様 https://calendar.google.com/* のみに保つ。テストのために
 *     本番の権限範囲を緩めることはしない。そのため、拡張機能一式を
 *     一時ディレクトリにコピーし、そのコピーの manifest.json にだけ
 *     ローカル静的サーバのオリジンを追加してロードする。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('./node_modules/playwright');

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_PATH = path.resolve(__dirname, '..', 'fixtures', 'week-view.html');

let passCount = 0;
let failCount = 0;

/**
 * 1ステップを実行し、成否をコンソールに出す（test/run.jsと同じ流儀）。
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function check(name, fn) {
  try {
    await fn();
    passCount += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failCount += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err && err.message ? err.message : err}`);
  }
}

/**
 * fixtureのHTMLだけを返す最小の静的サーバを起動する。
 * @returns {Promise<import('node:http').Server>}
 */
function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      fs.readFile(FIXTURE_PATH, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/**
 * 拡張機能一式（manifest.json / background.js / src/ / icons/）を、
 * テスト用オリジンだけを追加した manifest.json とともに一時ディレクトリへコピーする。
 * @param {string} testOrigin 例: 'http://127.0.0.1:12345'
 * @returns {string} 一時ディレクトリのパス
 */
function prepareExtensionCopy(testOrigin) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-ext-'));
  for (const name of ['background.js', 'src', 'icons']) {
    fs.cpSync(path.join(EXT_ROOT, name), path.join(tmpDir, name), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${testOrigin}/*`);
  manifest.content_scripts[0].matches.push(`${testOrigin}/*`);
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return tmpDir;
}

async function main() {
  const server = await startFixtureServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const extDir = prepareExtensionCopy(origin);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-profile-'));

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-sandbox'
    ]
  });

  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${origin}/week-view.html`);
    await page.waitForSelector('#gcal-schedule-memo-host', { state: 'attached' });
    await page.waitForTimeout(200); // loadState() の非同期完了を待つ

    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    // background.js の chrome.action.onClicked ハンドラと同じ効果を、
    // service worker上で直接再現する（Playwrightにはツールバーアイコンを
    // クリックするAPIが無いため）。
    async function toggleViaIcon() {
      await sw.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'GSM_TOGGLE_PANEL' });
      });
    }

    async function entryTexts() {
      return page.locator('#gcal-schedule-memo-host .entry-text').allTextContents();
    }

    /**
     * ホバープレビュー（枠+ラベル）の現在の表示状態を読む。
     * @returns {Promise<{boxVisible: boolean, labelText: string}>}
     */
    async function previewState() {
      return page.evaluate(() => {
        const host = document.getElementById('gcal-schedule-memo-preview-host');
        const box = host.shadowRoot.querySelector('.box');
        const label = host.shadowRoot.querySelector('.label');
        return {
          boxVisible: getComputedStyle(box).display !== 'none',
          labelText: label.textContent
        };
      });
    }

    await check('アイコンクリックでパネルが表示され取得モードがONになる', async () => {
      await toggleViaIcon();
      await page.waitForTimeout(150);
      const visible = await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      );
      assert.equal(visible, true);
      const pick = await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick'));
      assert.equal(pick, 'on');
    });

    await check('チップにカーソルを合わせると、クリックで追加される内容と同じ文言でプレビューされる', async () => {
      const chipBox = await page.locator('.chip').boundingBox();
      await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await page.waitForTimeout(80); // requestAnimationFrame 1回分の猶予
      const { boxVisible, labelText } = await previewState();
      assert.equal(boxVisible, true);
      assert.equal(labelText, '7月25日(土) 10:00〜11:00');
    });

    await check('予定チップをクリックすると一覧に追加され、詳細ポップアップは開かない', async () => {
      await page.locator('.chip').click();
      await page.waitForTimeout(100);
      const texts = await entryTexts();
      assert.deepEqual(texts, ['7月25日(土) 10:00〜11:00']);
      const popupVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('detail-popup')).display !== 'none'
      );
      assert.equal(popupVisible, false, '横取りに失敗し詳細ポップアップが開いてしまっている');
    });

    await check('空き枠にカーソルを合わせると、実際にクリックした場合と同じ時刻がプレビュー表示される', async () => {
      const colBox = await page.locator('[data-testid="col-2026-07-26"]').boundingBox();
      await page.mouse.move(colBox.x + 30, colBox.y + 672); // 14:00相当（下のクリック位置と同一座標）
      await page.waitForTimeout(80);
      const { boxVisible, labelText } = await previewState();
      assert.equal(boxVisible, true);
      assert.equal(labelText, '7月26日(日) 14:00〜15:00');
    });

    await check('空き枠をクリックすると時刻付きで追加され、予定作成バブルは開かない', async () => {
      await page.locator('[data-testid="col-2026-07-26"]').click({ position: { x: 30, y: 672 } }); // 14:00相当
      await page.waitForTimeout(100);
      const texts = await entryTexts();
      assert.ok(texts.includes('7月26日(日) 14:00〜15:00'), `実際の一覧: ${texts.join(' / ')}`);
      const bubbleVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('create-bubble')).display !== 'none'
      );
      assert.equal(bubbleVisible, false, '横取りに失敗し予定作成バブルが開いてしまっている');
    });

    await check('グリッド外にカーソルを移すとプレビューは消える', async () => {
      // #main はflexコンテナで幅いっぱいに広がるため、(5,5)のような単純な
      // 座標は実際にはグリッド内になってしまう。#main の矩形の外側
      // （右側の余白）へ確実に出す。
      const mainBox = await page.locator('#main').boundingBox();
      const outsideX = mainBox.x + mainBox.width + 20;
      await page.mouse.move(outsideX, 5);
      await page.waitForTimeout(80);
      const { boxVisible } = await previewState();
      assert.equal(boxVisible, false);
    });

    await check('同じ枠を2回目クリックしても重複追加されない', async () => {
      const before = (await entryTexts()).length;
      await page.locator('[data-testid="col-2026-07-26"]').click({ position: { x: 30, y: 672 } });
      await page.waitForTimeout(100);
      const after = (await entryTexts()).length;
      assert.equal(after, before);
    });

    await check('終日行（極端に低い列）をクリックしても追加されない', async () => {
      const before = (await entryTexts()).length;
      await page.locator('[data-testid="col-allday"]').click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(100);
      const after = (await entryTexts()).length;
      assert.equal(after, before);
    });

    await check('上限5件: 5件目まで追加でき、6件目は追加されない', async () => {
      const col = page.locator('[data-testid="col-2026-07-26"]');
      await col.click({ position: { x: 30, y: 768 } }); // 16:00
      await page.waitForTimeout(80);
      await col.click({ position: { x: 30, y: 864 } }); // 18:00
      await page.waitForTimeout(80);
      await col.click({ position: { x: 30, y: 960 } }); // 20:00
      await page.waitForTimeout(80);
      let texts = await entryTexts();
      assert.equal(texts.length, 5, `5件になっているはず: ${texts.join(' / ')}`);

      await col.click({ position: { x: 30, y: 1056 } }); // 22:00 → 6件目のはずが拒否される
      await page.waitForTimeout(100);
      texts = await entryTexts();
      assert.equal(texts.length, 5, '上限を超えて追加されてはいけない');
    });

    await check('一覧は常に時系列昇順で表示される', async () => {
      const texts = await entryTexts();
      assert.deepEqual(texts, [
        '7月25日(土) 10:00〜11:00',
        '7月26日(日) 14:00〜15:00',
        '7月26日(日) 16:00〜17:00',
        '7月26日(日) 18:00〜19:00',
        '7月26日(日) 20:00〜21:00'
      ]);
    });

    await check('コピー ボタンで期待どおりのテキストがクリップボードに入る', async () => {
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await page.locator('#gcal-schedule-memo-host [data-action="copy"]').click();
      await page.waitForTimeout(100);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(
        clip,
        [
          '7月25日(土) 10:00〜11:00',
          '7月26日(日) 14:00〜15:00',
          '7月26日(日) 16:00〜17:00',
          '7月26日(日) 18:00〜19:00',
          '7月26日(日) 20:00〜21:00'
        ].join('\n')
      );
    });

    await check('個別削除で1件だけ消える', async () => {
      const before = await entryTexts();
      await page.locator('#gcal-schedule-memo-host li.entry').first().locator('.entry-remove').click();
      await page.waitForTimeout(100);
      const after = await entryTexts();
      assert.equal(after.length, before.length - 1);
      assert.ok(!after.includes(before[0]));
    });

    await check('全消去は2回押しで確定する（1回目では消えない）', async () => {
      const clearBtn = page.locator('#gcal-schedule-memo-host [data-action="clear"]');
      await clearBtn.click();
      await page.waitForTimeout(50);
      let texts = await entryTexts();
      assert.ok(texts.length > 0, '1回目のクリックで消えてはいけない');

      await clearBtn.click();
      await page.waitForTimeout(50);
      texts = await entryTexts();
      assert.equal(texts.length, 0);
    });

    await check('ESCで取得モードがOFFになり、プレビューも消え、通常のカレンダー操作に戻る', async () => {
      // ESC前にプレビューが出ている状態を作ってから押す。
      const chipBox = await page.locator('.chip').boundingBox();
      await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await page.waitForTimeout(80);
      assert.equal((await previewState()).boxVisible, true, '前提: ESC前はプレビューが出ているはず');

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      const pick = await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick'));
      assert.equal(pick, 'off');
      assert.equal((await previewState()).boxVisible, false, 'ESC後はプレビューも消えているはず');

      await page.locator('[data-testid="col-2026-07-26"]').click({ position: { x: 30, y: 200 } });
      await page.waitForTimeout(100);
      const bubbleVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('create-bubble')).display !== 'none'
      );
      assert.equal(bubbleVisible, true, 'ESC後は横取りされず、通常どおり予定作成バブルが開くはず');
    });

    await check('パネルを閉じると取得モードも必ずOFFになる', async () => {
      // 直前のESCステップでは取得モードだけをOFFにしており、パネル自体は
      // まだ表示中（visible: true）のはず。ここでは閉じるボタンを直接押す
      // （toggleViaIcon()を呼ぶとvisibleを反転させてしまい二重トグルになる）。
      const stillVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      );
      assert.equal(stillVisible, true, '前提: ESC後もパネルは表示されたままのはず');

      await page.locator('#gcal-schedule-memo-host .close-btn').click();
      await page.waitForTimeout(100);
      const pick = await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick'));
      assert.equal(pick, 'off');
      const visible = await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      );
      assert.equal(visible, false);
    });
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(extDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log('');
  console.log(`${passCount} / ${passCount + failCount} 件成功`);
  if (failCount > 0) {
    console.error(`${failCount} 件失敗しました`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('E2Eテストで想定外のエラー:', err);
  process.exitCode = 1;
});
