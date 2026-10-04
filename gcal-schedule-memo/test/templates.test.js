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

const tokyoEntries = entries.map((e) => Object.assign({ tz: 'Asia/Tokyo' }, e));

module.exports.push(
  {
    name: 'findTemplate: 言語ごとに同じIDのテンプレートを持つ',
    fn() {
      for (const id of templates.TEMPLATE_IDS.filter((x) => x !== 'list')) {
        assert.ok(templates.findTemplate(id, 'ja'), `ja:${id}`);
        assert.ok(templates.findTemplate(id, 'en'), `en:${id}`);
        assert.ok(templates.findTemplate(id, 'en').body.includes('{{slots}}'));
      }
      assert.equal(templates.findTemplate('schedule-request', 'en').title, 'Propose times');
    }
  },
  {
    name: 'renderTemplate(en): 相手の書式の候補を • 箇条書きで差し込む',
    fn() {
      const all = (list) => format.formatAllFor(list, { locale: 'en-US', targetTz: 'America/New_York' });
      const text = templates.renderTemplate(templates.findTemplate('schedule-request', 'en'), tokyoEntries, all, 'en');
      assert.ok(text.startsWith('Hi,\n\nHere are a few times that work for me:\n\n'));
      assert.ok(text.includes('• Mon, Aug 31 · 9:30 – 10:00 PM EDT\n• Thu, Sep 3 · 1:00 – 2:00 AM EDT'));
      assert.ok(text.endsWith('Best regards,'));
    }
  },
  {
    name: 'renderTemplate(list): 候補のみは箇条書き記号なしの行だけ',
    fn() {
      const text = templates.renderTemplate(templates.findTemplate('list', 'ja'), entries, format.formatAll, 'ja');
      assert.equal(text, '9月1日(火) 10:30〜11:00\n9月3日(木) 14:00〜15:00');
    }
  },
  {
    name: 'renderTemplate(en): 候補が無ければ英語の案内を差し込む',
    fn() {
      assert.equal(templates.renderTemplate({ body: '{{slots}}' }, [], format.formatAll, 'en'), '• (add your available times)');
    }
  }
);
