'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_PX_PER_HOUR,
  columnSpanModel,
  hourRailModel,
  buildGridGeometry,
  yToMinutes,
  snapMinutes,
  minutesToHm,
  looksLikeAllDayRow
} = require('../src/geometry.js');

// 合成データ: 0:00 が clientY=100、1時間=48px の一貫した座標系。
const PX_PER_HOUR = 48;
const ORIGIN_Y = 100;

function syntheticHourPoints(hours) {
  return hours.map((hour) => ({ hour, top: ORIGIN_Y + hour * PX_PER_HOUR }));
}

module.exports = [
  {
    name: 'columnSpanModel: 列矩形の高さ/24 がpxPerHour',
    fn: () => {
      const model = columnSpanModel({ top: 100, height: 1152 });
      assert.equal(model.pxPerHour, 48);
      assert.equal(model.originY, 100);
    }
  },
  {
    name: 'columnSpanModel: 高さ0/nullは推定不能',
    fn: () => {
      assert.equal(columnSpanModel({ top: 0, height: 0 }), null);
      assert.equal(columnSpanModel(null), null);
    }
  },
  {
    name: 'hourRailModel: 3点の完全な線形データから正しくpxPerHourとoriginYを復元',
    fn: () => {
      const model = hourRailModel(syntheticHourPoints([9, 10, 11]));
      assert.ok(Math.abs(model.pxPerHour - PX_PER_HOUR) < 1e-9);
      assert.ok(Math.abs(model.originY - ORIGIN_Y) < 1e-9);
      assert.ok(model.r2 > 0.999);
    }
  },
  {
    name: 'hourRailModel: 点が1つ以下、または全点同時刻は推定不能',
    fn: () => {
      assert.equal(hourRailModel([{ hour: 9, top: 532 }]), null);
      assert.equal(hourRailModel([]), null);
      assert.equal(hourRailModel([{ hour: 9, top: 100 }, { hour: 9, top: 200 }]), null);
    }
  },
  {
    name: 'buildGridGeometry: column-spanとhour-railが一致 → high confidence',
    fn: () => {
      const geometry = buildGridGeometry(
        { top: ORIGIN_Y, height: PX_PER_HOUR * 24 },
        syntheticHourPoints([9, 10, 11])
      );
      assert.equal(geometry.confidence, 'high');
      assert.equal(geometry.model, 'agree');
      assert.ok(Math.abs(geometry.pxPerHour - PX_PER_HOUR) < 1e-9);
    }
  },
  {
    name: 'buildGridGeometry: 不一致(5%超)ならクリックした列そのもの(column-span)を優先しmedium',
    fn: () => {
      // column-spanは40px/h相当、hour-railは48px/h → 乖離約16.7%
      const geometry = buildGridGeometry(
        { top: 0, height: 40 * 24 },
        syntheticHourPoints([9, 10, 11])
      );
      assert.equal(geometry.confidence, 'medium');
      assert.equal(geometry.model, 'column-span');
      assert.ok(Math.abs(geometry.pxPerHour - 40) < 1e-9);
    }
  },
  {
    name: 'buildGridGeometry: hour-railのみ利用可能ならmedium',
    fn: () => {
      const geometry = buildGridGeometry(null, syntheticHourPoints([9, 10, 11]));
      assert.equal(geometry.model, 'hour-rail');
      assert.equal(geometry.confidence, 'medium');
    }
  },
  {
    name: 'buildGridGeometry: column-spanのみ利用可能ならmedium',
    fn: () => {
      const geometry = buildGridGeometry({ top: ORIGIN_Y, height: PX_PER_HOUR * 24 }, []);
      assert.equal(geometry.model, 'column-span');
      assert.equal(geometry.confidence, 'medium');
    }
  },
  {
    name: 'buildGridGeometry: どちらも無ければ既定値でlow confidence',
    fn: () => {
      const geometry = buildGridGeometry(null, []);
      assert.equal(geometry.model, 'default');
      assert.equal(geometry.confidence, 'low');
      assert.equal(geometry.pxPerHour, DEFAULT_PX_PER_HOUR);
    }
  },
  {
    name: 'yToMinutes: clientYを0:00からの経過分に変換する（10:15）',
    fn: () => {
      const geometry = { pxPerHour: PX_PER_HOUR, originY: ORIGIN_Y };
      const clientY = ORIGIN_Y + 10.25 * PX_PER_HOUR; // 10時15分
      assert.ok(Math.abs(yToMinutes(clientY, geometry) - 615) < 1e-9);
    }
  },
  {
    name: 'snapMinutes: 15分単位で最近傍に丸める（7分→0分, 8分→15分の境界）',
    fn: () => {
      assert.equal(snapMinutes(7, 15), 0);
      assert.equal(snapMinutes(8, 15), 15);
      assert.equal(snapMinutes(22, 15), 15);
      assert.equal(snapMinutes(23, 15), 30);
    }
  },
  {
    name: 'minutesToHm: 正常範囲は{h,m}、範囲外(負・1440以上)はnull',
    fn: () => {
      assert.deepEqual(minutesToHm(615), { h: 10, m: 15 });
      assert.deepEqual(minutesToHm(0), { h: 0, m: 0 });
      assert.deepEqual(minutesToHm(1439), { h: 23, m: 59 });
      assert.equal(minutesToHm(-1), null);
      assert.equal(minutesToHm(1440), null);
    }
  },
  {
    name: 'looksLikeAllDayRow: 20時間相当未満の高さは終日行と判定する',
    fn: () => {
      assert.equal(looksLikeAllDayRow({ height: 40 }, PX_PER_HOUR), true);
      assert.equal(looksLikeAllDayRow({ height: PX_PER_HOUR * 24 }, PX_PER_HOUR), false);
      assert.equal(looksLikeAllDayRow(null, PX_PER_HOUR), false);
    }
  }
];
