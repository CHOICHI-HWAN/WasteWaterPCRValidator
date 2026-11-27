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
