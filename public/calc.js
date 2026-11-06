// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 표준곡선 / 회수율 계산 (순수 함수, 브라우저·Node 공용)

// 계산 계층의 타입 규칙: 값은 반드시 number(double). 빈 칸은 NaN으로 표현하고, 문자열 등 다른 타입은 조용히 버리지 않고 오류로 알린다.
function assertNumber(v, name) {
  if (typeof v !== 'number') throw new TypeError(`${name}: number가 아닌 값(${typeof v}: ${JSON.stringify(v)})`);
  return v;
}

export function linearFit(x, y) {
  x.forEach((v, i) => { assertNumber(v, `x[${i}]`); assertNumber(y[i], `y[${i}]`); });
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy), n, mx, my, sxy, sxx, syy };
}

// rows: [{ conc: copies/µL, cts: [Ct, Ct, Ct] }]  (빈 칸/NaN 제외)
// xMode: 'log' = log10(copies/µL), 'dilution' = 0,-1,-2.. (원액=0)
export function standardCurve(rows, xMode = 'log') {
  const x = [], y = [];
  rows.forEach((r, i) => {
    assertNumber(r.conc, `rows[${i}].conc`); r.cts.forEach((c, j) => assertNumber(c, `rows[${i}].cts[${j}]`));
    const xv = xMode === 'log' ? Math.log10(r.conc) : -i;
    r.cts.forEach((ct) => { if (Number.isFinite(ct)) { x.push(xv); y.push(ct); } });
  });
  const fit = linearFit(x, y);
  fit.efficiency = (10 ** (-1 / fit.slope) - 1) * 100; // %
  return fit;
}

export function recovery(ct, { slope, intercept }, spiked) {
  [ct, slope, intercept, spiked].forEach((v, i) => assertNumber(v, ['ct', 'slope', 'intercept', 'spiked'][i]));
  const recovered = 10 ** ((ct - intercept) / slope);
  return { recovered, pct: (recovered / spiked) * 100 };
}

export function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
// sample=true: 표본 SD(n-1, STDEV.S), false: 모집단 SD(n, STDEV.P)
export function sd(a, sample = true) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - (sample ? 1 : 0)));
}

// 제출값 vs 계산값 비교. tol: 반올림 자릿수 기준 허용오차
export function compare(reported, calc, tol) {
  const diff = reported - calc;
  return { reported, calc, diff, ok: Math.abs(diff) <= tol };
}
