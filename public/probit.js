// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Probit 회귀(검출 여부 자료의 용량-반응 분석)와 C05 · C50 · C95 계산. 외부 라이브러리 없음.
//   모형: probit(p) = a + b · log10(농도)    (이항 분포, 프로빗 연결)
//   C_p = 10^((z_p − a) / b)      z_p = Φ⁻¹(p)        예) C50 = 10^(−a/b), C95 = 10^((1.645 − a)/b)
//   추정: 최대우도(IRLS, 단계 반감), 신뢰구간: Fieller 방법, 적합도: 편차·Pearson χ²

// ---------- 특수 함수 (정규분포, 카이제곱) ----------
// erf: 항이 모두 양수인 급수(상쇄 없음) — |x| < 3, erfc: 연분수 — x ≥ 3
function erfSeries(x) {
  const x2 = x * x; let term = x, sum = x;
  for (let n = 1; n < 400; n++) { term *= (2 * x2) / (2 * n + 1); sum += term; if (term < sum * 1e-17) break; }
  return (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
}
function erfcFrac(x) {                      // x > 0 큰 값: 연분수(Lentz) — erfc(x) = e^{-x²}/(x√π) · 1/(1+ 1/(2x²)/(1+ 2/(2x²)/(1+…)))
  const tiny = 1e-300; let f = tiny, C = f, D = 0;
  // erfc(x) = e^{-x²}/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …)))))
  const a = (k) => (k === 0 ? 1 : k / 2);
  let b0 = x; f = b0; C = f; D = 0;
  for (let k = 1; k < 500; k++) {
    D = x + a(k) * D; D = D === 0 ? tiny : 1 / D;
    C = x + a(k) / C; if (C === 0) C = tiny;
    const delta = C * D; f *= delta; if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}
export function erfc(x) {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  const v = ax < 3 ? 1 - erfSeries(ax) : erfcFrac(ax);
  return x >= 0 ? v : 2 - v;
}
export const normCdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
const normPdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
export function normQuantile(p) {           // Acklam 근사 + Halley 보정(1단계)
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  let x;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  for (let i = 0; i < 2; i++) { const e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); x -= u / (1 + x * u / 2); }
  return x;
}
function lnGamma(z) {                       // Lanczos
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1; let x = c[0]; const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
export function chi2sf(x, df) {             // P(χ²_df > x) = Q(df/2, x/2)  (정규화 불완전 감마, 급수/연분수)
  if (!(df > 0) || !(x >= 0)) return NaN;
  if (x === 0) return 1;
  const a = df / 2, xx = x / 2, gln = lnGamma(a);
  if (xx < a + 1) { let ap = a, del = 1 / a, sum = del; for (let n = 0; n < 1000; n++) { ap += 1; del *= xx / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; } return 1 - sum * Math.exp(-xx + a * Math.log(xx) - gln); }
  const tiny = 1e-300; let b = xx + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny; c = b + an / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
  return Math.exp(-xx + a * Math.log(xx) - gln) * h;
}

// ---------- 보조 ----------
// 검출률의 Wilson 95% 구간 (그래프용)
export function wilson(k, n, z = 1.959964) {
  const p = k / n, z2 = z * z, den = 1 + z2 / n, mid = (p + z2 / (2 * n)) / den, half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

// ---------- Probit 회귀 ----------
// levels: [{ conc, n, k }]  (conc > 0, 0 ≤ k ≤ n, n ≥ 1). 반환: { ok, reason, ... }
export function probitFit(levels, opts = {}) {
  const method = opts.ci === 'profile' ? 'profile' : 'fieller';
  const used = [], dropped = [], warnings = [];
  levels.forEach((l, i) => {
    const { conc, n, k } = l;
    const bad = !(Number.isFinite(conc) && Number.isFinite(n) && Number.isFinite(k)) ? '값이 비어 있어요'
      : !(conc > 0) ? '농도가 0 이하(로그를 취할 수 없어요)' : !(n >= 1 && Number.isInteger(n)) ? '시행 수는 1 이상의 정수' : !(k >= 0 && Number.isInteger(k)) ? '양성 수는 0 이상의 정수' : k > n ? '양성 수가 시행 수보다 커요' : null;
    if (bad) dropped.push({ row: i + 1, reason: bad, ...l }); else used.push({ conc, n, k, x: Math.log10(conc), p: k / n });
  });
  // 같은 농도는 합친다
  const byX = new Map(); used.forEach((u) => { const g = byX.get(u.x); if (g) { g.n += u.n; g.k += u.k; g.p = g.k / g.n; } else byX.set(u.x, { ...u }); });
  const L = [...byX.values()].sort((p, q) => p.x - q.x);
  const base = { ok: false, used: L, dropped, warnings };
  if (L.length < 2) return { ...base, reason: '농도 수준이 2개 이상 필요해요' };
  const info = L.filter((l) => l.k > 0 && l.k < l.n).length;
  if (info === 0) return { ...base, reason: '검출률이 0%와 100% 사이인 농도가 없어요(완전 분리). 중간 농도의 자료가 필요해요' };

  const P = (e) => normCdf(e), Q = (e) => normCdf(-e);
  const dev = (a, b) => { let s = 0; for (const l of L) { const e = a + b * l.x, mu = Math.min(Math.max(P(e), 1e-300), 1), nu = Math.min(Math.max(Q(e), 1e-300), 1); if (l.k > 0) s += l.k * Math.log(l.k / (l.n * mu)); if (l.n - l.k > 0) s += (l.n - l.k) * Math.log((l.n - l.k) / (l.n * nu)); } return 2 * s; };
  // 초기값: 보정한 검출률의 프로빗 변환에 대한 가중 최소제곱
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const l of L) { const p = Math.min(Math.max((l.k + 0.5) / (l.n + 1), 0.01), 0.99), y = normQuantile(p), w = l.n; sw += w; sx += w * l.x; sy += w * y; sxx += w * l.x * l.x; sxy += w * l.x * y; }
  let b = (sxy - sx * sy / sw) / (sxx - sx * sx / sw), a = (sy - b * sx) / sw;
  if (!Number.isFinite(b) || b <= 0) { b = 1; a = -b * L[Math.floor(L.length / 2)].x; }
  let d0 = dev(a, b), iter = 0, M = null;
  for (; iter < 200; iter++) {
    let s00 = 0, s01 = 0, s11 = 0, r0 = 0, r1 = 0;
    for (const l of L) {
      const e = a + b * l.x, mu = Math.min(Math.max(P(e), 1e-300), 1), nu = Math.min(Math.max(Q(e), 1e-300), 1), f = Math.max(normPdf(e), 1e-300);
      const w = l.n * f * f / (mu * nu), z = e + (l.p - mu) / f;
      s00 += w; s01 += w * l.x; s11 += w * l.x * l.x; r0 += w * z; r1 += w * l.x * z;
    }
    const det = s00 * s11 - s01 * s01;
    if (!(Math.abs(det) > 1e-300)) break;
    M = { s00, s01, s11, det };
    const na = (s11 * r0 - s01 * r1) / det, nb = (s00 * r1 - s01 * r0) / det;
    let step = 1, ok = false, nd = d0, ca = a, cb = b;
    for (let h = 0; h < 30; h++) { ca = a + step * (na - a); cb = b + step * (nb - b); nd = dev(ca, cb); if (Number.isFinite(nd) && nd <= d0 + 1e-12) { ok = true; break; } step /= 2; }
    if (!ok) break;
    const delta = Math.abs(ca - a) + Math.abs(cb - b); a = ca; b = cb; const dd = Math.abs(d0 - nd); d0 = nd;
    if (delta < 1e-11 && dd < 1e-12) { iter++; break; }
  }
  if (!M || !Number.isFinite(a) || !Number.isFinite(b)) return { ...base, reason: '계산이 수렴하지 않았어요' };
  // 최종 정보 행렬로 공분산
  let s00 = 0, s01 = 0, s11 = 0, pear = 0, ll = 0;
  for (const l of L) {
    const e = a + b * l.x, mu = Math.min(Math.max(P(e), 1e-300), 1), nu = Math.min(Math.max(Q(e), 1e-300), 1), f = Math.max(normPdf(e), 1e-300), w = l.n * f * f / (mu * nu);
    s00 += w; s01 += w * l.x; s11 += w * l.x * l.x; pear += (l.k - l.n * mu) ** 2 / (l.n * mu * nu);
    ll += (l.k > 0 ? l.k * Math.log(mu) : 0) + (l.n - l.k > 0 ? (l.n - l.k) * Math.log(nu) : 0);
  }
  const det = s00 * s11 - s01 * s01, cov = { aa: s11 / det, ab: -s01 / det, bb: s00 / det };
  const seA = Math.sqrt(cov.aa), seB = Math.sqrt(cov.bb);
  if (!(Number.isFinite(seA) && Number.isFinite(seB)) || Math.abs(b) > 40) return { ...base, reason: '기울기가 무한대로 발산해요(완전 분리에 가까운 자료). 중간 농도의 자료가 더 필요해요' };
  if (b <= 0) warnings.push('농도가 높을수록 검출률이 낮아지는 자료예요(기울기 ≤ 0). 입력을 확인하세요.');

  const df = L.length - 2, deviance = dev(a, b);
  const res = { ok: true, used: L, dropped, warnings, a, b, seA, seB, cov, deviance, pearson: pear, df, logLik: ll, iter, n: L.reduce((s, l) => s + l.n, 0),
    pDev: df > 0 ? chi2sf(deviance, df) : null, pPear: df > 0 ? chi2sf(pear, df) : null, informative: info,
    pSlope: 2 * normCdf(-Math.abs(b / seB)) };
  // C_p 와 95% 신뢰구간 (Fieller)
  const t = 1.959964;
  const fieller = (z) => {                  // Fieller: (a - z + b x)² = t² (v_aa + 2x v_ab + x² v_bb)  의 두 근 (log10 농도)
    const A = b * b - t * t * cov.bb, B = 2 * ((a - z) * b - t * t * cov.ab), C = (a - z) ** 2 - t * t * cov.aa, disc = B * B - 4 * A * C;
    if (!(A > 0 && disc >= 0)) return null;
    const r1 = (-B - Math.sqrt(disc)) / (2 * A), r2 = (-B + Math.sqrt(disc)) / (2 * A);
    return [Math.min(r1, r2), Math.max(r1, r2)];
  };
  // 프로파일 우도: x_p 를 고정하고 b 에 대해 최대화한 로그우도가 (최대값 − χ²₁(0.95)/2) 이상인 x_p 의 범위
  const llxy = (aa, bb) => { let s = 0; for (const l of L) { const e = aa + bb * l.x, mu = Math.min(Math.max(P(e), 1e-300), 1), nu = Math.min(Math.max(Q(e), 1e-300), 1); s += (l.k > 0 ? l.k * Math.log(mu) : 0) + (l.n - l.k > 0 ? (l.n - l.k) * Math.log(nu) : 0); } return s; };
  const llMax = llxy(a, b), crit = llMax - 1.920729;
  const profLL = (z, x) => { let lo = 1e-3, hi = Math.max(60, 20 * Math.abs(b)); const g = (bb) => llxy(z - bb * x, bb); for (let i = 0; i < 48; i++) { const m1 = lo + (hi - lo) * 0.381966, m2 = lo + (hi - lo) * 0.618034; if (g(m1) < g(m2)) lo = m1; else hi = m2; } return g((lo + hi) / 2); };
  const profile = (z, hint) => {
    const xhat = (z - a) / b, out = [null, null];
    [-1, 1].forEach((dir, k) => {
      let inside = xhat, outside = null;
      const guess = hint ? hint[k] : null;
      if (guess !== null && Number.isFinite(guess) && (guess - xhat) * dir > 0 && profLL(z, guess) < crit) outside = guess;
      for (let s = 0.1, x = xhat; outside === null && s <= 6.0001; s += 0.1) { x = xhat + dir * s; if (profLL(z, x) < crit) outside = x; else inside = x; }
      if (outside === null) return;
      for (let i = 0; i < 36; i++) { const mid = (inside + outside) / 2; if (profLL(z, mid) < crit) outside = mid; else inside = mid; }
      out[k] = (inside + outside) / 2;
    });
    return out[0] !== null && out[1] !== null ? out : null;
  };
  res.method = method;
  res.cp = (p, m = method) => {
    const z = normQuantile(p), x = (z - a) / b, out = { p, z, x, c: 10 ** x, lo: null, hi: null, bounded: false, method: m };
    const f = fieller(z);
    const r = m === 'profile' ? profile(z, f) : f;
    if (r) { out.lo = 10 ** r[0]; out.hi = 10 ** r[1]; out.bounded = true; }
    return out;
  };
  // 곡선의 신뢰구간 띠: 확률 p 마다 (하한 농도, 상한 농도)
  res.band = (np = 60, m = method) => { const pts = []; for (let i = 0; i < np; i++) { const z = -3.4 + (6.8 * i) / (np - 1), p = normCdf(z), c = res.cp(p, m); pts.push({ p, x: c.x, lo: c.lo === null ? null : Math.log10(c.lo), hi: c.hi === null ? null : Math.log10(c.hi) }); } return pts; };
  res.prob = (x) => normCdf(a + b * x);
  res.C05 = res.cp(0.05); res.C50 = res.cp(0.5); res.C95 = res.cp(0.95);
  // 경고
  const cmin = L[0].conc, cmax = L[L.length - 1].conc;
  const outside = [['C05', res.C05], ['C50', res.C50], ['C95', res.C95]].filter(([, v]) => v.c < cmin || v.c > cmax).map(([k]) => k);
  if (outside.length) warnings.push(`${outside.join('·')}가 시험한 농도 범위(${cmin}–${cmax}) 밖이에요 — 외삽한 값이라 신뢰할 수 없어요.`);
  const unb = [['C05', res.C05], ['C50', res.C50], ['C95', res.C95]].filter(([, v]) => !v.bounded).map(([k]) => k);
  if (unb.length) warnings.push(`${unb.join('·')}의 95% 신뢰구간을 정할 수 없어요(자료가 부족해 한쪽이 무한대).`);
  else { const hiOut = [['C05', res.C05], ['C50', res.C50], ['C95', res.C95]].filter(([, v]) => v.hi > cmax).map(([k]) => k); if (hiOut.length) warnings.push(`${hiOut.join('·')}의 신뢰구간 상한이 최고 시험 농도(${cmax})를 넘어요 — 그 부근에 농도 수준을 추가하세요.`); }
  if (df > 0 && res.pDev < 0.05) warnings.push(`적합도가 낮아요(편차 p = ${res.pDev.toFixed(3)}). 모형이 자료에 잘 맞지 않을 수 있어요.`);
  if (info < 3) warnings.push(`검출률이 0~100% 사이인 농도 수준이 ${info}개뿐이에요. 3개 이상(권장 5개 이상)이면 더 믿을 수 있어요.`);
  if (L.some((l) => l.n < 10)) warnings.push('시행 수가 10회 미만인 농도가 있어요. 수준마다 10~25회 이상을 권장해요.');
  return res;
}
