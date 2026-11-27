// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 7500 Fast 결과(.eds) 보기 화면: 요약 · 플레이트 · 증폭 곡선 · 결과표 · 시료×검출기 요약
import { readEds, summarize, standardCurves, applyThresholds } from './eds.js';
import { buildModel, renderPages, buildHwpx } from './eds-report.js';
import { VERSION, APP_INFO } from './version.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PALETTE = ['#2f80ed', '#e08e0b', '#c0362c', '#12804a', '#8a4bd5', '#0e8fa0', '#d6336c', '#5f6b73'];
const f2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(2));
const key = (r) => `${r.idx}|${r.target}`;
const dt = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { hour12: false }) : '–');
const dur = (a, b) => { if (!a || !b || b < a) return ''; const m = Math.round((b - a) / 60000); return `${Math.floor(m / 60)}시간 ${m % 60}분`; };

export function initEds({ $, saveBlob }) {
  let data = null, fileName = '';
  const S = { ymin: null, ymax: null, sel: new Set(), hidden: new Set(), sig: 'drn', log: false, only: false, q: '', tgt: '', view: 'wide', val: 'ct', flt: {}, sortCol: null, sortDir: 'asc', thr: {}, user: new Set() };
  const thrOf = (d) => (S.thr[d.name] ?? d.threshold);
  const fmtT = (v) => (v === null || v === undefined ? '–' : v < 100 ? String(+v.toPrecision(4)) : Math.round(v).toLocaleString('en-US'));
  const col = (t) => PALETTE[Math.max(0, data.detectors.findIndex((d) => d.name === t)) % PALETTE.length];

  // ---------- 파일 읽기 ----------
  async function load(file) {
    const msg = $('edsMsg');
    msg.className = 'note'; msg.textContent = '읽는 중…';
    try {
      if (typeof JSZip === 'undefined') throw new Error('JSZip 로드 실패');
      data = await readEds(await file.arrayBuffer(), JSZip);
      fileName = file.name; S.sel.clear(); S.hidden.clear(); S.q = ''; S.tgt = ''; S.thr = {}; S.user = new Set(); S.flt = {}; S.sortCol = null;
      msg.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB — 이 컴퓨터의 브라우저 안에서만 읽었어요 (서버로 올라가지 않아요).`;
      $('edsBody').hidden = false; renderAll();
    } catch (e) { data = null; $('edsBody').hidden = true; msg.className = 'pberr'; msg.textContent = e.message || String(e); }
  }
  const input = $('edsFile'), drop = $('edsDrop');
  input.addEventListener('change', () => { if (input.files[0]) load(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) load(f); });

  // ---------- 요약 ----------
  function renderInfo() {
    const i = data.info, p = data.protocol;
    const row = (k, v) => (v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : '');
    $('edsInfo').innerHTML = '<div class="edsgrid">' + row('실험 이름', i.name) + row('설명', i.description) + row('실험 종류', i.type) + row('장비', i.instrument === 'sds7500fast' ? 'Applied Biosystems 7500 Fast' : i.instrument) +
      row('실행자', i.operator) + row('상태', i.state === 'COMPLETE' ? '완료 (COMPLETE)' : i.state) + row('시작', dt(i.start)) + row('종료', dt(i.end) + (dur(i.start, i.end) ? ` (${dur(i.start, i.end)})` : '')) +
      row('반응 부피', p.volume ? `${p.volume} µL` : '') + row('플레이트', `${i.rows} × ${i.cols} (${i.rows * i.cols}웰)`) + row('웰 · 검출기 결과', `${new Set(data.reads.map((r) => r.idx)).size}웰 · ${data.reads.length}건`) + '</div>';
    const steps = p.stages.map((s) => `<div class="stg"><b>${s.flag === 'PRE_CYCLING' ? '사전 변성' : s.flag === 'CYCLING' ? '증폭' : s.flag === 'HOLD' ? '유지' : esc(s.flag)}</b> ×${s.reps}<br>` + s.steps.map((t) => `${t.temp} °C · ${t.hold >= 60 && t.hold % 60 === 0 ? t.hold / 60 + ' 분' : t.hold + ' 초'}${t.collect ? ' 📷' : ''}`).join('<br>') + '</div>').join('');
    $('edsProto').innerHTML = steps ? `<div class="edsstages">${steps}</div><p class="note" style="margin:6px 0 0">📷 = 형광 측정(데이터 수집) 단계${p.cover ? ` · 뚜껑 ${p.cover} °C` : ''}</p>` : '';
    const cnt = (n) => { const rs = data.reads.filter((r) => r.target === n); return [rs.length, rs.filter((r) => r.detected).length]; };
    const th = (x, tip) => `<th title="${esc(tip)}">${x}</th>`;
    $('edsDets').innerHTML = '<table class="drt edsdet"><thead><tr>' + th('표시', '행을 누르면 증폭 곡선에서 숨기거나 보여요') + th('표적유전자', 'Target(Detector): 증폭하려는 유전자 · 프라이머/프로브 세트의 이름') + th('형광 다이', 'Reporter: 프로브 5′ 끝의 형광 물질 (FAM, JOE, CY5 …)') + th('소광체', 'Quencher: 프로브가 온전할 때 형광을 눌러 두는 물질 (None = 장비 설정에 지정하지 않음)') +
      th('장비 임계값', '장비 소프트웨어가 Ct 계산에 쓴 임계값 (ΔRn 기준)') + th('사용할 임계값 ✎', '직접 입력하면 이 값으로 Ct를 다시 계산해요. 비우면 장비 값으로 돌아가요.') + th('방식', 'Auto = 장비가 자동 계산, Manual = 사용자가 직접 지정') + th('베이스라인', 'Baseline: 증폭 전 배경 신호를 구하는 사이클 범위 (시작–끝)') + th('웰 수', '이 검출기의 결과 건수') + th('검출', 'Ct가 정해진 건수 (나머지는 Undetermined)') + '</tr></thead><tbody>' +
      data.detectors.map((d) => { const [n, k] = cnt(d.name), u = S.user.has(d.name); return `<tr data-det="${esc(d.name)}" class="${S.hidden.has(d.name) ? 'off' : ''}"><td><i class="ld" style="background:${col(d.name)}"></i>${S.hidden.has(d.name) ? '숨김' : '표시'}</td><td style="font-weight:800">${esc(d.name)}</td><td>${esc(d.reporter)}</td><td>${esc(d.quencher)}</td><td>${fmtT(d.threshold)}</td><td><input class="flt thr${u ? ' user' : ''}" data-thr="${esc(d.name)}" inputmode="decimal" value="${S.thr[d.name] !== undefined ? S.thr[d.name] : ''}" placeholder="${fmtT(d.threshold)}" title="임계값을 직접 입력 (Enter 또는 칸 밖을 누르면 적용)">${u ? ' <span class="und">직접 지정</span>' : ''}</td><td>${d.autoCt === null ? '–' : d.autoCt ? 'Auto' : 'Manual'}</td><td>${d.baseStart === null ? '–' : `${d.baseStart} – ${d.baseStop}`}</td><td>${n}</td><td>${k}</td></tr>`; }).join('') + '</tbody></table>' +
      (S.user.size ? '<p class="note" style="margin:6px 0 0">⚠ 직접 지정한 임계값으로 <b>이 화면에서 Ct를 다시 계산</b>했어요 (ΔRn을 로그 선형 보간). 장비 소프트웨어와 방법이 달라 같은 임계값이어도 0.1~0.5 사이클 정도 차이가 날 수 있어요. <button id="edsThrReset" type="button" class="linkbtn">모두 장비 값으로 되돌리기</button></p>' : '');
  }

  // ---------- 플레이트 ----------
  function renderPlate() {
    const { rows, cols } = data.info, byIdx = new Map(), layout = new Map(data.layout);
    for (const r of data.reads) (byIdx.get(r.idx) ?? byIdx.set(r.idx, []).get(r.idx)).push(r);
    const sc = new Map(data.samples.map((s) => [s.name, s.color]));
    let h = '<table class="edsplate"><thead><tr><th data-all title="전체 선택"></th>' + Array.from({ length: cols }, (_, c) => `<th data-c="${c}" title="${c + 1}열 선택">${c + 1}</th>`).join('') + '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      h += `<tr><th data-r="${r}" title="${String.fromCharCode(65 + r)}행 선택">${String.fromCharCode(65 + r)}</th>`;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c, rs = byIdx.get(idx), smp = rs?.[0]?.sample ?? layout.get(idx);
        if (!smp) { h += `<td class="e" data-r="${r}" data-c="${c}"></td>`; continue; }
        const on = rs?.some((x) => S.sel.has(key(x)));
        const dots = (rs ?? []).map((x) => `<i class="${x.detected ? '' : 'nd'}" style="--c:${col(x.target)}" title="${esc(x.target)}"></i>`).join('');
        h += `<td data-idx="${idx}" data-r="${r}" data-c="${c}" class="${on ? 'sel' : ''}" style="--s:${sc.get(smp) ?? '#9aa5ab'}" title="${wellName(idx, cols)} · ${esc(smp)}"><span class="sn">${esc(smp)}</span><span class="dots">${dots}</span></td>`;
      }
      h += '</tr>';
    }
    $('edsPlate').innerHTML = h + '</tbody></table>';
    $('edsLegend').innerHTML = data.samples.map((s) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + '<span class="lg"><i class="dot"></i>검출</span><span class="lg"><i class="dot nd"></i>미검출 (Undetermined)</span>';
  }
  const wellName = (idx, cols) => String.fromCharCode(65 + Math.floor(idx / cols)) + ((idx % cols) + 1);

  // ---------- 증폭 곡선 ----------
  function visibleReads() { return data.reads.filter((r) => !S.hidden.has(r.target) && (!S.only || !S.sel.size || S.sel.has(key(r)))); }
  function plotSvg() {
    const W = 780, H = 440, L = 70, R = 20, T = 34, B = 56, pw = W - L - R, ph = H - T - B, sig = S.sig, ys = (r) => r[sig];
    const rs = visibleReads().filter((r) => ys(r).length);
    const N = data.cycles || 40;
    let lo = Infinity, hi = -Infinity;
    for (const r of rs) for (const v of ys(r)) { if (S.log && v <= 0) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    let y0, y1, ticks = [];
    if (S.log) {
      const a = S.ymin !== null && S.ymin > 0 ? S.ymin : lo, b = S.ymax !== null && S.ymax > 0 ? S.ymax : hi;
      y0 = Math.floor(Math.log10(Math.max(a, 1e-3))); y1 = Math.ceil(Math.log10(Math.max(b, 1)));
      if (y1 <= y0) y1 = y0 + 1;
      for (let k = y0; k <= y1; k++) ticks.push(k);
    } else {
      let a = S.ymin ?? Math.min(lo, 0), b = S.ymax ?? hi; if (b <= a) b = a + 1;
      const span = b - a, step = 10 ** Math.floor(Math.log10(span / 5)), m = [1, 2, 2.5, 5, 10].find((q) => span / (q * step) <= 6) * step;
      y0 = S.ymin ?? Math.floor(a / m) * m; y1 = S.ymax ?? Math.ceil(b / m) * m; if (y1 <= y0) y1 = y0 + m;
      for (let v = Math.ceil(y0 / m) * m; v <= y1 + m / 1e6; v += m) ticks.push(v);
    }
    const X = (c) => L + ((c - 1) / (N - 1)) * pw;
    const Y = (v) => { const t = S.log ? (Math.log10(Math.max(v, 10 ** y0)) - y0) / (y1 - y0) : (v - y0) / (y1 - y0); return T + (1 - t) * ph; };
    const fmt = (v) => (S.log ? (v >= 0 && v <= 4 ? String(10 ** v) : `10^${v}`) : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('en-US') + 'k' : String(+v.toPrecision(4)));
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR','Malgun Gothic',Arial,sans-serif" role="img" aria-label="Amplification plot"><rect width="${W}" height="${H}" fill="#fff"/>`;
    s += `<text x="${W / 2}" y="20" font-size="14" font-weight="700" text-anchor="middle" fill="#14313b">Amplification plot (${sig === 'drn' ? 'ΔRn' : 'Rn'} vs Cycle${S.log ? ', log' : ''})</text>`;
    for (const v of ticks) s += `<line x1="${L}" y1="${Y(S.log ? 10 ** v : v).toFixed(1)}" x2="${W - R}" y2="${Y(S.log ? 10 ** v : v).toFixed(1)}" stroke="#e3eaee"/><text x="${L - 8}" y="${(Y(S.log ? 10 ** v : v) + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#3a5560">${fmt(v)}</text>`;
    for (let c = 1; c <= N; c += c === 1 ? 4 : 5) s += `<line x1="${X(c).toFixed(1)}" y1="${T}" x2="${X(c).toFixed(1)}" y2="${T + ph}" stroke="#eef2f4"/><text x="${X(c).toFixed(1)}" y="${T + ph + 17}" font-size="11" text-anchor="middle" fill="#3a5560">${c}</text>`;
    s += `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#9db4bd"/><defs><clipPath id="edsclip"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath></defs><g clip-path="url(#edsclip)">`;
    // 임계값 (ΔRn 에서만 의미가 있다)
    if (sig === 'drn') for (const d of data.detectors) if (!S.hidden.has(d.name) && thrOf(d) !== null && rs.some((r) => r.target === d.name)) s += `<line x1="${L}" y1="${Y(thrOf(d)).toFixed(1)}" x2="${W - R}" y2="${Y(thrOf(d)).toFixed(1)}" stroke="${col(d.name)}" stroke-dasharray="6 4" stroke-opacity=".8"/>`;
    const anySel = S.sel.size > 0, draw = (r, bold) => {
      const pts = ys(r).map((v, i) => `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${col(r.target)}" stroke-width="${bold ? 2.6 : 1.4}" stroke-opacity="${anySel && !bold ? 0.28 : 0.95}" stroke-linejoin="round"/>`;
    };
    for (const r of rs) if (!(anySel && S.sel.has(key(r)))) s += draw(r, false);
    for (const r of rs) if (anySel && S.sel.has(key(r))) s += draw(r, true);
    if (sig === 'drn') for (const r of rs) if (r.detected && (!anySel || S.sel.has(key(r)))) { const d = data.detectors.find((x) => x.name === r.target); if (d && thrOf(d) !== null) s += `<circle cx="${X(r.ct).toFixed(1)}" cy="${Y(thrOf(d)).toFixed(1)}" r="3.4" fill="#fff" stroke="${col(r.target)}" stroke-width="1.8"/>`; }
    s += '</g>';
    s += `<text x="${L + pw / 2}" y="${H - 12}" font-size="12" text-anchor="middle" fill="#14313b">Cycle</text><text transform="translate(16 ${T + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#14313b">${sig === 'drn' ? 'ΔRn' : 'Rn'}</text>`;
    s += data.detectors.map((d, i) => `<g transform="translate(${L + 8 + i * 92} ${T + 14})" font-size="11" fill="#3a5560" opacity="${S.hidden.has(d.name) ? 0.3 : 1}"><line x1="0" x2="18" y1="0" y2="0" stroke="${col(d.name)}" stroke-width="2.6"/><text x="23" y="3.5">${esc(d.name)}</text></g>`).join('');
    return { svg: s + '</svg>', geo: { L, R, T, B, W, H, pw, ph, N, X, Y, rs } };
  }
  let geo = null;
  function renderPlot() {
    const o = plotSvg(); geo = o.geo; $('edsPlot').innerHTML = o.svg;
    const svg = $('edsPlot').querySelector('svg'), tip = $('edsTip');
    svg.addEventListener('mousemove', (e) => {
      const b = svg.getBoundingClientRect(), k = geo.W / b.width, mx = (e.clientX - b.left) * k, my = (e.clientY - b.top) * k;
      if (mx < geo.L || mx > geo.W - geo.R || my < geo.T || my > geo.T + geo.ph) { tip.hidden = true; return; }
      const c = Math.max(1, Math.min(geo.N, Math.round(1 + ((mx - geo.L) / geo.pw) * (geo.N - 1))));
      let best = null, bd = 1e9;
      for (const r of geo.rs) { const v = r[S.sig][c - 1]; if (v === undefined) continue; const d = Math.abs(geo.Y(v) - my); if (d < bd) { bd = d; best = { r, v }; } }
      if (!best || bd > 40) { tip.hidden = true; return; }
      const { r, v } = best;
      tip.innerHTML = `<b>${r.well}</b> · ${esc(r.sample)} · ${esc(r.target)}<br>Cycle ${c} · ${S.sig === 'drn' ? 'ΔRn' : 'Rn'} ${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}<br>Ct ${r.detected ? f2(r.ct) : 'Undetermined'}`;
      tip.hidden = false; tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 190) + 'px'; tip.style.top = (e.clientY - b.top + 14) + 'px';
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.addEventListener('click', () => { /* 곡선 클릭은 툴팁으로 대체 */ });
  }

  // ---------- 결과표 ----------
  function visibleTable() {
    const q = S.q.trim().toLowerCase();
    return data.reads.filter((r) => (!S.tgt || r.target === S.tgt) && (!q || `${r.well} ${r.sample} ${r.target}`.toLowerCase().includes(q)));
  }
  // 결과표 모델: { head: [{html,text}], rows: [{keys:[...], cells:[{html,text}]}] } — 화면과 CSV가 같은 모델을 쓴다
  const cell = (html, text = html, n = null) => ({ html, text: String(text ?? ''), n: Number.isFinite(n) ? n : null });
  const valOf = (r) => {
    const v = S.val === 'mean' ? r.ctMean : S.val === 'sd' ? r.ctSd : r.ct;
    if (!r.detected) return cell('<span class="und">Undetermined</span>', 'Undetermined');
    return v === null || v === undefined ? cell('', '') : cell(f2(v), v, v);
  };
  function tableModel() {
    const rs = visibleTable();
    if (S.view === 'list') {
      const head = ['Well', 'Sample', 'Target', 'Reporter', 'Task', 'Ct', 'Ct Mean', 'Ct SD'].map((x) => cell(x));
      return { head, rows: rs.map((r) => {
        const rep = data.detectors.find((d) => d.name === r.target)?.reporter ?? '';
        return { keys: [key(r)], cells: [cell(r.well), cell(esc(r.sample), r.sample), cell(`<i class="ld" style="background:${col(r.target)}"></i>${esc(r.target)}`, r.target), cell(esc(rep), rep), cell(esc(r.task), r.task),
          r.detected ? cell(f2(r.ct), r.ct, r.ct) : cell('<span class="und">Undetermined</span>', 'Undetermined'), cell(r.detected ? f2(r.ctMean) : '', r.detected ? r.ctMean : '', r.detected ? r.ctMean : null), cell(r.detected ? f2(r.ctSd) : '', r.detected ? r.ctSd : '', r.detected ? r.ctSd : null)] };
      }) };
    }
    // 웰 × 표적: 표적을 열로
    const tg = data.detectors.map((d) => d.name).filter((n) => rs.some((r) => r.target === n));
    const head = [cell('Well'), cell('Sample'), ...tg.map((n) => { const d = data.detectors.find((x) => x.name === n); return cell(`<i class="ld" style="background:${col(n)}"></i>${esc(n)}<small class="rep">${esc(d?.reporter ?? '')}</small>`, n); })];
    const byWell = new Map();
    for (const r of rs) (byWell.get(r.idx) ?? byWell.set(r.idx, []).get(r.idx)).push(r);
    const rows = [...byWell.entries()].sort((x, y) => x[0] - y[0]).map(([, g]) => ({ keys: g.map(key), cells: [cell(g[0].well), cell(esc(g[0].sample), g[0].sample), ...tg.map((n) => { const r = g.find((x) => x.target === n); return r ? valOf(r) : cell('', ''); })] }));
    return { head, rows };
  }
  // 열 필터: 글자 포함, 숫자 열은 >30  <=20  =17.06  20-30 같은 식도 허용. 정렬: 숫자는 숫자로, 글자는 자연 순서로, 빈 칸은 맨 뒤
  const numTest = (s) => {
    const m = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(s), r = /^(-?\d+(?:\.\d+)?)\s*[-~]\s*(-?\d+(?:\.\d+)?)$/.exec(s);
    if (r) { const a = Math.min(+r[1], +r[2]), b = Math.max(+r[1], +r[2]); return (n) => n >= a && n <= b; }
    if (!m) return null;
    const v = +m[2]; return { '>': (n) => n > v, '<': (n) => n < v, '>=': (n) => n >= v, '<=': (n) => n <= v, '=': (n) => n === v, undefined: (n) => n === v }[m[1]];
  };
  function applyColumnOps(m) {
    const idx = (k) => m.head.findIndex((h) => h.text === k);
    let rows = m.rows;
    for (const [k, q0] of Object.entries(S.flt)) {
      const i = idx(k), q = q0.trim().toLowerCase(); if (i < 0 || !q) continue;
      const nt = numTest(q);
      rows = rows.filter((r) => { const c = r.cells[i]; return nt && c.n !== null ? nt(c.n) : c.text.toLowerCase().includes(q); });
    }
    const si = S.sortCol === null ? -1 : idx(S.sortCol);
    if (si >= 0) {
      const dir = S.sortDir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const x = a.cells[si], y = b.cells[si], ex = x.text === '', ey = y.text === '';
        if (ex !== ey) return ex ? 1 : -1;
        if (x.n !== null && y.n !== null) return (x.n - y.n) * dir;
        if ((x.n === null) !== (y.n === null)) return x.n === null ? 1 : -1; // Undetermined 는 숫자 뒤
        return x.text.localeCompare(y.text, 'en', { numeric: true }) * dir;
      });
    }
    return { head: m.head, rows };
  }
  function renderTable() {
    const m = applyColumnOps(tableModel()), on = (keys) => keys.some((k) => S.sel.has(k));
    const act = document.activeElement?.dataset?.flt, caret = act !== undefined ? document.activeElement.selectionStart : null;
    const ctl = (h) => `<span class="srt" data-sort="${esc(h.text)}" title="눌러서 정렬 (오름 → 내림 → 해제)">${h.html}<b class="arw">${S.sortCol === h.text ? (S.sortDir === 'desc' ? '▼' : '▲') : '⇅'}</b></span>`;
    const flt = (h) => `<input class="flt" data-flt="${esc(h.text)}" value="${esc(S.flt[h.text] ?? '')}" placeholder="필터" title="글자 포함 · 숫자 열은 >30, <=20, 20-30 도 돼요">`;
    const dk = (keys) => `data-k="${keys.join(';')}"`;
    if (!S.tr) {
      $('edsTable').innerHTML = '<table class="drt edsres"><thead><tr>' + m.head.map((c) => `<th>${ctl(c)}</th>`).join('') + '</tr><tr class="fr">' + m.head.map((c) => `<th>${flt(c)}</th>`).join('') + '</tr></thead><tbody>' +
        m.rows.map((r) => `<tr ${dk(r.keys)} class="${on(r.keys) ? 'key' : ''}">` + r.cells.map((c) => `<td>${c.html}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    } else {
      $('edsTable').innerHTML = '<table class="drt edsres edstr"><tbody>' + m.head.map((h, i) => `<tr><th>${ctl(h)}${flt(h)}</th>` + m.rows.map((r) => `<td ${dk(r.keys)} class="${on(r.keys) ? 'sel' : ''}">${r.cells[i].html}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    }
    $('edsCount').textContent = S.view === 'list' ? `${m.rows.length} / ${data.reads.length}건` : `${m.rows.length}웰`;
    if (act !== undefined) { const el = [...$('edsTable').querySelectorAll('input[data-flt]')].find((x) => x.dataset.flt === act); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} } }
    $('edsFltClear').hidden = !Object.values(S.flt).some((v) => v.trim()) && S.sortCol === null;
    $('edsVal').disabled = S.view === 'list';
  }
  function renderPivot() {
    const sm = summarize(data), samples = data.samples.map((s) => s.name).filter((n) => sm.some((x) => x.sample === n)), tg = data.detectors.map((d) => d.name).filter((n) => sm.some((x) => x.target === n));
    const get = (s, t) => sm.find((x) => x.sample === s && x.target === t);
    $('edsPivot').innerHTML = '<table class="drt"><thead><tr><th>Sample</th>' + tg.map((t) => `<th><i class="ld" style="background:${col(t)}"></i>${esc(t)}</th>`).join('') + '</tr></thead><tbody>' +
      samples.map((s) => `<tr><td style="text-align:left;font-weight:700">${esc(s)}</td>` + tg.map((t) => { const x = get(s, t); return !x ? '<td></td>' : x.pos ? `<td title="${x.wells.join(', ')}">${f2(x.mean)} <small>(${x.pos}/${x.n})</small></td>` : `<td class="und" title="${x.wells.join(', ')}">ND <small>(0/${x.n})</small></td>`; }).join('') + '</tr>').join('') + '</tbody></table>';
  }

  function renderStd() {
    const cs = standardCurves(data); S.std = cs;
    let h = '';
    if (!cs.length) h = '<p class="note">이 파일에는 <b>표준(STANDARD) 웰</b>이 없어서 표준곡선과 정량값을 만들 수 없어요. 장비에서 웰의 Task를 Standard로 지정하고 양(Quantity)을 넣은 실험(<i>Quantitation – Standard Curve</i>)이어야 해요.</p>';
    else {
      h += '<div class="stdwrap">' + cs.map((c) => {
        const W = 340, H = 240, L = 46, R = 14, T = 16, B = 38, xs = c.points.map((p) => p.x), ys = c.points.map((p) => p.ct);
        const x0 = Math.floor(Math.min(...xs)) - 0.3, x1 = Math.ceil(Math.max(...xs)) + 0.3, y0 = Math.floor(Math.min(...ys)) - 1, y1 = Math.ceil(Math.max(...ys)) + 1;
        const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
        let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans KR',Arial,sans-serif" style="max-width:100%;height:auto"><rect width="${W}" height="${H}" fill="#fff"/>`;
        for (let v = Math.ceil(y0); v <= y1; v += 2) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3eaee"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="10" text-anchor="end" fill="#3a5560">${v}</text>`;
        for (let v = Math.ceil(x0); v <= x1; v++) s += `<line y1="${T}" y2="${H - B}" x1="${X(v)}" x2="${X(v)}" stroke="#e3eaee"/><text x="${X(v)}" y="${H - B + 14}" font-size="10" text-anchor="middle" fill="#3a5560">${v}</text>`;
        s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="#9db4bd"/><line x1="${X(x0)}" y1="${Y(c.slope * x0 + c.intercept)}" x2="${X(x1)}" y2="${Y(c.slope * x1 + c.intercept)}" stroke="${col(c.target)}" stroke-width="2"/>`;
        s += c.points.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.ct)}" r="3.8" fill="#fff" stroke="${col(c.target)}" stroke-width="2"><title>${p.well} · Ct ${f2(p.ct)}</title></circle>`).join('');
        s += `<text x="${(L + W - R) / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="#14313b">log10(Quantity)</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" font-size="11" text-anchor="middle" fill="#14313b">Ct</text></svg>`;
        const eff = c.efficiency, good = eff >= 90 && eff <= 110;
        const ex = data.reads.find((r) => r.target === c.target && !/^STANDARD$/i.test(r.task2) && r.detected && r.calcQty);
        const fx = `<p class="fx" style="margin:8px 0 0">Ct = slope × log10(Q) + intercept &nbsp;(최소제곱)<br>Efficiency = (10<sup>−1/slope</sup> − 1) × 100 = (10<sup>−1/${c.slope.toFixed(3)}</sup> − 1) × 100 = <b>${eff.toFixed(1)} %</b><br>Quantity = 10<sup>(Ct − intercept) ÷ slope</sup>${ex ? ` = 10<sup>(${f2(ex.ct)} − ${c.intercept.toFixed(3)}) ÷ ${c.slope.toFixed(3)}</sup> = ${ex.calcQty.toExponential(3)} <small>(${ex.well})</small>` : ''}</p>`;
        return `<div class="stdc"><h3 style="margin:0 0 6px;font-size:14px"><i class="ld" style="background:${col(c.target)}"></i>${esc(c.target)}</h3>${s}<div class="edsgrid" style="margin-top:8px"><div><span>Slope</span><b>${c.slope.toFixed(3)}</b></div><div><span>Y-intercept</span><b>${c.intercept.toFixed(3)}</b></div><div><span>R²</span><b>${c.r2.toFixed(4)}</b></div><div><span>Efficiency</span><b style="color:var(${good ? '--ok' : '--bad'})">${eff.toFixed(1)} %</b></div><div><span>표준 점</span><b>${c.n}개 (${c.levels}단계)</b></div></div>${fx}</div>`;
      }).join('') + '</div>';
      const rs = data.reads.filter((r) => cs.some((c) => c.target === r.target) && !/^STANDARD$/i.test(r.task2));
      h += '<h3 class="edsh">정량값 (표준곡선으로 계산)</h3><div class="scroll"><table class="drt edsres"><thead><tr><th>Well</th><th>Sample</th><th>Target</th><th>Ct</th><th title="표준곡선에서 이 사이트가 계산한 값: 10^((Ct − 절편) / 기울기)">계산 Quantity</th><th title="장비 소프트웨어가 파일에 저장한 값">장비 Quantity</th></tr></thead><tbody>' + rs.map((r) => `<tr><td>${r.well}</td><td>${esc(r.sample)}</td><td><i class="ld" style="background:${col(r.target)}"></i>${esc(r.target)}</td>` + (r.detected ? `<td>${f2(r.ct)}</td><td>${r.calcQty === null || r.calcQty === undefined ? '' : r.calcQty.toExponential(3)}</td>` : '<td class="und">Undetermined</td><td></td>') + `<td>${r.qty === null ? '' : r.qty.toExponential(3)}</td></tr>`).join('') + '</tbody></table></div>';
    }
    $('edsStd').innerHTML = h;
    $('edsMelt').innerHTML = data.melt
      ? '<p class="note">이 파일에는 <b>융해(Melt) 단계</b>가 있어요. 다만 융해 곡선 데이터의 저장 방식을 확인할 수 있는 파일로 검증하지 못해서 아직 표시하지 않아요. 융해 단계가 있는 .eds(SYBR Green) 샘플을 주시면 Tm 피크까지 지원할게요.</p>'
      : '<p class="note">이 파일의 PCR 프로그램에는 <b>융해(Melt) 단계가 없어요</b> (TaqMan 프로브 실험). SYBR Green 실험처럼 융해 단계가 있는 파일에서 융해 곡선을 보여줄 예정이에요.</p>';
  }
  function renderAll() { renderInfo(); renderPlate(); renderPlot(); renderTable(); renderPivot(); renderStd(); const d = $('edsTgt'); d.innerHTML = '<option value="">모든 검출기</option>' + data.detectors.map((x) => `<option>${esc(x.name)}</option>`).join(''); $('edsSel').textContent = ''; $('edsTitle').textContent = data.info.name; }
  function rerender() { S.user = applyThresholds(data, S.thr); renderInfo(); renderPlate(); renderPlot(); renderTable(); renderPivot(); renderStd(); }
  function refreshSel() { renderPlate(); renderPlot(); renderTable(); $('edsSel').textContent = S.sel.size ? `선택 ${S.sel.size}건` : ''; }

  // ---------- 상호작용 ----------
  // 플레이트 선택: 7500 소프트웨어처럼 드래그로 사각형 선택. Ctrl/Shift = 추가, 머리글 = 행/열/전체
  let drag = null;
  const cellOf = (e) => { const el = (e.target.closest?.('td[data-r]') ?? document.elementFromPoint(e.clientX, e.clientY))?.closest('td[data-r],th[data-r],th[data-c],th[data-all]'); return el; };
  const rectOf = (a, b) => ({ r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) });
  const paintDrag = () => { const q = rectOf(drag.a, drag.b); $('edsPlate').querySelectorAll('td[data-idx]').forEach((td) => { const r = +td.dataset.r, c = +td.dataset.c; td.classList.toggle('drag', r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1); }); };
  $('edsPlate').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest('td[data-r],th[data-r],th[data-c],th[data-all]'); if (!el) return;
    e.preventDefault();
    const { rows, cols } = data.info, add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (el.dataset.all !== undefined) drag = { a: { r: 0, c: 0 }, b: { r: rows - 1, c: cols - 1 }, add, hdr: true };
    else if (el.tagName === 'TH' && el.dataset.r !== undefined) drag = { a: { r: +el.dataset.r, c: 0 }, b: { r: +el.dataset.r, c: cols - 1 }, add, hdr: true };
    else if (el.tagName === 'TH') drag = { a: { r: 0, c: +el.dataset.c }, b: { r: rows - 1, c: +el.dataset.c }, add, hdr: true };
    else drag = { a: { r: +el.dataset.r, c: +el.dataset.c }, b: { r: +el.dataset.r, c: +el.dataset.c }, add, moved: false };
    paintDrag();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag || drag.hdr) return;
    const el = cellOf(e); if (!el || el.dataset.r === undefined || el.tagName === 'TH') return;
    const b = { r: +el.dataset.r, c: +el.dataset.c };
    if (b.r !== drag.b.r || b.c !== drag.b.c) { drag.b = b; drag.moved = true; paintDrag(); }
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const q = rectOf(drag.a, drag.b), hit = data.reads.filter((r) => r.row >= q.r0 && r.row <= q.r1 && r.col >= q.c0 && r.col <= q.c1);
    const single = !drag.hdr && !drag.moved, allOn = hit.length > 0 && hit.every((r) => S.sel.has(key(r)));
    if (drag.add) hit.forEach((r) => (allOn ? S.sel.delete(key(r)) : S.sel.add(key(r))));
    else if (single && allOn && S.sel.size === hit.length) S.sel.clear();
    else { S.sel.clear(); hit.forEach((r) => S.sel.add(key(r))); }
    drag = null; refreshSel();
  });
  $('edsTable').addEventListener('click', (e) => { if (e.target.closest('input,[data-sort]')) return; const tr = e.target.closest('[data-k]'); if (!tr) return; const ks = tr.dataset.k.split(';'), all = ks.every((k) => S.sel.has(k)); ks.forEach((k) => (all ? S.sel.delete(k) : S.sel.add(k))); refreshSel(); });
  $('edsDets').addEventListener('change', (e) => {
    const i = e.target.closest('input[data-thr]'); if (!i) return;
    const s = i.value.trim().replace(/,/g, ''), v = Number(s);
    if (s === '') delete S.thr[i.dataset.thr]; else if (Number.isFinite(v) && v > 0) S.thr[i.dataset.thr] = v; else { i.value = ''; delete S.thr[i.dataset.thr]; }
    rerender();
  });
  $('edsDets').addEventListener('click', (e) => { if (e.target.closest('#edsThrReset')) { S.thr = {}; rerender(); return; } if (e.target.closest('input')) return; const b = e.target.closest('tr[data-det]'); if (!b) return; const n = b.dataset.det; S.hidden.has(n) ? S.hidden.delete(n) : S.hidden.add(n); renderInfo(); renderPlot(); });
  $('edsSig').addEventListener('change', () => { S.sig = $('edsSig').value; renderPlot(); });
  $('edsLog').addEventListener('change', () => { S.log = $('edsLog').checked; renderPlot(); });
  $('edsOnly').addEventListener('change', () => { S.only = $('edsOnly').checked; renderPlot(); });
  const yIn = () => { const g = (id) => { const s = $(id).value.trim().replace(/,/g, ''); const v = Number(s); return s === '' || !Number.isFinite(v) ? null : v; }; S.ymin = g('edsYmin'); S.ymax = g('edsYmax'); renderPlot(); };
  $('edsYmin').addEventListener('input', yIn); $('edsYmax').addEventListener('input', yIn);
  $('edsYauto').addEventListener('click', () => { $('edsYmin').value = ''; $('edsYmax').value = ''; yIn(); });
  $('edsClearSel').addEventListener('click', () => { S.sel.clear(); refreshSel(); });
  $('edsTable').addEventListener('input', (e) => { const i = e.target.closest('input[data-flt]'); if (!i) return; S.flt[i.dataset.flt] = i.value; renderTable(); });
  $('edsTable').addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]'); if (!s) return; e.stopPropagation();
    const k = s.dataset.sort;
    if (S.sortCol !== k) { S.sortCol = k; S.sortDir = 'asc'; } else if (S.sortDir === 'asc') S.sortDir = 'desc'; else { S.sortCol = null; S.sortDir = 'asc'; }
    renderTable();
  }, true);
  $('edsFltClear').addEventListener('click', () => { S.flt = {}; S.sortCol = null; renderTable(); });
  $('edsView').addEventListener('change', () => { S.view = $('edsView').value; S.flt = {}; S.sortCol = null; renderTable(); });
  $('edsVal').addEventListener('change', () => { S.val = $('edsVal').value; renderTable(); });
  $('edsTr').addEventListener('change', () => { S.tr = $('edsTr').checked; renderTable(); });
  $('edsQ').addEventListener('input', () => { S.q = $('edsQ').value; renderTable(); });
  $('edsTgt').addEventListener('change', () => { S.tgt = $('edsTgt').value; renderTable(); });
  $('edsCsv').addEventListener('click', () => {
    const m = applyColumnOps(tableModel());
    let rows = [m.head.map((c) => c.text)].concat(m.rows.map((r) => r.cells.map((c) => c.text)));
    if (S.tr) rows = rows[0].map((_, i) => rows.map((r) => r[i]));
    saveBlob(new Blob(['\ufeff' + rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), (fileName.replace(/\.eds$/i, '') || '7500FAST') + '_results.csv');
  });
  $('edsPng').addEventListener('click', async () => {
    const svg = $('edsPlot').querySelector('svg'); if (!svg) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    try { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }); const c = document.createElement('canvas'); c.width = 1560; c.height = 880; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); saveBlob(await new Promise((res) => c.toBlob(res, 'image/png')), (fileName.replace(/\.eds$/i, '') || '7500FAST') + '_amplification.png'); } finally { URL.revokeObjectURL(url); }
  });
  // ---- 보고서 (미리보기 · HWPX) ----
  async function svgToPng(svg, W = 1560) {
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const vb = svg.viewBox.baseVal, H = Math.round((W * vb.height) / vb.width), c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return { png: new Uint8Array(await blob.arrayBuffer()), dataUrl: c.toDataURL('image/png'), w: W, h: H };
    } finally { URL.revokeObjectURL(url); }
  }
  const baseName = () => (data?.info.name || fileName.replace(/\.eds$/i, '') || '7500FAST').replace(/[\\/:*?"<>|]/g, '_');
  async function report() {
    if (!data) throw new Error('먼저 .eds 파일을 열어 주세요');
    const svg = $('edsPlot').querySelector('svg'), images = svg ? { plot: await svgToPng(svg) } : {};
    const model = buildModel(data, { fileName, version: VERSION, program: APP_INFO.name, thr: S.thr, user: S.user, curves: S.std, images });
    return { model, images, pages: renderPages(model, images), name: baseName() };
  }
  async function exportHwpx() {
    const r = await report();
    const blob = await buildHwpx(r.model, r.images, { JSZip, program: APP_INFO.name });
    saveBlob(blob, `${r.name}_7500FAST_결과서.hwpx`);
  }
  $('edsSample').addEventListener('click', async () => {
    try { const res = await fetch('samples/demo_7500fast.eds'); if (!res.ok) throw new Error('샘플을 불러오지 못했어요'); await load(new File([await res.blob()], 'demo_7500fast.eds')); }
    catch (e) { const m = $('edsMsg'); m.className = 'pberr'; m.textContent = e.message; }
  });
  return { load, report, exportHwpx, name: () => baseName(), has: () => !!data };
}
