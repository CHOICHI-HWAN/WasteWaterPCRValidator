// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import { standardCurve, recovery, mean, sd, compare } from './calc.js';
import { parseHwpx, exportHwpx, formatForForm, hasTemplate, templateName, ensureTemplate, META_LABELS } from './hwpx.js';
import { DEFAULTS, BASE_STOCK, load, save, reset } from './settings.js';
import { VERSION } from './version.js';
import { parseStrict, explainInvalid, fixed } from './num.js';
import { curvePng, drawStandardCurve } from './chart.js';
import { buildWorkbook } from './xlsx-export.js';
import { initSidePanel } from './releases.js';
import { probitFit } from './probit.js';
import { plotSvg, fmtC, doseTable } from './probit-ui.js';
import { initEds } from './eds-ui.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (Number.isFinite(v) ? fixed(v, d) : '–');
const f2 = (v) => (Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const badge = (ok, y = '일치', n = '불일치') => `<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? y : n}</span>`;
const val = (el) => parseStrict(el.value); // 엄격한 숫자 해석 (num.js): 부분 해석·소수점 쉼표(18,65) 등은 NaN
// 과학 표기: 1400000 → 1.40×10⁶ (HTML)
const sci = (v) => {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v))), m = v / 10 ** e;
  if (Math.abs(+fixed(m, 2)) >= 10) { m /= 10; e += 1; }
  return `${fixed(m, 2)}×10<sup>${e}</sup>`;
};
const thousands = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '');
// .bignum 입력칸: 포커스가 없을 때 쉼표 서식, 항상 아래에 과학 표기 표시 / 포커스 시 쉼표 제거해 편집 쉽게
function refreshNum() {
  document.querySelectorAll('input.bignum').forEach((el) => {
    let hint = el.nextElementSibling?.classList?.contains('sci') ? el.nextElementSibling : null;
    if (!hint) { hint = document.createElement('small'); hint.className = 'sci'; el.after(hint); }
    const v = val(el);
    if (document.activeElement !== el && Number.isFinite(v)) el.value = thousands(v);
    hint.innerHTML = Number.isFinite(v) && Math.abs(v) >= 1000 ? '= ' + sci(v) : '';
  });
}
document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('bignum')) { const v = val(e.target); if (Number.isFinite(v)) e.target.value = String(v); } });
document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('bignum')) refreshNum(); });
const nz = (v, d = '') => (Number.isFinite(v) ? v : d); // 빈 템플릿의 NaN → 빈 칸
const g = (v, d = 4) => (Number.isFinite(v) ? String(+fixed(v, d)) : '–'); // 식 표시용 숫자
const par = (v, d = 4) => (v < 0 ? `(${g(v, d)})` : g(v, d));
const fxl = (s) => `<small class="fx">${s}</small>`;

let S = load();
let lastData = null; // 마지막으로 업로드/샘플로 불러온 원본 값 (미리보기 비교용)

const PARAMS = [
  ['tolSlope', 'Slope 허용오차'], ['tolInter', 'Y-inter 허용오차'], ['tolR2', 'R² 허용오차'],
  ['tolMeasured', '측정값 허용오차 (copies/mL)'], ['tolPct', '회수율 허용오차 (%p)'], ['tolStat', '평균·SD·RSD 허용오차'],
  ['effMin', '증폭효율 하한 (%)'], ['effMax', '증폭효율 상한 (%)'],
];
$('params').innerHTML = PARAMS.map(([k, l]) => `<label>${l}<input type="number" step="any" data-k="${k}"></label>`).join('');

const SAMPLE = {
  stock: 1400000,
  cts: [[18.65,18.65,18.69],[21.99,22.19,21.64],[25.37,25.39,25.79],[30.91,29.95,29.98],[35.05,33.89,34.28]],
  reported: { slope: -3.982, intercept: 43.174, r2: 0.992 },
  rec: [
    { ct: 26.89, spiked: 100000, measured: 12285.77, pct: 12.29 },
    { ct: 26.98, spiked: 100000, measured: 11662.74, pct: 11.66 },
    { ct: 27.36, spiked: 100000, measured: 9362.05, pct: 9.36 },
  ],
  recSummary: { mean: 11.10, sd: 1.26, rsd: 11.32 },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEMO_META = { // 재미로 넣은 가상 데이터 (실제 기관 아님)
  '기관명': '상상시 하수탐정 보건환경연구원', '패널 수령일': '2026. 10. 20.', '검사 수행일': '2026. 10. 21.',
  '검사 수행자': '김하수 (별명: 똥물 셜록)', '유전자증폭기모델명': 'QuantStudio 5 (애칭: 퀀트돌이)',
  '유전자 증폭기 검증일 또는 보정일': '2026. 4. 17.', '결과 제출일': '2026. 10. 29.',
};
const isDemo = () => metaInputs.some((el) => el.classList.contains('demo')); // 아직 지우지 않은 예시 값이 있는지
const DEMO_WARN = '⚠ 예시(가상) 기관 정보가 남아 있습니다. 실제 제출 전에 본인 기관 정보로 바꾸거나 비우세요.';
const metaState = {};
// 기관 정보 항목: 모두 선택 항목, date=날짜 칸(직접 입력 + 달력)
const META_SPEC = META_LABELS.map((label) => ({ label, req: false, date: /일$|보정일$/.test(label) && label !== '기관명' }));
const TAG = (r) => (r ? '<span class="tag req">필수</span>' : '<span class="tag opt">선택</span>');
$('metaFields').innerHTML = META_SPEC.map((s, i) => s.date
  ? `<label>${s.label} ${TAG(s.req)}<span class="dwrap"><input type="text" class="txt" data-meta="${i}" inputmode="numeric" placeholder="2026. 10. 20."><span class="calbtn" title="달력에서 선택">📅<input type="date" data-pick="${i}" tabindex="-1" aria-label="${s.label} 달력"></span></span><small class="ferr" id="merr${i}"></small></label>`
  : `<label>${s.label} ${TAG(s.req)}<input type="text" class="txt" data-meta="${i}"><small class="ferr" id="merr${i}"></small></label>`).join('');

// 날짜 해석: 2026. 10. 20. / 2026-10-20 / 2026.10.20 / 20261020 → {y,m,d,text}, 실패하면 null
function parseDate(s) {
  const t = String(s ?? '').trim();
  const m = t.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d, text: `${y}. ${mo}. ${d}.`, iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, key: y * 10000 + mo * 100 + d };
}
const metaInputs = [...document.querySelectorAll('[data-meta]')];
const setMeta = (m = {}, demo = false) => metaInputs.forEach((el, i) => {
  el.value = m[META_LABELS[i]] ?? '';
  const pd = META_SPEC[i].date && parseDate(el.value);
  if (pd) el.value = pd.text;
  el.classList.toggle('demo', demo && !!el.value); metaState[META_LABELS[i]] = el.value;
  syncPicker(i);
});
function syncPicker(i) { const pk = document.querySelector(`[data-pick="${i}"]`); if (pk) pk.value = parseDate(metaInputs[i].value)?.iso ?? ''; }
// 예시(가안) 값은 칸을 클릭하는 순간 지워진다
metaInputs.forEach((el, i) => el.addEventListener('focus', () => {
  if (!el.classList.contains('demo')) return;
  el.value = ''; el.classList.remove('demo'); metaState[META_LABELS[i]] = ''; updateRequired();
}));

const recBody = $('rec').querySelector('tbody');

function addRecRow(d = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${recBody.rows.length + 1}</td><td><input type="text" inputmode="decimal" class="rct" autocomplete="off"></td>` +
    `<td><input type="text" inputmode="decimal" class="rsp bignum"></td><td class="num m"></td><td class="num p"></td>` +
    `<td><input type="text" inputmode="decimal" class="rm bignum"></td><td><input type="text" inputmode="decimal" class="rp" autocomplete="off"></td><td class="j"></td>`;
  recBody.appendChild(tr);
  tr.querySelector('.rct').value = nz(d.ct);
  tr.querySelector('.rsp').value = nz(d.spiked, S.spiked);
  tr.querySelector('.rm').value = nz(d.measured);
  tr.querySelector('.rp').value = nz(d.pct);
}

// 표준곡선 회귀 + 증폭효율. 희석단계 기준(x=0,−1,…)이면 효율은 희석 배수 기준으로 계산
function fitCurve(rows) {
  const xmode = $('xmode').value, fit = standardCurve(rows, xmode);
  if (xmode === 'dilution') fit.efficiency = (val($('fold')) ** (-1 / fit.slope) - 1) * 100;
  return fit;
}
const effOk = (e) => Number.isFinite(e) && e >= S.effMin && e <= S.effMax;

function readRows() {
  const stock = val($('stock')), fold = val($('fold')), nums = ctNums();
  return Array.from({ length: 5 }, (_, i) => ({ conc: stock / fold ** i, cts: nums[i] ?? [NaN, NaN, NaN] }));
}

function plot(rows, fit, xmode) {
  const pts = [];
  rows.forEach((r, i) => r.cts.forEach((c) => Number.isFinite(c) && pts.push([xmode === 'log' ? Math.log10(r.conc) : -i, c])));
  const svg = $('plot');
  if (pts.length < 2 || !Number.isFinite(fit.slope) || !Number.isFinite(fit.intercept)) { svg.innerHTML = ''; return; }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys) - 1, Math.max(...ys) + 1];
  const X = (x) => 50 + ((x - x0) / (x1 - x0 || 1)) * 520, Y = (y) => 270 - ((y - y0) / (y1 - y0)) * 240;
  svg.innerHTML =
    `<line x1="50" y1="270" x2="570" y2="270" stroke="currentColor" opacity=".3"/><line x1="50" y1="30" x2="50" y2="270" stroke="currentColor" opacity=".3"/>` +
    `<line x1="${X(x0)}" y1="${Y(fit.slope * x0 + fit.intercept)}" x2="${X(x1)}" y2="${Y(fit.slope * x1 + fit.intercept)}" stroke="var(--acc)" stroke-width="2"/>` +
    pts.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="4" fill="var(--bad)"/>`).join('') +
    `<text x="60" y="24" fill="currentColor" font-size="13">y = ${fmt(fit.slope)}x + ${fmt(fit.intercept)}  (R² = ${fmt(fit.r2, 4)})</text>`;
}

function judge(k, rep, calc, tol, d, expr = '') {
  const c = compare(rep, calc, tol);
  $('c' + k).innerHTML = fmt(calc, d) + (expr ? fxl(expr) : '');
  if ($('d' + k)) $('d' + k).textContent = Number.isFinite(c.diff) ? (c.diff > 0 ? '+' : '') + fixed(c.diff, d) : '–';
  $('j' + k).innerHTML = Number.isFinite(c.diff) ? badge(c.ok) : '';
}

function recalc() {
  syncConc();
  const xmode = $('xmode').value;
  const rows = readRows();
  const fit = fitCurve(rows);
  const ok = Number.isFinite(fit.slope);
  judge('S', val($('rS')), fit.slope, S.tolSlope, 3, ok && `${g(fit.sxy)} / ${g(fit.sxx)}`);
  judge('I', val($('rI')), fit.intercept, S.tolInter, 3, ok && `${g(fit.my)} − ${par(fit.slope)}×${g(fit.mx)}`);
  judge('R', val($('rR')), fit.r2, S.tolR2, 4, ok && `${g(fit.sxy)}² / (${g(fit.sxx)}×${g(fit.syy)})`);
  if (Number.isFinite(fit.slope)) {
    const inRange = fit.efficiency >= S.effMin && fit.efficiency <= S.effMax;
    const gz = (e) => Math.max(0, Math.min(100, (e - 60) / 70 * 100));   // 게이지 범위 60–130 %
    const gauge = `<div class="gauge" title="기준 ${S.effMin}–${S.effMax}%"><span class="zone" style="left:${gz(S.effMin)}%;width:${gz(S.effMax) - gz(S.effMin)}%"></span><span class="dot" style="left:${gz(fit.efficiency)}%"></span></div>`;
    $('keyres').innerHTML = [['Slope', fmt(fit.slope, 3), ''], ['Y-inter', fmt(fit.intercept, 3), ''], ['R²', fmt(fit.r2, 4), ''],
      ['Efficiency (E)', `${fmt(fit.efficiency, 1)} %`, `기준 ${S.effMin}–${S.effMax}% ${inRange ? '이내' : '벗어남'}`]]
      .map(([l, v, s], i) => `<div class="tile${i === 3 ? ` eff ${inRange ? 'good' : 'bad'}` : ''}"><span>${l}</span><b>${v}</b>${i === 3 ? gauge : ''}<small>${s}</small></div>`).join('');
    $('eff').innerHTML = `증폭효율(E) = ${fmt(fit.efficiency, 1)}% ${badge(inRange, '기준 내', '기준 밖')} (기준 ${S.effMin}–${S.effMax}%) · 데이터 ${fit.n}점` +
      fxl(`E = 10^(−1/${par(fit.slope)}) − 1 = ${g(10 ** (-1 / fit.slope), 4)} − 1 &nbsp;|&nbsp; x̄ = ${g(fit.mx)}, ȳ = ${g(fit.my)}, Σ(x−x̄)(y−ȳ) = ${g(fit.sxy)}, Σ(x−x̄)² = ${g(fit.sxx)}, Σ(y−ȳ)² = ${g(fit.syy)}`);
  } else { $('eff').textContent = ''; $('keyres').innerHTML = ''; }
  plot(rows, fit, xmode);

  // 회수율
  const curve = S.curveSrc === 'calc' ? fit : { slope: val($('rS')), intercept: val($('rI')) };
  const pcts = [];
  [...recBody.rows].forEach((tr) => {
    const ct = val(tr.querySelector('.rct')), spk = val(tr.querySelector('.rsp'));
    const m = tr.querySelector('.m'), p = tr.querySelector('.p'), j = tr.querySelector('.j');
    if (!Number.isFinite(ct) || !Number.isFinite(spk)) { m.textContent = p.textContent = j.innerHTML = ''; return; }
    const r = recovery(ct, curve, spk);
    pcts.push(r.pct);
    const e = (ct - curve.intercept) / curve.slope;
    m.innerHTML = f2(r.recovered) + `<small class="sci">${sci(r.recovered)}</small>` + fxl(`10^((${g(ct, 2)}−${par(curve.intercept, 3)})/${par(curve.slope, 3)}) = 10^${g(e)}`);
    p.innerHTML = fixed(r.pct, 2) + fxl(`${f2(r.recovered)} / ${spk.toLocaleString()} × 100`);
    const gm = val(tr.querySelector('.rm')), gp = val(tr.querySelector('.rp'));
    const checks = [];
    if (Number.isFinite(gm)) checks.push(Math.abs(gm - r.recovered) <= S.tolMeasured);
    if (Number.isFinite(gp)) checks.push(Math.abs(gp - r.pct) <= S.tolPct);
    j.innerHTML = checks.length ? badge(checks.every(Boolean)) : '';
  });
  if (pcts.length > 1) {
    const mn = mean(pcts), s = sd(pcts, S.sdMode === 'sample');
    const n = pcts.length, ss = pcts.reduce((a, v) => a + (v - mn) ** 2, 0), dn = S.sdMode === 'sample' ? n - 1 : n;
    $('cM').innerHTML = fixed(mn, 2) + fxl(`(${pcts.map((v) => g(v, 2)).join(' + ')}) / ${n}`);
    $('cD').innerHTML = fixed(s, 2) + fxl(`√(${g(ss)} / ${dn})`);
    $('cV').innerHTML = fixed(s / mn * 100, 2) + fxl(`${fixed(s, 2)} / ${fixed(mn, 2)} × 100`);
    const jj = (id, rid, c) => { const g = val($(rid)); $(id).innerHTML = Number.isFinite(g) ? badge(Math.abs(g - c) <= S.tolStat) : ''; };
    jj('jM', 'rM', +fixed(mn, 2)); jj('jD', 'rD', +fixed(s, 2)); jj('jV', 'rV', +fixed(s / mn * 100, 2));
  } else ['cM', 'cD', 'cV', 'jM', 'jD', 'jV'].forEach((i) => ($(i).innerHTML = ''));
  updateRequired();
  recalcPb();
  refreshNum();
}

// 필수 입력 점검: 비어 있는 필수 칸 표시 + 상단 요약
let reqProblems = [];
function updateRequired() {
  const probs = [], notes = [];
  const stockOk = val($('stock')) > 0;
  $('stock').classList.toggle('need', !stockOk);
  if (!stockOk) probs.push('원액 농도');
  // 입력 형식 점검: 숫자로 읽히지 않는 값(예: 18,65 · 18.65abc)은 조용히 무시하지 않고 빨갛게 표시 + 이유 안내
  const badList = [];
  const checkField = (el, label) => {
    const s = el.value.trim(), bad = s !== '' && !Number.isFinite(val(el));
    el.classList.toggle('bad', bad);
    if (bad) badList.push(`${label} '${s}' — ${explainInvalid(s)}`);
  };
  const stockDiff = stockOk && Math.abs(val($('stock')) - BASE_STOCK) > 1e-9;
  if (stockDiff) notes.push(`원액 농도가 기준값(${thousands(BASE_STOCK)})과 달라요 → Y 절편·측정값·회수율이 달라집니다`);
  $('stockNote').innerHTML = stockDiff
    ? `⚠ 기준값(<b>1.4×10<sup>6</sup></b> copies/µL, KDCA 기준)과 달라요. Y 절편과 정량값이 달라집니다. <button id="stockReset" type="button" style="padding:3px 12px;font-size:12px">기준값으로 되돌리기</button>`
    : '기준 원액 농도: <b>1.4×10<sup>6</sup> copies/µL</b> (KDCA 시트와 동일 · 희석 5단계는 1.4×10<sup>6</sup> → 1.4×10<sup>2</sup>)';
  checkField($('stock'), '원액 농도'); checkField($('spk'), 'Spiked 기본값');
  [...recBody.rows].forEach((tr, i) => [['.rct', 'Ct'], ['.rsp', 'Spiked'], ['.rm', '기재 측정값'], ['.rp', '기재 회수율']].forEach(([q, n]) => checkField(tr.querySelector(q), `회수율 ${i + 1}반복 ${n}`)));
  const raw = ctRaw(), nums = ctNums();
  raw.forEach((r, i) => r.forEach((s, j) => { if (s !== '' && !Number.isFinite(nums[i][j])) badList.push(`표준곡선 ${i + 1}단계 반복${j + 1} '${s}' — ${explainInvalid(s)}`); }));
  badList.slice(0, 3).forEach((m) => probs.push(`숫자 오류: ${m}`)); if (badList.length > 3) probs.push(`숫자 오류 외 ${badList.length - 3}건`);
  paintCt(raw, nums);
  const filled = nums.filter((r) => r.some(Number.isFinite));
  if (filled.length < 2) probs.push('표준곡선 Ct (최소 2단계, 권장 5단계×3반복)');
  else if (filled.length < 5) notes.push(`표준곡선이 ${filled.length}단계만 입력됨 (표준서식은 5단계)`);
  if (filled.some((r) => !r.every(Number.isFinite))) notes.push('일부 희석 단계의 반복이 비어 있음 (계산에서는 제외)');
  const rrows = [...recBody.rows].map((tr) => ({ ct: tr.querySelector('.rct'), sp: tr.querySelector('.rsp') }));
  rrows.forEach((r) => { r.ct.classList.toggle('need', !Number.isFinite(val(r.ct))); r.sp.classList.toggle('need', !(val(r.sp) > 0)); });
  const rc = rrows.filter((r) => Number.isFinite(val(r.ct)));
  if (!rc.length) probs.push('회수율 Ct (최소 1개, 권장 3반복)');
  if (rc.some((r) => !(val(r.sp) > 0))) probs.push('회수율 Spiked 농도');
  else if (rc.length && rc.length < 3) notes.push(`회수율이 ${rc.length}반복만 입력됨 (표준서식은 3반복)`);
  // 기관 정보는 모두 선택 항목. 날짜는 입력했다면 형식·순서 검증
  const ferr = (i, msg, warn = false) => { const e = $('merr' + i); if (e) { e.textContent = msg; e.className = warn ? 'ferr fwarn' : 'ferr'; } };
  META_SPEC.forEach((s, i) => ferr(i, ''));
  META_SPEC.forEach((s, i) => {
    metaInputs[i].classList.toggle('need', s.req && !metaInputs[i].value.trim());
    if (s.date && metaInputs[i].value.trim() && !parseDate(metaInputs[i].value)) {
      ferr(i, '날짜 형식이 올바르지 않습니다 (예: 2026. 10. 20.)'); probs.push(`${s.label} 날짜 형식 오류`);
    }
  });
  const dk = (l) => parseDate(metaState[l] || '')?.key;
  const [rcv, run, cal, sub] = ['패널 수령일', '검사 수행일', '유전자 증폭기 검증일 또는 보정일', '결과 제출일'].map(dk);
  const order = [[rcv, run, '검사 수행일', '패널 수령일보다 빠릅니다'], [run, sub, '결과 제출일', '검사 수행일보다 빠릅니다'], [cal, run, '검사 수행일', '증폭기 검증·보정일보다 빠릅니다']];
  order.forEach(([a, b, label, msg]) => { if (a && b && b < a) { ferr(META_LABELS.indexOf(label), `⚠ ${msg}`, true); notes.push(`${label}이(가) ${msg}`); } });
  reqProblems = probs;
  const warn = isDemo() ? `<br>${DEMO_WARN}` : '';
  $('reqStatus').innerHTML = (probs.length
    ? `${badge(false, '', `필수 입력 ${probs.length}건 남음`)} ${probs.join(' · ')}`
    : `${badge(true, '필수 입력 완료', '')} 선택 항목(결과서 기재값)을 입력하면 일치 여부를 비교합니다.`) +
    (notes.length ? `<br><span class="note">참고: ${notes.join(' · ')}</span>` : '') + (warn ? `<span style="color:var(--bad)">${warn}</span>` : '');
}

function applyData(d) {
  if (d.cts) setCtData(d.cts);
  const r = d.reported || {};
  $('rS').value = nz(r.slope); $('rI').value = nz(r.intercept); $('rR').value = nz(r.r2);
  recBody.innerHTML = '';
  (d.rec?.length ? d.rec : [{}, {}, {}]).forEach(addRecRow);
  const rs = d.recSummary || {};
  $('rM').value = nz(rs.mean); $('rD').value = nz(rs.sd); $('rV').value = nz(rs.rsd);
  recalc();
}

function syncSettingsToUi() {
  document.querySelectorAll('[data-k]').forEach((el) => (el.value = S[el.dataset.k]));
}

async function handleFile(file) {
  const msg = $('msg'); msg.textContent = '';
  if (!file) return;
  if (!/\.hwpx$/i.test(file.name)) { msg.innerHTML = badge(false, '', '.hwpx 파일만 지원합니다'); return; }
  try {
    const d = await parseHwpx(file);
    lastData = d;
    setMeta(d.meta);
    applyData(d);
    $('meta').textContent = Object.entries(d.meta).filter(([, v]) => v).map(([k, v]) => `${k.trim()}: ${v}`).join(' · ');
    const warn = d.cts.length !== 5 ? ` · 희석 단계가 ${d.cts.length}개로 읽혔습니다` : '';
    msg.textContent = `${file.name} 불러옴 — 표준곡선 ${d.cts.length}단계, 회수율 ${d.rec.length}반복${warn}`;
  } catch (e) { msg.innerHTML = badge(false, '', '읽기 실패') + ' ' + e.message; }
}

// ---- 회수율 표: 방향키 이동 / 엑셀 붙여넣기 ----
const GRID = '#ct input, #rec input, #pb input';
const inputsOf = (tr) => [...tr.querySelectorAll('input')];
function gridCell(el, dr, dc, create = false) {
  const tr = el.closest('tr'), tbody = tr.parentElement;
  const nr = [...tbody.rows].indexOf(tr) + dr, nc = inputsOf(tr).indexOf(el) + dc;
  if (nr < 0 || nc < 0) return null;
  if (nr >= tbody.rows.length) { if (!create || (tbody !== recBody && tbody !== pbBody)) return null; while (tbody.rows.length <= nr) (tbody === recBody ? addRecRow : addPbRow)({}); }
  return inputsOf(tbody.rows[nr])[nc] ?? null;
}
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el.matches?.(GRID) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey && e.key !== 'Enter') return;
  const go = (dr, dc) => { const t = gridCell(el, dr, dc); if (t) { e.preventDefault(); t.focus(); t.select(); } else if (dr || dc) e.preventDefault(); };
  if (e.key === 'ArrowDown') go(1, 0);
  else if (e.key === 'ArrowUp') go(-1, 0);
  else if (e.key === 'Enter') go(e.shiftKey ? -1 : 1, 0);
  else if (e.key === 'ArrowLeft' && el.selectionStart === 0) go(0, -1);
  else if (e.key === 'ArrowRight' && el.selectionEnd === el.value.length) go(0, 1);
});
function parseTable(text) {
  const lines = text.replace(/\r/g, '').split('\n'); while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const delim = text.includes('\t') ? '\t' : ',';
  return lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
}
// 붙여넣기 모양 변환: 토글이 켜져 있으면 행↔열 바꿈. 표준곡선 칸에 3×5(가로) 모양이 오면 5×3으로 자동 변환.
const transpose = (rows) => Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) }, (_, c) => rows.map((r) => r[c] ?? ''));
function reshapePaste(rows, toCt) {
  const h = rows.length, w = Math.max(0, ...rows.map((r) => r.length));
  let t = $('pasteT').checked, auto = false;
  if (!t && toCt && h === 3 && w === 5) { t = true; auto = true; }
  if (!t || (h < 2 && w < 2)) return { rows, note: '' };
  return { rows: transpose(rows), note: `↔ ${h}×${w} → ${w}×${h} 로 행·열을 바꿔 붙여넣었어요${auto ? ' (3×5 가로 모양이라 자동 변환)' : ''}` };
}
const pasteNote = (id, msg) => { const e = $(id); if (e) { e.textContent = msg; clearTimeout(pasteNote.t); if (msg) pasteNote.t = setTimeout(() => { e.textContent = ''; }, 8000); } };
document.addEventListener('paste', (e) => {
  const el = e.target;
  if (!el.matches?.(GRID)) return;
  const text = e.clipboardData?.getData('text') ?? '';
  if (!/[\t\n]/.test(text.trim())) return;       // 한 칸 값은 기본 동작
  e.preventDefault();
  const { rows, note } = reshapePaste(parseTable(text), !!el.closest('#ct'));
  rows.forEach((row, r) => row.forEach((v, c) => {
    const t = r || c ? gridCell(el, r, c, true) : el;
    if (t) { t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }
  }));
  pasteNote(el.closest('#ct') ? 'pasteMsg' : 'recPasteMsg', note);
});
// 스프레드시트 탭: 변환이 필요한 붙여넣기만 가로채서 직접 처리(그 외에는 라이브러리 기본 붙여넣기)
window.addEventListener('paste', (e) => {
  if ($('ctSheetBox').hidden || !ws) return;
  const t = e.target;
  if (t?.closest?.('input,textarea,select') && !t.closest('#ctSheetBox')) return;   // 다른 입력칸은 건드리지 않음
  const text = e.clipboardData?.getData('text') ?? '';
  if (!text.trim()) return;
  const { rows, note } = reshapePaste(parseTable(text), true);
  if (!note) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const sel = jspreadsheet.current?.selectedCell ?? ['2', '0'];
  const x0 = Math.max(2, +sel[0]), y0 = Math.max(0, +sel[1]);
  rows.forEach((row, r) => row.forEach((v, c) => { const x = x0 + c, y = y0 + r; if (x >= 2 && x <= 4 && y < 5) ctVals[y][x - 2] = String(v).trim(); }));
  renderSimple(); renderSheet(); recalc();
  pasteNote('pasteMsg', note);
}, true);

// ---- ① 표준곡선 Ct: 두 가지 입력 방식(간편 입력 / 스프레드시트)이 같은 데이터(ctVals)를 공유 ----
// 스프레드시트는 Jspreadsheet CE(MIT, public/vendor/jspreadsheet): 방향키·Enter·Tab 이동, 범위 선택, 복사/붙여넣기, 드래그 채우기 제공.
const CT_FILL = { empty: '#fff1cc', bad: '#fde0dc', ok: '#e6f6ec' };
const ctBody = $('ct').querySelector('tbody');
const ctVals = Array.from({ length: 5 }, () => ['', '', '']);   // 단일 원본 (문자열)
let ws = null, sheetBusy = false, paintCache = '';
const dilLabel = (i) => '10' + (i ? '⁻' + '¹²³⁴'[i - 1] : '⁰');
const concVal = (i) => val($('stock')) / val($('fold')) ** i;
const concText = (i) => { const c = concVal(i); return Number.isFinite(c) ? thousands(+fixed(c, 2)) : ''; };
const toNum = (s) => parseStrict(s);
const ctRaw = () => ctVals.map((r) => r.map((s) => String(s ?? '').trim()));
const ctNums = () => ctRaw().map((r) => r.map(toNum));
function buildCt() {
  ctBody.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="l"><b>10<sup>${i ? -i : 0}</sup></b></td><td class="num conc"></td>` +
      [0, 1, 2].map(() => '<td><input type="text" inputmode="decimal" class="ct" autocomplete="off"></td>').join('');
    ctBody.appendChild(tr);
  }
}
function renderSimple() { [...ctBody.rows].forEach((tr, i) => tr.querySelectorAll('.ct').forEach((el, j) => { el.value = ctVals[i][j]; })); }
function renderSheet() {
  if (!ws) return;
  sheetBusy = true; paintCache = '';
  ws.setData(Array.from({ length: 5 }, (_, i) => [dilLabel(i), concText(i), ...ctVals[i]]));
  sheetBusy = false;
}
function setCtData(m) {                       // m: 5×3 (숫자/문자/NaN)
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const v = m?.[i]?.[j]; ctVals[i][j] = Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : ''; }
  renderSimple(); renderSheet();
}
function syncConc() {                         // 원액 농도/희석 배수가 바뀌면 농도 열 갱신
  [...ctBody.rows].forEach((tr, i) => { const c = concVal(i); tr.querySelector('.conc').innerHTML = Number.isFinite(c) ? thousands(+fixed(c, 2)) + `<small class="sci">${sci(c)}</small>` : '–'; });
  if (!ws) return;
  sheetBusy = true;
  for (let i = 0; i < 5; i++) if (ws.getValueFromCoords(1, i) !== concText(i)) ws.setValueFromCoords(1, i, concText(i), true);
  sheetBusy = false;
}
function paintCt(raw, nums) {                 // 비어 있는 칸(노랑) / 숫자가 아닌 칸(빨강) / 정상
  [...ctBody.querySelectorAll('.ct')].forEach((el, k) => {
    const i = Math.floor(k / 3), j = k % 3, s = raw[i][j];
    el.classList.toggle('need', s === ''); el.classList.toggle('bad', s !== '' && !Number.isFinite(nums[i][j]));
  });
  if (!ws) return;
  const st = {}; let key = '';
  raw.forEach((r, i) => r.forEach((s, j) => {
    const c = s === '' ? 'empty' : Number.isFinite(nums[i][j]) ? 'ok' : 'bad';
    st['CDE'[j] + (i + 1)] = c; key += c[0];
  }));
  if (key === paintCache) return;
  paintCache = key;
  const o = {}; Object.entries(st).forEach(([k, c]) => { o[k] = `background-color: ${CT_FILL[c]};`; });
  ws.setStyle(o);
}
function initSheet() {                        // 스프레드시트 탭을 처음 열 때 생성
  if (ws) return;
  if (typeof jspreadsheet === 'undefined') { $('ctSheet').innerHTML = '<p class="note">스프레드시트 라이브러리를 불러오지 못했습니다. 새로고침하거나 간편 입력을 사용해 주세요.</p>'; return; }
  const col = (title, extra = {}) => ({ type: 'text', title, width: 120, align: 'right', ...extra });
  const r = jspreadsheet($('ctSheet'), {
    worksheets: [{
      data: Array.from({ length: 5 }, (_, i) => [dilLabel(i), concText(i), ...ctVals[i]]),
      columns: [col('희석', { width: 90, readOnly: true, align: 'center' }), col('농도 (copies/µL)', { width: 160, readOnly: true }), col('반복 1'), col('반복 2'), col('반복 3')],
      minDimensions: [5, 5], allowInsertRow: false, allowDeleteRow: false, allowInsertColumn: false, allowDeleteColumn: false,
      allowRenameColumn: false, allowComments: false, columnSorting: false, columnDrag: false, rowDrag: false, search: false, tableOverflow: false, wordWrap: false,
    }],
    toolbar: false,
    onafterchanges: () => {                   // 스프레드시트에서 편집 → 공유 데이터 + 간편 입력 갱신
      if (sheetBusy) return;
      const d = ws.getData();
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) ctVals[i][j] = String(d[i]?.[2 + j] ?? '').trim();
      renderSimple(); recalc();
    },
  });
  ws = Array.isArray(r) ? r[0] : r.worksheets?.[0] ?? r;
  paintCache = '';
}
function showCtMode(mode) {
  S.ctMode = mode; save(S);
  $('ctSimple').hidden = mode !== 'simple'; $('ctSheetBox').hidden = mode !== 'sheet';
  $('tabSimple').classList.toggle('on', mode === 'simple'); $('tabSheet').classList.toggle('on', mode === 'sheet');
  if (mode === 'sheet') { initSheet(); renderSheet(); }
}
const csvEsc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function downloadCsv() {
  const L = ['희석,농도 (copies/µL),반복 1,반복 2,반복 3'];
  ctVals.forEach((r, i) => L.push([`10^${i ? -i : 0}`, concVal(i), ...r].map(csvEsc).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'BCoV_표준곡선_Ct.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importCsv(file) {
  const rows = parseTable(await file.text().then((s) => s.replace(/^﻿/, '')))
    .map((c) => c.slice(-3)).filter((c) => c.length === 3 && c.some((x) => Number.isFinite(toNum(x)))).slice(0, 5);
  setCtData(rows.map((r) => r.map(toNum)));
  recalc();
  $('ctMsg').textContent = `${file.name} 불러옴 — ${rows.length}단계`;
}

// ---- 내보내기 / 미리보기 ----
// standard curve 그래프용 점/회귀 (계산한 표준곡선 기준)
function chartData() {
  const rows = readRows(), xmode = $('xmode').value;
  const fit = fitCurve(rows), points = [];
  rows.forEach((r, i) => r.cts.forEach((ct) => Number.isFinite(ct) && points.push([xmode === 'log' ? Math.log10(r.conc) : -i, ct])));
  return { fit, points, xLabel: xmode === 'log' ? 'Log10 concentration (copies/µL)' : 'Dilution step (10^-n)' };
}
async function chartFor() {
  const { fit, points, xLabel } = chartData();
  if (points.length < 2 || !Number.isFinite(fit.slope)) return null;
  return curvePng(points, fit, xLabel);
}
function chartDataUrl() {
  const { fit, points, xLabel } = chartData();
  if (points.length < 2 || !Number.isFinite(fit.slope)) return '';
  return drawStandardCurve(document.createElement('canvas'), points, fit, xLabel).toDataURL('image/png');
}

function computeExport() {
  const rows = readRows();
  const fit = fitCurve(rows);
  const rec = [];
  [...recBody.rows].forEach((tr) => {
    const ct = val(tr.querySelector('.rct')), spiked = val(tr.querySelector('.rsp'));
    if (!Number.isFinite(ct) || !Number.isFinite(spiked)) return;
    const r = recovery(ct, fit, spiked); // 내보내기는 항상 계산한 표준곡선 기준(일관성)
    rec.push({ ct, spiked, measured: r.recovered, pct: r.pct, row: [...recBody.rows].indexOf(tr) });
  });
  const p = rec.map((x) => x.pct);
  const m = p.length ? mean(p) : NaN, s = p.length > 1 ? sd(p, S.sdMode === 'sample') : NaN;
  return { cts: rows.map((r) => r.cts), slope: fit.slope, intercept: fit.intercept, r2: fit.r2, efficiency: fit.efficiency, rec, mean: m, sd: s, rsd: s / m * 100 };
}

// 내보내는 값 vs 결과서 기재값(입력칸) 불일치 판정 — 허용오차는 판정 기준 파라미터 사용
function reportedValues(ex) {
  return {
    slope: val($('rS')), intercept: val($('rI')), r2: val($('rR')),
    rec: ex.rec.map((x) => { const tr = recBody.rows[x.row]; return { measured: val(tr.querySelector('.rm')), pct: val(tr.querySelector('.rp')) }; }),
    mean: val($('rM')), sd: val($('rD')), rsd: val($('rV')),
  };
}
function computeFlags(ex) {
  const rep = reportedValues(ex);
  const bad = (r, c, tol) => Number.isFinite(r) && Number.isFinite(c) && Math.abs(r - c) > tol + 1e-9;
  const r2 = (v) => +fixed(v, 2);
  return {
    slope: bad(rep.slope, ex.slope, S.tolSlope), intercept: bad(rep.intercept, ex.intercept, S.tolInter), r2: bad(rep.r2, ex.r2, S.tolR2),
    rec: ex.rec.map((x, i) => ({ measured: bad(rep.rec[i].measured, x.measured, S.tolMeasured), pct: bad(rep.rec[i].pct, x.pct, S.tolPct) })),
    efficiency: Number.isFinite(ex.efficiency) && !effOk(ex.efficiency),
    mean: bad(rep.mean, r2(ex.mean), S.tolStat), sd: bad(rep.sd, r2(ex.sd), S.tolStat), rsd: bad(rep.rsd, r2(ex.rsd), S.tolStat),
  };
}

const n2 = (s) => parseStrict(s);
const SUP = { 0: '⁰', 1: '⁻¹', 2: '⁻²', 3: '⁻³', 4: '⁻⁴' };
// flag=true: 기재값과 불일치 → 빨간 굵은 글씨(+ 원본 값 취소선)
function cell(newS, old, flag, attrs = '') {
  const v = newS === '' ? '&nbsp;' : newS;
  if (!flag || old === undefined || !Number.isFinite(old)) return `<td ${attrs}>${v}</td>`;
  return `<td class="chg" ${attrs}><del>${old.toLocaleString('en-US', { maximumFractionDigits: 3 })}</del> <b>${v}</b></td>`;
}

async function renderPreview() {
  try { await ensureTemplate(); } catch (e) { $('pvNote').textContent = e.message; }
  const ex = computeExport(), f = formatForForm(ex), fl = computeFlags(ex), rv = reportedValues(ex);
  const diff = $('pvDiff').checked;
  const on = (b) => diff && b;
  const img = chartDataUrl();
  const m = (l) => esc(metaState[l] || '') || '&nbsp;';
  const year = ((metaState['결과 제출일'] || '').match(/\d{4}/) || [new Date().getFullYear()])[0];
  const labels = ['RNA 원액<sup>a</sup>', ...[1, 2, 3, 4].map((i) => `RNA 원액<sup>a</sup> × 10<sup>${SUP[i]}</sup>`)];
  const sideL = ['Slope', 'Y-inter', 'R<sup>2</sup>'];
  const effTxt = `Efficiency ${f.efficiency} %`;
  const effCell = !on(fl.efficiency) ? `<td colspan="2" rowspan="2"><b>${effTxt}</b></td>` : `<td class="chg" colspan="2" rowspan="2"><b>${effTxt}</b></td>`;
  const sideV = [cell(f.slope, rv.slope, on(fl.slope)), cell(f.intercept, rv.intercept, on(fl.intercept)), cell(f.r2, rv.r2, on(fl.r2))];
  const std = f.cts.map((r, i) => `<tr><th class="l">10<sup>${SUP[i]}</sup> (${labels[i]})</th>${r.map((s) => cell(s)).join('')}${i < 3 ? `<th>${sideL[i]}</th>${sideV[i]}` : i === 3 ? effCell : ''}</tr>`).join('');
  const n = f.rec.length;
  const rec = f.rec.map((x, i) => {
    const sum = i === 0 ? `${cell(f.mean, rv.mean, on(fl.mean), `rowspan="${n}"`)}${cell(f.sd, rv.sd, on(fl.sd), `rowspan="${n}"`)}${cell(f.rsd, rv.rsd, on(fl.rsd), `rowspan="${n}"`)}` : '';
    return `<tr><td>${i + 1}</td>${cell(x.ct)}${cell(x.spiked)}${cell(x.measured, rv.rec[i].measured, on(fl.rec[i].measured))}${cell(x.pct, rv.rec[i].pct, on(fl.rec[i].pct))}${sum}</tr>`;
  }).join('');
  $('pvBody').innerHTML = `<div class="paper"><div class="pg">
    <h1>${year}년도 하수 내 BCoV바이러스 실험실 검사 숙련도 평가 결과</h1>
    <table class="form"><tbody>
      <tr><th>기관명</th><td>${m('기관명')}</td><th>패널 수령일</th><td>${m('패널 수령일')}</td></tr>
      <tr><th>검사 수행일</th><td>${m('검사 수행일')}</td><th>검사 수행자</th><td>${m('검사 수행자')}</td></tr>
      <tr><th>유전자증폭기 모델명</th><td>${m('유전자증폭기모델명')}</td><th>유전자 증폭기 검증일 또는 보정일</th><td>${m('유전자 증폭기 검증일 또는 보정일')}</td></tr>
      <tr><th>결과 제출일</th><td colspan="3">${m('결과 제출일')}</td></tr>
    </tbody></table>
    <h2>1. 검사결과입력</h2>
    <p class="sec">① RT-qPCR standard curve (BCoV)</p>
    <table class="form"><thead>
      <tr><th rowspan="3">패널명</th><th colspan="5">검사결과</th></tr>
      <tr><th colspan="3">BCoV RNA 농도 (Ct 값)*</th><th colspan="2">BCoV RNA 표준 정량곡선</th></tr>
      <tr><th colspan="3">반복 수</th><th colspan="2"></th></tr>
      <tr><th>희석 배수</th><th>1</th><th>2</th><th>3</th><th colspan="2"></th></tr>
    </thead><tbody>${std}</tbody></table>
    <p class="fn">* Ct값은 소수점 둘째 자리까지 입력 바랍니다.<br><sup>a</sup> BCoV 용액(원액)에서 추출한 RNA를 희석하여 사용</p>
    <p class="sec">② BCoV 유전자 추출 회수율 분석 결과*</p>
    <table class="form"><thead><tr><th>반복 횟수</th><th>BCoV 유전자<br>검사 결과(Ct값)<sup>b</sup></th><th>하수 검체 BCoV 유전자 농도(spiked)<br>(copies Spiked / mL)</th><th>하수 검체 BCoV 유전자 농도(측정값)<br>(copies Recovered / mL)</th><th>BCoV 유전자<br>추출 회수율 (%)</th><th>평균값</th><th>표준편차<br>(SD)</th><th>상대표준편차*<br>(RSD)</th></tr></thead><tbody>${rec}</tbody></table>
    <p class="fn">* 상대표준편차 = (표준편차/평균값)*100<br><sup>b</sup> 하수 검체에 BCoV 용액(원액)을 첨가하여 제조한 하수 검체에서 추출한 RNA를 사용하여 Realtime PCR을 수행하여 얻은 검사 결과 Ct값</p>
    </div><div class="pg">
    <h2 style="margin-top:0">2. 유전자 증폭곡선 결과 그림 첨부</h2>
    <table class="form"><thead><tr><th colspan="2">유전자 증폭곡선 결과 그림</th></tr></thead><tbody><tr><th style="width:22%">구분</th><th>BCoV standard curve</th></tr><tr><th>BCoV standard curve(3반복)</th><td style="padding:6px">${img ? `<img class="curve" src="${img}" alt="BCoV standard curve">` : '(Ct 값을 입력하면 그래프가 표시됩니다)'}</td></tr></tbody></table>
  </div></div>`;
  $('pvNote').innerHTML = `서식: ${templateName()} · 값은 이 앱의 계산값(재계산)입니다. <b style="color:var(--bad)">빨간 굵은 글씨</b> = 결과서 기재값과 불일치(허용오차 초과)한 값이며, HWPX로 내보낼 때도 같은 표시가 들어갑니다. (기재값이 비어 있으면 비교하지 않습니다)`;
  if (isDemo()) $('pvNote').innerHTML += `<br><b style="color:var(--bad)">${DEMO_WARN}</b>`;
  if (reqProblems.length) $('pvNote').innerHTML += `<br><b style="color:var(--bad)">필수 입력 ${reqProblems.length}건 남음: ${reqProblems.join(' · ')}</b>`;
}

// PDF 다운로드: 미리보기 각 쪽(.pg)을 이미지로 캡처해 A4 PDF로 저장 (필요할 때만 라이브러리 로드)
const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('PDF 라이브러리 로드 실패 (네트워크 확인)'));
  document.head.appendChild(s);
});
// 미리보기 각 쪽(.pg)을 이미지로 캡처 (PNG·PDF 공통)
async function capturePages() {
  await loadScript('vendor/html2canvas/html2canvas.min.js');
  const pages = [...document.querySelectorAll('#pvBody .pg')];
  const out = [];
  // 화면(창·휴대폰) 크기와 상관없이 항상 A4 폭(794px)으로 그려서 PDF·PNG가 같은 모양이 되게 한다
  const fixLayout = (doc) => {
    const d = doc.getElementById('preview');
    if (d) d.style.cssText += ';position:static;display:block;width:900px;max-width:none;max-height:none;overflow:visible;padding:0;margin:0;border:0;box-shadow:none;';
    doc.querySelectorAll('#pvBody .pg').forEach((el) => { el.style.width = '794px'; el.style.maxWidth = 'none'; el.style.boxSizing = 'border-box'; el.style.margin = '0'; });
  };
  for (const p of pages) out.push(await window.html2canvas(p, { scale: 2, backgroundColor: '#fff', useCORS: true, windowWidth: 1000, onclone: fixLayout }));
  return out;
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// PNG 다운로드: 결과서 쪽들을 위→아래로 이어 붙인 한 장의 이미지
async function downloadPng() {
  const btn = $('pvPng'), old = btn.textContent;
  btn.disabled = true; btn.textContent = 'PNG 만드는 중…';
  try {
    const cvs = await capturePages();
    const gap = 40, W = Math.max(...cvs.map((c) => c.width)), H = cvs.reduce((s, c) => s + c.height, 0) + gap * (cvs.length + 1);
    const out = document.createElement('canvas'); out.width = W + gap * 2; out.height = H;
    const c = out.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height);
    let y = gap; cvs.forEach((cv) => { c.drawImage(cv, gap + (W - cv.width) / 2, y); y += cv.height + gap; });
    const blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('이미지 생성 실패'))), 'image/png'));
    saveBlob(blob, 'BCoV_숙련도평가_결과서.png');
  } catch (e) { $('pvNote').textContent = 'PNG 저장 실패: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
}
// ---- Probit 회귀 · LoD (C05 · C50 · C95): 농도별 시행 수·양성 수 → probit 회귀 ----
const pbBody = $('pb').querySelector('tbody');
const PB_SAMPLE = [1000, 100, 10, 1, 0.1].map((conc, i) => ({ conc, n: 25, k: [25, 22, 16, 6, 0][i] }));   // 예시(가상) 자료
function addPbRow(d = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = '<td><input type="text" inputmode="decimal" class="pbc" autocomplete="off"></td><td class="pbcalc pbx"></td>' +
    '<td><input type="text" inputmode="numeric" class="pbn" autocomplete="off"></td><td><input type="text" inputmode="numeric" class="pbk" autocomplete="off"></td><td class="pbcalc pbr"></td>';
  pbBody.appendChild(tr);
  [['.pbc', d.conc], ['.pbn', d.n], ['.pbk', d.k]].forEach(([q, v]) => { tr.querySelector(q).value = Number.isFinite(v) ? String(v) : ''; });
}
function setPb(rows) { pbBody.innerHTML = ''; (rows?.length ? rows : Array.from({ length: 5 }, () => ({}))).forEach(addPbRow); }
let pbLast = null, pbRows = [];
function recalcPb() {
  const unit = $('pbUnit').value.trim();
  $('pbU').textContent = unit ? `(${unit})` : '';
  const rows = [], badRaw = {};
  [...pbBody.rows].forEach((tr, i) => {
    const els = ['.pbc', '.pbn', '.pbk'].map((q) => tr.querySelector(q)), raw = els.map((e) => e.value.trim()), nums = els.map(val);
    const bi = raw.findIndex((s, j) => s !== '' && !Number.isFinite(nums[j]));
    if (bi >= 0) badRaw[i + 1] = `'${raw[bi]}' — ${explainInvalid(raw[bi])}`;
    els.forEach((e, j) => e.classList.toggle('bad', raw[j] !== '' && !Number.isFinite(nums[j])));
    tr.querySelector('.pbx').textContent = nums[0] > 0 ? fixed(Math.log10(nums[0]), 2) : '';
    tr.querySelector('.pbr').textContent = nums[1] > 0 && Number.isFinite(nums[2]) ? `${fixed(nums[2] / nums[1] * 100, 1)} %` : '';
    if (raw.some(Boolean)) rows.push({ conc: nums[0], n: nums[1], k: nums[2], rowNo: i + 1 });
  });
  const msgs = [], clear = () => { $('pbResult').hidden = true; $('pbTable').innerHTML = ''; $('pbTiles').innerHTML = ''; $('pbDetail').innerHTML = ''; $('pbPlot').innerHTML = ''; pbLast = null; };
  if (!rows.length) { $('pbMsgs').innerHTML = '<div class="note">자료를 입력하거나 <b>샘플 불러오기</b>를 눌러 보세요.</div>'; clear(); return; }
  const fit = probitFit(rows, { ci: $('pbCi').value });
  fit.dropped.forEach((d) => msgs.push(`<div class="pbwarn">${d.rowNo}행은 계산에서 제외했어요 — ${badRaw[d.rowNo] ?? d.reason}</div>`));
  if (!fit.ok) { msgs.push(`<div class="pberr">${fit.reason}</div>`); $('pbMsgs').innerHTML = msgs.join(''); clear(); return; }
  fit.warnings.forEach((w) => msgs.push(`<div class="pbwarn">⚠ ${w}</div>`));
  $('pbMsgs').innerHTML = msgs.join('');
  const u = unit ? ` ${unit}` : '';
  const tile = (lab, c, cls = '') => `<div class="tile ${cls}"><span>${lab} <small>(검출률 ${fixed(c.p * 100, 0)} %)</small></span><b>${fmtC(c.c)}</b><small>${c.bounded ? `95% 신뢰구간 ${fmtC(c.lo)} – ${fmtC(c.hi)}${u}` : '신뢰구간을 정할 수 없음'}</small></div>`;
  $('pbTiles').innerHTML = tile('C05', fit.C05) + tile('C50', fit.C50) + tile('C95', fit.C95, 'eff');
  const p3 = (p) => (p === null ? '–' : p < 0.001 ? '< 0.001' : fixed(p, 3));
  $('pbDetail').innerHTML = `probit(p) = <b>${fixed(fit.a, 3)}</b> + <b>${fixed(fit.b, 3)}</b> · log10(농도) &nbsp;·&nbsp; a SE ${fixed(fit.seA, 3)}, b SE ${fixed(fit.seB, 3)} (기울기 p ${p3(fit.pSlope)})<br>` +
    `적합도: 편차 ${fixed(fit.deviance, 2)} (자유도 ${fit.df}${fit.df > 0 ? `, p = ${p3(fit.pDev)}` : ''}), Pearson χ² ${fixed(fit.pearson, 2)}${fit.df > 0 ? ` (p = ${p3(fit.pPear)})` : ''} &nbsp;·&nbsp; 농도 수준 ${fit.used.length}개, 총 시행 ${fit.n}회, 반복 계산 ${fit.iter}회`;
  $('pbResult').hidden = false;
  $('pbPlot').innerHTML = plotSvg(fit, unit);
  const dt = doseTable(fit); $('pbTable').innerHTML = dt.html; pbRows = dt.rows;
  pbLast = fit;
}
async function pbPngSave() {
  const svg = $('pbPlot').querySelector('svg');
  if (!svg) { $('pbMsgs').insertAdjacentHTML('beforeend', '<div class="pbwarn">저장할 그래프가 없어요. 먼저 자료를 입력하세요.</div>'); return; }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = 1440; c.height = 880; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    saveBlob(await new Promise((res) => c.toBlob(res, 'image/png')), 'Probit_LoD.png');
  } finally { URL.revokeObjectURL(url); }
}
setPb();
const MENUS = {
  main: { panel: 'panelMain', btn: 'mtMain', hash: '', theme: '', icon: 'icoWater', color: '#0e8fa0', chip: 'BETA · 숙련도 평가 임시 사용', fx: true, topics: 'topicsMain' },
  probit: { panel: 'panelProbit', btn: 'mtProbit', hash: '#probit', theme: 'pbtheme', icon: 'icoProbit', color: '#5b4bd5', chip: 'BETA · 검출한계(LoD) 분석', fx: false, topics: 'topicsPb',
    title: 'Probit 분석기', sub: '농도별 검출(양성) 횟수만 넣으면 C05 · C50 · C95와 Dose-Response 그래프 · 표를 만들어 드려요.', doc: 'Probit 분석기', foot: 'Probit 분석 (LoD) — 농도별 검출률 · C05 / C50 / C95',
    beta: '<b>베타 테스트 버전</b>입니다. 검출한계(LoD) 분석 결과는 통계 소프트웨어(예: MedCalc, R)와 <b>교차 확인</b>한 뒤 사용해 주세요. 신뢰구간 계산 방식에 따라 값이 다를 수 있어요.',
    about: '농도별 검출(양성) 횟수로 <b>Probit 회귀 · 검출한계(LoD)</b>를 구하는 분석기. <b>C05 · C50 · C95</b>와 95% 신뢰구간, Dose-Response 그래프 · 표를 만들어요.', abeta: '베타 · 통계 소프트웨어와 교차 확인 권장' },
  eds: { panel: 'panelEds', btn: 'mtEds', hash: '#7500fast', theme: 'edstheme', icon: 'icoEds', color: '#d9480f', chip: 'BETA · 7500 Fast 결과 보기', fx: false, topics: 'topicsEds',
    title: '7500 Fast 결과 뷰어', sub: 'Applied Biosystems 7500 Fast의 .eds 결과 파일을 끌어다 놓으면 플레이트 · 증폭 곡선 · Ct 결과를 바로 보여드려요.', doc: '7500 Fast 결과 뷰어', foot: '7500 Fast 결과 뷰어 (.eds) — 플레이트 · 증폭 곡선 · Ct',
    beta: '<b>베타 테스트 버전</b>입니다. 장비 소프트웨어(7500 Software)의 화면·내보내기 값과 <b>대조해 확인</b>한 뒤 사용해 주세요. 파일은 이 브라우저 안에서만 읽어요.',
    about: 'Applied Biosystems <b>7500 Fast</b>가 저장한 <b>.eds</b> 결과 파일을 열어 플레이트 배치, 증폭 곡선, Ct 표를 보여주는 뷰어.', abeta: '베타 · 장비 소프트웨어와 대조 권장' },
};
function showMenu(m) {
  const cfg = MENUS[m] ?? MENUS.main; m = MENUS[m] ? m : 'main';
  showMenu.base ??= { title: [$('heroTitle').textContent, $('heroSub').textContent], beta: $('betaTxt').innerHTML, about: $('aboutTxt').innerHTML, abeta: $('aboutBeta').textContent, chip: $('betaChip').textContent };
  const B = showMenu.base;
  for (const [k, c] of Object.entries(MENUS)) { $(c.panel).hidden = k !== m; $(c.btn).classList.toggle('on', k === m); if (c.theme) document.body.classList.toggle(c.theme, k === m); $(c.icon).style.display = k === m ? '' : 'none'; if ($(c.topics)) $(c.topics).style.display = k === m ? '' : 'none'; }
  $('heroTitle').textContent = cfg.title ?? B.title[0]; $('heroSub').textContent = cfg.sub ?? B.title[1];
  $('fxChip').style.display = cfg.fx ? '' : 'none'; $('betaChip').textContent = cfg.chip;
  $('footName').hidden = m === 'main'; if (cfg.foot) $('footName').textContent = cfg.foot;
  $('betaTxt').innerHTML = cfg.beta ?? B.beta; $('aboutTxt').innerHTML = cfg.about ?? B.about; $('aboutBeta').textContent = cfg.abeta ?? B.abeta;
  $('themeColor').content = cfg.color; document.title = cfg.doc ?? B.title[0];
  try { history.replaceState(null, '', cfg.hash || location.pathname + location.search); } catch {}
}
$('mtMain').addEventListener('click', () => showMenu('main'));
$('mtEds').addEventListener('click', () => showMenu('eds'));
$('mtProbit').addEventListener('click', () => { showMenu('probit'); recalcPb(); });
$('pbCi').addEventListener('change', recalc);
const pbTsv = (sep) => ['Probability', 'Dose', '95% CI lower', '95% CI upper'].join(sep) + '\n' + pbRows.map(([p, c]) => [p.toFixed(3), c.c, c.bounded ? c.lo : '', c.bounded ? c.hi : ''].join(sep)).join('\n');
$('pbCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(pbTsv('\t')); $('pbCopy').textContent = '✅ 복사됨'; setTimeout(() => { $('pbCopy').textContent = '📋 표 복사'; }, 1500); } catch { $('pbCopy').textContent = '복사 실패'; } });
$('pbCsv').addEventListener('click', () => saveBlob(new Blob(['\ufeff' + pbTsv(',')], { type: 'text/csv;charset=utf-8' }), 'Probit_dose_response.csv'));
if (location.hash === '#probit') showMenu('probit'); else if (location.hash === '#7500fast') showMenu('eds');
initEds({ $, saveBlob });

// 엑셀 계산 시트: 현재 입력값이 채워진, 수식이 살아 있는 .xlsx (매크로 없음)
function excelState() {
  return {
    version: VERSION, stock: val($('stock')), fold: val($('fold')), xmode: $('xmode').value,
    ct: ctNums(),
    reported: { slope: val($('rS')), intercept: val($('rI')), r2: val($('rR')) },
    tol: { slope: S.tolSlope, inter: S.tolInter, r2: S.tolR2, measured: S.tolMeasured, pct: S.tolPct, stat: S.tolStat },
    eff: { min: S.effMin, max: S.effMax }, curveSrc: S.curveSrc, sdMode: S.sdMode, spiked: S.spiked,
    rec: [...recBody.rows].map((tr) => ({ ct: val(tr.querySelector('.rct')), spiked: val(tr.querySelector('.rsp')), measured: val(tr.querySelector('.rm')), pct: val(tr.querySelector('.rp')) })),
    repSummary: { mean: val($('rM')), sd: val($('rD')), rsd: val($('rV')) },
  };
}
async function downloadXlsx() {
  const msg = $('expmsg');
  try {
    const blob = await buildWorkbook(window.JSZip, excelState());
    saveBlob(blob, 'BCoV_검증_엑셀.xlsx');
    msg.textContent = 'BCoV_검증_엑셀.xlsx 저장됨 · 수식이 살아 있는 엑셀 파일이에요(매크로 없음). 녹색 칸을 고치면 결과가 바로 다시 계산돼요.';
  } catch (e) { msg.innerHTML = badge(false, '', '엑셀 만들기 실패') + ' ' + e.message; }
}
// 표준곡선 그래프만 PNG로 저장 (2074×1212)
function downloadPlotPng() {
  const url = chartDataUrl();
  if (!url) { $('ctMsg').textContent = 'Ct 값을 2단계 이상 입력하면 그래프를 저장할 수 있어요.'; return; }
  const a = document.createElement('a'); a.href = url; a.download = 'BCoV_standard_curve.png'; a.click();
}

async function downloadPdf() {
  const btn = $('pvPdf'), old = btn.textContent;
  btn.disabled = true; btn.textContent = 'PDF 만드는 중…';
  try {
    await loadScript('vendor/jspdf/jspdf.umd.min.js');
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const cvs = await capturePages();
    for (let i = 0; i < cvs.length; i++) {
      const cv = cvs[i];
      const maxW = 190, maxH = 277;
      let w = maxW, h = (cv.height / cv.width) * w;
      if (h > maxH) { h = maxH; w = (cv.width / cv.height) * h; }
      if (i) pdf.addPage();
      pdf.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', 10 + (maxW - w) / 2, 10, w, h);
    }
    pdf.save('BCoV_숙련도평가_결과서.pdf');
  } catch (e) { $('pvNote').textContent = 'PDF 저장 실패: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
}

async function doExport() {
  const msg = $('expmsg');
  if (reqProblems.length) { msg.innerHTML = badge(false, '', '내보내기 불가') + ' 필수 입력을 먼저 채워주세요: ' + reqProblems.join(' · '); return; }
  try {
    const ex = computeExport();
    const { blob, filename, skipped } = await exportHwpx({ ...formatForForm(ex), chartPng: await chartFor(ex), flags: computeFlags(ex) }, metaState);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    msg.textContent = `${filename} 저장됨` + (skipped.length ? ` · 채우지 못한 칸: ${skipped.join(', ')}` : '') + (isDemo() ? ` · ${DEMO_WARN}` : '');
  } catch (e) { msg.innerHTML = badge(false, '', '내보내기 실패') + ' ' + e.message; }
}

// 이벤트
syncSettingsToUi(); buildCt(); showCtMode(S.ctMode);
const applyFx = () => document.body.classList.toggle('nofx', !S.showFx);
$('fxToggle').checked = S.showFx; applyFx();
$('pasteT').checked = !!S.pasteT;
$('pasteT').addEventListener('change', (e) => { S.pasteT = e.target.checked; save(S); });
$('fxToggle').addEventListener('change', (e) => { S.showFx = e.target.checked; save(S); applyFx(); });
$('tabSimple').addEventListener('click', () => { showCtMode('simple'); recalc(); });
$('tabSheet').addEventListener('click', () => { showCtMode('sheet'); recalc(); });
metaInputs.forEach((el, i) => el.addEventListener('blur', () => {   // 직접 입력한 날짜를 표준 형식으로 정리
  const pd = META_SPEC[i].date && parseDate(el.value);
  if (pd && el.value !== pd.text) { el.value = pd.text; metaState[META_LABELS[i]] = pd.text; }
  syncPicker(i); updateRequired();
}));
document.addEventListener('input', (e) => {
  if (e.target.dataset?.pick !== undefined) {                      // 달력에서 날짜 선택
    const i = +e.target.dataset.pick, pd = parseDate(e.target.value);
    if (pd) { metaInputs[i].value = pd.text; metaInputs[i].classList.remove('demo'); metaState[META_LABELS[i]] = pd.text; }
    updateRequired(); return;
  }
  if (e.target.dataset?.meta !== undefined) { e.target.classList.remove('demo'); metaState[META_LABELS[e.target.dataset.meta]] = e.target.value; updateRequired(); return; }
  if (e.target.classList?.contains('ct')) {                        // 간편 입력 → 공유 데이터 + 스프레드시트 동기화
    const n = [...ctBody.querySelectorAll('.ct')].indexOf(e.target), i = Math.floor(n / 3), j = n % 3;
    ctVals[i][j] = e.target.value;
    if (ws) { sheetBusy = true; ws.setValueFromCoords(2 + j, i, e.target.value, true); sheetBusy = false; }
  }
  const k = e.target.dataset?.k;
  if (k) {
    S[k] = e.target.tagName === 'SELECT' && isNaN(+e.target.value) ? e.target.value : parseStrict(e.target.value);
    if (!Number.isFinite(S[k]) && typeof DEFAULTS[k] === 'number') S[k] = DEFAULTS[k];
    save(S);
  }
  recalc();
});
$('sample').addEventListener('click', () => { $('stock').value = SAMPLE.stock; S.stock = SAMPLE.stock; lastData = SAMPLE; applyData(SAMPLE); });
$('addrow').addEventListener('click', () => { addRecRow(); recalc(); });
$('reset').addEventListener('click', () => { S = reset(); syncSettingsToUi(); recalc(); });
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

$('ctCsv').addEventListener('click', downloadCsv);
$('ctCsvIn').addEventListener('click', () => $('ctFile').click());
$('ctFile').addEventListener('change', (e) => { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ''; });
$('btnPreview').addEventListener('click', async () => { await renderPreview(); $('preview').showModal(); });
$('pvClose').addEventListener('click', () => $('preview').close());
$('pvDiff').addEventListener('change', renderPreview);
$('pvPrint').addEventListener('click', () => window.print());
$('pvPdf').addEventListener('click', downloadPdf);
$('pvPng').addEventListener('click', downloadPng);
$('plotPng').addEventListener('click', downloadPlotPng);
$('btnXlsx').addEventListener('click', downloadXlsx);
document.addEventListener('click', (e) => { if (e.target.id === 'stockReset') { const s = $('stock'); s.value = String(BASE_STOCK); s.dispatchEvent(new Event('input', { bubbles: true })); refreshNum(); } });
$('btnExport').addEventListener('click', doExport);
$('pvExport').addEventListener('click', doExport);

// 정보 창 (제작자 · 라이선스 · 서드파티 · 변경 이력)
$('ver').textContent = `v${VERSION}`;
$('aboutTitle').textContent = `하수 PCR 검증기 v${VERSION} (베타)`;
async function showDoc(name) {
  $('aboutDoc').textContent = '불러오는 중…';
  try { const r = await fetch(name, { cache: 'no-cache' }); $('aboutDoc').textContent = r.ok ? await r.text() : `${name}을 불러오지 못했습니다`; }
  catch { $('aboutDoc').textContent = `${name}을 불러오지 못했습니다`; }
}
$('aboutOpen').addEventListener('click', (e) => { e.preventDefault(); $('about').showModal(); showDoc('THIRD_PARTY_NOTICES.md'); });
$('aboutClose').addEventListener('click', () => $('about').close());
document.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => showDoc(b.dataset.doc)));

setMeta(DEMO_META, true);
$('metaDemo').addEventListener('click', () => { setMeta(DEMO_META, true); recalc(); });
$('metaClear').addEventListener('click', () => { setMeta({}); recalc(); });
applyData({ rec: [{}, {}, {}] });
recalc();

// Firebase(Analytics)는 실패해도 검증 기능에 영향이 없도록 지연 로드
// 웹 사이트에서만 Firebase(Analytics) 로드. 로컬 실행(exe/127.0.0.1)에서는 외부 통신을 하지 않는다.
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
if (!LOCAL) import("./firebase.js").catch(() => {});
// 데모 열기: ?demo=1 → 샘플 데이터로 채움 (&view=preview 미리보기, &view=sheet 스프레드시트 탭). README 스크린샷·시연용
{
  const q = new URLSearchParams(location.search);
  if (q.get('demo')) {
    $('sample').click(); setPb(PB_SAMPLE); recalc(); if (location.hash === '#probit') showMenu('probit');
    if (q.get('view') === 'preview') setTimeout(() => $('btnPreview').click(), 300);
    if (q.get('view') === 'sheet') $('tabSheet').click();
  }
}
// 오른쪽 사이드 패널(About · Releases · 받을 수 있는 파일)
const openChangelog = () => { $('about').showModal(); showDoc('CHANGELOG.md'); };
initSidePanel({ local: location.hostname === '127.0.0.1', openChangelog }).catch(() => {});   // 127.0.0.1 = exe 실행
$('sideChangelog').addEventListener('click', openChangelog);
$('dlXlsx').addEventListener('click', () => $('btnXlsx').click());
$('dlReport').addEventListener('click', () => $('btnPreview').click());
$('dlCsv').addEventListener('click', downloadCsv);
$('dlPlot').addEventListener('click', downloadPlotPng);
$('pbSample').addEventListener('click', () => { setPb(PB_SAMPLE); recalc(); });
$('pbAdd').addEventListener('click', () => { addPbRow({}); recalc(); });
$('pbClear').addEventListener('click', () => { setPb(); recalc(); });
$('pbPng').addEventListener('click', pbPngSave);
$('dlPb').addEventListener('click', pbPngSave);
// exe(로컬 서버) 모드: 브라우저 탭이 열려 있는 동안 신호를 보내고, 마지막 탭을 닫으면 서버가 스스로 종료된다.
if (LOCAL && location.protocol === 'http:') {
  const tabId = Math.random().toString(36).slice(2, 12);
  const ping = () => fetch('/__ping?id=' + tabId, { cache: 'no-store' }).catch(() => {});
  ping(); setInterval(ping, 5000); document.addEventListener('visibilitychange', ping);
  window.addEventListener('pagehide', () => navigator.sendBeacon?.('/__bye?id=' + tabId));
}
