// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// HWPX(zip + XML) 결과서에서 표준곡선/회수율 표를 읽어낸다. JSZip 필요(전역 JSZip).
import { parseStrict, fixed } from './num.js';
const NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

const num = (s) => {
  return parseStrict(s);
};

function cellMap(tbl) {
  const m = new Map();
  for (const tc of tbl.getElementsByTagNameNS(NS, 'tc')) {
    const a = tc.getElementsByTagNameNS(NS, 'cellAddr')[0];
    if (!a) continue;
    const text = [...tc.getElementsByTagNameNS(NS, 't')].map((t) => t.textContent).join('').trim();
    m.set(`${a.getAttribute('rowAddr')},${a.getAttribute('colAddr')}`, text);
  }
  return m;
}

export function parseSection(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('section XML 파싱 실패');
  // 표 안에 표가 없는 leaf 표만 사용
  const leaves = [...doc.getElementsByTagNameNS(NS, 'tbl')].filter((t) => t.getElementsByTagNameNS(NS, 'tbl').length === 0);
  const out = { meta: {}, cts: null, reported: {}, rec: [], recSummary: {} };

  for (const tbl of leaves) {
    const m = cellMap(tbl);
    const g = (r, c) => m.get(`${r},${c}`) ?? '';
    const rows = Math.max(...[...m.keys()].map((k) => +k.split(',')[0])) + 1;

    // 메타 정보 (라벨/값이 2칸씩 반복되는 표)
    if (!out.cts && [...m.values()].some((v) => v.includes('기관명'))) {
      for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < 4; c += 2) {
        if (g(r, c)) out.meta[g(r, c)] = g(r, c + 1);
      }
    }
    // 표준곡선 표
    if ([...m.values()].includes('Slope')) {
      const cts = [];
      for (let r = 0; r < rows; r++) {
        if (/^10/.test(g(r, 0)) && m.has(`${r},1`)) cts.push([1, 2, 3].map((c) => num(g(r, c))));
        const label = g(r, 4).replace(/\s/g, '').toLowerCase();
        if (label === 'slope') out.reported.slope = num(g(r, 5));
        if (label === 'y-inter') out.reported.intercept = num(g(r, 5));
        if (label === 'r2') out.reported.r2 = num(g(r, 5));
      }
      out.cts = cts;
    }
    // 회수율 표
    if ([...m.values()].some((v) => v.startsWith('반복 횟수'))) {
      for (let r = 1; r < rows; r++) {
        if (!(num(g(r, 0)) >= 1)) continue;
        out.rec.push({ ct: num(g(r, 1)), spiked: num(g(r, 2)), measured: num(g(r, 3)), pct: num(g(r, 4)) });
      }
      out.recSummary = { mean: num(g(1, 5)), sd: num(g(1, 6)), rsd: num(g(1, 7)) };
    }
  }
  if (!out.cts) throw new Error('표준곡선 표(Slope)를 찾지 못했습니다');
  return out;
}

// ---- 내보내기용: 업로드한 원본을 서식(template)으로 보관 ----
let tpl = null;
export const hasTemplate = () => !!tpl;
export const templateName = () => (tpl ? (tpl.standard ? '표준서식 (template.hwpx)' : tpl.name) : '');
export const META_LABELS = ['기관명', '패널 수령일', '검사 수행일', '검사 수행자', '유전자증폭기모델명', '유전자 증폭기 검증일 또는 보정일', '결과 제출일'];

// 업로드된 서식이 없으면 표준서식(template.hwpx)을 사용
export async function ensureTemplate() {
  if (tpl) return;
  if (typeof JSZip === 'undefined') throw new Error('JSZip 로드 실패 (네트워크 확인)');
  const res = await fetch('template.hwpx', { cache: 'no-cache' });
  if (!res.ok) throw new Error('표준서식(template.hwpx)을 불러오지 못했습니다');
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const section = 'Contents/section0.xml';
  tpl = { zip, name: 'template.hwpx', section, xml: await zip.file(section).async('string'), standard: true };
}

const fmt = (v, d) => fixed(v, d);
const fmtComma = (v, d) => { const s = fixed(v, d); if (!s) return ''; const [i, f] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); };

// 계산 결과 → 결과서에 적을 문자열
export function formatForForm(v) {
  return {
    cts: v.cts.map((r) => r.map((x) => fmt(x, 2))),
    slope: fmt(v.slope, 3), intercept: fmt(v.intercept, 3), r2: fmt(v.r2, 3), efficiency: fmt(v.efficiency, 1),
    rec: v.rec.map((r) => ({ ct: fmt(r.ct, 2), spiked: fmtComma(r.spiked, 0), measured: fmtComma(r.measured, 2), pct: fmt(r.pct, 2) })),
    mean: fmt(v.mean, 2), sd: fmt(v.sd, 2), rsd: fmt(v.rsd, 2),
  };
}

function tablesWithCells(doc) {
  const leaves = [...doc.getElementsByTagNameNS(NS, 'tbl')].filter((t) => t.getElementsByTagNameNS(NS, 'tbl').length === 0);
  const res = { std: null, rec: null };
  for (const tbl of leaves) {
    const els = new Map(), txt = new Map();
    for (const tc of tbl.getElementsByTagNameNS(NS, 'tc')) {
      const a = tc.getElementsByTagNameNS(NS, 'cellAddr')[0];
      if (!a) continue;
      const k = `${a.getAttribute('rowAddr')},${a.getAttribute('colAddr')}`;
      els.set(k, tc);
      txt.set(k, [...tc.getElementsByTagNameNS(NS, 't')].map((x) => x.textContent).join('').trim());
    }
    const vals = [...txt.values()];
    const rows = Math.max(...[...els.keys()].map((k) => +k.split(',')[0])) + 1;
    const o = { els, txt, rows };
    if (vals.includes('Slope')) res.std = o;
    if (vals.some((x) => x.startsWith('반복 횟수'))) res.rec = o;
  }
  return res;
}

function setCell(tc, text) {
  const ts = tc.getElementsByTagNameNS(NS, 't');
  if (!ts.length) return false;
  ts[0].textContent = text;
  for (let i = 1; i < ts.length; i++) ts[i].textContent = '';
  return true;
}

// f = formatForForm(...) 결과. 반환: { blob, filename, skipped }
// f.flags: 기재값과 불일치하는 칸 → 빨간색 굵은 글자 모양으로 기록
// f.chartPng: Uint8Array(PNG) — 서식에 BinData/image1.png(그래프 자리)가 있으면 교체
export async function exportHwpx(f, meta = {}) {
  await ensureTemplate();
  const doc = new DOMParser().parseFromString(tpl.xml, 'application/xml');
  const { std, rec } = tablesWithCells(doc);
  if (!std) throw new Error('서식에서 표준곡선 표를 찾지 못했습니다');
  const skipped = [];
  const flags = f.flags || {};

  // 불일치 칸용 글자 모양: 기존 글자 모양을 복제해 빨간색 + 굵게 (header.xml)
  const HH = 'http://www.hancom.co.kr/hwpml/2011/head';
  tpl.headerXml ??= await tpl.zip.file('Contents/header.xml').async('string'); // 원본 보관(내보낼 때마다 새로 시작)
  const hdoc = new DOMParser().parseFromString(tpl.headerXml, 'application/xml');
  const cps = hdoc.getElementsByTagNameNS(HH, 'charProperties')[0];
  const redOf = new Map();
  let usedRed = false;
  const redStyle = (id) => {
    if (redOf.has(id)) return redOf.get(id);
    const all = [...cps.getElementsByTagNameNS(HH, 'charPr')];
    const src = all.find((e) => e.getAttribute('id') === id);
    if (!src) return id;
    const nc = src.cloneNode(true);
    const nid = String(Math.max(...all.map((e) => +e.getAttribute('id'))) + 1);
    nc.setAttribute('id', nid); nc.setAttribute('textColor', '#FF0000');
    if (!nc.getElementsByTagNameNS(HH, 'bold').length) {
      const b = hdoc.createElementNS(HH, 'hh:bold');
      const u = nc.getElementsByTagNameNS(HH, 'underline')[0];
      u ? nc.insertBefore(b, u) : nc.appendChild(b);
    }
    cps.appendChild(nc);
    cps.setAttribute('itemCnt', String(all.length + 1));
    redOf.set(id, nid); usedRed = true;
    return nid;
  };
  const markRed = (tc) => {
    const t = tc.getElementsByTagNameNS(NS, 't')[0];
    const run = t?.parentNode;
    if (run?.getAttribute?.('charPrIDRef') != null) run.setAttribute('charPrIDRef', redStyle(run.getAttribute('charPrIDRef')));
  };

  // 기관 정보 표: 라벨 칸 오른쪽의 값 칸에 기록
  for (const tbl of [...doc.getElementsByTagNameNS(NS, 'tbl')].filter((t) => t.getElementsByTagNameNS(NS, 'tbl').length === 0)) {
    const lab = new Map();
    for (const tc of tbl.getElementsByTagNameNS(NS, 'tc')) {
      const a = tc.getElementsByTagNameNS(NS, 'cellAddr')[0];
      lab.set(`${a.getAttribute('rowAddr')},${a.getAttribute('colAddr')}`, tc);
    }
    const text = (tc) => [...tc.getElementsByTagNameNS(NS, 't')].map((x) => x.textContent).join('').trim();
    if (![...lab.values()].some((tc) => text(tc) === '기관명')) continue;
    for (const [k, tc] of lab) {
      const [r, c] = k.split(',').map(Number), name = text(tc);
      const v = meta[name];
      if (v === undefined || v === '') continue;
      const vt = lab.get(`${r},${c + 1}`);
      if (!vt || !setCell(vt, v)) skipped.push(name);
    }
  }
  const put = (tbl, r, c, s, what, flag = false) => {
    const tc = tbl.els.get(`${r},${c}`);
    if (!tc || !setCell(tc, s)) skipped.push(what);
    else if (flag) markRed(tc);
  };
  let di = 0;
  for (let r = 0; r < std.rows; r++) {
    if (/^10/.test(std.txt.get(`${r},0`) ?? '') && std.els.has(`${r},1`)) {
      f.cts[di]?.forEach((s, j) => s !== '' && put(std, r, 1 + j, s, `Ct ${di + 1}-${j + 1}`));
      di++;
    }
    const label = (std.txt.get(`${r},4`) ?? '').replace(/\s/g, '').toLowerCase();
    if (label === 'slope') put(std, r, 5, f.slope, 'Slope', flags.slope);
    if (label === 'y-inter') put(std, r, 5, f.intercept, 'Y-inter', flags.intercept);
    if (label === 'r2') put(std, r, 5, f.r2, 'R2', flags.r2);
    if (label === '-' || label.startsWith('efficiency')) put(std, r, 4, `Efficiency ${f.efficiency} %`, 'Efficiency', flags.efficiency);
  }
  if (rec) {
    let k = 0;
    for (let r = 1; r < rec.rows; r++) {
      if (!(num(rec.txt.get(`${r},0`)) >= 1)) continue;
      const x = f.rec[k++];
      if (!x) continue;
      put(rec, r, 1, x.ct, `회수율 ${k} Ct`); put(rec, r, 2, x.spiked, `회수율 ${k} Spiked`);
      put(rec, r, 3, x.measured, `회수율 ${k} 측정값`, flags.rec?.[k - 1]?.measured); put(rec, r, 4, x.pct, `회수율 ${k} 회수율`, flags.rec?.[k - 1]?.pct);
    }
    if (k < f.rec.length) skipped.push(`회수율 반복 ${f.rec.length - k}개 (서식에 칸 없음)`);
    put(rec, 1, 5, f.mean, '평균', flags.mean); put(rec, 1, 6, f.sd, 'SD', flags.sd); put(rec, 1, 7, f.rsd, 'RSD', flags.rsd);
  }
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + xml;
  const zip = tpl.zip;
  const nf = { createFolders: false }; // 폴더 항목을 따로 만들지 않음 (원본 구조 유지)
  zip.file(tpl.section, xml, nf);
  let hxml = usedRed ? new XMLSerializer().serializeToString(hdoc) : tpl.headerXml;
  if (!hxml.startsWith('<?xml')) hxml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + hxml;
  zip.file('Contents/header.xml', hxml, nf);
  if (f.chartPng && zip.file('BinData/image1.png')) zip.file('BinData/image1.png', f.chartPng, nf);
  zip.file('mimetype', 'application/hwp+zip', { ...nf, compression: 'STORE' });
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
  return { blob, filename: tpl.standard ? 'BCoV_숙련도평가_결과서.hwpx' : tpl.name.replace(/\.hwpx$/i, '') + '_검증.hwpx', skipped };
}

export async function parseHwpx(file) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip 로드 실패 (네트워크 확인)');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort();
  if (!names.length) throw new Error('HWPX 형식이 아닙니다 (Contents/section*.xml 없음)');
  let last;
  for (const n of names) {
    try {
      const xml = await zip.file(n).async('string');
      const data = parseSection(xml);
      tpl = { zip, name: file.name, section: n, xml };
      return data;
    } catch (e) { last = e; }
  }
  throw last;
}
