// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// BCoV standard curve 그래프를 캔버스로 그려 PNG로 만든다 (결과서 그림 칸용, 1037:606 비율).

import { fixed } from './num.js';

export const CHART_W = 2074, CHART_H = 1212; // 결과서 그림 비율(1037×606)의 2배

// points: [[x, y]...], fit: {slope, intercept, r2, efficiency}, xLabel: X축 이름
export function drawStandardCurve(canvas, points, fit, xLabel = 'Log10 concentration (copies/µL)') {
  const W = (canvas.width = CHART_W), H = (canvas.height = CHART_H), c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  const FONT = '"Noto Sans KR","Malgun Gothic",Arial,sans-serif';
  const L = 190, R = 70, T = 150, B = 190;           // 여백
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const pad = (x1 - x0) * 0.06; x0 -= pad; x1 += pad;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);

  c.font = `bold 54px ${FONT}`; c.fillStyle = '#000'; c.textAlign = 'center';
  c.fillText('BCoV standard curve', W / 2, 80);

  // 격자 + 눈금
  c.strokeStyle = '#ddd'; c.lineWidth = 2; c.fillStyle = '#000'; c.font = `38px ${FONT}`;
  for (let y = y0; y <= y1; y += 5) {
    c.beginPath(); c.moveTo(L, Y(y)); c.lineTo(W - R, Y(y)); c.stroke();
    c.textAlign = 'right'; c.fillText(String(y), L - 14, Y(y) + 13);
  }
  const step = (x1 - x0) > 6 ? 1 : (x1 - x0) > 3 ? 0.5 : 0.25;
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    c.beginPath(); c.moveTo(X(x), T); c.lineTo(X(x), H - B); c.stroke();
    c.textAlign = 'center'; c.fillText(String(+fixed(x, 2)), X(x), H - B + 52);
  }
  // 축
  c.strokeStyle = '#000'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(L, T); c.lineTo(L, H - B); c.lineTo(W - R, H - B); c.stroke();
  c.font = `42px ${FONT}`; c.textAlign = 'center';
  c.fillText(xLabel, (L + W - R) / 2, H - 50);
  c.save(); c.translate(60, (T + H - B) / 2); c.rotate(-Math.PI / 2); c.fillText('Ct', 0, 0); c.restore();

  // 회귀선
  c.strokeStyle = '#1f5fd6'; c.lineWidth = 5;
  c.beginPath(); c.moveTo(X(x0), Y(fit.slope * x0 + fit.intercept)); c.lineTo(X(x1), Y(fit.slope * x1 + fit.intercept)); c.stroke();
  // 측정점
  c.fillStyle = '#c0392b';
  for (const [x, y] of points) { c.beginPath(); c.arc(X(x), Y(y), 11, 0, 2 * Math.PI); c.fill(); }

  // 식 표기
  const sign = fit.intercept < 0 ? '−' : '+';
  const lines = [`y = ${fixed(fit.slope, 3)}x ${sign} ${fixed(Math.abs(fit.intercept), 3)}`, `R² = ${fixed(fit.r2, 4)}`,
    Number.isFinite(fit.efficiency) ? `Efficiency = ${fixed(fit.efficiency, 1)} %` : ''].filter(Boolean);
  c.font = `44px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#000';
  const bx = W - R - 700, by = T + 30;
  c.fillStyle = 'rgba(255,255,255,.92)'; c.fillRect(bx - 20, by - 10, 700, lines.length * 62 + 20);
  c.strokeStyle = '#999'; c.lineWidth = 2; c.strokeRect(bx - 20, by - 10, 700, lines.length * 62 + 20);
  c.fillStyle = '#000'; lines.forEach((s, i) => c.fillText(s, bx, by + 42 + i * 62));
  return canvas;
}

// HWPX 그림 칸은 원본 크기를 1037×606 px(96dpi)로 기록하고 있으므로 같은 픽셀 크기로 내보낸다.
// (크기가 다르면 한글이 이미지를 잘라서 보여준다)
export const HWPX_W = 1037, HWPX_H = 606;

export function curvePng(points, fit, xLabel) {
  const big = document.createElement('canvas');
  drawStandardCurve(big, points, fit, xLabel);
  const out = document.createElement('canvas');
  out.width = HWPX_W; out.height = HWPX_H;
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(big, 0, 0, HWPX_W, HWPX_H);
  return new Promise((res, rej) => out.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('그래프 생성 실패'))), 'image/png'));
}
