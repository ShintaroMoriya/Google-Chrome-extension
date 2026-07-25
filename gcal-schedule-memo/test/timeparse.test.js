'use strict';

const assert = require('node:assert/strict');
const { parseTimeRange, isAllDayLabel } = require('../src/timeparse.js');

module.exports = [
  {
    name: '日本語 午前/午後 分あり: 午前10:00〜午前11:00',
    fn: () => {
      assert.deepEqual(
        parseTimeRange('午前10:00〜午前11:00、打ち合わせ、会議室A'),
        { sh: 10, sm: 0, eh: 11, em: 0 }
      );
    }
  },
  {
    name: '日本語 午後: 午後3:45〜午後5:00',
    fn: () => {
      assert.deepEqual(parseTimeRange('午後3:45〜午後5:00、面談'), { sh: 15, sm: 45, eh: 17, em: 0 });
    }
  },
  {
    name: '日本語「時」区切り・分省略・終了側の午前午後を開始側から継承: 午前10時〜11時',
    fn: () => {
      assert.deepEqual(parseTimeRange('午前10時〜11時'), { sh: 10, sm: 0, eh: 11, em: 0 });
    }
  },
  {
    name: '正午をまたぐ午後: 午前11:30〜午後1:00',
    fn: () => {
      assert.deepEqual(parseTimeRange('午前11:30〜午後1:00'), { sh: 11, sm: 30, eh: 13, em: 0 });
    }
  },
  {
    name: '英語ロケール実サンプル: 12pm to 3:45pm（開始側12時は正午）',
    fn: () => {
      assert.deepEqual(
        parseTimeRange("12pm to 3:45pm, test event, Dom's Life, No location, May 27, 2025"),
        { sh: 12, sm: 0, eh: 15, em: 45 }
      );
    }
  },
  {
    name: '英語ロケール省略形実サンプル: 12 – 3:45pm（開始側のampmを終了側から継承）',
    fn: () => {
      assert.deepEqual(parseTimeRange('12 – 3:45pm'), { sh: 12, sm: 0, eh: 15, em: 45 });
    }
  },
  {
    name: '24時間表記（午前/午後なし）: 10:00〜11:00',
    fn: () => {
      assert.deepEqual(parseTimeRange('10:00〜11:00、社内会議'), { sh: 10, sm: 0, eh: 11, em: 0 });
    }
  },
  {
    name: '区切り文字のゆらぎ（全角チルダ／ハイフン／から）を許容する',
    fn: () => {
      assert.deepEqual(parseTimeRange('10:00～11:00'), { sh: 10, sm: 0, eh: 11, em: 0 });
      assert.deepEqual(parseTimeRange('10:00-11:00'), { sh: 10, sm: 0, eh: 11, em: 0 });
      assert.deepEqual(parseTimeRange('10:00から11:00'), { sh: 10, sm: 0, eh: 11, em: 0 });
    }
  },
  {
    name: '時刻が読み取れない文字列は null',
    fn: () => {
      assert.equal(parseTimeRange('会議室Aで打ち合わせ'), null);
      assert.equal(parseTimeRange(''), null);
      assert.equal(parseTimeRange(null), null);
    }
  },
  {
    name: 'isAllDayLabel: 終日 / All day / All-day を検出する',
    fn: () => {
      assert.equal(isAllDayLabel('終日、社員旅行'), true);
      assert.equal(isAllDayLabel('All day, company trip'), true);
      assert.equal(isAllDayLabel('All-day event'), true);
      assert.equal(isAllDayLabel('10:00〜11:00、打ち合わせ'), false);
    }
  }
];
