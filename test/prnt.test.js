// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { toChannel, boxBlur, flattenIllumination, fitWellGrid, refineWellCenter, discStats, detectBlobs, ensembleDetect, splitMergedBlobs, judgeCountability, pxPerMm, prntInterpolate, detectColorBlobs, inferWellGrid, distanceTransform, countLobes } from '../public/prnt-calc.js';

// 원 하나를 작은 마스크(Uint8Array, w×h)에 그려 넣는 도우미 — 모양 기반 테스트에 쓴다
function drawCircleMask(w, h, cx, cy, r) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) m[y * w + x] = 1; }
  return m;
}
const orMask = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] || b[i] ? 1 : 0; return o; };

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

// ---------- 거리변환 · 모양으로 덩어리 개수 세기 ----------
// 크기 비교가 아니라 모양(거리변환 극대점)으로 센다 — 플라크 크기가 들쭉날쭉해도(작은 것·큰 것 섞여도) 맞아야 한다.
{
  // 혼자 있는 원 하나(그것도 아주 큰 원) — "평균보다 크다"는 이유로 쪼개지면 안 된다
  const bigSolo = drawCircleMask(60, 60, 30, 30, 26);
  assert.equal(countLobes(bigSolo, 60, 60).count, 1, '큰 원 하나를 여러 개로 잘못 쪼갬');

  // 작은 원 하나도 그냥 1개
  const smallSolo = drawCircleMask(20, 20, 10, 10, 6);
  assert.equal(countLobes(smallSolo, 20, 20).count, 1);

  // 맞닿은(겹치는) 원 두 개 — 크기가 서로 달라도(한쪽이 더 커도) 2개로 세야 한다
  const two = orMask(drawCircleMask(60, 40, 18, 20, 14), drawCircleMask(60, 40, 42, 20, 10));
  assert.equal(countLobes(two, 60, 40).count, 2, `두 원이 맞붙었는데 ${countLobes(two, 60, 40).count}개로 셈`);

  // 한 줄로 맞붙은 원 세 개(크기 제각각) — 3개
  let three = drawCircleMask(100, 36, 18, 18, 14);
  three = orMask(three, drawCircleMask(100, 36, 46, 18, 10));
  three = orMask(three, drawCircleMask(100, 36, 74, 18, 12));
  assert.equal(countLobes(three, 100, 36).count, 3, `세 원이 맞붙었는데 ${countLobes(three, 100, 36).count}개로 셈`);
  console.log('distanceTransform/countLobes tests passed');
}

// ---------- 병합 블롭 분리(추정): 실제 splitMergedBlobs 배선 확인 ----------
{
  const soloMask = drawCircleMask(20, 20, 10, 10, 8);
  let twoMask = drawCircleMask(50, 30, 14, 15, 11);
  twoMask = orMask(twoMask, drawCircleMask(50, 30, 36, 15, 9));
  const blobs = [
    { area: 80, cx: 1, cy: 1, mask: soloMask, maskW: 20, maskH: 20 },     // 1개
    { area: 300, cx: 2, cy: 2, mask: twoMask, maskW: 50, maskH: 30 },     // 2개(맞붙음) — 면적이 훨씬 커도 "모양"으로만 판단
    { area: 50, cx: 3, cy: 3 },                                          // 마스크 없음(예: 수동 추가) → 그냥 1개
  ];
  const { count, blobs: out } = splitMergedBlobs(blobs);
  assert.equal(out[0].estCount, 1); assert.equal(out[0].merged, false);
  assert.equal(out[1].estCount, 2); assert.equal(out[1].merged, true);
  assert.equal(out[2].estCount, 1); assert.equal(out[2].merged, false);
  assert.equal(count, 4); // 1+2+1
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

// ---------- 자동 웰 그리드 검출: 채도 기반 블롭 + 크기로 걸러 그리드에 맞추기 ----------
{
  // 합성 사진: 흰 배경(채도 0) 위에 2행×3열 보라색 원(채도 높음) + 한쪽 구석에 크기가 전혀 다른(훨씬 큰) 노란 사각형(스티커 메모 흉내)
  const w = 300, h = 200, px = new Uint8ClampedArray(w * h * 4).fill(255); // 흰 배경, 알파는 아래서 다시 채움
  for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 255;
  const setPx = (x, y, r, g, b) => { const i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const fillCircle = (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) setPx(cx + x, cy + y, ...c); };
  const rows = 2, cols = 3, cw = w / cols, ch = h / rows, r = Math.min(cw, ch) * 0.35;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) fillCircle(Math.round(cw * (col + 0.5)), Math.round(ch * (row + 0.5)), Math.round(r), [80, 40, 150]);
  for (let y = 2; y < 18; y++) for (let x = 270; x < 296; x++) setPx(x, y, 210, 200, 40); // 구석의 큰 노란 사각형(엉뚱한 큰 덩어리)

  const blobs = detectColorBlobs(px, w, h, { gridMax: 200, satThr: 0.4, erode: 0, minAreaFrac: 0.0005 });
  assert.ok(blobs.length >= rows * cols, `blobs too few: ${blobs.length}`);
  const res = inferWellGrid(blobs, rows, cols);
  assert.ok(res, 'inferWellGrid returned null for a clean synthetic grid');
  assert.equal(res.matchedCount, rows * cols);
  assert.equal(res.wells.length, rows * cols);
  // 각 웰이 의도한 위치 근처에 있는지(사각형 스티커가 섞여 들어가지 않았는지)
  for (const well of res.wells) {
    const ecx = cw * (well.col + 0.5), ecy = ch * (well.row + 0.5);
    assert.ok(Math.abs(well.cx - ecx) < cw * 0.25, `col off: ${well.row},${well.col}`);
    assert.ok(Math.abs(well.cy - ecy) < ch * 0.25, `row off: ${well.row},${well.col}`);
  }
  console.log('detectColorBlobs/inferWellGrid (clean grid) tests passed');

  // 자신 없는 경우: 블롭이 거의 없으면 null을 돌려줘야 한다(엉뚱한 추측 대신 손으로 하라고 넘기는 게 맞다)
  const sparse = detectColorBlobs(px, w, h, { gridMax: 200, satThr: 0.4, erode: 0, minAreaFrac: 0.0005 }).slice(0, 1);
  assert.equal(inferWellGrid(sparse, rows, cols), null);
  console.log('inferWellGrid (low-confidence → null) tests passed');
}

console.log('prnt tests passed');
