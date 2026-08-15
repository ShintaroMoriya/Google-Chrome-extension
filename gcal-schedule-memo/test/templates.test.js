'use strict';

const assert = require('node:assert/strict');
const format = require('../src/format.js');
const templates = require('../src/templates.js');

const entries = [
  { y: 2026, m: 9, d: 3, sh: 14, sm: 0, eh: 15, em: 0 },
  { y: 2026, m: 9, d: 1, sh: 10, sm: 30, eh: 11, em: 0 }
];

module.exports = [
  {
    name: 'formatSlotsForEmail: 時系列順に中黒箇条書きへ整形する',
    fn() {
      assert.equal(
        templates.formatSlotsForEmail(entries, format.formatAll),
        '・9月1日(火) 10:30〜11:00\n・9月3日(木) 14:00〜15:00'
      );
    }
  },
  {
    name: 'renderTemplate: 候補日時トークンを箇条書きへ置換する',
    fn() {
      const text = templates.renderTemplate(
        { body: '候補です。\n{{候補日時}}\nご確認ください。' },
        entries,
        format.formatAll
      );
      assert.equal(
        text,
        '候補です。\n・9月1日(火) 10:30〜11:00\n・9月3日(木) 14:00〜15:00\nご確認ください。'
      );
    }
  },
  {
    name: 'renderTemplate: 候補が無い場合も利用者に分かる案内を差し込む',
    fn() {
      assert.equal(
        templates.renderTemplate({ body: '{{候補日時}}' }, [], format.formatAll),
        '・候補日時を追加してください'
      );
    }
  },
  {
    name: 'findTemplate: 定義済みのテンプレートをIDで取得する',
    fn() {
      assert.equal(templates.findTemplate('schedule-request').title, '候補日を送る');
      assert.equal(templates.findTemplate('unknown-template'), null);
    }
  }
];
