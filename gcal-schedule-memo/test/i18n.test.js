'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../src/i18n.js');
const extract = require('../src/extract.js');

const ROOT = path.resolve(__dirname, '..');
const en = require('../_locales/en/messages.json');
const ja = require('../_locales/ja/messages.json');

function usedKeys() {
  const keys = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/label: '([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
  }
  const manifest = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  for (const m of manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(m[1]);
  return keys;
}

module.exports = [
  {
    name: 'messages.json: 英語と日本語のキーが完全に一致する',
    fn: () => {
      assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    }
  },
  {
    name: 'messages.json: コードとmanifestが参照するキー（動的なerr_/warn_/band_を含む）はすべて存在する',
    fn: () => {
      const keys = usedKeys();
      for (const code of Object.values(extract.ERR)) keys.add(`err_${code}`);
      for (const code of Object.values(extract.WARN)) keys.add(`warn_${code}`);
      for (const band of ['day', 'edge', 'night']) keys.add(`band_${band}`);
      const missing = [...keys].filter((k) => !en[k]);
      assert.deepEqual(missing, []);
    }
  },
  {
    name: 'ストア掲載の制約: 説明文は132文字以内、名前は45文字以内',
    fn: () => {
      for (const msgs of [en, ja]) {
        assert.ok(msgs.extDescription.message.length <= 132);
        assert.ok(msgs.extName.message.length <= 45);
      }
    }
  },
  {
    name: 't(): プレースホルダを展開し、言語を切り替えられる',
    fn: () => {
      i18n.setNodeLang('en');
      assert.equal(i18n.t('tzMismatch', 'GMT+9'), 'Google Calendar shows GMT+9. Make sure “My time zone” matches it.');
      i18n.setNodeLang('ja');
      assert.equal(i18n.t('copy'), 'コピー');
      assert.equal(i18n.t('no_such_key'), '');
      i18n.setNodeLang('en');
    }
  }
];
