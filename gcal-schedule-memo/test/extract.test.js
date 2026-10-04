'use strict';

const assert = require('node:assert/strict');
const {
  findDatekeyAncestor,
  getChipLabelText,
  isExcludedChip,
  extractFromChip,
  resolveDateColumn,
  resolveSlotPreview,
  extractFromSlot
} = require('../src/extract.js');

// ---------------------------------------------------------------------------
// 最小限のフェイクDOM（jsdom等の依存を増やさないための自前スタブ）。
// extract.js が実際に使うAPI（hasAttribute/getAttribute/parentElement/
// querySelector/querySelectorAll/textContent/getBoundingClientRect/children）
// だけを実装する。
// ---------------------------------------------------------------------------

function el({ tag = 'div', attrs = {}, className = null, textContent = '', rect = null, children = [] } = {}) {
  const node = {
    tagName: tag,
    attrs,
    className,
    textContent,
    rect: rect || { top: 0, left: 0, width: 0, height: 0 },
    children,
    parentElement: null,
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    getBoundingClientRect() {
      return this.rect;
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all.length ? all[0] : null;
    },
    querySelectorAll(sel) {
      const out = [];
      const matches = (n) => matchSelector(n, sel);
      const walk = (n) => {
        for (const c of n.children) {
          if (matches(c)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
  };
  for (const c of children) c.parentElement = node;
  return node;
}

function matchSelector(node, sel) {
  if (sel === '*') return true;
  if (sel.startsWith('.')) return node.className === sel.slice(1);
  const attrMatch = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attrMatch) {
    const [, name, value] = attrMatch;
    if (!node.hasAttribute(name)) return false;
    return value == null ? true : node.getAttribute(name) === value;
  }
  throw new Error(`テストスタブが未対応のセレクタ: ${sel}`);
}

function fakeDoc(body, elementsAtPoint) {
  return {
    body,
    querySelector: (sel) => body.querySelector(sel),
    elementsFromPoint: () => elementsAtPoint || []
  };
}

// ---------------------------------------------------------------------------
// テストケース
// ---------------------------------------------------------------------------

module.exports = [
  {
    name: 'extractFromChip: data-datekey祖先 + .XuJrye ラベルから高確信度で抽出できる',
    fn: () => {
      const label = el({ className: 'XuJrye', textContent: '午前10:00〜午前11:00、打ち合わせ、2026年7月25日' });
      const chip = el({ attrs: { 'data-eventid': 'abc123' }, children: [label] });
      const column = el({ attrs: { 'data-datekey': '28921' }, children: [chip] });
      void column;

      const result = extractFromChip(chip);
      assert.deepEqual(result, {
        y: 2026, m: 7, d: 25, sh: 10, sm: 0, eh: 11, em: 0,
        confidence: 'high', source: 'chip', warning: undefined
      });
    }
  },
  {
    name: 'extractFromChip: data-datekey祖先が無い場合はラベルの日付にフォールバックしmedium',
    fn: () => {
      const label = el({
        className: 'XuJrye',
        textContent: "12pm to 3:45pm, test event, Dom's Life, No location, May 27, 2025"
      });
      const chip = el({ attrs: { 'data-eventid': 'abc123' }, children: [label] });

      const result = extractFromChip(chip);
      assert.equal(result.y, 2025);
      assert.equal(result.m, 5);
      assert.equal(result.d, 27);
      assert.equal(result.sh, 12);
      assert.equal(result.eh, 15);
      assert.equal(result.em, 45);
      assert.equal(result.confidence, 'medium');
      assert.ok(result.warning);
    }
  },
  {
    name: 'extractFromChip: タスク(data-eventidがtasks_始まり)は対象外エラー',
    fn: () => {
      const chip = el({ attrs: { 'data-eventid': 'tasks_xyz' } });
      const result = extractFromChip(chip);
      assert.ok(result.error);
    }
  },
  {
    name: 'extractFromChip: 終日イベントは対象外エラー',
    fn: () => {
      const label = el({ className: 'XuJrye', textContent: '終日、社員旅行' });
      const chip = el({ attrs: { 'data-eventid': 'abc' }, children: [label] });
      const result = extractFromChip(chip);
      assert.ok(result.error);
    }
  },
  {
    name: 'extractFromChip: 日をまたぐ時刻(23:00〜01:00)は対象外エラー',
    fn: () => {
      const label = el({ className: 'XuJrye', textContent: '23:00〜01:00、夜間作業' });
      const chip = el({ attrs: { 'data-eventid': 'abc', 'data-datekey': undefined }, children: [label] });
      const column = el({ attrs: { 'data-datekey': '28921' }, children: [chip] });
      void column;
      const result = extractFromChip(chip);
      assert.ok(result.error);
    }
  },
  {
    name: 'extractFromChip: 時刻を含まないラベルはエラー（値を捏造しない）',
    fn: () => {
      const label = el({ className: 'XuJrye', textContent: '会議室Aで打ち合わせ、2026年7月25日' });
      const chip = el({ attrs: { 'data-eventid': 'abc' }, children: [label] });
      const result = extractFromChip(chip);
      assert.ok(result.error);
    }
  },
  {
    name: 'findDatekeyAncestor: 祖先を遡って最初に見つかったdata-datekeyを復号する',
    fn: () => {
      const leaf = el({});
      const mid = el({ children: [leaf] });
      const column = el({ attrs: { 'data-datekey': '28921' }, children: [mid] });
      void column;
      const hit = findDatekeyAncestor(leaf);
      assert.deepEqual(hit.decoded, { y: 2026, m: 7, d: 25 });
    }
  },
  {
    name: 'getChipLabelText: .XuJrye が無ければ aria-label、それも無ければ textContent',
    fn: () => {
      const withAria = el({ attrs: { 'aria-label': 'ラベルテキスト' } });
      assert.equal(getChipLabelText(withAria), 'ラベルテキスト');

      const withText = el({ textContent: '素のテキスト' });
      assert.equal(getChipLabelText(withText), '素のテキスト');
    }
  },
  {
    name: 'isExcludedChip: tasks_始まりのeventidだけ除外する',
    fn: () => {
      assert.equal(isExcludedChip(el({ attrs: { 'data-eventid': 'tasks_abc' } })), true);
      assert.equal(isExcludedChip(el({ attrs: { 'data-eventid': 'abc123' } })), false);
      assert.equal(isExcludedChip(el({})), false);
    }
  },
  {
    name: 'resolveDateColumn: target自身に無ければ doc.elementsFromPoint にフォールバックする',
    fn: () => {
      const targetWithoutDatekey = el({});
      const columnFromPoint = el({ attrs: { 'data-datekey': '28921' } });
      const doc = fakeDoc(el({}), [el({}), columnFromPoint]);

      const hit = resolveDateColumn(targetWithoutDatekey, 10, 20, doc);
      assert.deepEqual(hit.decoded, { y: 2026, m: 7, d: 25 });
    }
  },
  {
    name: 'extractFromSlot: 列矩形+時刻目盛りが一致 → high confidence、既定60分で時刻を算出',
    fn: () => {
      const PX_PER_HOUR = 48;
      const ORIGIN_Y = 100;
      const hourLabels = [9, 10, 11].map((h) =>
        el({ textContent: `午前${h}時`, rect: { top: ORIGIN_Y + h * PX_PER_HOUR, left: 0, width: 20, height: 12 } })
      );
      const body = el({ children: hourLabels });
      const column = el({
        attrs: { 'data-datekey': '28921' },
        rect: { top: ORIGIN_Y, left: 0, width: 100, height: PX_PER_HOUR * 24 }
      });
      const doc = fakeDoc(body, [column]);

      const clickY = ORIGIN_Y + 10.25 * PX_PER_HOUR; // 10:15相当
      const result = extractFromSlot({ clientX: 5, clientY: clickY, target: column }, doc, {});

      assert.equal(result.y, 2026);
      assert.equal(result.m, 7);
      assert.equal(result.d, 25);
      assert.equal(result.sh, 10);
      assert.equal(result.sm, 15);
      assert.equal(result.eh, 11);
      assert.equal(result.em, 15);
      assert.equal(result.confidence, 'high');
      assert.equal(result.source, 'slot');
    }
  },
  {
    name: 'extractFromSlot: 終日行（極端に低い矩形）はエラーにする',
    fn: () => {
      // pxPerHour は時刻グリッド側（時刻目盛りラベル）から独立に実測する必要がある。
      // 列矩形の高さだけからpxPerHourを逆算すると「height < pxPerHour*20」は
      // 数学的に常に偽になってしまうため、通常の週表示にある時刻目盛りラベルを
      // 用意し、それに対して極端に低い列矩形（終日行）を判定させる。
      const PX_PER_HOUR = 48;
      const hourLabels = [9, 10, 11].map((h) =>
        el({ textContent: `午前${h}時`, rect: { top: h * PX_PER_HOUR, left: 0, width: 20, height: 12 } })
      );
      const body = el({ children: hourLabels });
      const column = el({ attrs: { 'data-datekey': '28921' }, rect: { top: 0, left: 0, width: 100, height: 40 } });
      const doc = fakeDoc(body, [column]);
      const result = extractFromSlot({ clientX: 5, clientY: 20, target: column }, doc, {});
      assert.ok(result.error);
    }
  },
  {
    name: 'extractFromSlot: 日付列が特定できない場合はエラー（捏造しない）',
    fn: () => {
      const noDatekeyTarget = el({});
      const doc = fakeDoc(el({}), []);
      const result = extractFromSlot({ clientX: 5, clientY: 20, target: noDatekeyTarget }, doc, {});
      assert.ok(result.error);
    }
  },
  {
    name: 'resolveSlotPreview: pickはextractFromSlotと完全一致し、枠rectは列幅×snap後の時間帯の高さになる（WYSIWYG）',
    fn: () => {
      const PX_PER_HOUR = 48;
      const ORIGIN_Y = 100;
      const hourLabels = [9, 10, 11].map((h) =>
        el({ textContent: `午前${h}時`, rect: { top: ORIGIN_Y + h * PX_PER_HOUR, left: 0, width: 20, height: 12 } })
      );
      const body = el({ children: hourLabels });
      const column = el({
        attrs: { 'data-datekey': '28921' },
        rect: { top: ORIGIN_Y, left: 40, width: 100, height: PX_PER_HOUR * 24 }
      });
      const doc = fakeDoc(body, [column]);
      const clickEvent = { clientX: 5, clientY: ORIGIN_Y + 10.25 * PX_PER_HOUR, target: column };
      const options = { durationMin: 60, snapMin: 15 };

      const viaExtract = extractFromSlot(clickEvent, doc, options);
      const preview = resolveSlotPreview(clickEvent, doc, options);

      assert.deepEqual(preview.pick, viaExtract);
      assert.equal(preview.pick.sh, 10);
      assert.equal(preview.pick.sm, 15);
      assert.equal(preview.pick.eh, 11);
      assert.equal(preview.pick.em, 15);

      // 枠は列の左端・幅をそのまま使い、高さは60分ぶん(=1時間=pxPerHour)。
      assert.equal(preview.rect.left, 40);
      assert.equal(preview.rect.width, 100);
      assert.ok(Math.abs(preview.rect.height - PX_PER_HOUR) < 0.001);
      // 開始10:15の位置 = ORIGIN_Y + 10.25h * 48px/h
      assert.ok(Math.abs(preview.rect.top - (ORIGIN_Y + 10.25 * PX_PER_HOUR)) < 0.001);
    }
  },
  {
    name: 'resolveSlotPreview: エラー時はrectがnullで、pickにerrorを持つ',
    fn: () => {
      const noDatekeyTarget = el({});
      const doc = fakeDoc(el({}), []);
      const result = resolveSlotPreview({ clientX: 5, clientY: 20, target: noDatekeyTarget }, doc, {});
      assert.ok(result.pick.error);
      assert.equal(result.rect, null);
    }
  }
];

const extractV2 = require('../src/extract.js');

module.exports.push(
  {
    name: 'extractFromChip: ラベルがどの言語でも読めない場合はチップの位置から時刻を換算し medium',
    fn: () => {
      const PX = 48;
      const label = el({ className: 'XuJrye', textContent: 'Réunion importante' });
      const chip = el({ attrs: { 'data-eventid': 'abc' }, children: [label], rect: { top: 100 + 13.5 * PX, left: 0, width: 80, height: 1.5 * PX } });
      const column = el({ attrs: { 'data-datekey': '28921' }, children: [chip], rect: { top: 100, left: 0, width: 100, height: 24 * PX } });
      void column;
      const result = extractV2.extractFromChip(chip);
      assert.equal(result.sh, 13);
      assert.equal(result.sm, 30);
      assert.equal(result.eh, 15);
      assert.equal(result.em, 0);
      assert.equal(result.confidence, 'medium');
      assert.equal(result.warning, extractV2.WARN.TIME_FROM_POSITION);
    }
  },
  {
    name: 'エラーは言語に依存しないコードで返す（文言は i18n 側）',
    fn: () => {
      const label = el({ className: 'XuJrye', textContent: '終日、休暇' });
      const chip = el({ attrs: { 'data-eventid': 'abc' }, children: [label] });
      assert.equal(extractV2.extractFromChip(chip).error, extractV2.ERR.ALL_DAY);
      const task = el({ attrs: { 'data-eventid': 'tasks_1' } });
      assert.equal(extractV2.extractFromChip(task).error, extractV2.ERR.EXCLUDED);
      const doc = fakeDoc(el({}), []);
      assert.equal(extractV2.extractFromSlot({ clientX: 0, clientY: 0, target: el({}) }, doc, {}).error, extractV2.ERR.NO_COLUMN);
    }
  },
  {
    name: 'parseHourLabel: 中国語・韓国語・独仏の時刻目盛りも読める',
    fn: () => {
      assert.equal(extractV2.parseHourLabel('上午10点'), 10);
      assert.equal(extractV2.parseHourLabel('下午3点'), 15);
      assert.equal(extractV2.parseHourLabel('오후 2시'), 14);
      assert.equal(extractV2.parseHourLabel('14 Uhr'), 14);
      assert.equal(extractV2.parseHourLabel('28'), null);
    }
  }
);
