// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Applied Biosystems 7500 Fast(SDS) 결과 파일(.eds = zip + XML/텍스트) 읽기. 브라우저 안에서만 처리한다.
// 순수 함수(문자열 → 객체)라서 Node 테스트가 가능하다. zip 해제는 readEds()에서 JSZip을 받아서 한다.

const decode = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const tag = (t, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(t ?? ''); return m ? decode(m[1]) : ''; };
const blocks = (t, name) => [...String(t ?? '').matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
const num = (v) => { const s = String(v ?? '').trim(); if (s === '' || /^(n\/a|undetermined)$/i.test(s)) return null; const x = Number(s); return Number.isFinite(x) ? x : null; };

// Java 부호 있는 ARGB 정수 → #rrggbb
export function argb(c) { const n = Number(c); if (!Number.isFinite(n)) return '#9aa5ab'; return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0'); }

export function wellName(idx, cols = 12) { return String.fromCharCode(65 + Math.floor(idx / cols)) + ((idx % cols) + 1); }

export const UNDET_CT = 40; // 7500 Fast: 기준선을 넘지 못한 웰은 Ct 40.0 으로 기록

export function parseEds(f) {
  const exp = f.experiment ?? '', ap = f.analysisProtocol ?? '', tc = f.tcprotocol ?? '', plate = f.plateSetup ?? '';
  const rows = Number(tag(plate, 'Rows')) || 8, cols = Number(tag(plate, 'Columns')) || 12;

  const typeBlock = /<Type>\s*<Id>([\s\S]*?)<\/Id>\s*<Name>([\s\S]*?)<\/Name>/.exec(exp);
  const info = {
    name: tag(exp, 'Name'), description: tag(exp, 'Description'), operator: tag(exp, 'Operator'), state: tag(exp, 'RunState'),
    start: num(tag(exp, 'RunStartTime')), end: num(tag(exp, 'RunEndTime')), modified: num(tag(exp, 'ModifiedTime')),
    type: typeBlock ? decode(typeBlock[2]) : '', instrument: tag(exp, 'InstrumentTypeId'), file: tag(exp, 'FileName'),
    mode: tag(exp, 'TCProtocolMode'), rows, cols,
  };
  const samples = blocks(exp, 'Samples').map((b) => ({ name: tag(b, 'Name'), color: argb(tag(b, 'Color')) }));
  const sampleColor = new Map(samples.map((s) => [s.name, s.color]));

  // 검출기별 분석 설정(임계값 등): ObjectName 이 검출기 이름인 IDetectorSettings
  const det = new Map();
  for (const b of blocks(ap, 'JaxbAnalysisSettings')) {
    if (!/IDetectorSettings/.test(tag(b, 'Type'))) continue;
    const kv = {};
    for (const m of b.matchAll(/<Name>([\s\S]*?)<\/Name>\s*<JaxbValueItem[^>]*>\s*<\w+>([\s\S]*?)<\/\w+>/g)) kv[decode(m[1])] = decode(m[2]);
    const nm = kv.ObjectName;
    if (!nm || /DEFAULT_SETTINGS/.test(nm)) continue;
    det.set(nm, { threshold: num(kv.Threshold), autoCt: kv.AutoCt === 'true', autoBaseline: kv.AutoBaseline === 'true', baseStart: num(kv.BaselineStart), baseStop: num(kv.BaselineStop) });
  }
  const detectors = blocks(exp, 'Detectors').map((b) => {
    const name = tag(b, 'Name'), s = det.get(name) ?? {};
    return { name, reporter: tag(b, 'Reporter'), quencher: tag(b, 'Quencher'), color: argb(tag(b, 'Color')), threshold: s.threshold ?? null, autoCt: s.autoCt ?? null, baseStart: s.baseStart ?? null, baseStop: s.baseStop ?? null };
  });
  const detByName = new Map(detectors.map((d) => [d.name, d]));

  const protocol = {
    volume: num(tag(tc, 'SampleVolume')), cover: num(tag(tc, 'CoverTemperature')), mode: tag(tc, 'RunMode'),
    stages: blocks(tc, 'TCStage').map((s) => ({
      flag: tag(s, 'StageFlag'), reps: Number(tag(s, 'NumOfRepetitions')) || 1,
      steps: blocks(s, 'TCStep').map((p) => ({ temp: num(tag(p, 'Temperature')), hold: num(tag(p, 'HoldTime')), collect: tag(p, 'CollectionFlag') === '1', ramp: num(tag(p, 'RampRate')) })),
    })),
  };

  // 플레이트에 배정된 시료 (결과가 없는 웰도 보여주기 위해)
  const layout = new Map();
  for (const m of plate.matchAll(/<Index>(\d+)<\/Index>\s*<FeatureItem>\s*<Sample>\s*<Name>([\s\S]*?)<\/Name>/g)) layout.set(Number(m[1]), decode(m[2]));

  // 웰·검출기별 Task(STANDARD/UNKNOWN/NTC…)와 표준 정량값
  const dtask = new Map();
  for (const m of plate.matchAll(/<Index>(\d+)<\/Index>\s*<FeatureItem>\s*<DetectorTaskList>([\s\S]*?)<\/DetectorTaskList>/g))
    for (const b of blocks(m[2], 'DetectorTask')) dtask.set(m[1] + '|' + tag(/<Detector>[\s\S]*?<\/Detector>/.exec(b)?.[0] ?? '', 'Name'), { task: tag(b, 'Task'), qty: num(tag(b, 'Concentration')) });

  // 결과: 웰·검출기마다 한 줄(Ct …) + 'Rn values' + 'Delta Rn values'
  const reads = [];
  const lines = String(f.analysisResult ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split('\t');
    if (!/^\d+$/.test(c[0]) || c.length < 5 || /^(Rn|Delta Rn) values/.test(lines[i])) continue;
    let rn = [], drn = [];
    for (let k = 1; k <= 2 && i + k < lines.length; k++) {
      const v = lines[i + k].split('\t');
      if (v[0] === 'Rn values') rn = v.slice(1).map(Number).filter((x) => Number.isFinite(x));
      else if (v[0] === 'Delta Rn values') drn = v.slice(1).map(Number).filter((x) => Number.isFinite(x));
    }
    const idx = Number(c[0]), ct = num(c[4]);
    reads.push({
      idx, well: wellName(idx, cols), row: Math.floor(idx / cols), col: idx % cols, sample: c[1] ?? '', target: c[2] ?? '', task: c[3] ?? '',
      ct, detected: ct !== null && ct < UNDET_CT, ctMean: num(c[5]), ctSd: num(c[6]), qty: num(c[8]), qtyMean: num(c[9]), qtySd: num(c[10]),
      task2: dtask.get(idx + '|' + (c[2] ?? ''))?.task ?? c[3] ?? '', setQty: dtask.get(idx + '|' + (c[2] ?? ''))?.qty ?? null,
      rn, drn, color: detByName.get(c[2])?.color ?? '#6a8590',
    });
  }
  const cycles = reads.reduce((m, r) => Math.max(m, r.drn.length, r.rn.length), 0);
  for (const r of reads) if (!sampleColor.has(r.sample)) sampleColor.set(r.sample, '#9aa5ab');

  const melt = protocol.stages.some((s) => /MELT|DISSOC/i.test(s.flag));
  return { info, melt, samples: [...sampleColor].map(([name, color]) => ({ name, color })), detectors, protocol, layout: [...layout], reads, cycles };
}

// 시료 × 검출기 요약: 검출된 반복의 평균 Ct 와 양성 수/반복 수
export function summarize(data) {
  const out = new Map();
  for (const r of data.reads) {
    const key = r.sample + '\u0000' + r.target;
    const o = out.get(key) ?? { sample: r.sample, target: r.target, n: 0, pos: 0, sum: 0, wells: [] };
    o.n++; o.wells.push(r.well); if (r.detected) { o.pos++; o.sum += r.ct; }
    out.set(key, o);
  }
  return [...out.values()].map((o) => ({ ...o, mean: o.pos ? o.sum / o.pos : null }));
}

// 표준곡선 정량: 검출기마다 STANDARD 웰의 Ct 를 log10(양)에 대해 최소제곱 → 기울기·절편·R²·효율, 나머지 웰의 정량값
export function standardCurves(data) {
  const out = [];
  for (const d of data.detectors) {
    const pts = data.reads.filter((r) => r.target === d.name && /^STANDARD$/i.test(r.task2) && r.setQty > 0 && r.detected);
    const levels = new Set(pts.map((p) => p.setQty));
    if (pts.length < 2 || levels.size < 2) continue;
    const xs = pts.map((p) => Math.log10(p.setQty)), ys = pts.map((p) => p.ct), n = pts.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const slope = sxy / sxx, intercept = my - slope * mx, r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
    out.push({ target: d.name, slope, intercept, r2, efficiency: (10 ** (-1 / slope) - 1) * 100, n, levels: levels.size, points: pts.map((p) => ({ well: p.well, x: Math.log10(p.setQty), ct: p.ct })) });
  }
  for (const c of out) for (const r of data.reads) if (r.target === c.target && !/^STANDARD$/i.test(r.task2)) r.calcQty = r.detected ? 10 ** ((r.ct - c.intercept) / c.slope) : null;
  return out;
}

// ---- 사용자 임계값: ΔRn 곡선이 임계값 T를 처음 넘는 지점을 로그 선형 보간으로 다시 구한다 ----
// Ct = n + (ln T − ln ΔRn[n]) / (ln ΔRn[n+1] − ln ΔRn[n])   (n = T 바로 아래 사이클, 이후 곡선이 계속 T 이상일 때만 인정)
// 장비 소프트웨어의 Ct와 계산 방식이 달라서 같은 임계값이라도 0.1~0.5 사이클 정도 차이가 날 수 있다.
export function crossing(y, T) {
  if (!(T > 0) || !y?.length) return null;
  for (let i = 1; i < y.length; i++) {
    if (y[i - 1] < T && y[i] >= T) {
      let ok = true; for (let k = i; k < y.length; k++) if (y[k] < T) { ok = false; break; }
      if (!ok) continue;
      const a = y[i - 1], b = y[i];
      return a > 0 ? i + (Math.log(T) - Math.log(a)) / (Math.log(b) - Math.log(a)) : i + (T - a) / (b - a);
    }
  }
  return null;
}
const meanSd = (v) => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n; return { m, sd: n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : null }; };

// thr: { 검출기이름: 임계값 }. 장비 임계값과 같거나 비어 있으면 파일에 저장된 장비 값을 그대로 쓴다.
export function applyThresholds(data, thr = {}) {
  const user = new Set();
  for (const d of data.detectors) { const v = thr[d.name]; if (Number.isFinite(v) && v > 0 && v !== d.threshold) user.add(d.name); }
  for (const r of data.reads) {
    r.o ??= { ct: r.ct, detected: r.detected, ctMean: r.ctMean, ctSd: r.ctSd };
    if (user.has(r.target)) { const c = crossing(r.drn, thr[r.target]); r.ct = c ?? UNDET_CT; r.detected = c !== null; r.recalc = true; }
    else { r.ct = r.o.ct; r.detected = r.o.detected; r.ctMean = r.o.ctMean; r.ctSd = r.o.ctSd; r.recalc = false; }
  }
  const groups = new Map();
  for (const r of data.reads) if (r.recalc) { const k = r.sample + '\u0000' + r.target; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
  for (const g of groups.values()) {
    const det = g.filter((r) => r.detected).map((r) => r.ct), s = det.length ? meanSd(det) : { m: null, sd: null };
    for (const r of g) { r.ctMean = r.detected ? s.m : null; r.ctSd = r.detected ? s.sd : null; }
  }
  return user;
}

const FILES = { experiment: 'apldbio/sds/experiment.xml', tcprotocol: 'apldbio/sds/tcprotocol.xml', analysisProtocol: 'apldbio/sds/analysis_protocol.xml', analysisResult: 'apldbio/sds/analysis_result.txt', plateSetup: 'apldbio/sds/plate_setup.xml' };

// .eds(zip)를 읽는다. 항목 이름은 대소문자·구분자(\ /)를 가리지 않는다.
export async function readEds(buffer, JSZipLib) {
  const zip = await JSZipLib.loadAsync(buffer);
  const byName = new Map();
  zip.forEach((p, e) => { if (!e.dir) byName.set(p.replace(/\\/g, '/').toLowerCase(), e); });
  if (!byName.has(FILES.experiment) && ![...byName.keys()].some((k) => k.endsWith('analysis_result.txt'))) throw new Error('7500 Fast(.eds) 결과 파일이 아니에요. (apldbio/sds 폴더를 찾지 못했어요)');
  const txt = {};
  for (const [k, p] of Object.entries(FILES)) { const e = byName.get(p); txt[k] = e ? await e.async('string') : ''; }
  if (!txt.analysisResult.trim()) throw new Error('분석 결과(analysis_result.txt)가 없어요. 장비에서 분석을 마치고 저장한 파일인지 확인하세요.');
  const data = parseEds(txt);
  if (!data.reads.length) throw new Error('결과에서 웰 데이터를 찾지 못했어요.');
  data.messages = byName.has('apldbio/sds/messages.log') ? await byName.get('apldbio/sds/messages.log').async('string') : '';
  return data;
}
