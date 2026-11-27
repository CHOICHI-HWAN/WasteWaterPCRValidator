// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 현재 입력값을 "수식이 살아 있는" 엑셀 통합 문서(.xlsx)로 만든다. (매크로/VBA 없음 — 모든 계산은 엑셀 수식)
// JSZip 생성자를 인자로 받으므로 브라우저(전역 JSZip)와 Node 검증 모두에서 쓸 수 있다.
//   buildWorkbook(JSZip, state, { cache: true }) → Promise<Blob|Uint8Array>
//   cache=false 이면 수식 결과(캐시 값)를 넣지 않는다 → 엑셀/LibreOffice가 직접 계산해야 하므로 수식 검증용.
import { standardCurve, recovery, mean, sd } from './calc.js';
import { fixed } from './num.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const addr = (r, c) => `${col(c)}${r}`;
const fin = Number.isFinite;

// ===== 색상 팔레트 (웹 앱과 같은 "맑은 물" 톤) =====
const C = { teal: '0E8FA0', blue: '2F80ED', ink: '14313B', mut: '6A8590', line: 'D5E4EA', soft: 'E3F4F7', softer: 'F4FAFB', mint: 'EAF8F0', mintLine: 'A9DDC2', warn: 'FFF4D6', warnInk: '7A5A00', white: 'FFFFFF' };

// ===== 스타일 등록기: 스타일 객체 → cellXfs 번호 (중복 제거) =====
class StyleBook {
  constructor() { this.fonts = []; this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']; this.borders = []; this.numFmts = new Map(); this.xfs = []; this.keys = new Map(); this.font({}); this.border(null); this.get({}); }
  _idx(arr, xml) { let i = arr.indexOf(xml); if (i < 0) { arr.push(xml); i = arr.length - 1; } return i; }
  font({ sz = 10, b, i, color = C.ink } = {}) { return this._idx(this.fonts, `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/><color rgb="FF${color}"/><name val="맑은 고딕"/><family val="2"/></font>`); }
  fill(rgb) { return rgb ? this._idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`) : 0; }
  border(spec) {   // spec: null | {all:rgb} | {bottom:rgb} | {top:rgb} ...
    const side = (n) => (spec && spec[n] ? `<${n} style="thin"><color rgb="FF${spec[n]}"/></${n}>` : `<${n}/>`);
    const a = spec?.all; const s = a ? { left: a, right: a, top: a, bottom: a, ...spec } : spec;
    const side2 = (n) => (s && s[n] ? `<${n} style="${s.thick === n ? 'medium' : 'thin'}"><color rgb="FF${s[n]}"/></${n}>` : `<${n}/>`);
    return this._idx(this.borders, `<border>${side2('left')}${side2('right')}${side2('top')}${side2('bottom')}<diagonal/></border>`);
  }
  fmt(code) { if (!code) return 0; const builtin = { '0.00': 2, '#,##0': 3, '#,##0.00': 4 }; if (builtin[code]) return builtin[code]; if (!this.numFmts.has(code)) this.numFmts.set(code, 164 + this.numFmts.size); return this.numFmts.get(code); }
  get(o = {}) {
    const key = JSON.stringify(o); if (this.keys.has(key)) return this.keys.get(key);
    const f = this.font(o.font), fl = this.fill(o.fill), b = this.border(o.border), nf = this.fmt(o.fmt);
    const al = (o.h || o.v || o.wrap || o.indent) ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''} vertical="${o.v || 'center'}"${o.wrap ? ' wrapText="1"' : ''}${o.indent ? ` indent="${o.indent}"` : ''}/>` : '<alignment vertical="center"/>';
    const xml = `<xf numFmtId="${nf}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`;
    this.xfs.push(xml); const id = this.xfs.length - 1; this.keys.set(key, id); return id;
  }
  xml() {
    const nf = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf ? `<numFmts count="${this.numFmts.size}">${nf}</numFmts>` : ''}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="2"><dxf><font><b/><color rgb="FF12804A"/></font><fill><patternFill><bgColor rgb="FFE3F6EC"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FFC0362C"/></font><fill><patternFill><bgColor rgb="FFFDECEB"/></patternFill></fill></dxf></dxfs></styleSheet>`;
  }
}

export async function buildWorkbook(JSZipCtor, st, opt = {}) {
  const cache = opt.cache !== false;
  const sb = new StyleBook();
  const cells = new Map(), merges = [], rowH = new Map();
  const put = (r, c, o) => cells.set(`${r},${c}`, { r, c, ...o });
  const txt = (r, c, v, s) => put(r, c, { kind: 'str', v, s });
  const num = (r, c, v, s) => put(r, c, fin(v) ? { kind: 'num', v, s } : { kind: 'blank', s });
  const fnum = (r, c, f, v, s) => put(r, c, { kind: fin(v) ? 'fnum' : 'fstr', f, v: fin(v) ? v : '', s });
  const fstr = (r, c, f, v, s) => put(r, c, { kind: 'fstr', f, v, s });
  const blank = (r, c, s) => put(r, c, { kind: 'blank', s });
  const merge = (r1, c1, r2, c2, s) => { merges.push(`${addr(r1, c1)}:${addr(r2, c2)}`); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!cells.has(`${r},${c}`)) blank(r, c, s); };

  // ---- 스타일 ----
  const LN = { all: C.line };
  const X = {
    banner: sb.get({ font: { sz: 22, b: true, color: C.white }, fill: C.teal, h: 'left', indent: 1 }),
    bannerSub: sb.get({ font: { sz: 10, color: 'DFF4F7' }, fill: C.teal, h: 'left', indent: 1 }),
    bannerFill: sb.get({ fill: C.teal }),
    notice: sb.get({ font: { sz: 9, color: C.warnInk }, fill: C.warn, h: 'left', indent: 1, wrap: true }),
    section: sb.get({ font: { sz: 11, b: true, color: C.white }, fill: C.teal, h: 'left', indent: 1 }),
    sub: sb.get({ font: { sz: 10, b: true, color: C.teal }, border: { bottom: C.teal }, h: 'left' }),
    head: sb.get({ font: { b: true, color: C.ink }, fill: C.soft, border: LN, h: 'center', wrap: true }),
    label: sb.get({ font: { b: true, color: C.ink }, fill: C.softer, border: LN, h: 'left', indent: 1 }),
    cText: sb.get({ border: LN, h: 'center' }),
    c0: sb.get({ border: LN, fmt: '#,##0' }), c2: sb.get({ border: LN, fmt: '0.00' }), c2n: sb.get({ border: LN, fmt: '#,##0.00' }),
    c3: sb.get({ border: LN, fmt: '0.000' }), c4: sb.get({ border: LN, fmt: '0.0000' }), cG: sb.get({ border: LN, h: 'center' }),
    inNum: sb.get({ fill: C.mint, border: { all: C.mintLine }, fmt: '0.00' }),
    inGen: sb.get({ fill: C.mint, border: { all: C.mintLine } }),
    inInt: sb.get({ fill: C.mint, border: { all: C.mintLine }, fmt: '#,##0' }),
    inTxt: sb.get({ fill: C.mint, border: { all: C.mintLine }, h: 'center', font: { b: true } }),
    judge: sb.get({ font: { b: true }, border: LN, h: 'center' }),
    note: sb.get({ font: { sz: 9, i: true, color: C.mut }, h: 'left', wrap: true, v: 'top' }),
    tileLab: sb.get({ font: { sz: 9, b: true, color: C.mut }, fill: C.softer, border: { left: C.line, right: C.line, top: C.line }, h: 'center' }),
    tileVal3: sb.get({ font: { sz: 20, b: true }, fill: C.softer, border: { left: C.line, right: C.line }, h: 'center', fmt: '0.000' }),
    tileVal4: sb.get({ font: { sz: 20, b: true }, fill: C.softer, border: { left: C.line, right: C.line }, h: 'center', fmt: '0.0000' }),
    tileVal1: sb.get({ font: { sz: 24, b: true, color: C.teal }, fill: C.softer, border: { left: C.line, right: C.line }, h: 'center', fmt: '0.0" %"' }),
    tileSub: sb.get({ font: { sz: 9, color: C.mut }, fill: C.softer, border: { left: C.line, right: C.line, bottom: C.line }, h: 'center' }),
    foot: sb.get({ font: { sz: 9, color: C.mut }, h: 'left' }),
  };
  const bar = (r, title) => { for (let c = 1; c <= 8; c++) blank(r, c, X.section); txt(r, 1, title, X.section); rowH.set(r, 24); };
  const tol = st.tol, eff = st.eff;
  const fold = fin(st.fold) ? st.fold : 10, stock = st.stock, dil = st.xmode === 'dilution';
  const V = st.version;

  // ================= 값 미리 계산 (캐시용) =================
  const rows5 = Array.from({ length: 5 }, (_, i) => ({ conc: stock / fold ** i, cts: (st.ct[i] ?? [NaN, NaN, NaN]).map((v) => (fin(v) ? v : NaN)) }));
  let fit = null;
  try { const f = standardCurve(rows5, dil ? 'dilution' : 'log'); if (fin(f.slope) && fin(f.intercept)) fit = f; } catch { /* 점 부족 */ }
  const E = fit ? (((dil ? fold : 10) ** (-1 / fit.slope)) - 1) * 100 : NaN;
  const HS = "'회귀용 데이터'";

  // ================= 레이아웃 (열: A=여백, B..I = 8열 격자, J=여백) =================
  for (let c = 1; c <= 8; c++) { blank(1, c, X.bannerFill); blank(2, c, X.bannerFill); }
  txt(1, 1, 'Park&Choi Heavenly Lab(LabPhobia) · 직선성 검증', X.banner); merge(1, 1, 1, 8, X.bannerFill); rowH.set(1, 40);
  txt(2, 1, `BCoV 표준곡선 · 증폭효율 · 회수율 — 엑셀 계산 시트  |  v${V} BETA  |  매크로 없음(수식만 사용)`, X.bannerSub); merge(2, 1, 2, 8, X.bannerFill); rowH.set(2, 22);
  rowH.set(3, 8);
  txt(4, 1, `⚠ 베타 테스트 버전 · 숙련도 평가용 임시 사용  |  녹색 칸에 입력하면 나머지는 자동 계산됩니다.  |  계산 결과는 제출 전에 반드시 직접 검토·확인하세요.`, X.notice); merge(4, 1, 4, 8, X.notice); rowH.set(4, 22);
  rowH.set(5, 8);

  // ---- KPI 카드 (6~8행) : 값은 아래 ②표준곡선 결과 셀을 참조 ----
  const R = { set: 10, ctBar: 18, ctHead: 19, ct0: 20, resBar: 27, resHead: 28, slope: 29, inter: 30, r2: 31, effRow: 32, npts: 33, chart0: 36, chart1: 53, recBar: 55 };
  const tiles = [
    { c: 1, label: 'SLOPE (기울기)', f: `B${R.slope}`.replace('B', 'D'), v: fit?.slope, s: X.tileVal3, sub: `y-inter 와 함께 표준곡선을 이룹니다` },
    { c: 3, label: 'Y-INTER (절편)', f: `D${R.inter}`, v: fit?.intercept, s: X.tileVal3, sub: '' },
    { c: 5, label: 'R²', f: `D${R.r2}`, v: fit?.r2, s: X.tileVal4, sub: '' },
    { c: 7, label: 'EFFICIENCY (증폭효율)', f: `D${R.effRow}`, v: E, s: X.tileVal1, sub: '' },
  ];
  rowH.set(6, 20); rowH.set(7, 40); rowH.set(8, 20); rowH.set(9, 8);
  tiles.forEach((t, k) => {
    txt(6, t.c, t.label, X.tileLab); merge(6, t.c, 6, t.c + 1, X.tileLab);
    put(7, t.c, { kind: fin(t.v) ? 'fnum' : 'fstr', f: `IF(ISNUMBER(${t.f}),${t.f},"")`, v: fin(t.v) ? t.v : '', s: t.s }); merge(7, t.c, 7, t.c + 1, t.s);
    if (k === 3) fstr(8, t.c, `IF(F${R.effRow}="","입력 대기",F${R.effRow}&" (기준 "&${'$D$14'}&"–"&${'$E$14'}&" %)")`, !fin(E) ? '입력 대기' : `${E >= eff.min && E <= eff.max ? '기준 이내' : '기준 벗어남'} (기준 ${eff.min}–${eff.max} %)`, X.tileSub);
    else txt(8, t.c, k === 0 ? '기울기' : k === 1 ? '절편' : '결정계수', X.tileSub);
    merge(8, t.c, 8, t.c + 1, X.tileSub);
  });

  // ---- 설정 ----
  bar(R.set, '설정');
  const $stock = '$D$11', $fold = '$D$12', $xmode = '$D$13', $effMin = '$D$14', $effMax = '$E$14';
  const left = [[11, '원액 농도 (copies/µL)', num, stock, X.inInt], [12, '희석 배수', num, fold, X.inInt]];
  left.forEach(([r, l, fn, v, s]) => { txt(r, 1, l, X.label); merge(r, 1, r, 2, X.label); fn(r, 3, v, s); });
  txt(13, 1, 'X축 기준', X.label); merge(13, 1, 13, 2, X.label); txt(13, 3, dil ? '희석단계' : 'log10 농도', X.inTxt);
  txt(14, 1, '증폭효율 기준 (%) 최소 / 최대', X.label); merge(14, 1, 14, 2, X.label); num(14, 3, eff.min, X.inGen); num(14, 4, eff.max, X.inGen);
  txt(15, 1, '녹색 칸 = 입력 · 흰 칸 = 자동 계산', X.note); merge(15, 1, 16, 4, X.note);
  const tolDefs = [['Slope', 'slope'], ['Y-inter', 'inter'], ['R²', 'r2'], ['측정값 (copies/mL)', 'measured'], ['회수율 (%p)', 'pct'], ['평균 · SD · RSD', 'stat']];
  const tolCell = {};
  txt(R.set, 5, '판정 허용오차 (|기재값 − 계산값| ≤ 허용오차이면 "일치")', X.section);
  tolDefs.forEach(([label, key], k) => { const r = 11 + k; txt(r, 5, label, X.label); merge(r, 5, r, 6, X.label); num(r, 7, tol[key], X.inGen); tolCell[key] = `$H$${r}`; });
  for (let r = 11; r <= 16; r++) rowH.set(r, 22);
  rowH.set(17, 8);

  // ---- ① 표준곡선 Ct 입력 ----
  bar(R.ctBar, '① 표준곡선 Ct 입력  (희석 5단계 × 3반복)');
  ['희석', '농도 (copies/µL)', 'X (회귀용)', '반복 1', '반복 2', '반복 3', '평균 Ct', '편차 (SD)'].forEach((h, c) => txt(R.ctHead, 1 + c, h, X.head));
  rowH.set(R.ctHead, 24);
  const SUP = ['⁰', '⁻¹', '⁻²', '⁻³', '⁻⁴'];
  for (let i = 0; i < 5; i++) {
    const r = R.ct0 + i, conc = rows5[i].conc; rowH.set(r, 22);
    txt(r, 1, `10${SUP[i]}`, X.cText);
    fnum(r, 2, `${$stock}/${$fold}^${i}`, conc, X.c0);
    fnum(r, 3, `IF(${$xmode}="희석단계",-${i},LOG10(${addr(r, 2)}))`, dil ? -i : Math.log10(conc), X.c3);
    for (let j = 0; j < 3; j++) num(r, 4 + j, st.ct[i]?.[j], X.inNum);
    const vals = rows5[i].cts.filter(fin), rng = `${addr(r, 4)}:${addr(r, 6)}`;
    fnum(r, 7, `IF(COUNT(${rng})=0,"",AVERAGE(${rng}))`, vals.length ? mean(vals) : '', X.c2);
    fnum(r, 8, `IF(COUNT(${rng})<2,"",STDEV(${rng}))`, vals.length > 1 ? sd(vals, true) : '', X.c3);
  }
  txt(R.ct0 + 5, 1, '최소 2단계 이상 입력하세요(표준서식은 5단계 × 3반복). 빈 칸은 계산에서 제외됩니다. 소수점은 점(.)을 사용합니다.', X.note); merge(R.ct0 + 5, 1, R.ct0 + 5, 8, X.note); rowH.set(R.ct0 + 5, 18);
  rowH.set(R.ct0 + 6, 8);
  const Xr = `${HS}!$A$3:$A$17`, Yr = `${HS}!$B$3:$B$17`;

  // ---- ② 표준곡선 결과 ----
  bar(R.resBar, '② 표준곡선 결과');
  txt(R.resHead, 1, '항목', X.head); merge(R.resHead, 1, R.resHead, 2, X.head);
  ['계산값', '기재값 (선택)', '차이 (기재 − 계산)', '허용오차'].forEach((h, c) => txt(R.resHead, 3 + c, h, X.head));
  txt(R.resHead, 7, '판정', X.head); merge(R.resHead, 7, R.resHead, 8, X.head); rowH.set(R.resHead, 24);
  const resDefs = [
    { row: R.slope, label: 'Slope (기울기)', f: `SLOPE(${Yr},${Xr})`, v: fit?.slope, s: X.c3, rep: st.reported.slope, k: 'slope' },
    { row: R.inter, label: 'Y-inter (절편)', f: `INTERCEPT(${Yr},${Xr})`, v: fit?.intercept, s: X.c3, rep: st.reported.intercept, k: 'inter' },
    { row: R.r2, label: 'R² (결정계수)', f: `RSQ(${Yr},${Xr})`, v: fit?.r2, s: X.c4, rep: st.reported.r2, k: 'r2' },
  ];
  for (const d of resDefs) {
    rowH.set(d.row, 22);
    txt(d.row, 1, d.label, X.label); merge(d.row, 1, d.row, 2, X.label);
    const cc = addr(d.row, 3);
    fnum(d.row, 3, `IFERROR(${d.f},"")`, d.v, d.s);
    num(d.row, 4, d.rep, X.inGen);
    const diff = fin(d.rep) && fin(d.v) ? d.rep - d.v : '';
    fnum(d.row, 5, `IF(AND(ISNUMBER(${cc}),ISNUMBER(${addr(d.row, 4)})),${addr(d.row, 4)}-${cc},"")`, diff, X.c4);
    fnum(d.row, 6, tolCell[d.k], tol[d.k], X.cG);
    fstr(d.row, 7, `IF(${addr(d.row, 5)}="","",IF(ABS(${addr(d.row, 5)})<=${addr(d.row, 6)}+0.000000001,"일치","불일치"))`, diff === '' ? '' : (Math.abs(diff) <= tol[d.k] + 1e-9 ? '일치' : '불일치'), X.judge); merge(d.row, 7, d.row, 8, X.judge);
  }
  rowH.set(R.effRow, 22);
  txt(R.effRow, 1, 'Efficiency (증폭효율, %)', X.label); merge(R.effRow, 1, R.effRow, 2, X.label);
  fnum(R.effRow, 3, `IFERROR((IF(${$xmode}="희석단계",${$fold},10)^(-1/D${R.slope})-1)*100,"")`, E, sb.get({ border: LN, fmt: '0.0', font: { b: true } }));
  blank(R.effRow, 4, X.cText); blank(R.effRow, 5, X.cText);
  fstr(R.effRow, 6, `${$effMin}&" – "&${$effMax}&" %"`, `${eff.min} – ${eff.max} %`, X.cG);
  fstr(R.effRow, 7, `IF(D${R.effRow}="","",IF(AND(D${R.effRow}>=${$effMin},D${R.effRow}<=${$effMax}),"기준 이내","기준 벗어남"))`, !fin(E) ? '' : (E >= eff.min && E <= eff.max ? '기준 이내' : '기준 벗어남'), X.judge); merge(R.effRow, 7, R.effRow, 8, X.judge);
  // 카드의 Efficiency 하단 문구는 판정 셀(H열)을 참조 — 위에서 임시로 쓴 참조를 맞춘다
  cells.get(`8,7`).f = `IF(H${R.effRow}="","입력 대기",H${R.effRow}&" (기준 "&${$effMin}&"–"&${$effMax}&" %)")`;
  rowH.set(R.npts, 22);
  txt(R.npts, 1, '사용한 데이터 점 수', X.label); merge(R.npts, 1, R.npts, 2, X.label);
  fnum(R.npts, 3, `COUNT(${Yr})`, rows5.reduce((s, r) => s + r.cts.filter(fin).length, 0), X.cG);
  txt(R.npts + 1, 1, 'Ct = Slope × X + Y-inter  ·  Efficiency = (10^(−1/Slope) − 1) × 100  (X = log10 농도; 희석단계 기준이면 10 대신 희석 배수 사용)', X.note); merge(R.npts + 1, 1, R.npts + 1, 8, X.note); rowH.set(R.npts + 1, 18);

  // ---- 그래프 영역 (36~52행, 드로잉으로 배치) ----
  for (let r = R.chart0; r <= R.chart1; r++) rowH.set(r, 20);

  // ---- ③ 회수율 ----
  bar(R.recBar, '③ 회수율 분석');
  const rs = R.recBar + 1;
  txt(rs, 1, '사용할 표준곡선', X.label); merge(rs, 1, rs, 2, X.label); txt(rs, 3, st.curveSrc === 'reported' ? '결과서 기재값' : '계산값', X.inTxt);
  txt(rs, 5, 'SD 방식', X.label); merge(rs, 5, rs, 6, X.label); txt(rs, 7, st.sdMode === 'sample' ? '표본' : '모집단', X.inTxt);
  const useCalc = st.curveSrc !== 'reported';
  const curve = useCalc ? fit && { slope: fit.slope, intercept: fit.intercept } : { slope: st.reported.slope, intercept: st.reported.intercept };
  const $src = `$D$${rs}`, $sdm = `$H$${rs}`;
  txt(rs + 1, 1, '사용 Slope', X.label); merge(rs + 1, 1, rs + 1, 2, X.label);
  fnum(rs + 1, 3, `IF(${$src}="계산값",D${R.slope},E${R.slope})`, curve ? curve.slope : NaN, X.c3);
  txt(rs + 1, 5, '사용 Y-inter', X.label); merge(rs + 1, 5, rs + 1, 6, X.label);
  fnum(rs + 1, 7, `IF(${$src}="계산값",D${R.inter},E${R.inter})`, curve ? curve.intercept : NaN, X.c3);
  rowH.set(rs, 22); rowH.set(rs + 1, 22); rowH.set(rs + 2, 8);
  const $us = `$D$${rs + 1}`, $ui = `$H$${rs + 1}`;

  const rh = rs + 3;
  ['반복', 'Ct', 'Spiked (copies/mL)', '측정값 (copies/mL)', '회수율 (%)', '기재 측정값 (선택)', '기재 회수율 (선택)', '판정'].forEach((h, c) => txt(rh, 1 + c, h, X.head)); rowH.set(rh, 30);
  const nRec = Math.max(6, st.rec.length), r0 = rh + 1, rN = r0 + nRec - 1, pcts = [];
  for (let k = 0; k < nRec; k++) {
    const r = r0 + k, d = st.rec[k] ?? {}; rowH.set(r, 22);
    txt(r, 1, String(k + 1), X.cText);
    num(r, 2, d.ct, X.inNum); num(r, 3, d.spiked ?? (k >= st.rec.length ? st.spiked : undefined), X.inInt);
    const ct = fin(d.ct) ? d.ct : NaN, sp = fin(d.spiked) ? d.spiked : NaN;
    const rv = fin(ct) && fin(sp) && curve && fin(curve.slope) && fin(curve.intercept) ? recovery(ct, curve, sp) : null;
    const B = addr(r, 2), Cc = addr(r, 3), D = addr(r, 4);
    fnum(r, 4, `IF(AND(ISNUMBER(${B}),ISNUMBER(${Cc}),ISNUMBER(${$us}),ISNUMBER(${$ui})),10^((${B}-${$ui})/${$us}),"")`, rv ? rv.recovered : NaN, X.c2n);
    fnum(r, 5, `IF(ISNUMBER(${D}),${D}/${Cc}*100,"")`, rv ? rv.pct : NaN, X.c2);
    if (rv) pcts.push(rv.pct);
    num(r, 6, d.measured, X.inGen); num(r, 7, d.pct, X.inGen);
    const F = addr(r, 6), G = addr(r, 7), Ec = addr(r, 5), chk = [];
    if (rv && fin(d.measured)) chk.push(Math.abs(d.measured - rv.recovered) <= tol.measured + 1e-9);
    if (rv && fin(d.pct)) chk.push(Math.abs(d.pct - rv.pct) <= tol.pct + 1e-9);
    fstr(r, 8, `IF(NOT(ISNUMBER(${D})),"",IF(AND(NOT(ISNUMBER(${F})),NOT(ISNUMBER(${G}))),"",IF(AND(IF(ISNUMBER(${F}),ABS(${F}-${D})<=${tolCell.measured}+0.000000001,TRUE),IF(ISNUMBER(${G}),ABS(${G}-${Ec})<=${tolCell.pct}+0.000000001,TRUE)),"일치","불일치")))`, chk.length ? (chk.every(Boolean) ? '일치' : '불일치') : '', X.judge);
  }
  // 통계
  const sr = rN + 2;
  txt(sr, 1, '통계 (회수율 평균 · 표준편차 · 상대표준편차)', X.sub); for (let c = 2; c <= 8; c++) blank(sr, c, X.sub); rowH.set(sr, 22);
  const sh = sr + 1;
  txt(sh, 1, '항목', X.head); merge(sh, 1, sh, 2, X.head);
  ['계산값', '기재값 (선택)', '차이', '허용오차'].forEach((h, c) => txt(sh, 3 + c, h, X.head)); txt(sh, 7, '판정', X.head); merge(sh, 7, sh, 8, X.head); rowH.set(sh, 24);
  const Erng = `$F$${r0}:$F$${rN}`;
  const m = pcts.length ? mean(pcts) : NaN, sdv = pcts.length > 1 ? sd(pcts, st.sdMode === 'sample') : NaN, rsd = fin(sdv) ? sdv / m * 100 : NaN;
  const r2d = (v) => Math.round((v + Number.EPSILON * Math.sign(v)) * 100) / 100;
  const stats = [
    { label: '평균값 (%)', f: `IF(COUNT(${Erng})=0,"",AVERAGE(${Erng}))`, v: m, rep: st.repSummary.mean },
    { label: '표준편차 (SD)', f: `IF(COUNT(${Erng})<2,"",IF(${$sdm}="모집단",STDEVP(${Erng}),STDEV(${Erng})))`, v: sdv, rep: st.repSummary.sd },
    { label: '상대표준편차 (RSD, %)', f: `IF(D${sh + 2}="","",D${sh + 2}/D${sh + 1}*100)`, v: rsd, rep: st.repSummary.rsd },
  ];
  stats.forEach((d, k) => {
    const r = sh + 1 + k, B = addr(r, 3), Cc = addr(r, 4), D = addr(r, 5); rowH.set(r, 22);
    txt(r, 1, d.label, X.label); merge(r, 1, r, 2, X.label);
    fnum(r, 3, d.f, d.v, X.c2n);
    num(r, 4, d.rep, X.inGen);
    const diff = fin(d.rep) && fin(d.v) ? d.rep - r2d(d.v) : '';
    fnum(r, 5, `IF(AND(ISNUMBER(${B}),ISNUMBER(${Cc})),${Cc}-ROUND(${B},2),"")`, diff, X.c2);
    fnum(r, 6, tolCell.stat, tol.stat, X.cG);
    fstr(r, 7, `IF(${D}="","",IF(ABS(${D})<=${addr(r, 6)}+0.000000001,"일치","불일치"))`, diff === '' ? '' : (Math.abs(diff) <= tol.stat + 1e-9 ? '일치' : '불일치'), X.judge); merge(r, 7, r, 8, X.judge);
  });
  const lastStat = sh + 3, foot = lastStat + 2;
  txt(foot, 1, `Park&Choi Heavenly Lab(LabPhobia) · 직선성 검증 v${V} BETA  ·  제작: 치치박사&박박사  ·  GPL v3  ·  https://wwpcr.web.app`, X.foot); merge(foot, 1, foot, 8, X.foot);
  txt(foot + 1, 1, '이 파일은 매크로 없이 엑셀 수식만 사용합니다. 계산 결과는 제출 전에 반드시 직접 검토·확인하세요.', X.foot); merge(foot + 1, 1, foot + 1, 8, X.foot);

  // ================= 회귀용 보조 시트 =================
  const hcells = [];
  const hput = (r, c, o) => hcells.push({ r, c, ...o });
  const hHead = sb.get({ font: { b: true }, fill: C.soft, border: LN, h: 'center' });
  const hNote = sb.get({ font: { sz: 9, i: true, color: C.mut }, h: 'left' });
  hput(1, 0, { kind: 'str', v: '회귀용 데이터 — 자동 생성(수정 금지). "검증" 시트의 Ct와 X에서 만들어지며 SLOPE/INTERCEPT/RSQ와 그래프의 입력입니다.', s: hNote });
  hput(2, 0, { kind: 'str', v: 'X', s: hHead }); hput(2, 1, { kind: 'str', v: 'Ct', s: hHead });
  const sl = `'검증'!D${R.slope}`, ic = `'검증'!D${R.inter}`, rq = `'검증'!D${R.r2}`, ef = `'검증'!D${R.effRow}`;
  const titleF = `IF(ISNUMBER(${sl}),"BCoV standard curve   |   y = "&TEXT(${sl},"0.000")&"x "&IF(${ic}<0,"- ","+ ")&TEXT(ABS(${ic}),"0.000")&"   |   R² = "&TEXT(${rq},"0.0000")&"   |   Efficiency = "&TEXT(${ef},"0.0")&" %","BCoV standard curve")`;
  const titleV = fit ? `BCoV standard curve   |   y = ${fixed(fit.slope, 3)}x ${fit.intercept < 0 ? '- ' : '+ '}${fixed(Math.abs(fit.intercept), 3)}   |   R² = ${fixed(fit.r2, 4)}   |   Efficiency = ${fixed(E, 1)} %` : 'BCoV standard curve';
  hput(2, 3, { kind: 'str', v: '그래프 제목 (자동)', s: hHead });
  hput(3, 3, { kind: 'fstr', f: titleF, v: titleV, s: sb.get({ font: { sz: 9, color: C.mut } }) });
  const chartPts = [];
  for (let k = 0; k < 15; k++) {
    const r = 3 + k, i = Math.floor(k / 3), j = k % 3, src = `'검증'!${addr(R.ct0 + i, 4 + j)}`, xs = `'검증'!${addr(R.ct0 + i, 3)}`;
    const ct = rows5[i].cts[j], ok = fin(ct), x = dil ? -i : Math.log10(rows5[i].conc);
    hput(r, 0, { kind: ok ? 'fnum' : 'fstr', f: `IF(ISNUMBER(${src}),${xs},"")`, v: ok ? x : '', s: X.c3 });
    hput(r, 1, { kind: ok ? 'fnum' : 'fstr', f: `IF(ISNUMBER(${src}),${src},"")`, v: ok ? ct : '', s: X.c2 });
    if (ok) chartPts.push([x, ct]);
  }

  // ================= XML 조립 =================
  const cellXml = (c) => {
    const ref = addr(c.r, c.c), s = c.s ?? 0;
    switch (c.kind) {
      case 'str': return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
      case 'num': return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
      case 'blank': return `<c r="${ref}" s="${s}"/>`;
      case 'fnum': return `<c r="${ref}" s="${s}"><f>${esc(c.f)}</f>${cache && fin(c.v) ? `<v>${c.v}</v>` : ''}</c>`;
      case 'fstr': return `<c r="${ref}" s="${s}" t="str"><f>${esc(c.f)}</f>${cache ? `<v>${esc(c.v ?? '')}</v>` : ''}</c>`;
      default: return '';
    }
  };
  const rowsXml = (list, heights) => {
    const rows = [...new Set([...list.map((c) => c.r), ...(heights ? [...heights.keys()] : [])])].sort((a, b) => a - b);
    return rows.map((r) => {
      const h = heights?.get(r), cs = list.filter((c) => c.r === r).sort((a, b) => a.c - b.c);
      return `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cs.map(cellXml).join('')}</row>`;
    }).join('');
  };
  const all = [...cells.values()];
  const lastRow = Math.max(...all.map((c) => c.r), foot + 1);

  const listDv = (sq, items) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="선택 항목" error="목록에서 선택하세요." sqref="${sq}"><formula1>"${items}"</formula1></dataValidation>`;
  const dvs = [
    listDv('D13', 'log10 농도,희석단계'), listDv(`D${rs}`, '계산값,결과서 기재값'), listDv(`H${rs}`, '모집단,표본'), listDv('D12', '10,2'),
    `<dataValidation type="decimal" errorStyle="warning" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Ct 확인" error="Ct는 보통 0~60 사이의 숫자입니다. (숫자만 입력, 소수점은 점)" sqref="E${R.ct0}:G${R.ct0 + 4} C${r0}:C${rN}"><formula1>0</formula1><formula2>60</formula2></dataValidation>`,
    `<dataValidation type="decimal" operator="greaterThan" allowBlank="1" showErrorMessage="1" errorTitle="농도 확인" error="0보다 큰 숫자를 입력하세요." sqref="D11 D${r0}:D${rN}"><formula1>0</formula1></dataValidation>`,
  ];
  const rule = (pri, v, dxf) => `<cfRule type="cellIs" dxfId="${dxf}" priority="${pri}" operator="equal"><formula>"${v}"</formula></cfRule>`;
  const judgeRanges = `H${R.slope}:I${R.effRow} I${r0}:I${rN} H${sh + 1}:I${sh + 3}`;
  const condFmt = `<conditionalFormatting sqref="${judgeRanges}">${rule(1, '일치', 0)}${rule(2, '기준 이내', 0)}${rule(3, '불일치', 1)}${rule(4, '기준 벗어남', 1)}</conditionalFormatting>`
    + `<conditionalFormatting sqref="H6:I8"><cfRule type="expression" dxfId="0" priority="5"><formula>$H$${R.effRow}="기준 이내"</formula></cfRule><cfRule type="expression" dxfId="1" priority="6"><formula>$H$${R.effRow}="기준 벗어남"</formula></cfRule></conditionalFormatting>`;
  const widths = [2.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 15.5, 2.5];
  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor rgb="FF${C.teal}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:J${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0" zoomScale="100"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${colsXml}<sheetData>${rowsXml(all, rowH)}</sheetData><mergeCells count="${merges.length}">${merges.map((m2) => `<mergeCell ref="${m2}"/>`).join('')}</mergeCells>${condFmt}<dataValidations count="${dvs.length}">${dvs.join('')}</dataValidations><printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToHeight="0"/><rowBreaks count="1" manualBreakCount="1"><brk id="${R.chart0 - 1}" max="16383" man="1"/></rowBreaks><drawing r:id="rId1"/></worksheet>`;
  const sheetH = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><tabColor rgb="FF9DB4BD"/></sheetPr><dimension ref="A1:D17"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="2" width="16" customWidth="1"/><col min="3" max="3" width="4" customWidth="1"/><col min="4" max="4" width="110" customWidth="1"/></cols><sheetData>${rowsXml(hcells, null)}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;

  // 안내 시트
  const gTitle = sb.get({ font: { sz: 16, b: true, color: C.teal } }), gSec = sb.get({ font: { sz: 11, b: true, color: C.teal }, border: { bottom: C.teal } }), gTxt = sb.get({ wrap: true, v: 'top' }), gMut = sb.get({ font: { sz: 9, color: C.mut } });
  const guide = [
    ['사용 안내', gTitle], ['', 0],
    ['이렇게 쓰세요', gSec],
    ['1. "검증" 시트의 녹색 칸에 값을 입력하면 Slope · Y-inter · R² · Efficiency · 회수율이 자동으로 계산됩니다. (엑셀 수식만 사용, 매크로 없음)', gTxt],
    ['2. 표준곡선 Ct는 5단계 × 3반복을 입력하세요. 비어 있는 칸은 계산에서 제외되고, 소수점은 점(.)을 사용합니다.', gTxt],
    ['3. "결과서 기재값"에 결과서의 값을 넣으면 허용오차 안에서 일치/불일치를 판정합니다.', gTxt],
    ['4. 증폭효율(Efficiency)이 기준 범위(기본 90–110 %)를 벗어나면 "기준 벗어남"으로 표시됩니다.', gTxt],
    ['', 0],
    ['계산식', gSec],
    ['Slope = SLOPE(Ct, X)  ·  Y-inter = INTERCEPT(Ct, X)  ·  R² = RSQ(Ct, X)   (X = log10 농도, 15개 점 전체로 최소제곱 회귀)', gTxt],
    ['Efficiency (%) = (10^(−1/Slope) − 1) × 100', gTxt],
    ['측정값 (copies/mL) = 10^((Ct − Y-inter) / Slope)  ·  회수율 (%) = 측정값 / Spiked × 100', gTxt],
    ['SD = STDEVP(모집단) 또는 STDEV(표본)  ·  RSD (%) = SD / 평균 × 100', gTxt],
    ['', 0],
    [`Park&Choi Heavenly Lab(LabPhobia) · 직선성 검증 v${V} (베타 · 숙련도 평가용 임시 사용)  ·  제작: 치치박사&박박사  ·  라이선스: GPL v3`, gMut],
    ['계산 결과는 제출 전에 반드시 직접 검토·확인하세요.', gMut],
  ];
  const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><tabColor rgb="FF9DB4BD"/></sheetPr><dimension ref="A1:A${guide.length}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="1" width="120" customWidth="1"/></cols><sheetData>${guide.map(([t, s], i) => `<row r="${i + 1}">${t ? `<c r="A${i + 1}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>` : ''}</row>`).join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;

  // ================= 차트(표준곡선 산점도 + 추세선) =================
  const ptsX = chartPts.map(([x], i) => `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>`).join('');
  const ptsY = chartPts.map(([, y], i) => `<c:pt idx="${i}"><c:v>${y}</c:v></c:pt>`).join('');
  const rich = (t, sz, b = 0, color = C.ink) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b}"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="${sz}" b="${b}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx>`;
  const axTitle = (t) => `<c:title>${rich(t, 1000, 0, C.mut)}<c:overlay val="0"/></c:title>`;
  const grid = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5EEF2"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;
  const axLine = `<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="9DB4BD"/></a:solidFill></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="${C.mut}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`;
  const chart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:strRef><c:f>${HS}!$D$3</c:f>${cache ? `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(titleV)}</c:v></c:pt></c:strCache>` : ''}</c:strRef></c:tx><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="${C.ink}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Ct</c:v></c:tx><c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker><c:trendline><c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="2F80ED"/></a:solidFill></a:ln></c:spPr><c:trendlineType val="linear"/><c:dispRSqr val="0"/><c:dispEq val="0"/></c:trendline><c:xVal><c:numRef><c:f>${Xr}</c:f>${cache ? `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${chartPts.length}"/>${ptsX}</c:numCache>` : ''}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${Yr}</c:f>${cache ? `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${chartPts.length}"/>${ptsY}</c:numCache>` : ''}</c:numRef></c:yVal><c:smooth val="0"/></c:ser><c:axId val="111111111"/><c:axId val="222222222"/></c:scatterChart><c:valAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${grid}${axTitle(dil ? 'Dilution step (10^-n)' : 'Log10 concentration (copies/µL)')}<c:numFmt formatCode="0.0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axLine}<c:crossAx val="222222222"/><c:crosses val="min"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/><c:min val="10"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${grid}${axTitle('Ct')}<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axLine}<c:crossAx val="111111111"/><c:crosses val="min"/><c:crossBetween val="midCat"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${C.line}"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
  const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${R.chart0 - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${R.chart1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="표준곡선 그래프"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

  const z = new JSZipCtor();
  const add = (n, d) => z.file(n, d, { createFolders: false });
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Park&Choi Heavenly Lab(LabPhobia) · 직선성 검증 — BCoV 표준곡선·회수율</dc:title><dc:creator>Park&Choi Heavenly Lab(LabPhobia) · 직선성 검증 (치치박사&amp;박박사)</dc:creator></cp:coreProperties>`);
  add('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28000" windowHeight="16000" activeTab="0"/></bookViews><sheets><sheet name="검증" sheetId="1" r:id="rId1"/><sheet name="사용 안내" sheetId="2" r:id="rId2"/><sheet name="회귀용 데이터" sheetId="3" r:id="rId4"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>`);
  add('xl/styles.xml', sb.xml());
  add('xl/worksheets/sheet1.xml', sheet1);
  add('xl/worksheets/sheet2.xml', sheet2);
  add('xl/worksheets/sheet3.xml', sheetH);
  add('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  add('xl/drawings/drawing1.xml', drawing);
  add('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`);
  add('xl/charts/chart1.xml', chart);
  const type = typeof Blob !== 'undefined' ? 'blob' : 'uint8array';
  return z.generateAsync({ type, compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
