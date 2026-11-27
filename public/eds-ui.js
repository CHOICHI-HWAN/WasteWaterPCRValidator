// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 7500 Fast 결과(.eds) 보기 화면: 요약 · 플레이트 · 증폭 곡선 · 결과표 · 시료×검출기 요약
import { readEds, summarize } from './eds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PALETTE = ['#2f80ed', '#e08e0b', '#c0362c', '#12804a', '#8a4bd5', '#0e8fa0', '#d6336c', '#5f6b73'];
const f2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(2));
const key = (r) => `${r.idx}|${r.target}`;
const dt = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { hour12: false }) : '–');
const dur = (a, b) => { if (!a || !b || b < a) return ''; const m = Math.round((b - a) / 60000); return `${Math.floor(m / 60)}시간 ${m % 60}분`; };

export function initEds({ $, saveBlob }) {
  let data = null, fileName = '';
  const S = { sel: new Set(), hidden: new Set(), sig: 'drn', log: false, only: false, q: '', tgt: '' };
  const col = (t) => PALETTE[Math.max(0, data.detectors.findIndex((d) => d.name === t)) % PALETTE.length];

  // ---------- 파일 읽기 ----------
  async function load(file) {
    const msg = $('edsMsg');
    msg.className = 'note'; msg.textContent = '읽는 중…';
    try {
      if (typeof JSZip === 'undefined') throw new Error('JSZip 로드 실패');
      data = await readEds(await file.arrayBuffer(), JSZip);
      fileName = file.name; S.sel.clear(); S.hidden.clear(); S.q = ''; S.tgt = '';
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
    $('edsDets').innerHTML = data.detectors.map((d) => `<button type="button" class="edschip${S.hidden.has(d.name) ? ' off' : ''}" data-det="${esc(d.name)}" title="클릭하면 그래프에서 숨기거나 보여요"><i style="background:${col(d.name)}"></i><b>${esc(d.name)}</b> <small>${esc(d.reporter)}${d.threshold !== null ? ` · 임계값 ${d.threshold < 100 ? d.threshold : Math.round(d.threshold).toLocaleString('en-US')}` : ''}</small></button>`).join('');
  }

  // ---------- 플레이트 ----------
  function renderPlate() {
    const { rows, cols } = data.info, byIdx = new Map(), layout = new Map(data.layout);
    for (const r of data.reads) (byIdx.get(r.idx) ?? byIdx.set(r.idx, []).get(r.idx)).push(r);
    const sc = new Map(data.samples.map((s) => [s.name, s.color]));
    let h = '<table class="edsplate"><thead><tr><th></th>' + Array.from({ length: cols }, (_, c) => `<th>${c + 1}</th>`).join('') + '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      h += `<tr><th>${String.fromCharCode(65 + r)}</th>`;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c, rs = byIdx.get(idx), smp = rs?.[0]?.sample ?? layout.get(idx);
        if (!smp) { h += '<td class="e"></td>'; continue; }
        const on = rs?.some((x) => S.sel.has(key(x)));
        const dots = (rs ?? []).map((x) => `<i class="${x.detected ? '' : 'nd'}" style="--c:${col(x.target)}" title="${esc(x.target)}"></i>`).join('');
        h += `<td data-idx="${idx}" class="${on ? 'sel' : ''}" style="--s:${sc.get(smp) ?? '#9aa5ab'}" title="${wellName(idx, cols)} · ${esc(smp)}"><span class="sn">${esc(smp)}</span><span class="dots">${dots}</span></td>`;
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
      y0 = Math.floor(Math.log10(Math.max(lo, 1e-3))); y1 = Math.ceil(Math.log10(Math.max(hi, 1)));
      if (y1 <= y0) y1 = y0 + 1;
      for (let k = y0; k <= y1; k++) ticks.push(k);
    } else {
      const span = hi - Math.min(lo, 0) || 1, step = 10 ** Math.floor(Math.log10(span / 5)), m = [1, 2, 2.5, 5, 10].find((q) => span / (q * step) <= 6) * step;
      y0 = Math.floor(Math.min(lo, 0) / m) * m; y1 = Math.ceil(hi / m) * m;
      for (let v = y0; v <= y1 + m / 1e6; v += m) ticks.push(v);
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
    if (sig === 'drn') for (const d of data.detectors) if (!S.hidden.has(d.name) && d.threshold !== null && rs.some((r) => r.target === d.name)) s += `<line x1="${L}" y1="${Y(d.threshold).toFixed(1)}" x2="${W - R}" y2="${Y(d.threshold).toFixed(1)}" stroke="${col(d.name)}" stroke-dasharray="6 4" stroke-opacity=".8"/>`;
    const anySel = S.sel.size > 0, draw = (r, bold) => {
      const pts = ys(r).map((v, i) => `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${col(r.target)}" stroke-width="${bold ? 2.6 : 1.4}" stroke-opacity="${anySel && !bold ? 0.28 : 0.95}" stroke-linejoin="round"/>`;
    };
    for (const r of rs) if (!(anySel && S.sel.has(key(r)))) s += draw(r, false);
    for (const r of rs) if (anySel && S.sel.has(key(r))) s += draw(r, true);
    if (sig === 'drn') for (const r of rs) if (r.detected && (!anySel || S.sel.has(key(r)))) { const d = data.detectors.find((x) => x.name === r.target); if (d?.threshold !== null && d) s += `<circle cx="${X(r.ct).toFixed(1)}" cy="${Y(d.threshold).toFixed(1)}" r="3.4" fill="#fff" stroke="${col(r.target)}" stroke-width="1.8"/>`; }
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
  function renderTable() {
    const rs = visibleTable();
    const det = (r) => data.detectors.find((d) => d.name === r.target);
    $('edsTable').innerHTML = '<table class="drt edsres"><thead><tr><th>Well</th><th>Sample</th><th>Target</th><th>Reporter</th><th>Task</th><th>Ct</th><th>Ct Mean</th><th>Ct SD</th></tr></thead><tbody>' + rs.map((r) =>
      `<tr data-k="${key(r)}" class="${S.sel.has(key(r)) ? 'key' : ''}"><td>${r.well}</td><td>${esc(r.sample)}</td><td><i class="ld" style="background:${col(r.target)}"></i>${esc(r.target)}</td><td>${esc(det(r)?.reporter ?? '')}</td><td>${esc(r.task)}</td>` +
      (r.detected ? `<td>${f2(r.ct)}</td>` : '<td class="und">Undetermined</td>') + `<td>${r.detected ? f2(r.ctMean) : ''}</td><td>${r.detected ? f2(r.ctSd) : ''}</td></tr>`).join('') + '</tbody></table>';
    $('edsCount').textContent = `${rs.length} / ${data.reads.length}건`;
  }
  function renderPivot() {
    const sm = summarize(data), samples = data.samples.map((s) => s.name).filter((n) => sm.some((x) => x.sample === n)), tg = data.detectors.map((d) => d.name).filter((n) => sm.some((x) => x.target === n));
    const get = (s, t) => sm.find((x) => x.sample === s && x.target === t);
    $('edsPivot').innerHTML = '<table class="drt"><thead><tr><th>Sample</th>' + tg.map((t) => `<th><i class="ld" style="background:${col(t)}"></i>${esc(t)}</th>`).join('') + '</tr></thead><tbody>' +
      samples.map((s) => `<tr><td style="text-align:left;font-weight:700">${esc(s)}</td>` + tg.map((t) => { const x = get(s, t); return !x ? '<td></td>' : x.pos ? `<td title="${x.wells.join(', ')}">${f2(x.mean)} <small>(${x.pos}/${x.n})</small></td>` : `<td class="und" title="${x.wells.join(', ')}">ND <small>(0/${x.n})</small></td>`; }).join('') + '</tr>').join('') + '</tbody></table>';
  }

  function renderAll() { renderInfo(); renderPlate(); renderPlot(); renderTable(); renderPivot(); const d = $('edsTgt'); d.innerHTML = '<option value="">모든 검출기</option>' + data.detectors.map((x) => `<option>${esc(x.name)}</option>`).join(''); $('edsSel').textContent = ''; $('edsTitle').textContent = data.info.name; }
  function refreshSel() { renderPlate(); renderPlot(); renderTable(); $('edsSel').textContent = S.sel.size ? `선택 ${S.sel.size}건` : ''; }

  // ---------- 상호작용 ----------
  $('edsPlate').addEventListener('click', (e) => {
    const td = e.target.closest('td[data-idx]'); if (!td) return;
    const rs = data.reads.filter((r) => r.idx === +td.dataset.idx), all = rs.every((r) => S.sel.has(key(r)));
    rs.forEach((r) => (all ? S.sel.delete(key(r)) : S.sel.add(key(r)))); refreshSel();
  });
  $('edsTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (!tr) return; const k = tr.dataset.k; S.sel.has(k) ? S.sel.delete(k) : S.sel.add(k); refreshSel(); });
  $('edsDets').addEventListener('click', (e) => { const b = e.target.closest('[data-det]'); if (!b) return; const n = b.dataset.det; S.hidden.has(n) ? S.hidden.delete(n) : S.hidden.add(n); renderInfo(); renderPlot(); });
  $('edsSig').addEventListener('change', () => { S.sig = $('edsSig').value; renderPlot(); });
  $('edsLog').addEventListener('change', () => { S.log = $('edsLog').checked; renderPlot(); });
  $('edsOnly').addEventListener('change', () => { S.only = $('edsOnly').checked; renderPlot(); });
  $('edsClearSel').addEventListener('click', () => { S.sel.clear(); refreshSel(); });
  $('edsQ').addEventListener('input', () => { S.q = $('edsQ').value; renderTable(); });
  $('edsTgt').addEventListener('change', () => { S.tgt = $('edsTgt').value; renderTable(); });
  $('edsCsv').addEventListener('click', () => {
    const rows = [['Well', 'Sample', 'Target', 'Reporter', 'Task', 'Ct', 'Ct Mean', 'Ct SD']].concat(visibleTable().map((r) => [r.well, r.sample, r.target, data.detectors.find((d) => d.name === r.target)?.reporter ?? '', r.task, r.detected ? r.ct : 'Undetermined', r.detected ? (r.ctMean ?? '') : '', r.detected ? (r.ctSd ?? '') : '']));
    saveBlob(new Blob(['﻿' + rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), (fileName.replace(/\.eds$/i, '') || '7500FAST') + '_results.csv');
  });
  $('edsPng').addEventListener('click', async () => {
    const svg = $('edsPlot').querySelector('svg'); if (!svg) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
    try { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }); const c = document.createElement('canvas'); c.width = 1560; c.height = 880; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); saveBlob(await new Promise((res) => c.toBlob(res, 'image/png')), (fileName.replace(/\.eds$/i, '') || '7500FAST') + '_amplification.png'); } finally { URL.revokeObjectURL(url); }
  });
  return { load };
}
