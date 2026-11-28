// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// PRNT 플라크 세기 화면: 사진 올리기 → 플레이트 범위 지정 → 웰 자동 검출(+수정) → 앙상블 검출(워커) → 보정 → 결과표/PRNT50·80·90 → 보고서
import { fitWellGrid, refineWellCenter, toChannel, judgeCountability, prntInterpolate, detectColorBlobs, inferWellGrid, EDGE_EXCLUDE_FRAC } from './prnt-calc.js';
import { buildModel } from './prnt-report.js';
import { renderPages, buildHwpx } from './eds-report.js';
import { VERSION, APP_INFO } from './version.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ANALYSIS_MAX = 1400; // 분석·표시용 캔버스 긴 변 최대 픽셀
const WELL_LAYOUT = { 6: { rows: 2, cols: 3 }, 12: { rows: 3, cols: 4 }, 24: { rows: 4, cols: 6 } };
// 표준 평저(flat-bottom) 배양 플레이트의 공칭 웰 지름(mm, 제조사 카탈로그 기준 — 브랜드마다 ±1mm 정도 다를 수 있어요).
// 자(ruler)를 따로 안 대도, 이미 찾은 웰의 화면 지름(px)과 이 값을 나눠 mm↔px 환산 비율을 자동으로 구한다.
const STANDARD_WELL_DIAM_MM = { 6: 34.8, 12: 22.1, 24: 15.6 };
const JUDGE_BADGE = { ok: ['OK', '#12804a'], tntc: ['TNTC', '#c0362c'], too_few: ['너무 적음', '#8a7366'] };
const wellName = (row, col) => String.fromCharCode(65 + row) + (col + 1);

export function initPrnt({ $, saveBlob }) {
  const S = {
    img: null, fileName: '', w: 0, h: 0,
    bbox: null, dragBbox: null,
    wellType: 12, wells: [], results: new Map(), // key = `${row},${col}`
    meta: new Map(), // key -> { dilution: number|null, isControl: bool }
    correctMode: false, dragWell: null,
    channels: ['green', 'invSat'], minDiamMm: '', pxPerMm: null, worker: null, lastTotalRuns: 0, swapRC: false,
    prnt: null, controlMean: null,
  };
  const key = (row, col) => `${row},${col}`;
  const canvas = $('prntCanvas'), ctx = canvas.getContext('2d');
  // 분석(웰 검출·플라크 검출)은 항상 이 "깨끗한" 오프스크린 캔버스에서 픽셀을 읽는다 — 화면용 canvas/ctx는
  // 웰 원·라벨·마커 오버레이가 매번 그 위에 그려지므로, 거기서 getImageData를 하면 오버레이 색이 플라크로 오검출된다
  // (실측으로 확인된 버그: 이전 실행의 주황색 마커 테두리가 다음 검출의 입력 픽셀로 들어갔었음).
  const base = document.createElement('canvas'), baseCtx = base.getContext('2d');

  // ---------- 사진 올리기 ----------
  function loadImage(file) {
    const msg = $('prntMsg'); msg.className = 'note'; msg.textContent = '불러오는 중…';
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, ANALYSIS_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      S.img = img; S.fileName = file.name; S.w = Math.round(img.naturalWidth * scale); S.h = Math.round(img.naturalHeight * scale);
      S.bbox = null; S.wells = []; S.results.clear(); S.meta.clear(); S.prnt = null; S.controlMean = null;
      canvas.width = S.w; canvas.height = S.h; base.width = S.w; base.height = S.h;
      baseCtx.drawImage(S.img, 0, 0, S.w, S.h);
      msg.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB — 이 컴퓨터의 브라우저 안에서만 읽어요.`;
      $('prntBody').hidden = false;
      drawBase(); renderTable();
      tryAutoDetectWells(); // 범위를 직접 그리지 않아도 바로 찾아본다 — 못 찾으면 기존 방식(드래그) 안내로 조용히 넘어간다
    };
    img.onerror = () => { msg.className = 'pberr'; msg.textContent = '이미지를 읽지 못했어요.'; };
    img.src = url;
  }
  const input = $('prntFile'), drop = $('prntDrop');
  input.addEventListener('change', () => { if (input.files[0]) loadImage(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) loadImage(f); });
  $('prntSample').addEventListener('click', async () => {
    try { const res = await fetch('samples/demo_prnt.png'); if (!res.ok) throw new Error('샘플을 불러오지 못했어요'); loadImage(new File([await res.blob()], 'demo_prnt.png', { type: 'image/png' })); }
    catch (e) { const m = $('prntMsg'); m.className = 'pberr'; m.textContent = e.message; }
  });

  // ---------- 카메라로 바로 찍기 ----------
  // 여러 프레임을 찍어 픽셀마다 중앙값을 합성한다 — 손이 흔들려 생기는 반짝임(반사광)이나
  // 센서 잡음은 매 프레임 위치가 달라서 중앙값에서 사라지고, 진짜 염색 패턴만 남는다
  // (CLAUDE.md 원래 계획에 있던 아이디어 — 오늘 찾은 반사광 글레어 문제를 직접 줄여 준다).
  const CAM_FRAMES = 8, CAM_INTERVAL_MS = 90, CAM_MAX = 1600;
  let camStream = null;
  async function camStop() {
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
    $('prntCamVideo').srcObject = null;
  }
  $('prntCamOpen').addEventListener('click', async () => {
    const msg = $('prntMsg');
    if (!navigator.mediaDevices?.getUserMedia) { msg.className = 'pberr'; msg.textContent = '이 브라우저(또는 이 연결)에서는 카메라를 쓸 수 없어요. HTTPS 주소에서 열어 주세요.'; return; }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      $('prntCamVideo').srcObject = camStream;
      $('prntCamMsg').className = 'note'; $('prntCamMsg').textContent = '화면 가운데 점선 사각형 안에 플레이트 전체가 들어오게 맞추고 "촬영"을 눌러 주세요. 가능하면 손을 가만히 두세요 — 여러 장을 합쳐서 반사광·잡음을 줄여요.';
      $('prntCam').showModal();
    } catch (e) {
      msg.className = 'pberr';
      msg.textContent = e?.name === 'NotAllowedError' ? '카메라 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요.' : '카메라를 열지 못했어요: ' + (e?.message || e);
    }
  });
  $('prntCamClose').addEventListener('click', () => { camStop(); $('prntCam').close(); });
  $('prntCam').addEventListener('close', camStop);
  $('prntCamShot').addEventListener('click', async () => {
    const video = $('prntCamVideo'), shotBtn = $('prntCamShot'), camMsg = $('prntCamMsg');
    if (!video.videoWidth) return;
    shotBtn.disabled = true; camMsg.className = 'note'; camMsg.textContent = `촬영 중… (${CAM_FRAMES}장을 합쳐요)`;
    const scale = Math.min(1, CAM_MAX / Math.max(video.videoWidth, video.videoHeight));
    const cw = Math.round(video.videoWidth * scale), ch = Math.round(video.videoHeight * scale);
    const grab = document.createElement('canvas'); grab.width = cw; grab.height = ch;
    const gctx = grab.getContext('2d', { willReadFrequently: true });
    const frames = [];
    for (let i = 0; i < CAM_FRAMES; i++) {
      gctx.drawImage(video, 0, 0, cw, ch);
      frames.push(gctx.getImageData(0, 0, cw, ch).data);
      if (i < CAM_FRAMES - 1) await new Promise((r) => setTimeout(r, CAM_INTERVAL_MS));
    }
    const n = frames.length, mid = n >> 1, out = new Uint8ClampedArray(frames[0].length);
    const col = new Uint8ClampedArray(n);
    for (let i = 0; i < out.length; i++) {
      if (i % 4 === 3) { out[i] = 255; continue; } // 알파
      for (let f = 0; f < n; f++) col[f] = frames[f][i];
      col.sort();
      out[i] = n % 2 ? col[mid] : ((col[mid - 1] + col[mid]) >> 1);
    }
    const outCanvas = document.createElement('canvas'); outCanvas.width = cw; outCanvas.height = ch;
    outCanvas.getContext('2d').putImageData(new ImageData(out, cw, ch), 0, 0);
    outCanvas.toBlob((blob) => {
      shotBtn.disabled = false;
      if (!blob) { camMsg.className = 'pberr'; camMsg.textContent = '사진으로 저장하지 못했어요. 다시 시도해 주세요.'; return; }
      camStop(); $('prntCam').close();
      loadImage(new File([blob], `camera_${Date.now()}.png`, { type: 'image/png' }));
    }, 'image/png');
  });

  // ---------- 캔버스 그리기 ----------
  function drawBase() {
    ctx.clearRect(0, 0, S.w, S.h);
    ctx.drawImage(S.img, 0, 0, S.w, S.h);
  }
  function drawOverlay() {
    drawBase();
    if (S.bbox && !S.wells.length) {
      ctx.save(); ctx.strokeStyle = '#2f80ed'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(S.bbox.x0, S.bbox.y0, S.bbox.x1 - S.bbox.x0, S.bbox.y1 - S.bbox.y0); ctx.restore();
    }
    for (const w of S.wells) {
      const r = S.results.get(key(w.row, w.col));
      const ok = !r ? null : r.judge;
      ctx.save(); ctx.strokeStyle = ok === 'tntc' ? '#c0362c' : ok === 'too_few' ? '#8a7366' : '#2f80ed'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w.cx, w.cy, w.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(w.cx, w.cy, 4, 0, Math.PI * 2); ctx.fill(); // 중심 손잡이
      ctx.font = '13px sans-serif'; ctx.fillText(wellName(w.row, w.col) + (r ? ` · ${r.count}` : ''), w.cx - w.r, w.cy - w.r - 4);
      ctx.restore();
      if (r) for (const b of r.blobs) {
        const conf = b.confidence ?? 1;
        ctx.save(); ctx.strokeStyle = b.manual ? '#12804a' : `rgba(255,70,20,${0.35 + conf * 0.65})`; ctx.lineWidth = b.manual ? 2 : 1.6;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, Math.max(3, Math.sqrt(b.area / Math.PI)), 0, Math.PI * 2); ctx.stroke();
        if (b.merged) { ctx.fillStyle = '#c0362c'; ctx.font = '10px sans-serif'; ctx.fillText(`×${b.estCount}`, b.cx + 4, b.cy - 4); }
        ctx.restore();
      }
    }
  }
  // 마우스 drag든 손가락 터치든 같은 좌표 계산을 쓴다. 터치는 touchend에 clientX/Y가 없어 changedTouches를 본다.
  const clientXY = (e) => (e.touches?.[0] ?? e.changedTouches?.[0] ?? e);
  // 가로·세로 배율을 따로 구한다 — 일부 브라우저는 CSS에서 canvas 가로세로 비율을 안 지키고 다르게 늘릴 때가 있어서
  // (실측: Safari에서 폭만 줄고 높이는 원본 그대로라 좌표가 어긋남), 폭 기준 하나로 퉁치면 세로축이 틀어질 수 있다.
  const pt = (e) => { const c = clientXY(e), b = canvas.getBoundingClientRect(); return { x: (c.clientX - b.left) * (S.w / b.width), y: (c.clientY - b.top) * (S.h / b.height) }; };
  function wellAt(x, y) { return S.wells.find((w) => { const dx = x - w.cx, dy = y - w.cy; return dx * dx + dy * dy <= w.r * w.r; }); }
  // 터치 목표 크기는 "화면에 보이는 크기"로 고정해야 한다 — 캔버스 내부 해상도는 그대로인데 폰에서 화면이 훨씬 작게 줄어 보이므로,
  // 고정 내부 픽셀 값은 폰에서 손가락 끝보다 훨씬 작아진다. 지금 화면 배율로 환산해 "화면 기준 cssPx"만큼의 내부 반지름을 돌려준다.
  const touchRadiusPx = (cssPx) => { const b = canvas.getBoundingClientRect(); return cssPx * ((S.w / b.width + S.h / b.height) / 2); };
  const DRAG_HANDLE_CSS_PX = 20;

  // ---------- 플레이트 범위 드래그 지정 (마우스 + 터치 공용) ----------
  function dragStart(e) {
    if (!S.img) return;
    e.preventDefault(); // 터치에서 페이지 스크롤·확대 대신 캔버스 드래그로 쓴다
    const p = pt(e);
    if (S.correctMode && S.wells.length) { correctClick(p); return; }
    if (S.wells.length) { // 웰 중심 드래그로 위치 수정
      const handle = touchRadiusPx(DRAG_HANDLE_CSS_PX);
      const w = S.wells.find((w0) => { const dx = p.x - w0.cx, dy = p.y - w0.cy; return Math.sqrt(dx * dx + dy * dy) < handle; });
      if (w) { S.dragWell = w; return; }
    }
    S.dragBbox = { a: p, b: p };
  }
  function dragMove(e) {
    if (!S.img) return;
    if (S.dragWell) { e.preventDefault(); const p = pt(e); S.dragWell.cx = p.x; S.dragWell.cy = p.y; drawOverlay(); return; }
    if (!S.dragBbox) return;
    e.preventDefault();
    S.dragBbox.b = pt(e);
    S.bbox = { x0: Math.min(S.dragBbox.a.x, S.dragBbox.b.x), y0: Math.min(S.dragBbox.a.y, S.dragBbox.b.y), x1: Math.max(S.dragBbox.a.x, S.dragBbox.b.x), y1: Math.max(S.dragBbox.a.y, S.dragBbox.b.y) };
    drawOverlay();
  }
  function dragEnd() {
    if (S.dragWell) { S.dragWell = null; recountAfterMove(); }
    S.dragBbox = null;
  }
  canvas.addEventListener('mousedown', dragStart);
  window.addEventListener('mousemove', dragMove);
  window.addEventListener('mouseup', dragEnd);
  canvas.addEventListener('touchstart', dragStart, { passive: false });
  window.addEventListener('touchmove', dragMove, { passive: false });
  window.addEventListener('touchend', dragEnd);
  window.addEventListener('touchcancel', dragEnd);
  function recountAfterMove() { /* 수동으로 위치만 옮긴 경우 — 다시 "검출 실행"을 눌러야 그 위치로 다시 센다 */ renderTable(); }

  // ---------- 1) 웰 자동 검출 ----------
  // 찾은 웰 목록을 확정(중심 미세 보정 + mm 환산 + 표시)하는 공통 마무리 — 범위-드래그 방식과 색 기반 자동 검출 둘 다 이걸 쓴다.
  function finalizeWells(wells, note) {
    const imgData = baseCtx.getImageData(0, 0, S.w, S.h).data;
    const green = toChannel(imgData, S.w, S.h, 'green');
    wells = wells.map((w) => refineWellCenter(green, S.w, S.h, w, { searchPx: Math.round(w.r * 0.12) }));
    S.wells = wells; S.results.clear();
    for (const w of wells) if (!S.meta.has(key(w.row, w.col))) S.meta.set(key(w.row, w.col), { dilution: null, isControl: false });
    const avgDiamPx = (wells.reduce((a, w) => a + w.r, 0) / wells.length) * 2;
    S.pxPerMm = avgDiamPx / STANDARD_WELL_DIAM_MM[S.wellType];
    $('prntScaleNote').textContent = `웰 지름 ${avgDiamPx.toFixed(0)}px ≈ ${STANDARD_WELL_DIAM_MM[S.wellType]}mm(${S.wellType}웰 표준 규격) 기준 → 1mm ≈ ${S.pxPerMm.toFixed(1)}px로 자동 환산했어요.`;
    const msg = $('prntMsg'); msg.className = 'note'; msg.textContent = note;
    drawOverlay(); renderTable();
  }
  // 사진을 올리자마자 범위를 직접 그리지 않아도 되도록, 염색된 웰(채도 높은 원형 얼룩)을 바로 찾아본다.
  // 자신 없으면(크기가 들쭉날쭉하거나 절반 넘게 못 찾으면) 조용히 포기하고 기존 방식(범위 드래그)으로 넘어간다 — 틀린 추측을 자신 있게 보여주는 것보다 낫다.
  function tryAutoDetectWells() {
    const imgData = baseCtx.getImageData(0, 0, S.w, S.h).data;
    const blobs = detectColorBlobs(imgData, S.w, S.h);
    const { rows, cols } = WELL_LAYOUT[S.wellType];
    const normal = inferWellGrid(blobs, rows, cols), swapped = inferWellGrid(blobs, cols, rows);
    let res = normal, swap = false;
    if (swapped && (!normal || swapped.matchedCount > normal.matchedCount)) { res = swapped; swap = true; }
    if (!res) { $('prntMsg').className = 'note'; $('prntMsg').textContent += ' 플레이트 범위를 자동으로 찾지 못했어요 — 사진 위를 드래그해서 범위를 표시한 뒤 "웰 자동 검출"을 눌러 주세요.'; return false; }
    S.swapRC = swap; $('prntSwapRC').checked = swap;
    const missing = res.wells.filter((w) => !w.matched).length;
    finalizeWells(res.wells, `사진에서 웰 ${res.matchedCount}/${rows * cols}개를 자동으로 찾았어요${missing ? ` (${missing}개는 추정 위치 — 원 가운데 점을 드래그해 옮겨 주세요)` : ''}. 다르면 드래그로 옮기고 "검출 실행"을 눌러 주세요.`);
    return true;
  }
  $('prntWellType').addEventListener('change', () => { S.wellType = +$('prntWellType').value; if (S.img) tryAutoDetectWells(); });
  $('prntSwapRC').addEventListener('change', () => { S.swapRC = $('prntSwapRC').checked; });
  $('prntDetectWells').addEventListener('click', () => {
    const msg = $('prntMsg');
    if (!S.img) { msg.className = 'pberr'; msg.textContent = '먼저 사진을 올려 주세요.'; return; }
    if (!S.bbox || S.bbox.x1 - S.bbox.x0 < 20 || S.bbox.y1 - S.bbox.y0 < 20) { msg.className = 'pberr'; msg.textContent = '캔버스 위에서 드래그해 플레이트 범위를 먼저 표시해 주세요.'; return; }
    let { rows, cols } = WELL_LAYOUT[S.wellType]; if (S.swapRC) [rows, cols] = [cols, rows];
    const wells = fitWellGrid(S.bbox, rows, cols, 0.42);
    finalizeWells(wells, `웰 ${wells.length}개를 찾았어요. 중심이 어긋나면 원 가운데 점을 드래그해 옮기고 "검출 실행"을 눌러 주세요.`);
  });

  // ---------- 2) 앙상블 검출 (워커) ----------
  function worker() { return (S.worker ??= new Worker('./prnt-worker.js', { type: 'module' })); }
  $('prntChannels').addEventListener('change', () => {
    S.channels = [...$('prntChannels').querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
  });
  $('prntMinDiam').addEventListener('input', () => { S.minDiamMm = $('prntMinDiam').value; });
  $('prntRunDetect').addEventListener('click', () => {
    const msg = $('prntMsg');
    if (!S.wells.length) { msg.className = 'pberr'; msg.textContent = '먼저 "1) 웰 자동 검출"을 눌러 주세요.'; return; }
    if (!S.channels.length) { msg.className = 'pberr'; msg.textContent = '검출 채널을 하나 이상 선택해 주세요.'; return; }
    msg.className = 'note'; msg.textContent = '검출하는 중… (사진이 크면 몇 초 걸려요)';
    const imgData = baseCtx.getImageData(0, 0, S.w, S.h);
    const wellsPlain = S.wells.map((w) => ({ row: w.row, col: w.col, cx: w.cx, cy: w.cy, r: w.r }));
    const w = worker();
    w.onmessage = (e) => {
      const { ok, error, results } = e.data;
      if (!ok) { msg.className = 'pberr'; msg.textContent = '검출 실패: ' + error; return; }
      S.lastTotalRuns = results[0]?.totalRuns ?? S.channels.length * 4;
      for (const r of results) {
        const k = key(r.row, r.col);
        const avgConf = r.blobs.length ? r.blobs.reduce((a, b) => a + (b.confidence ?? 1), 0) / r.blobs.length : 1;
        S.results.set(k, { count: r.count, judge: r.judge, blobs: r.blobs, confidence: avgConf, manual: false });
      }
      msg.className = 'note'; msg.textContent = '검출 완료. 표에서 희석배수·대조군을 지정하고, 필요하면 사진을 클릭해 플라크를 보정하세요.';
      drawOverlay(); renderTable();
    };
    const minDiamMmVal = Number(S.minDiamMm); const minDiamMm = S.minDiamMm !== '' && Number.isFinite(minDiamMmVal) && minDiamMmVal > 0 ? minDiamMmVal : null;
    w.postMessage({ pixels: imgData.data.buffer, w: S.w, h: S.h, wells: wellsPlain, wellType: S.wellType, channels: S.channels, refine: false, minDiamMm, pxPerMm: S.pxPerMm }, [imgData.data.buffer]);
  });

  // ---------- 보정 모드: 클릭으로 플라크 추가·삭제 ----------
  $('prntCorrect').addEventListener('change', () => { S.correctMode = $('prntCorrect').checked; });
  // 검출 표시(웰 원·플라크 마커)가 그려진 화면 그대로를 사진 한 장(PNG)으로 저장 — 보고서 없이 사진만 필요할 때
  $('prntSavePng').addEventListener('click', () => {
    const msg = $('prntMsg');
    if (!S.img) { msg.className = 'pberr'; msg.textContent = '먼저 사진을 올려 주세요.'; return; }
    canvas.toBlob((blob) => {
      if (!blob) { msg.className = 'pberr'; msg.textContent = 'PNG로 저장하지 못했어요.'; return; }
      saveBlob(blob, `${baseName()}_검출결과.png`);
    }, 'image/png');
  });
  function correctClick(p) {
    const well = wellAt(p.x, p.y); if (!well) return;
    const k = key(well.row, well.col), r = S.results.get(k) ?? { count: 0, judge: 'ok', blobs: [], confidence: 1, manual: true };
    const minHit = touchRadiusPx(14);
    const hit = r.blobs.findIndex((b) => { const dx = b.cx - p.x, dy = b.cy - p.y; return Math.sqrt(dx * dx + dy * dy) <= Math.max(minHit, Math.sqrt(b.area / Math.PI) + 3); });
    if (hit >= 0) r.blobs.splice(hit, 1); else r.blobs.push({ cx: p.x, cy: p.y, area: Math.PI * 9, confidence: 1, manual: true, merged: false, estCount: 1 });
    r.count = r.blobs.reduce((a, b) => a + (b.estCount ?? 1), 0); r.judge = judgeCountability(r.count, S.wellType); r.manual = true;
    S.results.set(k, r); drawOverlay(); renderTable();
  }

  // ---------- 결과표(희석·대조군 지정 + PRNT 계산) ----------
  function renderTable() {
    if (!S.wells.length) { $('prntTable').innerHTML = ''; $('prntPrntOut').innerHTML = ''; return; }
    const rows = S.wells.slice().sort((a, b) => a.row - b.row || a.col - b.col).map((w) => {
      const k = key(w.row, w.col), r = S.results.get(k), m = S.meta.get(k) ?? { dilution: null, isControl: false };
      const badge = r ? JUDGE_BADGE[r.judge] ?? ['–', '#666'] : ['–', '#999'];
      return `<tr data-k="${k}"><td>${wellName(w.row, w.col)}</td><td>${r ? r.count : '–'}${r?.manual ? ' <small>(보정됨)</small>' : ''}</td>` +
        `<td><span style="color:${badge[1]};font-weight:700">${badge[0]}</span></td>` +
        `<td>${r ? Math.round((r.confidence ?? 1) * 100) + '%' : '–'}</td>` +
        `<td><label class="chk"><input type="checkbox" class="pControl" ${m.isControl ? 'checked' : ''}> 대조군</label></td>` +
        `<td><input class="txt pDilution" type="text" inputmode="numeric" style="width:90px" placeholder="희석배수(예 40)" value="${m.dilution ?? ''}" ${m.isControl ? 'disabled' : ''}></td></tr>`;
    });
    $('prntTable').innerHTML = `<table class="drt"><thead><tr><th>Well</th><th>플라크 수</th><th>판정</th><th>평균 동의율</th><th>대조군</th><th>희석배수</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  $('prntTable').addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-k]'); if (!tr) return;
    const k = tr.dataset.k, m = S.meta.get(k) ?? { dilution: null, isControl: false };
    if (e.target.classList.contains('pControl')) m.isControl = e.target.checked;
    if (e.target.classList.contains('pDilution')) { const v = e.target.value.trim(); m.dilution = v === '' ? null : Number(v); }
    S.meta.set(k, m); renderTable();
  });
  $('prntCalcPrnt').addEventListener('click', () => {
    const msg = $('prntPrntMsg');
    const controls = [...S.meta.entries()].filter(([, m]) => m.isControl).map(([k]) => S.results.get(k)?.count).filter((c) => Number.isFinite(c));
    if (!controls.length) { msg.className = 'pberr'; msg.textContent = '먼저 대조군(바이러스만, 항체 없음) 웰을 하나 이상 체크해 주세요.'; return; }
    S.controlMean = controls.reduce((a, b) => a + b, 0) / controls.length;
    const points = [...S.meta.entries()].filter(([, m]) => !m.isControl && m.dilution).map(([k, m]) => ({ dilution: m.dilution, count: S.results.get(k)?.count ?? 0 }));
    if (!points.length) { msg.className = 'pberr'; msg.textContent = '희석배수를 지정한 웰이 없어요.'; return; }
    S.prnt = prntInterpolate(points, S.controlMean, [50, 80, 90]);
    msg.className = 'note'; msg.textContent = `대조군 평균 ${S.controlMean.toFixed(1)}개로 계산했어요.`;
    $('prntPrntOut').innerHTML = Object.entries(S.prnt.results).map(([t, v]) => `<div><span>PRNT${t}</span><b>${v === null ? '계산 불가' : '×' + v.toFixed(1)}</b></div>`).join('');
  });

  // ---------- 보고서 (미리보기 · HWPX) ----------
  function canvasPng() {
    const dataUrl = canvas.toDataURL('image/png');
    return fetch(dataUrl).then((r) => r.arrayBuffer()).then((buf) => ({ png: new Uint8Array(buf), dataUrl, w: canvas.width, h: canvas.height }));
  }
  const baseName = () => (S.fileName.replace(/\.(jpg|jpeg|png|webp|heic)$/i, '') || 'PRNT').replace(/[\\/:*?"<>|]/g, '_');
  async function report() {
    if (!S.wells.length || !S.results.size) throw new Error('먼저 웰을 검출해 주세요');
    const wells = S.wells.map((w) => { const k = key(w.row, w.col), r = S.results.get(k) ?? { count: 0, judge: 'ok', confidence: 1 }, m = S.meta.get(k) ?? {}; return { row: w.row, col: w.col, count: r.count, judge: r.judge, confidence: r.confidence, dilution: m.dilution, isControl: m.isControl }; });
    const data = { wells, wellType: S.wellType, controlMean: S.controlMean, prnt: S.prnt, conditions: { stain: '크리스탈 바이올렛', minDiamMm: S.minDiamMm || null, channels: S.channels, totalRuns: S.lastTotalRuns,
      scaleNote: S.pxPerMm ? `1mm ≈ ${S.pxPerMm.toFixed(1)}px (${S.wellType}웰 표준 지름 ${STANDARD_WELL_DIAM_MM[S.wellType]}mm 기준 자동 환산, 자 사용 안 함)` : '웰 지름 환산 안 함',
      edgeExcludeNote: `웰 반지름의 ${(EDGE_EXCLUDE_FRAC * 100).toFixed(0)}%(면적 약 ${((1 - (1 - EDGE_EXCLUDE_FRAC) ** 2) * 100).toFixed(0)}%) — 벽 그림자·메니스커스 구간 제외` } };
    const images = { plate: await canvasPng() };
    const model = buildModel(data, { fileName: S.fileName, version: VERSION, program: APP_INFO.name, images });
    return { model, images, pages: renderPages(model, images), name: baseName() };
  }
  async function exportHwpx() {
    const r = await report();
    const blob = await buildHwpx(r.model, r.images, { JSZip: window.JSZip, program: APP_INFO.name });
    saveBlob(blob, `${r.name}_PRNT_결과서.hwpx`);
  }
  return { report, exportHwpx, name: () => baseName(), has: () => S.wells.length > 0 && S.results.size > 0 };
}
