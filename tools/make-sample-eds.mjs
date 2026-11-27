// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 7500FAST 탭의 "샘플 불러오기"용 가상 .eds 파일을 만든다 (실제 환자·기관 자료 아님, 모두 컴퓨터로 만든 숫자).
//   node tools/make-sample-eds.mjs   →  public/samples/demo_7500fast.eds
// .eds 는 zip 이다. 외부 라이브러리 없이 node:zlib 로 직접 묶는다.
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { crossing } from '../public/eds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seed = 20261127; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5; // 결정적 난수(−0.5~0.5)

const DET = [
  { name: 'GENE_A', reporter: 'FAM', color: -7619079, thr: 15000 },
  { name: 'IC', reporter: 'CY5', color: -743962, thr: 8000 },
];
// 웰 배치 (행 A~H = 0~7, 열 1~12): 표준 10^7~10^3 (2반복), 시료 S1~S4 (3반복), NTC 2개
const wells = [];
const put = (r, c, sample, task, qty, ctA, ctIC) => wells.push({ idx: r * 12 + c, sample, task, qty, ct: { GENE_A: ctA, IC: ctIC } });
[1e7, 1e6, 1e5, 1e4, 1e3].forEach((q, i) => [0, 1].forEach((k) => put(i, k, `STD_1E${Math.log10(q)}`, 'STANDARD', q, -3.34 * Math.log10(q) + 38.6 + rnd() * 0.25, null)));
[[2.3e5, 'S1'], [4.1e4, 'S2'], [6.8e3, 'S3'], [null, 'S4']].forEach(([q, nm], i) => [0, 1, 2].forEach((k) => put(i, 4 + k, nm, 'UNKNOWN', null, q ? -3.34 * Math.log10(q) + 38.6 + rnd() * 0.5 : 40, 27.2 + rnd() * 0.8)));
[0, 1].forEach((k) => put(6, k, 'NTC', 'NTC', null, 40, 40));

const N = 40;
const curve = (ct, thr) => {            // 로지스틱 증폭 곡선: ΔRn
  if (ct >= 40) return Array.from({ length: N }, () => rnd() * 600);
  const amax = thr * 90, w = 1.05, m = ct + w * Math.log(amax / thr - 1);
  return Array.from({ length: N }, (_, i) => amax / (1 + Math.exp(-(i + 1 - m) / w)) + rnd() * (thr * 0.015));
};
const reads = [];
for (const w of wells) for (const d of DET) {
  if (w.ct[d.name] === null) continue;
  const drn = curve(w.ct[d.name], d.thr), base = d.name === 'IC' ? 180000 : 100000;
  const ct = crossing(drn, d.thr);
  reads.push({ w, d, drn, rn: drn.map((v, i) => v + base + i * 15), ct: ct ?? 40 });
}
// 표준곡선(장비 Quantity 용) — GENE_A
const std = reads.filter((r) => r.d.name === 'GENE_A' && r.w.task === 'STANDARD' && r.ct < 40);
const xs = std.map((r) => Math.log10(r.w.qty)), ys = std.map((r) => r.ct), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0), icpt = my - slope * mx;
const group = (r) => reads.filter((o) => o.w.sample === r.w.sample && o.d.name === r.d.name && o.ct < 40).map((o) => o.ct);
const msd = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null]; };

let txt = 'Session Name\t\nWell\tSample Name\tDetector\tTask\tCt\tAvg Ct\tCt SD\tDelta Ct\tQty\tAvg Qty\tQty SD\n';
for (const r of reads.sort((a, b) => a.w.idx - b.w.idx)) {
  const [m, sd] = r.ct < 40 ? msd(group(r)) : [null, null];
  const q = r.d.name === 'GENE_A' && r.ct < 40 ? 10 ** ((r.ct - icpt) / slope) : '';
  txt += `${r.w.idx}\t${r.w.sample}\t${r.d.name}\tTarget\t${r.ct.toFixed(6)}\t${m ?? ''}\t${sd ?? ''}\t\t${q}\t\t\n`;
  txt += 'Rn values\t' + r.rn.map((v) => v.toFixed(3)).join('\t') + '\n';
  txt += 'Delta Rn values\t' + r.drn.map((v) => v.toFixed(3)).join('\t') + '\n';
}

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const samples = [...new Set(wells.map((w) => w.sample))];
const colors = [-8076815, -5701666, -2105970, -524376, -4915456, -1330000, -9000000, -3000000, -6000000, -700000];
const experiment = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Experiment>
    <Name>DEMO_7500FAST_synthetic</Name>
    <Description>가상 데이터 (실제 시료 아님) — 표준곡선 정량 예시</Description>
    <Operator>demo</Operator>
    <RunState>COMPLETE</RunState>
    <FinalAnalysisCompleted>true</FinalAnalysisCompleted>
    <ModifiedTime>1795000000000</ModifiedTime>
    <RunStartTime>1794990000000</RunStartTime>
    <RunEndTime>1794993300000</RunEndTime>
    <FileName>demo_7500fast.eds</FileName>
    <Type>
        <Id>Std</Id>
        <Name>Quantitation - Standard Curve</Name>
    </Type>
${samples.map((s, i) => `    <Samples>\n        <Name>${x(s)}</Name>\n        <Color>${colors[i % colors.length]}</Color>\n    </Samples>`).join('\n')}
${DET.map((d) => `    <Detectors>\n        <Name>${d.name}</Name>\n        <Reporter>${d.reporter}</Reporter>\n        <Quencher>None</Quencher>\n        <Color>${d.color}</Color>\n    </Detectors>`).join('\n')}
    <TCProtocolMode>Standard</TCProtocolMode>
    <InstrumentTypeId>sds7500fast</InstrumentTypeId>
</Experiment>
`;
const tcprotocol = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TCProtocol>
    <SampleVolume>20.0</SampleVolume>
    <CoverTemperature>105.0</CoverTemperature>
    <RunMode>Standard</RunMode>
    <TCStage><StageFlag>PRE_CYCLING</StageFlag><NumOfRepetitions>1</NumOfRepetitions><TCStep><CollectionFlag>0</CollectionFlag><RampRate>100.0</RampRate><Temperature>95.0</Temperature><HoldTime>300</HoldTime></TCStep></TCStage>
    <TCStage><StageFlag>CYCLING</StageFlag><NumOfRepetitions>40</NumOfRepetitions><TCStep><CollectionFlag>0</CollectionFlag><RampRate>100.0</RampRate><Temperature>95.0</Temperature><HoldTime>15</HoldTime></TCStep><TCStep><CollectionFlag>1</CollectionFlag><RampRate>100.0</RampRate><Temperature>60.0</Temperature><HoldTime>45</HoldTime></TCStep></TCStage>
</TCProtocol>
`;
const dtl = (w) => DET.filter((d) => w.ct[d.name] !== null).map((d) => `<DetectorTask><Task>${w.task}</Task><Concentration>${w.qty && d.name === 'GENE_A' ? w.qty : 1.0}</Concentration><Detector><Name>${d.name}</Name><Reporter>${d.reporter}</Reporter><Quencher>None</Quencher><Color>${d.color}</Color></Detector></DetectorTask>`).join('');
const plate = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Plate><Name/><Rows>8</Rows><Columns>12</Columns>
<FeatureMap><Feature><Id>sample</Id><Name>sample</Name></Feature>
${wells.map((w) => `<FeatureValue><Index>${w.idx}</Index><FeatureItem><Sample><Name>${x(w.sample)}</Name><Color>0</Color></Sample></FeatureItem></FeatureValue>`).join('\n')}
</FeatureMap>
<FeatureMap><Feature><Id>detector-task</Id><Name>detector-task</Name></Feature>
${wells.map((w) => `<FeatureValue><Index>${w.idx}</Index><FeatureItem><DetectorTaskList>${dtl(w)}</DetectorTaskList></FeatureItem></FeatureValue>`).join('\n')}
</FeatureMap></Plate>
`;
const setting = (k, t, v) => `<JaxbSettingValue><Name>${k}</Name><JaxbValueItem type="${t}"><${t === 'Double' ? 'DoubleValue' : t === 'Integer' ? 'IntValue' : t === 'Boolean' ? 'BooleanValue' : 'StringValue'}>${v}</${t === 'Double' ? 'DoubleValue' : t === 'Integer' ? 'IntValue' : t === 'Boolean' ? 'BooleanValue' : 'StringValue'}></JaxbValueItem></JaxbSettingValue>`;
const protocol = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<JaxbAnalysisProtocol><Name>unnamed</Name>
${DET.map((d) => `<JaxbAnalysisSettings><Type>com.apldbio.sds.platform.analysis.IDetectorSettings</Type>${setting('Threshold', 'Double', d.thr)}${setting('AutoBaseline', 'Boolean', 'true')}${setting('BaselineStart', 'Integer', 3)}${setting('ObjectName', 'String', d.name)}${setting('BaselineStop', 'Integer', 15)}${setting('AutoCt', 'Boolean', 'false')}</JaxbAnalysisSettings>`).join('\n')}
</JaxbAnalysisProtocol>
`;

// ---- zip ----
const files = {
  'apldbio/sds/experiment.xml': experiment, 'apldbio/sds/tcprotocol.xml': tcprotocol, 'apldbio/sds/plate_setup.xml': plate,
  'apldbio/sds/analysis_protocol.xml': protocol, 'apldbio/sds/analysis_result.txt': txt, 'apldbio/sds/messages.log': '<RunLogEvent>synthetic demo file</RunLogEvent>\n',
};
const parts = [], cen = []; let off = 0;
for (const [name, body] of Object.entries(files)) {
  const nb = Buffer.from(name), raw = Buffer.from(body), def = deflateRawSync(raw), crc = crc32(raw);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
  parts.push(lh, nb, def);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(def.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
  cen.push(ch, nb); off += 30 + nb.length + def.length;
}
const cenBuf = Buffer.concat(cen), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(off, 16);
mkdirSync(path.join(root, 'public/samples'), { recursive: true });
const out = path.join(root, 'public/samples/demo_7500fast.eds');
writeFileSync(out, Buffer.concat([...parts, cenBuf, end]));
console.log('wrote', out, `${reads.length} reads · slope ${slope.toFixed(3)} · intercept ${icpt.toFixed(3)}`);
