// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT 플라크 탭의 "샘플 불러오기"용 가상 플레이트 사진(PNG)을 만든다 (실제 환자·기관 자료 아님, 전부 컴퓨터로 그린 그림).
//   node tools/make-sample-prnt.mjs   →  public/samples/demo_prnt.png
// 외부 라이브러리 없이 node:zlib로 PNG를 직접 인코딩한다 (make-sample-eds.mjs가 zip을 직접 묶는 것과 같은 방식).
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 20261128; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); // 결정적 난수(0~1)

const W = 1000, H = 750;
const buf = new Uint8Array(W * H * 3);
const setPx = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; };
const fillRect = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) setPx(x, y, c); };
const fillCircle = (cx, cy, r, c) => { const r2 = r * r; for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) setPx(Math.round(cx + x), Math.round(cy + y), c); };

// 배경(연한 회색 책상) + 플레이트 하우징(살짝 더 밝은 회색)
fillRect(0, 0, W, H, [230, 235, 238]);
const bx0 = 50, by0 = 55, bx1 = 950, by1 = 695;
fillRect(bx0, by0, bx1, by1, [213, 221, 226]);

const rows = 3, cols = 4, cw = (bx1 - bx0) / cols, ch = (by1 - by0) / rows, r = Math.min(cw, ch) * 0.42;
const WELL_PURPLE = [66, 48, 148];
const PLAQUE = [232, 231, 238];

// 웰 배치: 대조군(바이러스만) · 희석배수별 감소하는 중화(=플라크 증가) · 무바이러스 음성대조(NC)
const PLAN = [
  [{ role: 'control', count: 55 }, { role: 'control', count: 50 }, { role: 'dil', dil: 10, count: 4 }, { role: 'dil', dil: 10, count: 6 }],
  [{ role: 'dil', dil: 40, count: 14 }, { role: 'dil', dil: 40, count: 17 }, { role: 'dil', dil: 160, count: 27 }, { role: 'dil', dil: 160, count: 24 }],
  [{ role: 'dil', dil: 640, count: 42 }, { role: 'dil', dil: 640, count: 39 }, { role: 'nc', count: 0 }, { role: 'nc', count: 0 }],
];

for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
  const cx = bx0 + cw * (col + 0.5), cy = by0 + ch * (row + 0.5);
  fillCircle(cx, cy, r, WELL_PURPLE);
  const { count } = PLAN[row][col];
  for (let k = 0; k < count; k++) {
    const rad = r * 0.78 * Math.sqrt(rnd()), ang = rnd() * Math.PI * 2;
    const px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
    const pr = 2 + rnd() * 2.5;
    fillCircle(px, py, pr, PLAQUE);
  }
}

// ---------- PNG 인코딩 (시그니처 + IHDR + IDAT + IEND) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; buf.subarray(y * W * 3, (y + 1) * W * 3).forEach((v, i) => { raw[y * (1 + W * 3) + 1 + i] = v; }); }
const idat = deflateSync(raw);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(path.join(root, 'public/samples'), { recursive: true });
writeFileSync(path.join(root, 'public/samples/demo_prnt.png'), png);
console.log(`public/samples/demo_prnt.png (${(png.length / 1024).toFixed(0)} KB) 생성 완료`);
