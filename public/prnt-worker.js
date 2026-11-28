// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT 플라크 세기 무거운 계산(채널 추출 · 조명 평탄화 · 웰별 앙상블 검출)을 메인 스레드 밖에서 수행한다.
// 이 저장소 최초의 Web Worker — 빌드 단계가 없으므로 평범한 ES 모듈 워커로 띄운다: new Worker('./prnt-worker.js', { type: 'module' })
import { toChannel, refineWellCenter, ensembleDetect, splitMergedBlobs, judgeCountability } from './prnt-calc.js';

self.onmessage = (e) => {
  const { pixels, w, h, wells, wellType, channels, refine, minDiamMm, pxPerMm } = e.data;
  try {
    const px = new Uint8ClampedArray(pixels);
    // 문턱값은 웰마다 "그 웰 자신의" 평균·표준편차로 정하므로(ensembleDetect 안에서 웰별 discStats), 이미지 전체에 걸친
    // 조명 평탄화는 따로 안 한다 — 웰 간격이 좁으면 박스 블러가 옆 웰 색을 끌어와 거짓 양성을 만들 수 있다(실측으로 확인됨).
    const variants = channels.map((mode) => ({ channel: toChannel(px, w, h, mode), label: mode }));
    // 최소 플라크 직경(mm) → px 면적: 자를 따로 안 대도, 웰 지름으로 환산한 pxPerMm(화면 쪽에서 계산해 넘겨줌)을 쓴다.
    // mm을 안 정했으면(또는 환산 비율이 없으면) 웰 면적의 작은 비율을 기본값으로 쓴다(잡음 제외용 최소선).
    const minAreaFromMm = minDiamMm && pxPerMm ? Math.PI * ((minDiamMm / 2) * pxPerMm) ** 2 : null;

    const results = wells.map((well0) => {
      const well = refine ? refineWellCenter(variants[0].channel, w, h, well0, { searchPx: Math.round(well0.r * 0.12) }) : well0;
      const minAreaPx = minAreaFromMm ?? Math.max(2, Math.round(well.r * well.r * 0.0006));
      const { blobs, totalRuns } = ensembleDetect(variants, w, h, well, { minAreaPx, maxAreaPx: well.r * well.r * 0.35 });
      const { count, blobs: splitBlobs } = splitMergedBlobs(blobs);
      const judge = judgeCountability(count, wellType);
      return { row: well.row, col: well.col, cx: well.cx, cy: well.cy, r: well.r, count, judge, totalRuns, blobs: splitBlobs, minAreaPx };
    });
    self.postMessage({ ok: true, results });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) });
  }
};
