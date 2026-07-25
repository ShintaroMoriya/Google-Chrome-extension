'use strict';

const assert = require('node:assert/strict');
const { SEP, WEEKDAY_JA, pad2, weekdayOf, sortKey, formatEntry, formatAll } = require('../src/format.js');

function entry(y, m, d, sh, sm, eh, em) {
  return { y, m, d, sh, sm, eh, em };
}

module.exports = [
  {
    name: '区切り文字は波ダッシュ(U+301C)であり全角チルダ(U+FF5E)ではない',
    fn: () => {
      assert.equal(SEP.codePointAt(0), 0x301c);
      assert.notEqual(SEP.codePointAt(0), 0xff5e);
    }
  },
  {
    name: 'pad2は1桁を0埋めし2桁はそのまま',
    fn: () => {
      assert.equal(pad2(0), '00');
      assert.equal(pad2(9), '09');
      assert.equal(pad2(10), '10');
      assert.equal(pad2(23), '23');
    }
  },
  {
    name: '基本形式: 月日はゼロ埋めしない・時刻はゼロ埋めする',
    fn: () => {
      const s = formatEntry(entry(2026, 7, 25, 10, 0, 11, 0));
      assert.equal(s, '7月25日(土) 10:00〜11:00');
    }
  },
  {
    name: '1桁の月日はゼロ埋めせず、時刻はゼロ埋めする（7月5日 09:05〜09:30）',
    fn: () => {
      // 2026-07-05 は 日曜日 (2026-07-25が土曜、7/25-7/5=20日=2週6日前 → 逆算せずJSに委ねる代わりに
      // Pythonで検証済みの独立した既知値を使う: 2026-07-05 は日曜日)
      const s = formatEntry(entry(2026, 7, 5, 9, 5, 9, 30));
      assert.equal(s, '7月5日(日) 09:05〜09:30');
    }
  },
  {
    name: '既知の曜日: 2026-07-25(土) 2026-01-01(木) 2026-12-31(木) 2026-03-15(日) 2026-07-28(火)',
    fn: () => {
      assert.equal(weekdayOf({ y: 2026, m: 7, d: 25 }), '土');
      assert.equal(weekdayOf({ y: 2026, m: 1, d: 1 }), '木');
      assert.equal(weekdayOf({ y: 2026, m: 12, d: 31 }), '木');
      assert.equal(weekdayOf({ y: 2026, m: 3, d: 15 }), '日');
      assert.equal(weekdayOf({ y: 2026, m: 7, d: 28 }), '火');
    }
  },
  {
    name: 'うるう日 2028-02-29 は火曜日',
    fn: () => {
      assert.equal(weekdayOf({ y: 2028, m: 2, d: 29 }), '火');
      const s = formatEntry(entry(2028, 2, 29, 13, 0, 14, 0));
      assert.equal(s, '2月29日(火) 13:00〜14:00');
    }
  },
  {
    name: 'sortKeyは年→月→日→時→分の順で時系列に並ぶ',
    fn: () => {
      const a = entry(2026, 7, 25, 9, 0, 10, 0);
      const b = entry(2026, 7, 25, 10, 0, 11, 0);
      const c = entry(2026, 7, 28, 8, 0, 9, 0);
      assert.ok(sortKey(a) < sortKey(b));
      assert.ok(sortKey(b) < sortKey(c));
    }
  },
  {
    name: 'formatAllは複数件を時系列昇順・改行区切りで結合する（入力順は無視する）',
    fn: () => {
      const entries = [
        entry(2026, 7, 28, 14, 0, 15, 0),
        entry(2026, 7, 25, 10, 0, 11, 0)
      ];
      const result = formatAll(entries);
      assert.equal(result, '7月25日(土) 10:00〜11:00\n7月28日(火) 14:00〜15:00');
    }
  },
  {
    name: 'WEEKDAY_JAは日曜始まりで7要素',
    fn: () => {
      assert.deepEqual(WEEKDAY_JA, ['日', '月', '火', '水', '木', '金', '土']);
    }
  }
];
