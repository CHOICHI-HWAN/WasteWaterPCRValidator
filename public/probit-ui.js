// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Probit 결과 표시: 숫자 서식, 검출률 곡선 그래프(SVG)
import { normCdf, wilson } from './probit.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 농도 표시: 유효숫자 3자리 (큰 수는 쉼표)
export function fmtC(v) {
  if (!Number.isFinite(v)) return '–';
  if (v >= 1000) return Math.round(v).toLocaleString('en-US');
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toExponential(2);
}

export function plotSvg(fit, unit = '') {
  const W = 640, H = 360, L = 62, R = 22, T = 22, B = 56, pw = W - L - R, ph = H - T - B;
  const xs = fit.used.map((u) => u.x);
  const xmin = Math.min(...xs, fit.C05.x) - 0.25, xmax = Math.max(...xs, fit.C95.x) + 0.25;
  const X = (x) => L + ((x - xmin) / (xmax - xmin)) * pw, Y = (p) => T + (1 - p) * ph;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif" role="img" aria-label="Probit 검출률 곡선">`;
  s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const p of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${L}" y1="${Y(p)}" x2="${W - R}" y2="${Y(p)}" stroke="#e5eef2"/><text x="${L - 8}" y="${Y(p) + 4}" font-size="11" text-anchor="end" fill="#6a8590">${Math.round(p * 100)}%</text>`;
  for (let k = Math.ceil(xmin); k <= Math.floor(xmax); k++) s += `<line x1="${X(k)}" y1="${T}" x2="${X(k)}" y2="${T + ph}" stroke="#e5eef2"/><text x="${X(k)}" y="${T + ph + 16}" font-size="11" text-anchor="middle" fill="#6a8590">${fmtC(10 ** k)}</text>`;
  s += `<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="#9db4bd"/><line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" stroke="#9db4bd"/>`;
  s += `<text x="${L + pw / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="#14313b">농도 ${unit ? `(${esc(unit)}) ` : ''}— 로그 눈금</text><text transform="translate(16 ${T + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#14313b">검출률 (양성 비율)</text>`;
  // 기준선(5·50·95%)과 C 값
  const cols = { 0.05: '#e08e0b', 0.5: '#0e8fa0', 0.95: '#c0362c' };
  for (const [lab, c] of [['C05', fit.C05], ['C50', fit.C50], ['C95', fit.C95]]) {
    const col = cols[c.p];
    s += `<line x1="${L}" y1="${Y(c.p)}" x2="${X(c.x)}" y2="${Y(c.p)}" stroke="${col}" stroke-dasharray="4 3"/><line x1="${X(c.x)}" y1="${Y(c.p)}" x2="${X(c.x)}" y2="${T + ph}" stroke="${col}" stroke-dasharray="4 3"/>`;
    if (c.bounded) s += `<line x1="${X(Math.log10(c.lo))}" y1="${Y(c.p)}" x2="${X(Math.log10(c.hi))}" y2="${Y(c.p)}" stroke="${col}" stroke-width="5" stroke-opacity=".35" stroke-linecap="round"/>`;
    s += `<circle cx="${X(c.x)}" cy="${Y(c.p)}" r="4.5" fill="${col}"/><text x="${X(c.x) + 6}" y="${Y(c.p) + (c.p > 0.9 ? 16 : -7)}" font-size="12" font-weight="700" fill="${col}" stroke="#fff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${lab} = ${fmtC(c.c)}</text>`;
  }
  // 적합 곡선
  let d = '';
  for (let i = 0; i <= 160; i++) { const x = xmin + ((xmax - xmin) * i) / 160; d += `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(normCdf(fit.a + fit.b * x)).toFixed(1)} `; }
  s += `<path d="${d}" fill="none" stroke="#2f80ed" stroke-width="2.5"/>`;
  // 관측 검출률 + Wilson 95% 구간
  for (const u of fit.used) {
    const [lo, hi] = wilson(u.k, u.n);
    s += `<line x1="${X(u.x)}" y1="${Y(lo)}" x2="${X(u.x)}" y2="${Y(hi)}" stroke="#14313b" stroke-opacity=".55"/><circle cx="${X(u.x)}" cy="${Y(u.p)}" r="5" fill="#fff" stroke="#14313b" stroke-width="2"/>`;
  }
  return s + '</svg>';
}
