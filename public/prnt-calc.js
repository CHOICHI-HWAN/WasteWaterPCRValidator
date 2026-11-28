// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT 플라크 세기 — 순수 로직 (DOM·Canvas에 기대지 않아 Node에서도 테스트할 수 있다)
// 입력은 항상 "단일 채널" 평면 배열(Float32Array 또는 plain Array, 길이 w*h, 값 0~255 근방)이다.
// RGBA 픽셀 → 채널 추출만 toChannel()을 거치고, 그 뒤 모든 함수는 채널 배열만 다룬다.

// ---------- 채널 추출 ----------
// 크리스탈 바이올렛(보라/파랑) 염색: 살아있는 세포 층은 진한 보라, 플라크(죽은 자리)는 희거나 밝다.
// 'lightness' = (R+G+B)/3, 'green' = G, 'invSat' = 255 − 채도(0~255) — 셋 다 플라크에서 값이 커진다.
export function toChannel(pixels, w, h, mode = 'lightness') {
  const n = w * h, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    if (mode === 'green') out[i] = g;
    else if (mode === 'invSat') { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx; out[i] = 255 * (1 - sat); }
    else out[i] = (r + g + b) / 3;
  }
  return out;
}

// ---------- 조명 평탄화 ----------
// 큰 반지름 박스 블러로 배경(조명 불균일)을 추정하고, 원본에서 빼서 평탄화한다 (결과는 128 중심으로 재조정).
export function boxBlur(arr, w, h, radius) {
  const r = Math.max(1, radius | 0), out = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let acc = 0, row = y * w; for (let x = -r; x <= r; x++) acc += arr[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); const xo = x - r, xi = x + r + 1; acc += arr[row + Math.min(w - 1, xi)] - arr[row + Math.max(0, xo)]; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); const yo = y - r, yi = y + r + 1; acc += tmp[Math.min(h - 1, yi) * w + x] - tmp[Math.max(0, yo) * w + x]; } }
  return out;
}
export function flattenIllumination(gray, w, h, radius) {
  const bg = boxBlur(gray, w, h, radius), out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = gray[i] - bg[i] + 128;
  return out;
}

// ---------- 웰 그리드 ----------
// bbox 안에 rows×cols 웰을 균등 배치 (자동 검출의 1차 근사). marginRatio: 각 웰 칸 안에서 원 반지름 비율(0~0.5).
export function fitWellGrid(bbox, rows, cols, marginRatio = 0.42) {
  const { x0, y0, x1, y1 } = bbox, cw = (x1 - x0) / cols, ch = (y1 - y0) / rows, r = Math.min(cw, ch) * marginRatio;
  const wells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
    wells.push({ row, col, cx: x0 + cw * (col + 0.5), cy: y0 + ch * (row + 0.5), r });
  return wells;
}

// 원 둘레(여러 각도)에서 안쪽 평균과 바깥쪽 평균의 밝기 차(테두리 대비)가 가장 큰 위치로 중심을 미세 조정한다.
export function refineWellCenter(channel, w, h, well, opts = {}) {
  const { searchPx = Math.round(well.r * 0.15), step = 1, angles = 16 } = opts;
  const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null; return channel[yi * w + xi]; };
  const rimScore = (cx, cy, r) => { let s = 0, n = 0; for (let a = 0; a < angles; a++) { const t = (a / angles) * Math.PI * 2, ix = at(cx + Math.cos(t) * r * 0.82, cy + Math.sin(t) * r * 0.82), ox = at(cx + Math.cos(t) * r * 1.05, cy + Math.sin(t) * r * 1.05); if (ix === null || ox === null) continue; s += Math.abs(ix - ox); n++; } return n ? s / n : -Infinity; };
  let best = { cx: well.cx, cy: well.cy, score: rimScore(well.cx, well.cy, well.r) };
  for (let dy = -searchPx; dy <= searchPx; dy += step) for (let dx = -searchPx; dx <= searchPx; dx += step) {
    if (dx === 0 && dy === 0) continue;
    const sc = rimScore(well.cx + dx, well.cy + dy, well.r);
    if (sc > best.score) best = { cx: well.cx + dx, cy: well.cy + dy, score: sc };
  }
  return { ...well, cx: best.cx, cy: best.cy };
}

// ---------- 웰 안의 통계 ----------
export function discStats(channel, w, h, well, opts = {}) {
  const { edgeExclude = 0 } = opts, r = well.r - edgeExclude, r2 = r * r, vals = [];
  const x0 = Math.max(0, Math.floor(well.cx - r)), x1 = Math.min(w - 1, Math.ceil(well.cx + r));
  const y0 = Math.max(0, Math.floor(well.cy - r)), y1 = Math.min(h - 1, Math.ceil(well.cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x - well.cx, dy = y - well.cy; if (dx * dx + dy * dy <= r2) vals.push(channel[y * w + x]); }
  if (!vals.length) return { mean: 0, std: 0, n: 0, p: () => 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  const sorted = vals.slice().sort((a, b) => a - b);
  const p = (pct) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))))];
  return { mean, std, n: vals.length, p };
}

// ---------- 연결 요소(블롭) 검출: 한 웰, 한 문턱값 ----------
// edgeExclude(px): 가장자리 플라크 제외(웰 테두리 효과 배제). minAreaPx/maxAreaPx: 면적 필터.
export function detectBlobs(channel, w, h, well, threshold, opts = {}) {
  const { edgeExclude = Math.round(well.r * 0.06), minAreaPx = 3, maxAreaPx = Infinity } = opts;
  const r = well.r - edgeExclude, r2 = r * r;
  const x0 = Math.max(0, Math.floor(well.cx - r)), x1 = Math.min(w - 1, Math.ceil(well.cx + r));
  const y0 = Math.max(0, Math.floor(well.cy - r)), y1 = Math.min(h - 1, Math.ceil(well.cy + r));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw <= 0 || bh <= 0) return [];
  const mask = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - well.cx, dy = y - well.cy; if (dx * dx + dy * dy > r2) continue;
    if (channel[y * w + x] >= threshold) mask[(y - y0) * bw + (x - x0)] = 1;
  }
  const visited = new Uint8Array(bw * bh), blobs = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    const stack = [i]; visited[i] = 1; let sumX = 0, sumY = 0, area = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    while (stack.length) {
      const p = stack.pop(), py = (p / bw) | 0, px = p % bw;
      sumX += px; sumY += py; area++;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      const nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
      for (const [nx, ny] of nb) { if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const ni = ny * bw + nx; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); } }
    }
    if (area < minAreaPx || area > maxAreaPx) continue;
    blobs.push({ cx: x0 + sumX / area, cy: y0 + sumY / area, area, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return blobs;
}

// ---------- 앙상블: 여러 문턱값(+필요하면 여러 채널)으로 반복 검출해 다수결로 합친다 ----------
// variants: [{channel, label}] — 이미 toChannel/flattenIllumination을 거친 채널 배열들. 채널마다 중앙값+k·표준편차(k 목록)로 여러 문턱값을 만든다.
export function ensembleDetect(variants, w, h, well, opts = {}) {
  const { kList = [1.1, 1.5, 2.0, 2.6], minAreaPx = 3, maxAreaPx = Infinity, edgeExclude, mergeDistPx = Math.max(2, well.r * 0.05) } = opts;
  const runs = [];
  for (const v of variants) {
    const st = discStats(v.channel, w, h, well, { edgeExclude });
    for (const k of kList) {
      const thr = st.mean + k * st.std;
      runs.push(detectBlobs(v.channel, w, h, well, thr, { edgeExclude, minAreaPx, maxAreaPx }));
    }
  }
  const total = runs.length;
  // 모든 실행의 블롭을 하나의 목록으로 모으고, 가까운 것끼리 클러스터로 합쳐 동의 개수를 센다 (그리디).
  const all = runs.flatMap((blobs, ri) => blobs.map((b) => ({ ...b, ri })));
  const clusters = [];
  for (const b of all) {
    let hit = null;
    for (const c of clusters) { const dx = c.sumX / c.n - b.cx, dy = c.sumY / c.n - b.cy; if (Math.sqrt(dx * dx + dy * dy) <= mergeDistPx && !c.runs.has(b.ri)) { hit = c; break; } }
    if (hit) { hit.runs.add(b.ri); hit.sumX += b.cx; hit.sumY += b.cy; hit.n++; hit.areaSum += b.area; hit.areaMax = Math.max(hit.areaMax, b.area); }
    else clusters.push({ sumX: b.cx, sumY: b.cy, n: 1, runs: new Set([b.ri]), areaSum: b.area, areaMax: b.area });
  }
  const half = total / 2;
  const accepted = clusters.filter((c) => c.n >= Math.max(1, Math.ceil(half * 0.5))) // 최소 절반 가까이 동의해야 채택 (키스터닝 억제)
    .map((c) => ({ cx: c.sumX / c.n, cy: c.sumY / c.n, area: c.areaSum / c.n, confidence: c.n / total }));
  return { blobs: accepted, totalRuns: total };
}

// 큰 블롭(여러 플라크가 맞붙은 것으로 추정)을 중앙값 면적 기준으로 나눠 개수를 추정한다.
export function splitMergedBlobs(blobs, opts = {}) {
  if (blobs.length < 3) return { count: blobs.length, blobs };
  const areas = blobs.map((b) => b.area).sort((a, b) => a - b), med = areas[Math.floor(areas.length / 2)] || 1;
  const { mergeFactor = 1.6 } = opts;
  let count = 0; const out = [];
  for (const b of blobs) {
    const est = Math.max(1, Math.round(b.area / med));
    if (est > 1 && b.area > med * mergeFactor) { count += est; out.push({ ...b, merged: true, estCount: est }); }
    else { count += 1; out.push({ ...b, merged: false, estCount: 1 }); }
  }
  return { count, blobs: out };
}

// ---------- 판정 (TNTC / 너무 적음) ----------
const COUNT_RANGE = { 6: [20, 100], 12: [15, 60], 24: [10, 40] };
export function judgeCountability(count, wellType) {
  const range = COUNT_RANGE[wellType]; if (!range) return 'ok';
  if (count > range[1]) return 'tntc';
  if (count < range[0]) return 'too_few';
  return 'ok';
}

// ---------- 스케일(mm 환산) ----------
export const pxPerMm = (rulerPx, rulerMm) => rulerPx / rulerMm;
export const mmToPx = (mm, pxPerMmVal) => mm * pxPerMmVal;

// ---------- PRNT50 / PRNT80 / PRNT90: 로그 보간 ----------
// points: [{ dilution: number(희석배수, 예 10,40,160...), count: number }] — dilution 오름차순이 아니어도 된다.
// controlMean: 바이러스 대조군(항체 없음) 평균 플라크 수.
export function prntInterpolate(points, controlMean, targets = [50, 80, 90]) {
  const pts = points.filter((p) => p.dilution > 0 && Number.isFinite(p.count)).map((p) => ({ dilution: p.dilution, count: p.count, reduction: controlMean > 0 ? (1 - p.count / controlMean) * 100 : null })).sort((a, b) => a.dilution - b.dilution);
  const results = {};
  for (const t of targets) {
    results[t] = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.reduction === null || b.reduction === null) continue;
      if ((a.reduction - t) * (b.reduction - t) <= 0 && a.reduction !== b.reduction) {
        const la = Math.log10(a.dilution), lb = Math.log10(b.dilution);
        const frac = (a.reduction - t) / (a.reduction - b.reduction);
        results[t] = Math.pow(10, la + frac * (lb - la));
        break;
      }
    }
  }
  return { points: pts, results, formula: '감소율(%) = (1 − 플라크수 ÷ 대조군 평균) × 100;  PRNTx = 10^( log10(D1) + (R1−x)/(R1−R2) × (log10(D2)−log10(D1)) )  (R1≥x≥R2, D1<D2인 인접한 두 희석)' };
}
