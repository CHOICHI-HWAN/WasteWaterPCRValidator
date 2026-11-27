// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { parseEds, summarize, argb, wellName } from '../public/eds.js';

assert.equal(wellName(0), 'A1'); assert.equal(wellName(16), 'B5'); assert.equal(wellName(95), 'H12');
assert.match(argb(-1), /^#ffffff$/);

const f = {
  experiment: '<Experiment><Name>t &amp; run</Name><Operator>OP</Operator><RunStartTime>1000</RunStartTime><InstrumentTypeId>sds7500fast</InstrumentTypeId><Type><Id>Std</Id><Name>Quant</Name></Type>' +
    '<Samples><Name>S1</Name><Color>-1</Color></Samples><Detectors><Name>F3L</Name><Reporter>FAM</Reporter><Quencher>None</Quencher><Color>-1</Color></Detectors></Experiment>',
  analysisProtocol: '<R><JaxbAnalysisSettings><Type>x.IDetectorSettings</Type><JaxbSettingValue><Name>Threshold</Name><JaxbValueItem type="Double"><DoubleValue>15000.0</DoubleValue></JaxbValueItem></JaxbSettingValue><JaxbSettingValue><Name>ObjectName</Name><JaxbValueItem type="String"><StringValue>F3L</StringValue></JaxbValueItem></JaxbSettingValue></JaxbAnalysisSettings></R>',
  plateSetup: '<Plate><Rows>8</Rows><Columns>12</Columns></Plate>',
  analysisResult: 'Session Name\t\nWell\tSample Name\tDetector\tTask\tCt\tAvg Ct\tCt SD\n16\tS1\tF3L\tTarget\t16.5\t16.5\t\t\t\t\t\nRn values\t1\t2\t3\nDelta Rn values\t0\t1\t5\n' +
    '17\tS1\tF3L\tTarget\t40.0\t\t\t\t\t\t\nRn values\t1\t1\t1\nDelta Rn values\t0\t0\t0\n',
};
const d = parseEds(f);
assert.equal(d.info.name, 't & run'); assert.equal(d.info.instrument, 'sds7500fast');
assert.equal(d.detectors[0].threshold, 15000);
assert.equal(d.reads.length, 2); assert.equal(d.reads[0].well, 'B5'); assert.deepEqual(d.reads[0].drn, [0, 1, 5]);
assert.equal(d.reads[0].detected, true); assert.equal(d.reads[1].detected, false); assert.equal(d.cycles, 3);
const s = summarize(d)[0]; assert.equal(s.n, 2); assert.equal(s.pos, 1); assert.equal(s.mean, 16.5);
console.log('eds tests passed');

// 표준곡선 정량: Ct = -3.32 log10(q) + 38  → 기울기·절편·효율·정량값
{
  const { standardCurves } = await import('../public/eds.js');
  const mk = (idx, task, q, ct) => ({ idx, well: 'A' + idx, target: 'T', task2: task, setQty: q, ct, detected: ct < 40 });
  const reads = [1e6, 1e5, 1e4, 1e3].flatMap((q, i) => [0, 1].map((k) => mk(i * 2 + k, 'STANDARD', q, -3.32 * Math.log10(q) + 38)));
  reads.push(mk(20, 'UNKNOWN', 1, -3.32 * Math.log10(5e4) + 38), mk(21, 'UNKNOWN', 1, 40));
  const data = { detectors: [{ name: 'T' }], reads };
  const [c] = standardCurves(data);
  assert.ok(Math.abs(c.slope + 3.32) < 1e-9 && Math.abs(c.intercept - 38) < 1e-9 && Math.abs(c.r2 - 1) < 1e-12);
  assert.ok(Math.abs(c.efficiency - 100.1) < 0.2);
  assert.ok(Math.abs(reads[8].calcQty / 5e4 - 1) < 1e-9); assert.equal(reads[9].calcQty, null);
  console.log('std tests passed');
}

// 임계값 재계산: crossing / applyThresholds
{
  const { crossing, applyThresholds } = await import('../public/eds.js');
  const y = [1, 2, 4, 8, 16, 32, 64, 128, 128, 128];       // 정확히 2배씩
  assert.ok(Math.abs(crossing(y, 16) - 5) < 1e-12);          // T=16 은 5번째 사이클 값
  assert.ok(Math.abs(crossing(y, 24) - (4 + Math.log2(24 / 16))) < 1e-9 || Math.abs(crossing(y, 24) - 5.585) < 0.01);
  assert.equal(crossing(y, 1000), null);
  assert.equal(crossing([0, 50, 5, 30], 40), null, '중간에 다시 내려가면 인정하지 않음');
  const mk = (idx, sample, ct, drn) => ({ idx, sample, target: 'T', ct, detected: ct < 40, ctMean: null, ctSd: null, drn, rn: [] });
  const data = { detectors: [{ name: 'T', threshold: 16 }], reads: [mk(0, 'S', 5, y), mk(1, 'S', 5, y)] };
  assert.equal(applyThresholds(data, { T: 16 }).size, 0);   // 장비와 같은 값이면 사용자 지정 아님
  const u = applyThresholds(data, { T: 64 });
  assert.ok(u.has('T') && Math.abs(data.reads[0].ct - 7) < 1e-9 && data.reads[0].ctSd === 0 && data.reads[0].ctMean === data.reads[0].ct);
  applyThresholds(data, {});                                 // 되돌리기
  assert.equal(data.reads[0].ct, 5);
  console.log('threshold tests passed');
}
// 보고서 모델
{
  const { buildModel, renderPages } = await import('../public/eds-report.js');
  const d = parseEds(f);
  d.reads.forEach((r) => { r.task2 = r.task; });
  const m = buildModel(d, { fileName: 't.eds', version: '0', program: 'P', thr: {}, user: new Set(), curves: [], images: {} });
  assert.ok(m.some((b) => b.t === 'title') && m.filter((b) => b.t === 'table').length >= 5);
  const pages = renderPages(m, {});
  assert.ok(pages.length >= 1 && pages.join('').includes('B5'));
  console.log('report model tests passed');
}
