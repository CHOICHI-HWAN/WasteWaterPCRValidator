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
    else if (mode === 'saturation') { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx; out[i] = 255 * sat; }
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

// ---------- 진짜 자동 검출: 사용자가 범위를 그리지 않아도, 염색된 웰(채도 높은 원형 얼룩)을 사진에서 직접 찾는다 ----------
// 1) detectColorBlobs: 다운샘플한 그리드에서 "채도가 뚜렷한" 픽셀만 남기고(배경·검은 띠·그림자는 채도가 낮다),
//    침식(erode)으로 서로 거의 맞닿은 웰 사이의 얇은 다리를 끊은 뒤 연결 요소를 찾는다.
export function detectColorBlobs(pixels, w, h, opts = {}) {
  const { gridMax = 260, satThr = 0.5, erode = 1, minAreaFrac = 0.0012, aspectMin = 0.5, aspectMax = 2.0 } = opts;
  const scale = Math.min(1, gridMax / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * scale)), gh = Math.max(1, Math.round(h * scale));
  let mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const sx = Math.min(w - 1, Math.floor(((gx + 0.5) / gw) * w)), sy = Math.min(h - 1, Math.floor(((gy + 0.5) / gh) * h));
    const i = (sy * w + sx) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx;
    mask[gy * gw + gx] = sat > satThr ? 1 : 0;
  }
  for (let k = 0; k < erode; k++) {
    const nm = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      if (!mask[gy * gw + gx]) continue;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
        const ny = gy + dy, nx = gx + dx;
        if (ny < 0 || nx < 0 || ny >= gh || nx >= gw || !mask[ny * gw + nx]) ok = false;
      }
      nm[gy * gw + gx] = ok ? 1 : 0;
    }
    mask = nm;
  }
  const visited = new Uint8Array(gw * gh), blobs = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    const stack = [i]; visited[i] = 1; let sumX = 0, sumY = 0, area = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    while (stack.length) {
      const p = stack.pop(), py = (p / gw) | 0, px = p % gw;
      sumX += px; sumY += py; area++;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1, aspect = bw / bh;
    if (area < minAreaFrac * gw * gh || aspect < aspectMin || aspect > aspectMax) continue;
    blobs.push({ cx: ((sumX / area + 0.5) / gw) * w, cy: ((sumY / area + 0.5) / gh) * h, area, bw, bh });
  }
  return blobs;
}

// 1차원 값들을 오름차순으로 정렬한 뒤, 가장 큰 (k-1)개의 간격을 기준으로 k개 그룹으로 나눈다(균등 그리드 가정).
function clusterInto(items, k, valueOf) {
  if (k <= 1 || items.length <= k) return [items.slice()];
  const sorted = items.slice().sort((a, b) => valueOf(a) - valueOf(b));
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push({ i, gap: valueOf(sorted[i]) - valueOf(sorted[i - 1]) });
  gaps.sort((a, b) => b.gap - a.gap);
  const cuts = gaps.slice(0, k - 1).map((g) => g.i).sort((a, b) => a - b);
  const groups = []; let start = 0;
  for (const c of cuts) { groups.push(sorted.slice(start, c)); start = c; }
  groups.push(sorted.slice(start));
  return groups;
}

// 2) inferWellGrid: detectColorBlobs가 찾은 후보들 중 "서로 크기가 비슷한" 것들만 남기고(스티커 메모 같은 엉뚱한 큰 덩어리 제외),
//    남은 후보들의 x·y 좌표를 rows×cols 그리드로 묶어 웰 중심을 추정한다. 자신 없으면(개수가 너무 안 맞으면) null.
export function inferWellGrid(blobs, rows, cols, opts = {}) {
  const { sizeTolLow = 0.4, sizeTolHigh = 2.4, minMatchFrac = 0.7, marginRatio = 0.42 } = opts;
  if (!blobs.length) return null;
  const areas = blobs.map((b) => b.area).sort((a, b) => a - b);
  let median = areas[Math.floor(areas.length / 2)] || 1;
  let kept = blobs.filter((b) => b.area >= median * sizeTolLow && b.area <= median * sizeTolHigh);
  if (kept.length >= 3) { // 2차: 남은 것들만으로 중앙값을 다시 구해 이상치 영향을 줄인다
    const a2 = kept.map((b) => b.area).sort((x, y) => x - y);
    median = a2[Math.floor(a2.length / 2)] || median;
    kept = kept.filter((b) => b.area >= median * sizeTolLow && b.area <= median * sizeTolHigh);
  }
  const expected = rows * cols;
  if (kept.length < Math.max(2, expected * minMatchFrac)) return null;

  const rowGroups = clusterInto(kept, rows, (b) => b.cy);
  const colGroups = clusterInto(kept, cols, (b) => b.cx);
  if (rowGroups.length < rows || colGroups.length < cols) return null;
  const rowCenters = rowGroups.map((g) => g.reduce((a, b) => a + b.cy, 0) / g.length);
  const colCenters = colGroups.map((g) => g.reduce((a, b) => a + b.cx, 0) / g.length);
  const rowOf = (b) => { let bi = 0, bd = Infinity; rowCenters.forEach((c, i) => { const d = Math.abs(c - b.cy); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const colOf = (b) => { let bi = 0, bd = Infinity; colCenters.forEach((c, i) => { const d = Math.abs(c - b.cx); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const cellArea = new Map(); // "row,col" -> 가장 큰 블롭(여러 개가 같은 칸에 들어오면 그걸 쓴다)
  for (const b of kept) { const k = `${rowOf(b)},${colOf(b)}`; const prev = cellArea.get(k); if (!prev || b.area > prev.area) cellArea.set(k, b); }
  // kept.length(크기가 비슷한 후보 개수)만 보면 안 된다 — 그리드로 묶었을 때 서로 다른 칸에 실제로 자리 잡은 개수(= 진짜 자신 있게 맞춘 웰 수)를 봐야 한다.
  if (cellArea.size < Math.max(2, expected * minMatchFrac)) return null;

  const spacingX = colCenters.length > 1 ? (colCenters[colCenters.length - 1] - colCenters[0]) / (colCenters.length - 1) : null;
  const spacingY = rowCenters.length > 1 ? (rowCenters[rowCenters.length - 1] - rowCenters[0]) / (rowCenters.length - 1) : null;
  const avgBlobSize = kept.reduce((a, b) => a + (b.bw + b.bh) / 2, 0) / kept.length;
  const pitch = spacingX !== null && spacingY !== null ? Math.min(spacingX, spacingY) : spacingX ?? spacingY ?? avgBlobSize / marginRatio;
  const r = Math.max(2, pitch * marginRatio);

  const wells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const hit = cellArea.get(`${row},${col}`);
    wells.push({ row, col, cx: hit ? hit.cx : colCenters[col], cy: hit ? hit.cy : rowCenters[row], r, matched: !!hit });
  }
  return { wells, rowCenters, colCenters, matchedCount: cellArea.size };
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

// 가장자리 제외 비율(웰 반지름의 몇 %를 테두리로 보고 뺄지) — 메니스커스·벽 그림자·반사로 염색이 왜곡되는 구간을 피한다.
// 반지름의 6% = 웰 전체 면적의 약 11.6%(1 − 0.94²). 사용자와 상의해 이 값으로 유지하기로 함(2026-11-28).
export const EDGE_EXCLUDE_FRAC = 0.06;

// ---------- 연결 요소(블롭) 검출: 한 웰, 한 문턱값 ----------
// edgeExclude(px): 가장자리 플라크 제외(웰 테두리 효과 배제). minAreaPx/maxAreaPx: 면적 필터.
export function detectBlobs(channel, w, h, well, threshold, opts = {}) {
  // maxAspect/minFillRatio: 플라크(또는 맞붙은 플라크 몇 개)는 대체로 둥글넓적하다 — 반사광 줄무늬나 얼룩 같은
  // 가늘고 긴 잡음(가로세로 비율이 아주 크거나, 테두리 상자 안을 듬성듬성 채우는 모양)은 플라크가 아니다(실측으로 확인됨:
  // 일반 조명(반사광)으로 찍은 사진에서 하이라이트 줄무늬가 플라크로 잘못 잡혀 거짓양성을 크게 늘렸다).
  const { edgeExclude = Math.round(well.r * EDGE_EXCLUDE_FRAC), minAreaPx = 3, maxAreaPx = Infinity, maxAspect = 3.5, minFillRatio = 0.3 } = opts;
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
    const stack = [i]; visited[i] = 1; const pix = [];
    let sumX = 0, sumY = 0, area = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    while (stack.length) {
      const p = stack.pop(), py = (p / bw) | 0, px = p % bw;
      pix.push(px, py);
      sumX += px; sumY += py; area++;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      const nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
      for (const [nx, ny] of nb) { if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const ni = ny * bw + nx; if (mask[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); } }
    }
    if (area < minAreaPx || area > maxAreaPx) continue;
    const mw = maxX - minX + 1, mh = maxY - minY + 1;
    if (Math.max(mw, mh) / Math.min(mw, mh) > maxAspect || area / (mw * mh) < minFillRatio) continue; // 가늘고 긴 줄무늬·잡음 제외
    // 이 블롭만의 작은 마스크를 따로 떼어 둔다 — 나중에 "모양"으로 맞붙은 플라크 개수를 셀 때 쓴다(크기 비교 대신).
    const compMask = new Uint8Array(mw * mh);
    for (let k = 0; k < pix.length; k += 2) compMask[(pix[k + 1] - minY) * mw + (pix[k] - minX)] = 1;
    blobs.push({ cx: x0 + sumX / area, cy: y0 + sumY / area, area, w: mw, h: mh, mask: compMask, maskW: mw, maskH: mh });
  }
  return blobs;
}

// ---------- 체임퍼 거리변환(근사 유클리드 거리): 전경 픽셀이 배경에서 얼마나 떨어져 있는지 ----------
export function distanceTransform(mask, w, h) {
  const INF = 1e9, dist = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? INF : dist[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    dist[y * w + x] = Math.min(dist[y * w + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4142, at(x + 1, y - 1) + 1.4142);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    if (!mask[y * w + x]) continue;
    dist[y * w + x] = Math.min(dist[y * w + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4142, at(x - 1, y + 1) + 1.4142);
  }
  return dist;
}

// ---------- 덩어리 모양으로 "몇 개가 맞붙었는지" 세기 ----------
// 크기가 제각각이어도 된다: 평균 크기와 비교하지 않고, 거리변환의 극대점(= 각 둥근 덩어리의 한가운데)을 센다.
// 맞붙은 원 두 개는 잘록한 경계 때문에 극대점이 둘로 나뉘고, 그냥 큰 플라크 하나는 극대점이 하나뿐이다.
export function countLobes(mask, w, h, opts = {}) {
  const { minPeakFrac = 0.3, sepFrac = 0.75 } = opts;
  const dist = distanceTransform(mask, w, h);
  let maxD = 0; for (const d of dist) if (d < 1e8 && d > maxD) maxD = d;
  if (maxD <= 0) return { count: 1, peaks: [] };
  const candidates = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    const d = dist[i]; if (d < maxD * minPeakFrac) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1 && isMax; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dist[ny * w + nx] > d) isMax = false;
    }
    if (isMax) candidates.push({ x, y, d });
  }
  candidates.sort((a, b) => b.d - a.d);
  const minSep = maxD * sepFrac, peaks = [];
  for (const c of candidates) if (peaks.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= minSep)) peaks.push(c);
  return { count: Math.max(1, peaks.length), peaks };
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
    if (hit) { hit.runs.add(b.ri); hit.sumX += b.cx; hit.sumY += b.cy; hit.n++; hit.areaSum += b.area; hit.areaMax = Math.max(hit.areaMax, b.area); hit.members.push(b); }
    else clusters.push({ sumX: b.cx, sumY: b.cy, n: 1, runs: new Set([b.ri]), areaSum: b.area, areaMax: b.area, members: [b] });
  }
  const half = total / 2;
  const accepted = clusters.filter((c) => c.n >= Math.max(1, Math.ceil(half * 0.5))) // 최소 절반 가까이 동의해야 채택 (키스터닝 억제)
    .map((c) => {
      // 모양으로 개수를 셀 때 쓸 "대표 마스크": 여러 실행 중 면적이 중앙값에 가장 가까운 것의 모양을 쓴다(극단값 피하기).
      const byArea = c.members.slice().sort((a, b) => a.area - b.area), rep = byArea[Math.floor(byArea.length / 2)];
      return { cx: c.sumX / c.n, cy: c.sumY / c.n, area: c.areaSum / c.n, confidence: c.n / total, mask: rep.mask, maskW: rep.maskW, maskH: rep.maskH };
    });
  return { blobs: accepted, totalRuns: total };
}

// 맞붙은 블롭을 몇 개로 나눠 셀지 추정한다. 평균 면적과 비교하지 않는다 — 플라크는 크기가 다양해서(작은 것도
// 큰 것도 있다) "평균보다 크면 여러 개"라는 가정은 큰 플라크 하나를 잘못 쪼갤 수 있다. 대신 각 블롭 자신의
// 모양(countLobes, 거리변환 극대점)만 본다: 같은 크기든 아니든 진짜 잘록한 경계가 있어야만 여러 개로 센다.
export function splitMergedBlobs(blobs, opts = {}) {
  let count = 0; const out = [];
  for (const b of blobs) {
    const est = b.mask && b.maskW && b.maskH ? countLobes(b.mask, b.maskW, b.maskH, opts).count : 1;
    count += est;
    out.push({ ...b, merged: est > 1, estCount: est });
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
