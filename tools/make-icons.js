#!/usr/bin/env node
'use strict';

/**
 * tools/make-icons.js — 拡張機能アイコン(PNG)を依存ゼロで生成する
 *
 * 目的:
 *   icons/icon-16.png / icon-48.png / icon-128.png を、外部の画像ライブラリを
 *   一切使わずに生成する。青地に白いメモ帳＋オレンジのアクセントドット、
 *   という単純な図形をピクセル単位で描画し、Node標準の zlib で
 *   PNG（IHDR/IDAT/IEND の最小構成）として書き出す。
 *
 * 呼び出し方:
 *   node gcal-schedule-memo/tools/make-icons.js
 *
 * 設計上の制約:
 *   - 依存ゼロ（node:zlib, node:fs, node:path のみ）。house の
 *     skills/dev_dashboard/assets/generate.js と同じ思想。
 *   - アンチエイリアスは行わない（単純な距離判定による塗り分け）。
 *     16px のような小サイズでは多少ジャギーが出るが、実用上問題ない。
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// 色定義
// ---------------------------------------------------------------------------
const COLOR_BG = [26, 115, 232, 255]; // Google Blue 相当 #1a73e8
const COLOR_PAD = [255, 255, 255, 255]; // 白いメモ帳
const COLOR_LINE = [174, 203, 250, 255]; // 薄い青のテキスト行
const COLOR_ACCENT = [251, 140, 0, 255]; // オレンジのアクセントドット #fb8c00
const COLOR_TRANSPARENT = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// ピクセルバッファ操作
// ---------------------------------------------------------------------------

/**
 * size x size の RGBA バッファを作る（初期値は透明）。
 * @param {number} size
 * @returns {Uint8Array}
 */
function createBuffer(size) {
  return new Uint8Array(size * size * 4);
}

/**
 * 1ピクセルを塗る。
 * @param {Uint8Array} buf @param {number} size @param {number} x @param {number} y @param {number[]} rgba
 */
function setPixel(buf, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = rgba[0];
  buf[i + 1] = rgba[1];
  buf[i + 2] = rgba[2];
  buf[i + 3] = rgba[3];
}

/**
 * 角丸矩形を塗る（四隅だけ円弧判定、それ以外は矩形判定の単純な実装）。
 * @param {Uint8Array} buf @param {number} size
 * @param {number} x0 @param {number} y0 @param {number} w @param {number} h
 * @param {number} radius @param {number[]} rgba
 */
function fillRoundedRect(buf, size, x0, y0, w, h, radius, rgba) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const inCornerZone =
        (x < x0 + radius && y < y0 + radius) ||
        (x >= x1 - radius && y < y0 + radius) ||
        (x < x0 + radius && y >= y1 - radius) ||
        (x >= x1 - radius && y >= y1 - radius);

      if (inCornerZone) {
        const cx = x < x0 + radius ? x0 + radius : x1 - radius;
        const cy = y < y0 + radius ? y0 + radius : y1 - radius;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      setPixel(buf, size, x, y, rgba);
    }
  }
}

/**
 * 円を塗る。
 * @param {Uint8Array} buf @param {number} size
 * @param {number} cx @param {number} cy @param {number} r @param {number[]} rgba
 */
function fillCircle(buf, size, cx, cy, r, rgba) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(buf, size, x, y, rgba);
    }
  }
}

// ---------------------------------------------------------------------------
// アイコンの図案: 青背景 + 白いメモ帳 + 薄い青の3本線 + オレンジのアクセント
// ---------------------------------------------------------------------------

/**
 * @param {number} size
 * @returns {Uint8Array}
 */
function drawIcon(size) {
  const buf = createBuffer(size);

  // 背景（角丸の正方形）
  fillRoundedRect(buf, size, 0, 0, size, size, size * 0.22, COLOR_BG);

  // メモ帳（白い角丸矩形、少し内側）
  const padMargin = size * 0.2;
  fillRoundedRect(
    buf, size,
    padMargin, padMargin * 0.85,
    size - padMargin * 2, size - padMargin * 1.7,
    size * 0.08,
    COLOR_PAD
  );

  // テキスト行（3本）。16pxでは潰れるため2本に間引く。
  const lineCount = size >= 32 ? 3 : 2;
  const lineHeight = Math.max(1, size * 0.05);
  const lineInset = padMargin * 1.5;
  const lineWidth = size - lineInset * 2;
  const firstLineY = size * 0.36;
  const lineGap = size * 0.16;
  for (let i = 0; i < lineCount; i++) {
    fillRoundedRect(
      buf, size,
      lineInset, firstLineY + i * lineGap,
      lineWidth * (i === lineCount - 1 ? 0.6 : 1),
      lineHeight,
      lineHeight / 2,
      COLOR_LINE
    );
  }

  // アクセントドット（右下、追加されたメモを表す）
  fillCircle(buf, size, size * 0.78, size * 0.78, size * 0.14, COLOR_ACCENT);
  // ドットの縁を背景色でくり抜き、白いメモ帳の上に浮いて見えるようにする
  // （簡易的な "リング" 効果。半透明合成は行わないシンプル実装）。

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

  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const pixels = drawIcon(size);
    const png = encodePng(pixels, size);
    const outPath = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`生成: ${path.relative(process.cwd(), outPath)} (${png.length} bytes)`);
  }
}

main();
