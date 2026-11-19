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

export const PB_PROBS = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 0.8, 0.9, 0.95, 0.975, 0.98, 0.99];

// MedCalc 스타일 용량-반응(Dose-Response) 그래프: 로그 가로축(잔눈금), 0–1 세로축, 곡선 + 95% 신뢰 띠
export function plotSvg(fit, unit = '') {
  const W = 720, H = 440, L = 64, R = 26, T = 36, B = 62, pw = W - L - R, ph = H - T - B;
  const xs = fit.used.map((u) => u.x);
  const lo5 = fit.cp(0.05), hi95 = fit.cp(0.95);
  const xmin = Math.floor(Math.min(...xs, lo5.x, lo5.bounded ? Math.log10(lo5.lo) : Infinity) - 0.15);
  const xmax = Math.ceil(Math.max(...xs, hi95.x, hi95.bounded ? Math.log10(hi95.hi) : -Infinity) + 0.15);
  const X = (x) => L + ((x - xmin) / (xmax - xmin)) * pw, Y = (p) => T + (1 - p) * ph;
  const f1 = (v) => v.toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif" role="img" aria-label="Dose-Response plot">`;
  s += `<defs><clipPath id="pbclip"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath></defs><rect width="${W}" height="${H}" fill="#fff"/>`;
  s += `<text x="${W / 2}" y="20" font-size="14" font-weight="700" text-anchor="middle" fill="#14313b">Dose-Response plot</text>`;
  // 잔눈금(10년 간격 사이 2~9)과 큰 눈금
  for (let k = xmin; k < xmax; k++) for (let m = 2; m <= 9; m++) { const x = X(k + Math.log10(m)); s += `<line x1="${f1(x)}" y1="${T}" x2="${f1(x)}" y2="${T + ph}" stroke="#eef2f4"/>`; }
  for (let k = xmin; k <= xmax; k++) s += `<line x1="${f1(X(k))}" y1="${T}" x2="${f1(X(k))}" y2="${T + ph}" stroke="#c9d6dc"/><line x1="${f1(X(k))}" y1="${T + ph}" x2="${f1(X(k))}" y2="${T + ph + 5}" stroke="#6a8590"/><text x="${f1(X(k))}" y="${T + ph + 19}" font-size="11" text-anchor="middle" fill="#3a5560">${k >= -3 && k <= 6 ? fmtC(10 ** k).replace(/\.0+$/, '') : '10<tspan baseline-shift="super" font-size="8">' + k + '</tspan>'}</text>`;
  for (let i = 0; i <= 10; i++) { const p = i / 10; s += `<line x1="${L}" y1="${f1(Y(p))}" x2="${W - R}" y2="${f1(Y(p))}" stroke="${i % 5 ? '#eef2f4' : '#c9d6dc'}"/><text x="${L - 8}" y="${f1(Y(p) + 4)}" font-size="11" text-anchor="end" fill="#3a5560">${p.toFixed(1)}</text>`; }
  s += `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#9db4bd"/>`;
  // 95% 신뢰 띠
  const band = fit.band(90);
  const okb = band.filter((b) => b.lo !== null);
  if (okb.length > 2) {
    const left = okb.map((b) => `${f1(X(b.lo))} ${f1(Y(b.p))}`), right = okb.map((b) => `${f1(X(b.hi))} ${f1(Y(b.p))}`);
    s += `<g clip-path="url(#pbclip)"><polygon points="${left.join(' ')} ${right.slice().reverse().join(' ')}" fill="#bcd6f2" fill-opacity=".65"/>`;
    s += `<polyline points="${left.join(' ')}" fill="none" stroke="#5b8fc9" stroke-dasharray="5 3"/><polyline points="${right.join(' ')}" fill="none" stroke="#5b8fc9" stroke-dasharray="5 3"/></g>`;
  }
  // 적합 곡선
  let d = '';
  for (let i = 0; i <= 240; i++) { const x = xmin + ((xmax - xmin) * i) / 240; d += `${i ? 'L' : 'M'}${f1(X(x))} ${f1(Y(fit.prob(x)))} `; }
  s += `<path d="${d}" fill="none" stroke="#10265c" stroke-width="2.4" clip-path="url(#pbclip)"/>`;
  // 관측 검출률 (Wilson 95% 막대)
  for (const u of fit.used) {
    const [lo, hi] = wilson(u.k, u.n);
    s += `<line x1="${f1(X(u.x))}" y1="${f1(Y(lo))}" x2="${f1(X(u.x))}" y2="${f1(Y(hi))}" stroke="#14313b" stroke-opacity=".5"/><circle cx="${f1(X(u.x))}" cy="${f1(Y(u.p))}" r="4.2" fill="#fff" stroke="#10265c" stroke-width="1.8"/>`;
  }
  // C05 · C50 · C95 표시
  const cols = { 0.05: '#e08e0b', 0.5: '#0e8fa0', 0.95: '#c0362c' };
  for (const [lab, c] of [['C05', fit.C05], ['C50', fit.C50], ['C95', fit.C95]]) {
    const col = cols[c.p];
    s += `<line x1="${L}" y1="${f1(Y(c.p))}" x2="${f1(X(c.x))}" y2="${f1(Y(c.p))}" stroke="${col}" stroke-dasharray="3 3" stroke-opacity=".8"/><line x1="${f1(X(c.x))}" y1="${f1(Y(c.p))}" x2="${f1(X(c.x))}" y2="${T + ph}" stroke="${col}" stroke-dasharray="3 3" stroke-opacity=".8"/>`;
    s += `<circle cx="${f1(X(c.x))}" cy="${f1(Y(c.p))}" r="4" fill="${col}"/><text x="${f1(X(c.x) + 7)}" y="${f1(Y(c.p) + (c.p > 0.9 ? 15 : -7))}" font-size="11" font-weight="700" fill="${col}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${lab} = ${fmtC(c.c)}</text>`;
  }
  s += `<text x="${L + pw / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="#14313b">Dose${unit ? ` (${esc(unit)})` : ''}</text><text transform="translate(16 ${T + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#14313b">Probability</text>`;
  // 범례
  s += `<g font-size="10.5" fill="#3a5560" transform="translate(${L + 10} ${T + 12})"><line x1="0" y1="0" x2="22" y2="0" stroke="#10265c" stroke-width="2.4"/><text x="27" y="3">fitted</text><rect x="70" y="-5" width="18" height="10" fill="#bcd6f2"/><text x="93" y="3">95% CI${okb.length > 2 ? '' : ' (n/a)'}</text><circle cx="160" cy="0" r="3.6" fill="#fff" stroke="#10265c" stroke-width="1.6"/><text x="168" y="3">observed (Wilson 95%)</text></g>`;
  return s + '</svg>';
}

// Dose-Response table: 확률별 용량과 95% 신뢰구간
export function doseTable(fit, ciLabel = '') {
  const hi = new Set([0.05, 0.5, 0.95]);
  let h = `<table class="drt"><thead><tr><th>Probability</th><th>Dose</th><th>95% CI lower</th><th>95% CI upper</th></tr></thead><tbody>`;
  const rows = [];
  for (const p of PB_PROBS) {
    const c = fit.cp(p);
    rows.push([p, c]);
    h += `<tr${hi.has(p) ? ' class="key"' : ''}><td>${p.toFixed(3)}</td><td>${fmtC(c.c)}</td><td>${c.bounded ? fmtC(c.lo) : '–'}</td><td>${c.bounded ? fmtC(c.hi) : '–'}</td></tr>`;
  }
  return { html: h + '</tbody></table>', rows };
}
