'use strict';

const assert = require('node:assert/strict');
const { encodeDatekey, decodeDatekey, decodeDatekeyAttr, parseDateLabel } = require('../src/datekey.js');

module.exports = [
  {
    name: '既知値: 2026-07-25 は datekey 28921',
    fn: () => {
      assert.equal(encodeDatekey(2026, 7, 25), 28921);
      assert.deepEqual(decodeDatekey(28921), { y: 2026, m: 7, d: 25 });
    }
  },
  {
    name: '全日付の往復一致（2020-01-01〜2030-12-31）',
    fn: () => {
      let count = 0;
      for (let y = 2020; y <= 2030; y++) {
        for (let m = 1; m <= 12; m++) {
          const daysInMonth = new Date(y, m, 0).getDate();
          for (let d = 1; d <= daysInMonth; d++) {
            const key = encodeDatekey(y, m, d);
            const decoded = decodeDatekey(key);
            assert.deepEqual(decoded, { y, m, d }, `${y}-${m}-${d} の往復が一致しない`);
            count += 1;
          }
        }
      }
      assert.ok(count > 4000, `十分な件数を検証したか (count=${count})`);
    }
  },
  {
    name: '不正値は null を返す（月0/13, 日0/32, 負数）',
    fn: () => {
      assert.equal(decodeDatekey(encodeDatekey(2026, 0, 15)), null);
      assert.equal(decodeDatekey(encodeDatekey(2026, 13, 15)), null);
      assert.equal(decodeDatekey(encodeDatekey(2026, 2, 0)), null);
      assert.equal(decodeDatekey(encodeDatekey(2026, 2, 32)), null);
      assert.equal(decodeDatekey(-1), null);
      assert.equal(decodeDatekey(NaN), null);
    }
  },
  {
    name: '実在しない日付（2月30日）は null',
    fn: () => {
      assert.equal(decodeDatekey(encodeDatekey(2026, 2, 30)), null);
    }
  },
  {
    name: 'decodeDatekeyAttrは文字列属性値・null・非数値を安全に扱う',
    fn: () => {
      assert.deepEqual(decodeDatekeyAttr('28921'), { y: 2026, m: 7, d: 25 });
      assert.equal(decodeDatekeyAttr(null), null);
      assert.equal(decodeDatekeyAttr('not-a-number'), null);
    }
  },
  {
    name: 'parseDateLabel: 日本語「2026年7月25日」形式',
    fn: () => {
      assert.deepEqual(parseDateLabel('午前10:00〜午前11:00、打ち合わせ、2026年7月25日'), {
        y: 2026, m: 7, d: 25
      });
    }
  },
  {
    name: 'parseDateLabel: 年省略「7月25日」形式は参照年を使う',
    fn: () => {
      assert.deepEqual(parseDateLabel('7月25日 打ち合わせ', 2027), { y: 2027, m: 7, d: 25 });
    }
  },
  {
    name: 'parseDateLabel: 英語ロケール「May 27, 2025」形式',
    fn: () => {
      assert.deepEqual(
        parseDateLabel('12pm to 3:45pm, test event, Dom\'s Life, No location, May 27, 2025'),
        { y: 2025, m: 5, d: 27 }
      );
    }
  },
  {
    name: 'parseDateLabel: マッチしない文字列は null',
    fn: () => {
      assert.equal(parseDateLabel('会議室Aで打ち合わせ'), null);
      assert.equal(parseDateLabel(''), null);
      assert.equal(parseDateLabel(null), null);
    }
  }
];
