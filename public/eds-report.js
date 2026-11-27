// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 7500FAST 결과 보고서: 하나의 "문서 모델"을 만들고, 미리보기(HTML 쪽들)와 HWPX 두 곳에서 같이 쓴다.
// 문서 모델 블록: title / sub / h / p / fx / kv / table / img / pb

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(2));
const fT = (v) => (v === null || v === undefined ? '–' : v < 100 ? String(+v.toPrecision(4)) : Math.round(v).toLocaleString('en-US'));
const when = (ms) => (ms ? new Date(ms).toLocaleString('ko-KR', { hour12: false }) : '–');
const STAGE = { PRE_CYCLING: '사전 변성', CYCLING: '증폭', HOLD: '유지', MELT_CURVE: '융해' };
const sci = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toExponential(2));

// o: { fileName, version, program, thr: {검출기: 사용자 임계값}, user: Set, curves, now: Date, wellValue: 'ct'|'mean'|'sd' }
export function buildModel(data, o) {
  const B = [], i = data.info, p = data.protocol, u = o.user ?? new Set();
  const dets = data.detectors, tg = dets.filter((d) => data.reads.some((r) => r.target === d.name));
  const thrOf = (d) => (o.thr?.[d.name] ?? d.threshold);
  B.push({ t: 'title', text: '7500 Fast 결과 보고서' });
  B.push({ t: 'sub', text: i.name || o.fileName || '' });
  B.push({ t: 'p', small: true, center: true, text: `원본 파일: ${o.fileName || '–'}  ·  생성: ${o.program} 7500FAST v${o.version}  ·  ${(o.now ?? new Date()).toLocaleString('ko-KR', { hour12: false })}` });

  B.push({ t: 'h', text: '1. 실험 정보' });
  const kv = [['실험 이름', i.name], ['설명', i.description], ['실험 종류', i.type], ['장비', i.instrument === 'sds7500fast' ? 'Applied Biosystems 7500 Fast' : i.instrument],
    ['실행자', i.operator], ['상태', i.state], ['시작', when(i.start)], ['종료', when(i.end)], ['반응 부피', p.volume ? `${p.volume} µL` : ''], ['플레이트', `${i.rows} × ${i.cols} (${i.rows * i.cols}웰)`],
    ['웰', `${new Set(data.reads.map((r) => r.idx)).size}웰`], ['결과 건수', `${data.reads.length}건`]].filter((r) => r[1]);
  B.push({ t: 'kv', rows: kv });

  B.push({ t: 'h', text: '2. PCR 프로그램' });
  const steps = [];
  for (const s of p.stages) s.steps.forEach((t, k) => steps.push([k === 0 ? STAGE[s.flag] ?? s.flag : '', k === 0 ? `×${s.reps}` : '', t.temp !== null ? `${t.temp}` : '', t.hold >= 60 && t.hold % 60 === 0 ? `${t.hold / 60}분` : `${t.hold}초`, t.collect ? '●' : '']));
  B.push({ t: 'table', head: ['단계', '반복', '온도 (°C)', '시간', '형광 측정'], rows: steps, widths: [3, 2, 2, 2, 2] });

  B.push({ t: 'h', text: '3. 검출기 (표적유전자) 설정' });
  B.push({ t: 'table', head: ['표적유전자', '형광 다이', '소광체', '장비 임계값', '사용한 임계값', '방식', '베이스라인', '웰 수', '검출'],
    rows: dets.map((d) => { const rs = data.reads.filter((r) => r.target === d.name); return [d.name, d.reporter, d.quencher, fT(d.threshold), u.has(d.name) ? `${fT(thrOf(d))} (직접 지정)` : fT(d.threshold), d.autoCt === null ? '–' : d.autoCt ? 'Auto' : 'Manual', d.baseStart === null ? '–' : `${d.baseStart}–${d.baseStop}`, String(rs.length), String(rs.filter((r) => r.detected).length)]; }),
    widths: [2.2, 1.6, 1.4, 2, 2.6, 1.4, 1.8, 1.2, 1.2] });
  if (u.size) B.push({ t: 'p', small: true, text: '※ 직접 지정한 임계값으로 이 프로그램이 ΔRn을 로그 선형 보간해 Ct를 다시 계산했어요. 장비 소프트웨어와 방법이 달라 0.1~0.5 사이클 정도 차이가 날 수 있어요.' });

  if (o.images?.plot) {
    B.push({ t: 'h', text: '4. 증폭 곡선' });
    B.push({ t: 'img', id: 'plot', caption: `ΔRn vs Cycle (점선 = 임계값${u.size ? ', 직접 지정 포함' : ''})` });
    B.push({ t: 'fx', lines: ['ΔRn = Rn − 베이스라인  (Rn = 리포터 형광 ÷ 참조 형광)', 'Ct = ΔRn이 임계값 T를 처음 넘는 사이클  (T를 직접 바꾸면 Ct = n + (ln T − ln ΔRn[n]) / (ln ΔRn[n+1] − ln ΔRn[n]) 로 다시 계산)'] });
  }

  B.push({ t: 'h', text: '5. 플레이트 배치' });
  const byIdx = new Map(data.reads.map((r) => [r.idx, r.sample])); for (const [k, v] of data.layout) if (!byIdx.has(k)) byIdx.set(k, v);
  const prow = [];
  for (let r = 0; r < i.rows; r++) prow.push([String.fromCharCode(65 + r), ...Array.from({ length: i.cols }, (_, c) => byIdx.get(r * i.cols + c) ?? '')]);
  B.push({ t: 'table', head: ['', ...Array.from({ length: i.cols }, (_, c) => String(c + 1))], rows: prow, widths: [0.7, ...Array(i.cols).fill(1.6)], small: true });

  B.push({ t: 'h', text: '6. 웰 × 표적 결과 (Ct)' });
  const wellRows = [], byWell = new Map();
  for (const r of data.reads) (byWell.get(r.idx) ?? byWell.set(r.idx, []).get(r.idx)).push(r);
  for (const [, g] of [...byWell.entries()].sort((a, b) => a[0] - b[0])) wellRows.push([g[0].well, g[0].sample, ...tg.map((d) => { const r = g.find((x) => x.target === d.name); return !r ? '' : r.detected ? f2(r.ct) : 'Undetermined'; })]);
  B.push({ t: 'table', head: ['Well', 'Sample', ...tg.map((d) => `${d.name} (${d.reporter})`)], rows: wellRows, widths: [1.2, 2, ...tg.map(() => 2)] });
  B.push({ t: 'fx', lines: ['Undetermined = 40 사이클 안에 임계값을 넘지 못함 (Ct 40.0)'] });

  B.push({ t: 'h', text: '7. 시료 × 표적 요약 (평균 Ct)' });
  const sm = new Map();
  for (const r of data.reads) { const k = r.sample + '\u0000' + r.target, x = sm.get(k) ?? { n: 0, v: [] }; x.n++; if (r.detected) x.v.push(r.ct); sm.set(k, x); }
  const names = [...new Set(data.reads.map((r) => r.sample))];
  B.push({ t: 'table', head: ['Sample', ...tg.map((d) => d.name)], rows: names.map((s) => [s, ...tg.map((d) => { const x = sm.get(s + '\u0000' + d.name); if (!x) return ''; if (!x.v.length) return `ND (0/${x.n})`; const m = x.v.reduce((a, b) => a + b, 0) / x.v.length, sd = x.v.length > 1 ? Math.sqrt(x.v.reduce((a, b) => a + (b - m) ** 2, 0) / (x.v.length - 1)) : null; return `${f2(m)}${sd !== null ? ` ± ${f2(sd)}` : ''} (${x.v.length}/${x.n})`; })]), widths: [2, ...tg.map(() => 2.4)] });
  B.push({ t: 'fx', lines: ['평균 Ct = ΣCt ÷ n,   SD = √( Σ(Ct − 평균)² ÷ (n − 1) )   (검출된 반복만, 표본 표준편차) ·  (검출 수/반복 수)'] });

  let sec = 8;
  if (o.curves?.length) {
    B.push({ t: 'h', text: `${sec++}. 표준곡선 정량` });
    B.push({ t: 'table', head: ['표적유전자', 'Slope', 'Y-intercept', 'R²', 'Efficiency (%)', '표준 점'], rows: o.curves.map((c) => [c.target, c.slope.toFixed(3), c.intercept.toFixed(3), c.r2.toFixed(4), c.efficiency.toFixed(1), `${c.n}개 (${c.levels}단계)`]), widths: [2, 1.6, 1.8, 1.6, 2, 2] });
    B.push({ t: 'fx', lines: o.curves.flatMap((c) => [`${c.target}:  Ct = ${c.slope.toFixed(3)} × log10(Q) + ${c.intercept.toFixed(3)}`, `Efficiency = (10^(−1/slope) − 1) × 100 = (10^(−1/${c.slope.toFixed(3)}) − 1) × 100 = ${c.efficiency.toFixed(1)} %`]).concat(['Quantity = 10^((Ct − intercept) ÷ slope)']) });
    const qrows = data.reads.filter((r) => o.curves.some((c) => c.target === r.target) && !/^STANDARD$/i.test(r.task2)).map((r) => [r.well, r.sample, r.target, r.detected ? f2(r.ct) : 'Undetermined', r.detected ? sci(r.calcQty) : '', sci(r.qty)]);
    B.push({ t: 'table', head: ['Well', 'Sample', 'Target', 'Ct', '계산 Quantity', '장비 Quantity'], rows: qrows, widths: [1.2, 2, 2, 1.6, 2.2, 2.2] });
  }
  B.push({ t: 'h', text: `${sec}. 안내` });
  B.push({ t: 'p', small: true, text: `이 보고서는 ${o.program}의 7500FAST 탭이 .eds 파일에서 읽어 자동으로 만들었어요. 베타 소프트웨어이므로 장비 소프트웨어(7500 Software)의 화면·내보내기 값과 대조해 확인한 뒤 사용해 주세요.` });
  return B;
}

// ---------- HTML 쪽들 ----------
const weight = (b) => ({ title: 3, sub: 2, h: 2.2, p: 1.6, fx: 1.3 * (b.lines?.length ?? 1) + 0.4, kv: Math.ceil(b.rows?.length / 2) * 1.4 + 0.5, img: 17, table: 0 }[b.t] ?? 0);
const cellHtml = (c) => (/^Undetermined|^ND/.test(c) ? `<i style="color:#666">${esc(c)}</i>` : esc(c));
function tableHtml(b, rows) {
  const tot = b.widths?.reduce((a, c) => a + c, 0);
  const col = (k) => (tot ? ` style="width:${((b.widths[k] / tot) * 100).toFixed(1)}%"` : '');
  return `<table class="form"${b.small ? ' style="font-size:10px"' : ''}><thead><tr>${b.head.map((h, k) => `<th${col(k)}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export function renderPages(model, images = {}) {
  const pages = []; let cur = '', used = 0; const CAP = 52;
  const flush = () => { if (cur) pages.push(`<div class="pg">${cur}</div>`); cur = ''; used = 0; };
  const add = (html, w) => { if (used + w > CAP && used > 0) flush(); cur += html; used += w; };
  for (const b of model) {
    if (b.t === 'pb') { flush(); continue; }
    if (b.t === 'title') add(`<h1>${esc(b.text)}</h1>`, weight(b));
    else if (b.t === 'sub') add(`<p style="text-align:center;font-weight:700;margin:-6px 0 4px">${esc(b.text)}</p>`, weight(b));
    else if (b.t === 'h') { if (used + 8 > CAP) flush(); add(`<p class="sec">${esc(b.text)}</p>`, weight(b)); }
    else if (b.t === 'p') add(`<p class="fn"${b.center ? ' style="text-align:center"' : ''}>${esc(b.text)}</p>`, weight(b));
    else if (b.t === 'fx') add(`<p class="fn">${b.lines.map(esc).join('<br>')}</p>`, weight(b));
    else if (b.t === 'kv') {
      let h = '<table class="form"><tbody>';
      for (let k = 0; k < b.rows.length; k += 2) { const a = b.rows[k], c = b.rows[k + 1]; h += `<tr><th class="l" style="width:16%">${esc(a[0])}</th><td style="text-align:left">${esc(a[1])}</td>${c ? `<th class="l" style="width:16%">${esc(c[0])}</th><td style="text-align:left">${esc(c[1])}</td>` : '<td></td><td></td>'}</tr>`; }
      add(h + '</tbody></table>', weight(b));
    } else if (b.t === 'img') {
      const src = images[b.id]?.dataUrl;
      if (src) add(`<img class="curve" src="${src}" alt="${esc(b.caption ?? '')}">${b.caption ? `<p class="fn" style="text-align:center">${esc(b.caption)}</p>` : ''}`, weight(b));
    } else if (b.t === 'table') {
      let rows = b.rows.slice();
      if (!rows.length) { add(tableHtml(b, []), 3); continue; }
      while (rows.length) {
        const room = Math.max(3, Math.floor((CAP - used - 1.5) / (b.small ? 1.5 : 1.25)));
        if (room < 4 && used > 0) { flush(); continue; }
        const part = rows.splice(0, room);
        add(tableHtml(b, part), part.length * (b.small ? 1.5 : 1.25) + 1.5);
        if (rows.length) flush();
      }
    }
  }
  flush();
  return pages;
}

// ---------- HWPX ----------
const X = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const HH = 'http://www.hancom.co.kr/hwpml/2011/head', HC = 'http://www.hancom.co.kr/hwpml/2011/core';
const TEXT_W = 48190; // A4 세로, 좌우 여백 5669 를 뺀 본문 폭 (HWPUNIT)

export async function buildHwpx(model, images, { JSZip, templateUrl = 'template.hwpx', program = 'HeavelyLab(LabPhobia)' } = {}) {
  const res = await fetch(templateUrl); if (!res.ok) throw new Error('서식(template.hwpx)을 불러오지 못했어요');
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  let hxml = await zip.file('Contents/header.xml').async('string');
  const hdoc = new DOMParser().parseFromString(hxml, 'application/xml');
  const cps = hdoc.getElementsByTagNameNS(HH, 'charProperties')[0], bfs = hdoc.getElementsByTagNameNS(HH, 'borderFills')[0];
  const allCp = () => [...cps.getElementsByTagNameNS(HH, 'charPr')];
  const cpCache = new Map();
  const cp = (h, bold) => { // 글자 크기(1/100 pt)와 굵기로 글자 모양을 복제해 쓴다
    const k = `${h}|${bold ? 1 : 0}`; if (cpCache.has(k)) return cpCache.get(k);
    const all = allCp(), src = all.find((e) => e.getAttribute('id') === '3'), nc = src.cloneNode(true), id = String(Math.max(...all.map((e) => +e.getAttribute('id'))) + 1);
    nc.setAttribute('id', id); nc.setAttribute('height', String(h));
    if (bold && !nc.getElementsByTagNameNS(HH, 'bold').length) { const b = hdoc.createElementNS(HH, 'hh:bold'), un = nc.getElementsByTagNameNS(HH, 'underline')[0]; un ? nc.insertBefore(b, un) : nc.appendChild(b); }
    cps.appendChild(nc); cps.setAttribute('itemCnt', String(all.length + 1)); cpCache.set(k, id); return id;
  };
  // 머리글 칸용 회색 바탕 테두리(표준 서식의 3번 테두리 + 회색)
  const bAll = [...bfs.getElementsByTagNameNS(HH, 'borderFill')], b3 = bAll.find((e) => e.getAttribute('id') === '3'), gray = b3.cloneNode(true), grayId = String(Math.max(...bAll.map((e) => +e.getAttribute('id'))) + 1);
  gray.setAttribute('id', grayId);
  const fb = hdoc.createElementNS(HC, 'hc:fillBrush'), wb = hdoc.createElementNS(HC, 'hc:winBrush'); wb.setAttribute('faceColor', '#EDEDED'); wb.setAttribute('hatchColor', '#FF000000'); wb.setAttribute('alpha', '0'); fb.appendChild(wb); gray.appendChild(fb);
  bfs.appendChild(gray); bfs.setAttribute('itemCnt', String(bAll.length + 1));
  const PCENTER = 13, PLEFT = 14, PCELL = 15;

  const para = (text, { c, pr = PLEFT, brk = false } = {}) => `<hp:p id="2147483648" paraPrIDRef="${pr}" styleIDRef="0" pageBreak="${brk ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="${c}"><hp:t>${X(text)}</hp:t></hp:run></hp:p>`;
  const cell = (text, col, row, w, hgt, { head, c, left }) => `<hp:tc name="" header="${head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${head ? grayId : 3}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${para(text, { c, pr: left ? PLEFT : PCELL })}</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${w}" height="${hgt}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  let tblId = 1300000000;
  const table = (head, rows, widths, { small, leftCols = [] } = {}) => {
    const n = head.length, tot = widths.reduce((a, b) => a + b, 0), W = widths.map((w) => Math.round((w / tot) * TEXT_W)); W[n - 1] += TEXT_W - W.reduce((a, b) => a + b, 0);
    const fs = small ? 800 : 900, rowH = small ? 1500 : 1700, cB = cp(fs, true), cN = cp(fs, false);
    const all = [head, ...rows];
    const trs = all.map((r, ri) => `<hp:tr>${r.map((v, ci) => cell(v, ci, ri, W[ci], rowH, { head: ri === 0, c: ri === 0 ? cB : cN, left: ri > 0 && leftCols.includes(ci) })).join('')}</hp:tr>`).join('');
    return `<hp:p id="2147483648" paraPrIDRef="${PCENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cN}"><hp:tbl id="${tblId++}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${all.length}" colCnt="${n}" cellSpacing="0" borderFillIDRef="3" noAdjust="0"><hp:sz width="${TEXT_W}" widthRelTo="ABSOLUTE" height="${all.length * rowH}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="140" right="140" top="140" bottom="140"/><hp:inMargin left="141" right="141" top="141" bottom="141"/>${trs}</hp:tbl><hp:t/></hp:run></hp:p>`;
  };
  const spacer = () => para('', { c: cp(600, false), pr: PLEFT });
  const picXml = (idx, wU, hU, cap) => `<hp:p id="2147483648" paraPrIDRef="${PCENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${cp(900, false)}"><hp:pic id="${1500000000 + idx}" zOrder="${idx}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${1600000000 + idx}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${wU}" height="${hU}"/><hp:curSz width="${wU}" height="${hU}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(wU / 2)}" centerY="${Math.round(hU / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${wU}" y="0"/><hc:pt2 x="${wU}" y="${hU}"/><hc:pt3 x="0" y="${hU}"/></hp:imgRect><hp:imgClip left="0" right="${wU}" top="0" bottom="${hU}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${wU}" dimheight="${hU}"/><hc:img binaryItemIDRef="image${idx}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="${wU}" widthRelTo="ABSOLUTE" height="${hU}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>${X(cap)}</hp:shapeComment></hp:pic><hp:t/></hp:run></hp:p>`;

  // 본문
  const sec0 = await zip.file('Contents/section0.xml').async('string');
  const open = /^[\s\S]*?<hs:sec [^>]*>/.exec(sec0)[0], secRun = /<hp:run charPrIDRef="\d+"><hp:secPr[\s\S]*?<\/hp:secPr>[\s\S]*?<\/hp:run>/.exec(sec0)[0];
  const first = model.find((b) => b.t === 'title');
  let body = `<hp:p id="0" paraPrIDRef="${PCENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${secRun}<hp:run charPrIDRef="${cp(1600, true)}"><hp:t>${X(first?.text ?? '')}</hp:t></hp:run></hp:p>`;
  const bins = []; let imgIdx = 1;
  for (const b of model) {
    if (b === first) continue;
    if (b.t === 'sub') body += para(b.text, { c: cp(1100, true), pr: PCENTER });
    else if (b.t === 'h') body += spacer() + para(b.text, { c: cp(1100, true) });
    else if (b.t === 'p') body += para(b.text, { c: cp(900, false), pr: b.center ? PCENTER : PLEFT });
    else if (b.t === 'fx') b.lines.forEach((l) => { body += para(l, { c: cp(850, false) }); });
    else if (b.t === 'kv') {
      const rows = []; for (let k = 0; k < b.rows.length; k += 2) { const a = b.rows[k], c = b.rows[k + 1]; rows.push([a[0], a[1], c?.[0] ?? '', c?.[1] ?? '']); }
      body += table(['항목', '값', '항목', '값'], rows, [1.4, 3, 1.4, 3], { leftCols: [1, 3] });
    } else if (b.t === 'table') body += table(b.head, b.rows.length ? b.rows : [b.head.map(() => '')], b.widths ?? b.head.map(() => 1), { small: b.small });
    else if (b.t === 'img') {
      const im = images[b.id]; if (!im?.png) continue;
      const wU = 42000, hU = Math.round((wU * im.h) / im.w); const idx = imgIdx++;
      bins.push({ idx, png: im.png }); body += picXml(idx, wU, hU, b.caption ?? '') + (b.caption ? para(b.caption, { c: cp(850, false), pr: PCENTER }) : '');
    }
  }
  let xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n` + open.replace(/^<\?xml[^>]*\?>\s*/, '') + body + '</hs:sec>';
  const nf = { createFolders: false };
  zip.file('Contents/section0.xml', xml, nf);
  let hout = new XMLSerializer().serializeToString(hdoc); if (!hout.startsWith('<?xml')) hout = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + hout;
  zip.file('Contents/header.xml', hout, nf);
  // 그림: BinData/imageN.png + 목록(content.hpf) 갱신. 서식에 있던 image1 은 그림이 없으면 그대로 둔다.
  let hpf = await zip.file('Contents/content.hpf').async('string');
  for (const b of bins) { zip.file(`BinData/image${b.idx}.png`, b.png, nf); if (b.idx > 1) hpf = hpf.replace('</opf:manifest>', `<opf:item id="image${b.idx}" href="BinData/image${b.idx}.png" media-type="image/png" isEmbeded="1"/></opf:manifest>`); }
  hpf = hpf.replace(/<opf:title[^>]*>[\s\S]*?<\/opf:title>/, `<opf:title xml:space="preserve">${X(first?.text ?? '7500 Fast 결과 보고서')} - ${X(program)}</opf:title>`);
  zip.file('Contents/content.hpf', hpf, nf);
  zip.file('Preview/PrvText.txt', `${first?.text ?? ''}\n${program}`, nf);
  zip.file('mimetype', 'application/hwp+zip', { ...nf, compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
}
