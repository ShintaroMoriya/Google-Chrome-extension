#!/usr/bin/env node
'use strict';

/**
 * test/e2e/picker.spec.js — Playwrightによる拡張機能の操作テスト
 *
 * Googleカレンダー週表示を模したfixtureに拡張機能を実際に読み込み、候補取得・
 * 手入力・相手のタイムゾーン/言語でのコピー・ショートカットまでを検証する。
 * 実際のGoogleカレンダーDOMに対する動作保証ではないため、最終的な実機確認は
 * READMEのチェックリストに従う。
 *
 * 実行環境は固定する: UI言語 en-US、タイムゾーン Asia/Tokyo。
 * SHOT_DIR を指定すると、パネルのスクリーンショット（ライト/ダーク）を保存する。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('./node_modules/playwright');

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_PATH = path.resolve(__dirname, '..', 'fixtures', 'week-view.html');
const SHOT_DIR = process.env.SHOT_DIR || '';
const HOST = '#gcal-schedule-memo-host';
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
  for (const name of ['background.js', 'src', 'icons', '_locales']) {
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
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--lang=en-US',
      '--no-sandbox'
    ]
  });

  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${origin}/week-view.html`);
    await page.waitForSelector(HOST, { state: 'attached' });
    await page.waitForTimeout(200);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });

    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    async function sendToTab(type) {
      await sw.evaluate(async (msgType) => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        await chrome.tabs.sendMessage(tabs[0].id, { type: msgType });
      }, type);
    }
    const q = (sel) => page.locator(`${HOST} ${sel}`);
    async function entryTexts() {
      return q('.entry-text').allTextContents();
    }
    async function clipboard() {
      return page.evaluate(() => navigator.clipboard.readText());
    }
    async function previewState() {
      return page.evaluate(() => {
        const host = document.getElementById('gcal-schedule-memo-preview-host');
        const box = host.shadowRoot.querySelector('.box');
        const label = host.shadowRoot.querySelector('.label');
        return { boxVisible: getComputedStyle(box).display !== 'none', labelText: label.textContent, boxFull: box.classList.contains('full') };
      });
    }
    async function shot(name) {
      if (!SHOT_DIR) return;
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const box = await page.evaluate(() => {
        const el = document.getElementById('gcal-schedule-memo-host').shadowRoot.querySelector('.panel');
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const pad = 24;
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name}.png`),
        clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 }
      });
    }

    await check('アイコンクリックでパネルが表示され取得モードがONになる（UIはアイコン＋英語のaria）', async () => {
      await sendToTab('GSM_TOGGLE_PANEL');
      await page.waitForTimeout(400);
      const visible = await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      );
      assert.equal(visible, true);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick')), 'on');
      assert.equal(await q('.pick-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await q('.copy-btn').isDisabled(), true);
      assert.equal(await q('.slot.empty').count(), 3);
      await shot('01-empty-light');
    });

    await check('予定チップのプレビューとクリック結果が一致し、詳細ポップアップは開かない', async () => {
      const chipBox = await page.locator('#main .chip').boundingBox();
      await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await page.waitForTimeout(80);
      const pv = await previewState();
      assert.equal(pv.boxVisible, true);
      assert.equal(pv.labelText, 'Sat, Jul 25 · 10:00 – 11:00 AM');
      await page.locator('#main .chip').click();
      await page.waitForTimeout(150);
      assert.deepEqual(await entryTexts(), ['Sat, Jul 25 · 10:00 – 11:00 AM']);
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
      assert.equal((await previewState()).labelText, 'Sun, Jul 26 · 2:00 – 3:00 PM');
      await column.click({ position: { x: 30, y: 672 } });
      await page.waitForTimeout(150);
      assert.ok((await entryTexts()).includes('Sun, Jul 26 · 2:00 – 3:00 PM'));
      const bubbleVisible = await page.evaluate(
        () => getComputedStyle(document.getElementById('create-bubble')).display !== 'none'
      );
      assert.equal(bubbleVisible, false);
    });

    await check('＋から手入力で3件目を追加でき（終了は開始＋長さで自動補完）、一覧は時系列順', async () => {
      await q('.slot.empty [data-action="manual-open"]').first().click();
      await q('[data-manual="date"]').fill('2026-07-27');
      await q('[data-manual="start"]').fill('09:30');
      await q('[data-manual="start"]').dispatchEvent('change');
      assert.equal(await q('[data-manual="end"]').inputValue(), '10:30');
      await q('[data-manual="end"]').fill('10:00');
      await q('[data-action="manual-add"]').click();
      await page.waitForTimeout(150);
      assert.deepEqual(await entryTexts(), [
        'Sat, Jul 25 · 10:00 – 11:00 AM',
        'Sun, Jul 26 · 2:00 – 3:00 PM',
        'Mon, Jul 27 · 9:30 – 10:00 AM'
      ]);
      assert.equal(await q('.manual').isHidden(), true);
      assert.equal(await q('.dots.full').count(), 1);
      await shot('02-three-light');
    });

    await check('上限3件では4件目を追加できず、枠が揺れてプレビューはグレーになる', async () => {
      const column = page.locator('[data-testid="col-2026-07-26"]');
      const colBox = await column.boundingBox();
      await page.mouse.move(colBox.x + 30, colBox.y + 768);
      await page.waitForTimeout(80);
      assert.equal((await previewState()).boxFull, true);
      await column.click({ position: { x: 30, y: 768 } });
      await page.waitForTimeout(60);
      assert.equal(await q('ul.slots.shake').count(), 1);
      await page.waitForTimeout(500);
      assert.equal((await entryTexts()).length, 3);
    });

    await check('「候補のみ」で3候補が改行区切りでクリップボードに入り、ボタンが✓に変わる', async () => {
      await q('[data-template-id="list"]').click();
      await q('[data-action="copy"]').click();
      await page.waitForTimeout(150);
      assert.equal(await clipboard(), [
        'Sat, Jul 25 · 10:00 – 11:00 AM',
        'Sun, Jul 26 · 2:00 – 3:00 PM',
        'Mon, Jul 27 · 9:30 – 10:00 AM'
      ].join('\n'));
      assert.equal(await q('.copy-btn.done').count(), 1);
    });

    await check('相手のタイムゾーンをNew Yorkにすると、相手の時刻（夜アイコン・日付ずれ）で表示・コピーされる', async () => {
      await q('[data-action="open-tz"]').click();
      await q('input[data-role="tz-search"]').fill('new york');
      await page.waitForTimeout(80);
      await shot('03-tz-sheet-light');
      await q('.list .row[data-tz="America/New_York"]').click();
      await page.waitForTimeout(150);
      assert.ok((await q('.chip.tz').textContent()).includes('New York'));
      assert.equal(await q('.their').count(), 3);
      assert.ok(await q('.their .band-night, .their .band-edge, .their .band-day').count() >= 3);
      assert.ok((await q('.their .shift').count()) >= 1);
      await q('[data-template-id="schedule-request"]').click();
      await q('[data-action="copy"]').click();
      await page.waitForTimeout(150);
      const text = await clipboard();
      assert.ok(text.startsWith('Hi,\n\nHere are a few times that work for me:'), text);
      assert.ok(text.includes('• Fri, Jul 24 · 9:00 – 10:00 PM EDT'), text);
      assert.ok(text.includes('• Sun, Jul 26 · 1:00 – 2:00 AM EDT'), text);
      assert.ok(text.endsWith('Best regards,'));
      await shot('04-recipient-ny-light');
    });

    await check('ホバーのラベルに相手の時刻が並ぶ', async () => {
      await q('.entry .entry-remove').last().click();
      await page.waitForTimeout(100);
      const column = page.locator('[data-testid="col-2026-07-26"]');
      const colBox = await column.boundingBox();
      await page.mouse.move(colBox.x + 30, colBox.y + 480);
      await page.waitForTimeout(80);
      assert.equal((await previewState()).labelText, 'Sun, Jul 26 · 10:00 – 11:00 AM→9:00 – 10:00 PM EDT');
      await column.click({ position: { x: 30, y: 480 } });
      await page.waitForTimeout(150);
      assert.equal((await entryTexts()).length, 3);
    });

    await check('言語を日本語にすると、日本語の定型文＋相手の時刻（GMT表記）でコピーされる', async () => {
      await q('[data-action="open-lang"]').click();
      await page.waitForTimeout(50);
      assert.equal(await q('.row.sample').count(), 3);
      await q('.row.sample[data-locale="ja"]').click();
      await page.waitForTimeout(100);
      await q('[data-action="copy"]').click();
      await page.waitForTimeout(150);
      const text = await clipboard();
      assert.ok(text.startsWith('お世話になっております。'), text);
      assert.ok(text.includes('・7月24日(金) 21:00〜22:00 (GMT-4)'), text);
      assert.ok(text.endsWith('何卒よろしくお願いいたします。'));
    });

    await check('ショートカット（GSM_COPY）で選択中の定型文をコピーし、最近の相手に残る', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await q('[data-template-id="reschedule-request"]').click();
      await page.bringToFront();
      await sendToTab('GSM_COPY');
      await page.waitForTimeout(200);
      const text = await clipboard();
      assert.ok(text.includes('再調整をお願いできますでしょうか'), text);
      assert.equal(await q('.hud.show').count(), 1);
      await q('[data-action="open-tz"]').click();
      await page.waitForTimeout(50);
      assert.ok(await q('.list .row[data-tz="America/New_York"][data-locale="ja"]').count() >= 1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      assert.equal(await q('.view-sheet').isHidden(), true);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-gsm-pick')), 'on');
    });

    await check('自分のタイムゾーンがカレンダー表示(GMT+09)と食い違うと、設定に警告が出る', async () => {
      await q('[data-action="open-settings"]').click();
      await page.waitForTimeout(50);
      assert.equal(await q('.note').count(), 0);
      await q('[data-action="open-mytz"]').click();
      await q('input[data-role="tz-search"]').fill('london');
      await page.waitForTimeout(50);
      await q('.list .row[data-tz="Europe/London"]').click();
      await page.waitForTimeout(150);
      assert.ok((await q('.note').textContent()).includes('GMT+9'));
      await shot('05-settings-light');
      await q('[data-action="open-mytz"]').click();
      await q('.list .row[data-tz=""]').click();
      await page.waitForTimeout(100);
      assert.equal(await q('.note').count(), 0);
      await q('[data-action="sheet-back"]').click();
    });

    await check('個別削除と全消去（2回押し）が機能する', async () => {
      await q('li.entry').first().locator('.entry-remove').click();
      await page.waitForTimeout(80);
      assert.equal((await entryTexts()).length, 2);
      const clearButton = q('[data-action="clear"]');
      await clearButton.click();
      await page.waitForTimeout(50);
      assert.equal((await entryTexts()).length, 2);
      assert.equal(await q('.clear.armed').count(), 1);
      await clearButton.click();
      await page.waitForTimeout(80);
      assert.equal((await entryTexts()).length, 0);
    });

    await check('5,000要素の重いページでも、ホバー中に長いタスク（50ms超）が発生しない', async () => {
      await page.evaluate(() => {
        const main = document.getElementById('main');
        const filler = document.createElement('div');
        filler.style.cssText = 'position:absolute; left:-9999px; top:0;';
        for (let i = 0; i < 5000; i += 1) {
          const d = document.createElement('div');
          d.textContent = i % 7 === 0 ? `Item ${i}` : '';
          filler.appendChild(d);
        }
        main.appendChild(filler);
        window.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__longTasks.push(e.duration);
        }).observe({ type: 'longtask', buffered: false });
      });
      const column = page.locator('[data-testid="col-2026-07-26"]');
      const colBox = await column.boundingBox();
      for (let i = 0; i < 40; i += 1) {
        await page.mouse.move(colBox.x + 30, colBox.y + 300 + i * 12);
        await page.waitForTimeout(16);
      }
      const longTasks = await page.evaluate(() => window.__longTasks);
      assert.deepEqual(longTasks, []);
    });

    if (SHOT_DIR) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.mouse.move(5, 5);
      const column = page.locator('[data-testid="col-2026-07-26"]');
      await column.click({ position: { x: 30, y: 480 } });
      await page.locator('#main .chip').click();
      await page.waitForTimeout(200);
      await shot('06-dark');
      await page.emulateMedia({ colorScheme: 'light' });
    }

    await check('Escで取得モードがOFFになり、パネルを閉じても通常操作を妨げない', async () => {
      const chipBox = await page.locator('#main .chip').boundingBox();
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
      await q('.close-btn').click();
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(
        () => getComputedStyle(document.getElementById('gcal-schedule-memo-host')).display !== 'none'
      ), false);
    });

    await check('再読み込み後も候補・相手・定型文の選択が保持される', async () => {
      await page.reload();
      await page.waitForSelector(HOST, { state: 'attached' });
      await page.waitForTimeout(300);
      await sendToTab('GSM_TOGGLE_PANEL');
      await page.waitForTimeout(300);
      assert.ok((await q('.chip.tz').textContent()).includes('New York'));
      assert.equal(await q('[data-template-id="reschedule-request"]').getAttribute('aria-checked'), 'true');
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
