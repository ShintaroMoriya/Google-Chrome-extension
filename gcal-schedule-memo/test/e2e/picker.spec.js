#!/usr/bin/env node
'use strict';

/**
 * test/e2e/picker.spec.js — Playwrightによる拡張機能の操作テスト
 *
 * Googleカレンダー週表示を模したfixtureに拡張機能を実際に読み込み、候補取得・
 * 手入力・定型メールのコピーまでを検証する。実際のGoogleカレンダーDOMに対する
 * 動作保証ではないため、最終的な実機確認はREADMEのチェックリストに従う。
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
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
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
    await page.waitForTimeout(200);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });

    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    async function toggleViaIcon() {
      await sw.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        await chrome.tabs.sendMessage(tabs[0].id, { type: 'GSM_TOGGLE_PANEL' });
      });
    }
    async function entryTexts() {
      return page.locator('#gcal-schedule-memo-host .entry-text').allTextContents();
    }
    async function previewState() {
      return page.evaluate(() => {
        const host = document.getElementById('gcal-schedule-memo-preview-host');
        const box = host.shadowRoot.querySelector('.box');
        const label = host.shadowRoot.querySelector('.label');
        return { boxVisible: getComputedStyle(box).display !== 'none', labelText: label.textContent };
      });
    }

    await check('アイコンクリックでパネルが表示され取得モードがONになる', async () => {
      await toggleViaIcon();
      await page.waitForTimeout(150);
      const visible = await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      );
      assert.equal(visible, true);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick')), 'on');
    });

    await check('予定チップのプレビューとクリック結果が一致し、詳細ポップアップは開かない', async () => {
      const chipBox = await page.locator('.chip').boundingBox();
      await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await page.waitForTimeout(80);
      assert.deepEqual(await previewState(), { boxVisible: true, labelText: '7月25日(土) 10:00〜11:00' });
      await page.locator('.chip').click();
      await page.waitForTimeout(100);
      assert.deepEqual(await entryTexts(), ['7月25日(土) 10:00〜11:00']);
      const popupVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('detail-popup')).display !== 'none'
      );
      assert.equal(popupVisible, false);
    });

    await check('空き枠のプレビューとクリック結果が一致し、予定作成バブルは開かない', async () => {
      const column = page.locator('[data-testid="col-2026-07-26"]');
      const colBox = await column.boundingBox();
      await page.mouse.move(colBox.x + 30, colBox.y + 672);
      await page.waitForTimeout(80);
      assert.deepEqual(await previewState(), { boxVisible: true, labelText: '7月26日(日) 14:00〜15:00' });
      await column.click({ position: { x: 30, y: 672 } });
      await page.waitForTimeout(100);
      assert.ok((await entryTexts()).includes('7月26日(日) 14:00〜15:00'));
      const bubbleVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('create-bubble')).display !== 'none'
      );
      assert.equal(bubbleVisible, false);
    });

    await check('手入力で3件目を追加でき、一覧は常に時系列順に表示される', async () => {
      await page.locator('#gcal-schedule-memo-host [data-manual="date"]').fill('2026-07-27');
      await page.locator('#gcal-schedule-memo-host [data-manual="start"]').fill('09:30');
      await page.locator('#gcal-schedule-memo-host [data-manual="end"]').fill('10:00');
      await page.locator('#gcal-schedule-memo-host [data-action="manual-add"]').click();
      await page.waitForTimeout(100);
      assert.deepEqual(await entryTexts(), [
        '7月25日(土) 10:00〜11:00',
        '7月26日(日) 14:00〜15:00',
        '7月27日(月) 09:30〜10:00'
      ]);
    });

    await check('上限3件では4件目を追加できない', async () => {
      const column = page.locator('[data-testid="col-2026-07-26"]');
      await column.click({ position: { x: 30, y: 768 } });
      await page.waitForTimeout(100);
      assert.equal((await entryTexts()).length, 3);
    });

    await check('候補のみコピーで3候補が改行区切りでクリップボードに入る', async () => {
      await page.locator('#gcal-schedule-memo-host [data-action="copy-candidates"]').click();
      await page.waitForTimeout(100);
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        ['7月25日(土) 10:00〜11:00', '7月26日(日) 14:00〜15:00', '7月27日(月) 09:30〜10:00'].join('\n')
      );
    });

    await check('定型文ボタンで候補日時を差し込んだメール全文をコピーできる', async () => {
      await page.locator('#gcal-schedule-memo-host [data-template-id="schedule-request"]').click();
      await page.waitForTimeout(100);
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(clipboard.startsWith('お世話になっております。'));
      assert.ok(clipboard.includes('・7月25日(土) 10:00〜11:00'));
      assert.ok(clipboard.includes('・7月27日(月) 09:30〜10:00'));
      assert.ok(clipboard.endsWith('何卒よろしくお願いいたします。'));
    });

    await check('個別削除と全消去（2回押し）が機能する', async () => {
      await page.locator('#gcal-schedule-memo-host li.entry').first().locator('.entry-remove').click();
      await page.waitForTimeout(80);
      assert.equal((await entryTexts()).length, 2);
      const clearButton = page.locator('#gcal-schedule-memo-host [data-action="clear"]');
      await clearButton.click();
      await page.waitForTimeout(50);
      assert.equal((await entryTexts()).length, 2);
      await clearButton.click();
      await page.waitForTimeout(50);
      assert.equal((await entryTexts()).length, 0);
    });

    await check('Escで取得モードがOFFになり、パネルを閉じても通常操作を妨げない', async () => {
      const chipBox = await page.locator('.chip').boundingBox();
      await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await page.waitForTimeout(80);
      assert.equal((await previewState()).boxVisible, true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick')), 'off');
      assert.equal((await previewState()).boxVisible, false);
      await page.locator('[data-testid="col-2026-07-26"]').click({ position: { x: 30, y: 200 } });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(
        () => getComputedStyle(document.getElementById('create-bubble')).display !== 'none'
      ), true);
      await page.locator('#gcal-schedule-memo-host .close-btn').click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      ), false);
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
