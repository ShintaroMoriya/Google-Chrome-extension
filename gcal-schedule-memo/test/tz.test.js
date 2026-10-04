'use strict';

const assert = require('node:assert/strict');
const tz = require('../src/tz.js');

module.exports = [
  {
    name: 'zonedToEpoch / epochToZoned: 東京の壁時計は往復で一致する',
    fn: () => {
      const ms = tz.zonedToEpoch(2026, 9, 1, 10, 0, 'Asia/Tokyo');
      assert.equal(ms, Date.UTC(2026, 8, 1, 1, 0));
      const z = tz.epochToZoned(ms, 'Asia/Tokyo');
      assert.deepEqual(z, { y: 2026, m: 9, d: 1, h: 10, mi: 0, wd: 2 });
    }
  },
  {
    name: 'zonedToEpoch: ニューヨークの夏時間（EDT, UTC-4）と冬時間（EST, UTC-5）を区別する',
    fn: () => {
      assert.equal(tz.zonedToEpoch(2026, 7, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 6, 1, 13, 0));
      assert.equal(tz.zonedToEpoch(2026, 1, 15, 9, 0, 'America/New_York'), Date.UTC(2026, 0, 15, 14, 0));
    }
  },
  {
    name: 'zonedToEpoch: DST切替日（2026-03-08開始 / 2026-11-01終了）の前後で正しい瞬間を返す',
    fn: () => {
      // 3/8 01:30 EST(-5) / 03:30 EDT(-4)
      assert.equal(tz.zonedToEpoch(2026, 3, 8, 1, 30, 'America/New_York'), Date.UTC(2026, 2, 8, 6, 30));
      assert.equal(tz.zonedToEpoch(2026, 3, 8, 3, 30, 'America/New_York'), Date.UTC(2026, 2, 8, 7, 30));
      // 11/1 00:30 EDT(-4) / 03:00 EST(-5)
      assert.equal(tz.zonedToEpoch(2026, 11, 1, 0, 30, 'America/New_York'), Date.UTC(2026, 10, 1, 4, 30));
      assert.equal(tz.zonedToEpoch(2026, 11, 1, 3, 0, 'America/New_York'), Date.UTC(2026, 10, 1, 8, 0));
    }
  },
  {
    name: 'offsetLabel: 言語に依存しないGMT表記（30分単位のオフセットも表せる）',
    fn: () => {
      const ms = Date.UTC(2026, 6, 1);
      assert.equal(tz.offsetLabel('Asia/Tokyo', ms), 'GMT+9');
      assert.equal(tz.offsetLabel('America/New_York', ms), 'GMT-4');
      assert.equal(tz.offsetLabel('Asia/Kolkata', ms), 'GMT+5:30');
      assert.equal(tz.offsetLabel('UTC', ms), 'GMT');
    }
  },
  {
    name: 'resolveTz: 不正なタイムゾーン名は例外を出さずローカルへフォールバックする',
    fn: () => {
      assert.equal(tz.isValidTz('Mars/Olympus'), false);
      assert.equal(tz.resolveTz('Mars/Olympus'), tz.localTz());
      assert.equal(tz.resolveTz('Asia/Tokyo'), 'Asia/Tokyo');
    }
  },
  {
    name: 'cityOf / searchTimeZones: 都市名・略称・GMTオフセットで検索できる',
    fn: () => {
      assert.equal(tz.cityOf('America/Argentina/Buenos_Aires'), 'Buenos Aires');
      const nowMs = Date.UTC(2026, 6, 1);
      assert.equal(tz.searchTimeZones('new york', { nowMs })[0].tz, 'America/New_York');
      assert.ok(tz.searchTimeZones('tokyo', { nowMs }).some((r) => r.tz === 'Asia/Tokyo'));
      const india = (r) => r.tz === 'Asia/Kolkata' || r.tz === 'Asia/Calcutta';
      assert.ok(tz.searchTimeZones('GMT+5:30', { nowMs }).some(india));
      assert.ok(tz.searchTimeZones('kolkata', { nowMs }).some(india));
      assert.ok(tz.searchTimeZones('', { nowMs, limit: 10 }).length === 10);
    }
  },
  {
    name: 'slotBand: 日中(9-18)/朝夕(7-9,18-22)/夜間 の最も悪い帯を返す',
    fn: () => {
      assert.equal(tz.slotBand(10 * 60, 11 * 60), 'day');
      assert.equal(tz.slotBand(17 * 60, 18 * 60), 'day');
      assert.equal(tz.slotBand(17 * 60 + 30, 18 * 60 + 30), 'edge');
      assert.equal(tz.slotBand(8 * 60, 9 * 60), 'edge');
      assert.equal(tz.slotBand(21 * 60 + 30, 22 * 60 + 30), 'night');
      assert.equal(tz.slotBand(2 * 60, 3 * 60), 'night');
    }
  },
  {
    name: 'parseGmtLabel: Googleカレンダー左上の表記を分に変換する',
    fn: () => {
      assert.equal(tz.parseGmtLabel('GMT+09'), 540);
      assert.equal(tz.parseGmtLabel('GMT-04'), -240);
      assert.equal(tz.parseGmtLabel('GMT+05:30'), 330);
      assert.equal(tz.parseGmtLabel('UTC+9'), 540);
      assert.equal(tz.parseGmtLabel('GMT'), 0);
      assert.equal(tz.parseGmtLabel('GMT+99'), null);
      assert.equal(tz.parseGmtLabel('Meeting'), null);
    }
  }
];
