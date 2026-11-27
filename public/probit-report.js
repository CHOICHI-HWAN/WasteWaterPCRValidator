// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Probit 분석(LoD) 결과 보고서: 보고서 모델(eds-report.js 의 renderPages · buildHwpx 로 그리는 블록 목록)과 그래프 PNG 변환
import { PB_PROBS, fmtC } from './probit-ui.js';
import { wilson } from './probit.js';

const f = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const p3 = (p) => (p === null || p === undefined ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(3));

export function buildProbitModel(fit, o) {
  const B = [], unit = o.unit || '', u = unit ? ` ${unit}` : '';
  const ci = o.ci === 'profile' ? '프로파일 우도' : 'Fieller';
  B.push({ t: 'title', text: 'Probit 분석 (LoD) 결과 보고서' });
  B.push({ t: 'sub', text: o.title || 'C05 · C50 · C95 검출한계 분석' });
  B.push({ t: 'approval', roles: o.approvers ?? ['실무자', '중간관리자', '관리자'] });
  B.push({ t: 'p', small: true, center: true, text: `생성: ${o.program} Probit v${o.version}  ·  ${(o.now ?? new Date()).toLocaleString('ko-KR', { hour12: false })}` });

  B.push({ t: 'h', text: '1. 분석 조건' });
  B.push({ t: 'kv', rows: [['농도 단위', unit || '–'], ['신뢰구간 방법', `${ci} (95 %)`], ['농도 수준', `${fit.used.length}개`], ['총 시행 수', `${fit.n}회`], ['총 양성 수', `${fit.used.reduce((s, x) => s + x.k, 0)}회`], ['반복 계산', `${fit.iter}회`]] });
  if (fit.dropped.length) B.push({ t: 'p', text: `계산에서 제외한 행: ${fit.dropped.map((d) => `${d.rowNo ?? d.row}행(${d.reason})`).join(', ')}` });

  B.push({ t: 'h', text: '2. 입력 자료' });
  B.push({ t: 'table', head: [`농도${unit ? ` (${unit})` : ''}`, 'log10 농도', '시행 수 (n)', '양성 수 (k)', '검출률 (%)', '검출률 95 % 구간 (Wilson)'],
    widths: [1.3, 1, 1, 1, 1, 1.9],
    rows: fit.used.map((x) => { const [lo, hi] = wilson(x.k, x.n); return [fmtC(x.conc), f(x.x, 2), String(x.n), String(x.k), f(x.p * 100, 1), `${f(lo * 100, 1)} – ${f(hi * 100, 1)}`]; }) });
  B.push({ t: 'p', small: true, text: '같은 농도를 여러 줄로 입력했다면 합쳐서 한 줄로 계산했어요.' });

  B.push({ t: 'h', text: '3. 검출한계 (C05 · C50 · C95)' });
  B.push({ t: 'table', head: ['항목', '검출률', `농도${unit ? ` (${unit})` : ''}`, '95 % 신뢰구간 하한', '95 % 신뢰구간 상한'], widths: [1, 1, 1.4, 1.6, 1.6],
    rows: [['C05', fit.C05], ['C50', fit.C50], ['C95', fit.C95]].map(([n, c]) => [n, `${Math.round(c.p * 100)} %`, fmtC(c.c), c.bounded ? fmtC(c.lo) : '–', c.bounded ? fmtC(c.hi) : '–']) });
  B.push({ t: 'p', text: `C95 = ${fmtC(fit.C95.c)}${u}: 이 농도에서 시료의 95 %가 검출될 것으로 추정해요 (일반적인 LoD 정의).` });

  B.push({ t: 'h', text: '4. 모형과 적합도' });
  B.push({ t: 'kv', rows: [['절편 a', `${f(fit.a, 3)} (SE ${f(fit.seA, 3)})`], ['기울기 b', `${f(fit.b, 3)} (SE ${f(fit.seB, 3)})`], ['기울기 p 값', p3(fit.pSlope)], ['편차 (Deviance)', `${f(fit.deviance, 2)}  (자유도 ${fit.df}${fit.df > 0 ? `, p = ${p3(fit.pDev)}` : ''})`], ['Pearson χ²', `${f(fit.pearson, 2)}${fit.df > 0 ? `  (p = ${p3(fit.pPear)})` : ''}`], ['로그 우도', f(fit.logLik, 2)]] });
  B.push({ t: 'fx', lines: [
    `probit(p) = a + b · log10(농도) = ${f(fit.a, 3)} + ${f(fit.b, 3)} · log10(농도)  (최대우도법으로 추정)`,
    'C_p = 10^((z_p − a) ÷ b),  z_p = Φ⁻¹(p) (표준정규분포의 분위수),  C50 = 10^(−a ÷ b),  C95 : z = 1.645',
    '검출률 95 % 구간 (Wilson) = [ p̂ + z²/2n ± z·√( p̂(1−p̂)/n + z²/4n² ) ] ÷ ( 1 + z²/n ),  z = 1.96',
    `95 % 신뢰구간: ${ci}${o.ci === 'profile' ? ' — 프로파일 우도(우도비 검정)에서 χ²(1) 3.84 이내인 농도 범위' : ' — C_p 추정값의 분산을 델타법으로 구한 구간'}`] });
  if (fit.warnings.length) { B.push({ t: 'h', text: '유의 사항' }); fit.warnings.forEach((w) => B.push({ t: 'p', text: `· ${w}` })); }

  B.push({ t: 'h', text: '5. Dose-Response 그래프' });
  B.push({ t: 'img', id: 'plot', caption: '곡선: 적합한 검출률, 하늘색 띠 · 점선: 95 % 신뢰구간, 점과 막대: 관측 검출률과 Wilson 95 % 구간' });

  B.push({ t: 'h', text: '6. Dose-Response 표' });
  B.push({ t: 'table', head: ['Probability', `Dose${unit ? ` (${unit})` : ''}`, '95 % CI lower', '95 % CI upper'], widths: [1, 1.4, 1.4, 1.4],
    rows: PB_PROBS.map((p) => { const c = fit.cp(p); return [p.toFixed(3), fmtC(c.c), c.bounded ? fmtC(c.lo) : '–', c.bounded ? fmtC(c.hi) : '–']; }) });
  return B;
}

export async function svgToPng(svg, W = 1560) {
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const vb = svg.viewBox.baseVal, H = Math.round((W * vb.height) / vb.width), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return { png: new Uint8Array(await blob.arrayBuffer()), dataUrl: c.toDataURL('image/png'), w: W, h: H };
  } finally { URL.revokeObjectURL(url); }
}
