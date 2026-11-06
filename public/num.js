// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 숫자 입력 해석(엄격)과 표시용 반올림(엑셀·한글 방식). 계산은 모두 IEEE-754 double(JS number)로 한다.

const WS = /[\s   ]/g;

// 문자열 → number. 숫자로 확실히 읽히는 형식만 허용하고, 그 외는 NaN (부분 해석·진법·Infinity 금지)
//  허용: 18.65, -3.982, +1.2, .5, 5., 1.4e6, 1.4E+06, 1,400,000 (올바른 천 단위 묶음), 12.29%, 전각 숫자, 유니코드 마이너스(−)
//  거부: 18,65(소수점 쉼표) · 18.65abc · 18..65 · 0x1F · Infinity · 18.65 27.1 · 빈 문자열
export function parseStrict(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (input == null) return NaN;
  let s = String(input).replace(WS, '')
    .replace(/[−–—－]/g, '-')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.').replace(/，/g, ',').replace(/%$/, '');
  if (s === '') return NaN;
  if (s.includes(',')) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return NaN;   // 천 단위 묶음이 맞을 때만
    s = s.replace(/,/g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

// 숫자로 읽히지 않을 때 사용자에게 보여줄 이유
export function explainInvalid(input) {
  const s = String(input ?? '').replace(WS, '');
  if (/^[+-]?\d+,\d{1,2}$/.test(s) || /^[+-]?\d+,\d+$/.test(s) && !/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) return '소수점은 쉼표(,)가 아니라 점(.)으로 써 주세요';
  if (/[A-Za-z가-힣]/.test(s)) return '숫자 외의 글자가 섞여 있어요';
  if (/\..*\./.test(s)) return '소수점이 두 번 이상 있어요';
  return '숫자로 읽을 수 없어요';
}

// 십진수 기준 반올림(0.5는 0에서 먼 쪽): 엑셀 ROUND/표시 서식과 같은 결과. (toFixed는 2진수 기준이라 1.005→1.00 처럼 달라질 수 있음)
export function roundHalfUp(x, d = 0) {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1, a = Math.abs(x);
  const plain = a.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }); // 지수 표기 없는 십진 문자열
  const r = Number(Math.round(Number(`${plain}e${d}`)) + `e-${d}`);
  return sign * r;
}
export const fixed = (x, d = 2) => (Number.isFinite(x) ? roundHalfUp(x, d).toFixed(d) : '');
