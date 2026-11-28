// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT 플라크 계수 결과 보고서: 블록 모델만 이 파일에서 만들고, 쪽 나누기(renderPages)·HWPX(buildHwpx)는
// eds-report.js의 것을 그대로 재사용한다(둘 다 블록 타입에 대해 일반적이라 PRNT 전용 코드가 없어도 된다).
export { renderPages, buildHwpx } from './eds-report.js';

const f1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(1));
const wellName = (row, col) => String.fromCharCode(65 + row) + (col + 1);
const JUDGE_LABEL = { ok: 'OK', tntc: 'TNTC (너무 많음)', too_few: '너무 적음' };

// data: { wells: [{row,col,count,judge,dilution?,isControl?}], wellType, controlMean, prnt: {results,formula,points} | null, conditions: {...} }
// o: { fileName, version, program, approvers, now, images }
export function buildModel(data, o = {}) {
  const B = [];
  B.push({ t: 'title', text: 'PRNT 플라크 계수 결과 보고서' });
  B.push({ t: 'sub', text: o.fileName || '' });
  B.push({ t: 'approval', roles: o.approvers ?? ['실무자', '중간관리자', '관리자'] });
  B.push({ t: 'p', small: true, center: true, text: `원본 사진: ${o.fileName || '–'}  ·  생성: ${o.program} PRNT v${o.version}  ·  ${(o.now ?? new Date()).toLocaleString('ko-KR', { hour12: false })}` });

  B.push({ t: 'h', text: '1. 분석 조건' });
  const c = data.conditions ?? {};
  B.push({ t: 'kv', rows: [['플레이트', `${data.wellType}웰`], ['염색', c.stain ?? '크리스탈 바이올렛'], ['최소 플라크 직경', c.minDiamMm ? `${c.minDiamMm} mm` : '지정 안 함'],
    ['mm↔px 환산', c.scaleNote ?? '–'], ['가장자리 제외', c.edgeExcludeNote ?? '웰 테두리 안쪽 일부 제외'], ['검출 채널', (c.channels ?? []).join(', ') || '–'], ['앙상블 변형 수', c.totalRuns ? `${c.totalRuns}가지 (문턱값×채널)` : '–']].filter((r) => r[1])
  });
  B.push({ t: 'fx', lines: ['여러 채널 × 여러 문턱값으로 반복 검출한 뒤 다수결(동의 비율)로 플라크를 확정해요. 동의 비율이 낮은 표시는 눈으로 한 번 더 확인하세요.',
    '판정 기준(플레이트당 유효 개수 범위): 6웰 20–100 · 12웰 15–60 · 24웰 10–40 (범위 밖이면 TNTC 또는 "너무 적음")'] });

  B.push({ t: 'h', text: '2. 웰별 플라크 수' });
  const wrows = data.wells.slice().sort((a, b) => a.row - b.row || a.col - b.col).map((w) => [wellName(w.row, w.col), w.isControl ? '대조군' : (w.dilution ? `×${w.dilution}` : ''), String(w.count), JUDGE_LABEL[w.judge] ?? w.judge, w.confidence !== undefined ? `${Math.round(w.confidence * 100)}%` : '']);
  B.push({ t: 'table', head: ['Well', '희석/구분', '플라크 수', '판정', '평균 동의율'], rows: wrows, widths: [1.2, 1.6, 1.6, 2, 1.8] });

  if (data.prnt?.points?.length) {
    B.push({ t: 'h', text: '3. 희석 계열 · 감소율 · PRNT50/80/90' });
    const prows = data.prnt.points.map((p) => [`×${p.dilution}`, String(p.count), p.reduction === null ? '' : f1(p.reduction) + ' %']);
    B.push({ t: 'table', head: ['희석배수', '플라크 수', '감소율 (대조군 대비)'], rows: prows, widths: [1.6, 1.6, 2.2] });
    const targets = Object.keys(data.prnt.results);
    B.push({ t: 'kv', rows: targets.map((t) => [`PRNT${t}`, data.prnt.results[t] === null ? '계산 불가(구간 안에 들지 않음)' : `×${data.prnt.results[t].toFixed(1)}`]) });
    B.push({ t: 'fx', lines: [`대조군(바이러스만, 항체 없음) 평균 플라크 수 = ${f1(data.controlMean)}`, data.prnt.formula] });
  }

  if (o.images?.plate) {
    B.push({ t: 'h', text: `${data.prnt?.points?.length ? '4' : '3'}. 플레이트 사진 (검출 표시)` });
    B.push({ t: 'img', id: 'plate', caption: '원 = 검출된 플라크 위치 (색이 옅을수록 동의율이 낮음)' });
  }
  return B;
}
