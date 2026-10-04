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

const formatV2 = require('../src/format.js');
const tokyo = (y, m, d, sh, sm, eh, em) => ({ y, m, d, sh, sm, eh, em, tz: 'Asia/Tokyo' });

module.exports.push(
  {
    name: 'formatSlot(ja・同じタイムゾーン): v1の formatEntry と1バイトも違わない',
    fn: () => {
      const e = tokyo(2026, 9, 1, 10, 30, 11, 0);
      assert.equal(formatV2.formatSlot(e, { locale: 'ja', targetTz: 'Asia/Tokyo' }), formatV2.formatEntry(e));
      assert.equal(formatV2.formatSlot(e, { locale: 'ja', targetTz: 'Asia/Seoul' }), '9月1日(火) 10:30〜11:00');
    }
  },
  {
    name: 'formatSlot(en-US→ニューヨーク): 相手の日付・12時間表記・略称で出す',
    fn: () => {
      const e = tokyo(2026, 9, 1, 10, 0, 11, 0);
      assert.equal(
        formatV2.formatSlot(e, { locale: 'en-US', targetTz: 'America/New_York' }),
        'Mon, Aug 31 · 9:00 – 10:00 PM EDT'
      );
    }
  },
  {
    name: 'formatSlot(en-GB→ロンドン): 24時間表記・日付が先',
    fn: () => {
      const e = tokyo(2026, 9, 1, 17, 0, 18, 0);
      assert.equal(
        formatV2.formatSlot(e, { locale: 'en-GB', targetTz: 'Europe/London' }),
        'Tue 1 Sept · 09:00–10:00 BST'
      );
    }
  },
  {
    name: 'formatSlot(en-US・同じタイムゾーン): タイムゾーン表記を付けない',
    fn: () => {
      const e = tokyo(2026, 9, 1, 10, 0, 11, 0);
      assert.equal(formatV2.formatSlot(e, { locale: 'en-US', targetTz: 'Asia/Tokyo' }), 'Tue, Sep 1 · 10:00 – 11:00 AM');
    }
  },
  {
    name: 'formatSlot(ja→ニューヨーク): 波ダッシュの書式のまま相手の時刻とGMT表記',
    fn: () => {
      const e = tokyo(2026, 9, 1, 10, 0, 11, 0);
      assert.equal(formatV2.formatSlot(e, { locale: 'ja', targetTz: 'America/New_York' }), '8月31日(月) 21:00〜22:00 (GMT-4)');
    }
  },
  {
    name: 'formatSlot: 相手の時刻で日付をまたぐ場合は終了側に翌日を明示する',
    fn: () => {
      const e = tokyo(2026, 9, 1, 12, 30, 13, 30); // NY 23:30〜00:30
      assert.equal(formatV2.formatSlot(e, { locale: 'ja', targetTz: 'America/New_York' }), '8月31日(月) 23:30〜翌00:30 (GMT-4)');
      assert.equal(
        formatV2.formatSlot(e, { locale: 'en-US', targetTz: 'America/New_York' }),
        'Mon, Aug 31 · 11:30 PM – Tue 12:30 AM EDT'
      );
    }
  },
  {
    name: 'computeSlot: 相手側の日付ずれ(dayShift)と時刻帯(band)',
    fn: () => {
      const c = formatV2.computeSlot(tokyo(2026, 9, 1, 10, 0, 11, 0), { targetTz: 'America/New_York' });
      assert.equal(c.dayShift, -1);
      assert.equal(c.band, 'edge');
      assert.equal(c.differs, true);
      const same = formatV2.computeSlot(tokyo(2026, 9, 1, 10, 0, 11, 0), { targetTz: 'Asia/Tokyo' });
      assert.equal(same.dayShift, 0);
      assert.equal(same.band, 'day');
      assert.equal(same.differs, false);
    }
  },
  {
    name: 'computeSlot: tzを持たないv2以前のエントリは sourceTz（自分のタイムゾーン）で解釈する',
    fn: () => {
      const legacy = { y: 2026, m: 9, d: 1, sh: 10, sm: 0, eh: 11, em: 0 };
      const c = formatV2.computeSlot(legacy, { sourceTz: 'Asia/Tokyo', targetTz: 'UTC' });
      assert.equal(c.startMs, Date.UTC(2026, 8, 1, 1, 0));
    }
  },
  {
    name: 'formatAllFor: 実時刻の時系列順に並べる（タイムゾーンが混在しても正しい順）',
    fn: () => {
      const a = tokyo(2026, 9, 1, 10, 0, 11, 0); // UTC 01:00
      const b = { y: 2026, m: 8, d: 31, sh: 20, sm: 0, eh: 21, em: 0, tz: 'America/New_York' }; // UTC 00:00
      const text = formatV2.formatAllFor([a, b], { locale: 'en-US', targetTz: 'UTC' });
      assert.equal(text, 'Tue, Sep 1 · 12:00 – 1:00 AM UTC\nTue, Sep 1 · 1:00 – 2:00 AM UTC');
    }
  },
  {
    name: 'normalizeLocale / langOf / formatSample: 書式の見本で選べる',
    fn: () => {
      assert.equal(formatV2.normalizeLocale('ja-JP'), 'ja');
      assert.equal(formatV2.normalizeLocale('en_GB'), 'en-GB');
      assert.equal(formatV2.normalizeLocale('fr-FR'), 'en-US');
      assert.equal(formatV2.langOf('en-GB'), 'en');
      assert.equal(formatV2.formatSample('en-US'), 'Mon, Aug 31 · 9:00 – 10:00 PM');
      assert.equal(formatV2.formatSample('en-GB'), 'Mon 31 Aug · 21:00–22:00');
      assert.equal(formatV2.formatSample('ja'), '8月31日(月) 21:00〜22:00');
    }
  },
  {
    name: 'formatDuration: 短い単位表記',
    fn: () => {
      assert.equal(formatV2.formatDuration(15, 'en'), '15m');
      assert.equal(formatV2.formatDuration(60, 'en'), '1h');
      assert.equal(formatV2.formatDuration(90, 'en'), '1.5h');
    }
  }
);
