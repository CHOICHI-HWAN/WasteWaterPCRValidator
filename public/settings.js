// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 기준 원액 농도 (KDCA 시트 기준): 최고 표준 농도 1.4×10^6 copies/µL. KAD 시트는 수량×40 = 4×10^6 을 쓴다(Y 절편·정량값이 2.857배 달라짐).
export const BASE_STOCK = 1400000;

// 판정 기준 파라미터. 기본값 = 현재 사용 중인 오차. localStorage에 저장.
export const DEFAULTS = {
  tolSlope: 0.001,   // Slope 허용오차 (절대값)
  tolInter: 0.001,   // Y-inter 허용오차
  tolR2: 0.001,      // R² 허용오차
  tolMeasured: 0.01, // 측정값(copies/mL) 허용오차
  tolPct: 0.01,      // 회수율(%p) 허용오차
  tolStat: 0.01,     // 평균/SD/RSD 허용오차
  effMin: 90,        // 증폭효율 하한 (%)
  effMax: 110,       // 증폭효율 상한 (%)
  spiked: 100000,    // 하수 검체 spiked 기본값 (copies/mL)
  stock: BASE_STOCK, // 원액 농도 (copies/µL) — 기준값
  sdMode: 'pop',     // 'pop' = STDEV.P, 'sample' = STDEV.S
  ctMode: 'simple',  // Ct 입력 방식: 'simple'(간편 입력) / 'sheet'(스프레드시트)
  pasteT: false,     // 붙여넣을 때 행↔열 바꾸기(Transpose)
  showFx: true,      // 계산식 표시
  curveSrc: 'calc',  // 회수율 계산에 쓸 표준곡선: 'calc' = 위에서 계산한 값(기본), 'reported' = 결과서 기재값
};
const KEY = 'wwpcr.settings.v2';
const OLD_KEY = 'wwpcr.settings.v1';

export function load() {
  try {
    const cur = localStorage.getItem(KEY);
    if (cur) return { ...DEFAULTS, ...JSON.parse(cur) };
    // v1에서 이전: 허용오차 등은 유지하되, 기본 표준곡선(curveSrc)은 새 기본값('calc')을 따른다
    const { curveSrc, ...old } = JSON.parse(localStorage.getItem(OLD_KEY) || '{}');
    return { ...DEFAULTS, ...old };
  } catch { return { ...DEFAULTS }; }
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ } }
export function reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY); } catch { /* ignore */ } return { ...DEFAULTS }; }
