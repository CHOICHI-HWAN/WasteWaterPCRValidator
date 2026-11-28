// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { toChannel, boxBlur, flattenIllumination, fitWellGrid, refineWellCenter, discStats, detectBlobs, ensembleDetect, splitMergedBlobs, judgeCountability, pxPerMm, prntInterpolate } from '../public/prnt-calc.js';

// ---------- 채널 추출 ----------
{
  // 흰색(255,255,255), 진한 보라(80,40,140) 두 픽셀
  const px = new Uint8ClampedArray([255, 255, 255, 255, 80, 40, 140, 255]);
  const light = toChannel(px, 2, 1, 'lightness');
  assert.equal(light[0], 255); assert.ok(Math.abs(light[1] - (80 + 40 + 140) / 3) < 1e-4); // Float32Array 정밀도
  const green = toChannel(px, 2, 1, 'green');
  assert.equal(green[0], 255); assert.equal(green[1], 40);
  const invSat = toChannel(px, 2, 1, 'invSat'); // 흰색은 채도 0 → invSat 255. 보라는 채도가 있으므로 invSat < 255
  assert.equal(invSat[0], 255); assert.ok(invSat[1] < 255);
  console.log('channel tests passed');
}

// ---------- 박스 블러 / 평탄화 ----------
{
  const w = 20, h = 20, arr = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) arr[y * w + x] = x < 10 ? 50 : 200; // 수직 경계
  const blurred = boxBlur(arr, w, h, 3);
  // 블러는 경계 근처에서 평탄화되지만 양쪽 끝은 원래 값에 가깝다
  assert.ok(Math.abs(blurred[10 * w + 1] - 50) < 5);
  assert.ok(Math.abs(blurred[10 * w + 18] - 200) < 5);
  assert.ok(blurred[10 * w + 10] > 50 && blurred[10 * w + 10] < 200); // 경계 바로 옆은 중간값
  const flat = flattenIllumination(arr, w, h, 3);
  assert.equal(flat.length, w * h);
  console.log('blur/flatten tests passed');
}

// ---------- 웰 그리드 ----------
{
  const wells = fitWellGrid({ x0: 0, y0: 0, x1: 100, y1: 50 }, 1, 2, 0.4);
  assert.equal(wells.length, 2);
  assert.ok(Math.abs(wells[0].cx - 25) < 1e-9 && Math.abs(wells[0].cy - 25) < 1e-9);
  assert.ok(Math.abs(wells[1].cx - 75) < 1e-9 && Math.abs(wells[1].cy - 25) < 1e-9);
  assert.ok(Math.abs(wells[0].r - 20) < 1e-9); // min(50,50)*0.4
  console.log('grid tests passed');
}

// ---------- 중심 보정(원 테두리 대비가 가장 큰 위치로) ----------
{
  const w = 100, h = 100, channel = new Float32Array(w * h).fill(60);
  const trueCx = 50, trueCy = 50, r = 20;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = x - trueCx, dy = y - trueCy; if (dx * dx + dy * dy <= r * r) channel[y * w + x] = 210; }
  const refined = refineWellCenter(channel, w, h, { cx: 53, cy: 48, r }, { searchPx: 6, step: 1 });
  assert.ok(Math.abs(refined.cx - trueCx) <= 2 && Math.abs(refined.cy - trueCy) <= 2, `refined center too far: ${refined.cx},${refined.cy}`);
  console.log('refine tests passed');
}

// ---------- 웰 안 통계 ----------
{
  const w = 10, h = 10, channel = new Float32Array(w * h);
  for (let i = 0; i < channel.length; i++) channel[i] = i % 10; // 0..9 반복
  const well = { cx: 5, cy: 5, r: 4 };
  const st = discStats(channel, w, h, well);
  assert.ok(st.n > 0 && st.mean >= 0 && st.std >= 0);
  assert.ok(st.p(100) >= st.p(0));
  console.log('discStats tests passed');
}

// ---------- 블롭(연결 요소) 검출 ----------
{
  const w = 60, h = 60, channel = new Float32Array(w * h).fill(50);
  const well = { cx: 30, cy: 30, r: 25 };
  // 플라크 하나: 중앙 근처 5×5 밝은 사각형(= 25px)
  for (let y = 28; y <= 32; y++) for (let x = 28; x <= 32; x++) channel[y * w + x] = 220;
  // 가장자리 바로 옆(제외돼야 함): 웰 테두리에 거의 붙은 작은 점
  for (let y = 30; y <= 31; y++) for (let x = 53; x <= 54; x++) channel[y * w + x] = 220;
  const blobs = detectBlobs(channel, w, h, well, 150, { minAreaPx: 3, edgeExclude: 3 });
  assert.equal(blobs.length, 1, `expected 1 blob (edge one excluded), got ${blobs.length}`);
  assert.ok(Math.abs(blobs[0].cx - 30) < 1 && Math.abs(blobs[0].cy - 30) < 1);
  assert.equal(blobs[0].area, 25);
  // 너무 작은 점(면적 필터)은 걸러진다
  const tiny = detectBlobs(channel, w, h, well, 150, { minAreaPx: 100, edgeExclude: 3 });
  assert.equal(tiny.length, 0);
  console.log('detectBlobs tests passed');
}

// ---------- 앙상블 검출: 밝기만 다른 두 '채널'이 같은 블롭에 동의 ----------
{
  const w = 60, h = 60, well = { cx: 30, cy: 30, r: 25 };
  const mkChannel = (bg, fg) => { const c = new Float32Array(w * h).fill(bg); for (let y = 15; y <= 19; y++) for (let x = 15; x <= 19; x++) c[y * w + x] = fg; for (let y = 38; y <= 41; y++) for (let x = 38; x <= 41; x++) c[y * w + x] = fg; return c; };
  const variants = [{ channel: mkChannel(60, 230), label: 'a' }, { channel: mkChannel(55, 235), label: 'b' }];
  const { blobs, totalRuns } = ensembleDetect(variants, w, h, well, { minAreaPx: 5 });
  assert.equal(totalRuns, 2 * 4); // 2 채널 × kList 기본 4개
  assert.equal(blobs.length, 2, `expected 2 plaques, got ${blobs.length}`);
  for (const b of blobs) assert.ok(b.confidence > 0.5, `confidence too low: ${b.confidence}`);
  console.log('ensembleDetect tests passed');
}

// ---------- 병합 블롭 분리(추정) ----------
{
  const blobs = [{ area: 10, cx: 1, cy: 1 }, { area: 12, cx: 2, cy: 2 }, { area: 11, cx: 3, cy: 3 }, { area: 34, cx: 4, cy: 4 }]; // 마지막은 3개 정도 맞붙은 추정
  const { count, blobs: out } = splitMergedBlobs(blobs);
  assert.equal(count, 6); // 1+1+1+3
  assert.equal(out[3].merged, true); assert.equal(out[3].estCount, 3);
  console.log('splitMergedBlobs tests passed');
}

// ---------- TNTC / 너무 적음 판정 ----------
{
  assert.equal(judgeCountability(5, 12), 'too_few');
  assert.equal(judgeCountability(30, 12), 'ok');
  assert.equal(judgeCountability(90, 12), 'tntc');
  assert.equal(judgeCountability(25, 6), 'ok');
  assert.equal(judgeCountability(5, 24), 'too_few');
  console.log('judgeCountability tests passed');
}

// ---------- 스케일 ----------
{
  assert.equal(pxPerMm(200, 20), 10);
  console.log('scale tests passed');
}

// ---------- PRNT50/80 로그 보간 ----------
{
  // 감소율이 log10(희석)에 대해 구간별 선형이 되도록 설계한 자료 (보간이 정확히 들어맞는 값으로 검증)
  const controlMean = 100;
  const points = [
    { dilution: 10, count: 10 },   // reduction 90
    { dilution: 100, count: 40 },  // reduction 60
    { dilution: 1000, count: 90 }, // reduction 10
  ];
  const { results, points: pts } = prntInterpolate(points, controlMean, [50, 80]);
  assert.ok(Math.abs(pts[0].reduction - 90) < 1e-9 && Math.abs(pts[1].reduction - 60) < 1e-9 && Math.abs(pts[2].reduction - 10) < 1e-9);
  // PRNT80: 90→60 구간, frac=(90-80)/(90-60)=1/3, logD=1+1/3=1.3333 → 10^1.3333
  assert.ok(Math.abs(results[80] - Math.pow(10, 1 + 1 / 3)) < 1e-6);
  // PRNT50: 60→10 구간, frac=(60-50)/(60-10)=0.2, logD=2+0.2=2.2 → 10^2.2
  assert.ok(Math.abs(results[50] - Math.pow(10, 2.2)) < 1e-6);
  console.log('prntInterpolate tests passed');
}

console.log('prnt tests passed');
