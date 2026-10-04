#!/usr/bin/env node
'use strict';

/**
 * tools/make-icons.js — 拡張機能アイコン(PNG)を依存ゼロで生成する
 *
 * 目的:
 *   icons/icon-16.png / icon-48.png / icon-128.png を、外部の画像ライブラリを
 *   一切使わずに生成する。Node標準の zlib で PNG（IHDR/IDAT/IEND）を書き出す。
 *
 * 図案（v2.0.0, iOSのアプリアイコン風）:
 *   青→藍のグラデーションの角丸正方形に、赤い帯の付いた白いカレンダー。
 *   カレンダーの中に「3つの枠」を表す点（2つは青で埋まり、1つは空き）を置く。
 *   = 「カレンダーから候補を3つ選ぶ」という機能そのものを、文字なしで表す。
 *
 * 呼び出し方:
 *   node gcal-schedule-memo/tools/make-icons.js
 *
 * 描画方式:
 *   各図形を符号付き距離関数で判定し、1ピクセルを 4×4 にスーパーサンプリングして
 *   アンチエイリアスする。128pxは Chrome ウェブストアの推奨どおり、96pxの絵柄の
 *   周囲に16pxの透明余白を取る。
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SUPERSAMPLE = 4;

const GRAD_TOP = [24, 139, 255];   // #188bff
const GRAD_BOTTOM = [94, 92, 230]; // #5e5ce6 (iOS indigo)
const WHITE = [255, 255, 255];
const RED = [255, 59, 48];         // iOS systemRed
const BLUE = [0, 122, 255];        // iOS systemBlue
const SLOT_EMPTY = [199, 210, 235];

/** 角丸矩形の内側なら true（座標はアイコン内の 0..1 正規化座標） */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/**
 * 正規化座標 (u, v) における色（RGBA, 0-255）。図形を奥から順に重ねる。
 * @param {number} u 0..1
 * @param {number} v 0..1
 * @param {number} size 出力ピクセル数（小さいサイズでは細部を省く）
 */
function colorAt(u, v, size) {
  const small = size <= 16;
  let color = null;

  // 背景（iOS風の大きめの角丸）
  if (inRoundRect(u, v, 0, 0, 1, 1, 0.225)) color = lerp(GRAD_TOP, GRAD_BOTTOM, v);
  if (!color) return [0, 0, 0, 0];

  // カレンダー（白いカード）
  const cx0 = small ? 0.16 : 0.2;
  const cx1 = 1 - cx0;
  const cy0 = small ? 0.18 : 0.21;
  const cy1 = small ? 0.84 : 0.8;
  const cr = small ? 0.1 : 0.09;
  if (inRoundRect(u, v, cx0, cy0, cx1, cy1, cr)) {
    color = WHITE;
    // 上部の赤い帯（カードの角丸に沿って上だけ赤くする）
    const bandBottom = cy0 + (cy1 - cy0) * (small ? 0.3 : 0.24);
    if (v <= bandBottom) color = RED;

    // 3つの枠（2つ埋まり・1つ空き）。16pxでは点を大きくして2つに省略。
    const dotsY = bandBottom + (cy1 - bandBottom) * 0.5;
    const centers = small ? [0.38, 0.62] : [0.33, 0.5, 0.67];
    const r = small ? 0.085 : 0.062;
    centers.forEach((dx, i) => {
      const filled = small || i < 2;
      if (filled) {
        if (inCircle(u, v, dx, dotsY, r)) color = BLUE;
      } else if (inCircle(u, v, dx, dotsY, r) && !inCircle(u, v, dx, dotsY, r * 0.55)) {
        color = SLOT_EMPTY;
      }
    });
  }
  return [color[0], color[1], color[2], 255];
}

/**
 * @param {number} size 出力サイズ(px)
 * @param {number} margin 透明余白(px)
 * @returns {Uint8Array} RGBA
 */
function drawIcon(size, margin) {
  const buf = new Uint8Array(size * size * 4);
  const art = size - margin * 2;
  const n = SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const u = (x + (sx + 0.5) / n - margin) / art;
          const v = (y + (sy + 0.5) / n - margin) / art;
          const c = (u < 0 || v < 0 || u > 1 || v > 1) ? [0, 0, 0, 0] : colorAt(u, v, size);
          const alpha = c[3] / 255;
          r += c[0] * alpha; g += c[1] * alpha; b += c[2] * alpha; a += alpha;
        }
      }
      const i = (y * size + x) * 4;
      const samples = n * n;
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round((a / samples) * 255);
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// PNGエンコード（依存ゼロ: IHDR + IDAT + IEND の最小構成）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * PNGチャンク1つをBufferとして組み立てる。
 * @param {string} type 4文字のチャンクタイプ
 * @param {Buffer} data
 * @returns {Buffer}
 */
function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * RGBAピクセルバッファをPNGバイナリ(Buffer)にする。
 * @param {Uint8Array} pixels size*size*4のRGBA
 * @param {number} size
 * @returns {Buffer}
 */
function encodePng(pixels, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(6, 9); // color type 6 = RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // 各スキャンラインの先頭にフィルタタイプ0（フィルタなし）を付与する。
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }
  const idat = makeChunk('IDAT', zlib.deflateSync(raw));

  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
function main() {
  const outDir = path.resolve(__dirname, '..', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  // [サイズ, 透明余白]。128pxはストアの推奨（96pxの絵柄＋16pxの余白）に従う。
  const sizes = [[16, 0], [48, 2], [128, 16]];
  for (const [size, margin] of sizes) {
    const pixels = drawIcon(size, margin);
    const png = encodePng(pixels, size);
    const outPath = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`生成: ${path.relative(process.cwd(), outPath)} (${png.length} bytes)`);
  }
}

main();
