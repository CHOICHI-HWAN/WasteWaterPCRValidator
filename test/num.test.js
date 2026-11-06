// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { parseStrict, roundHalfUp, fixed, explainInvalid } from '../public/num.js';
import { standardCurve, recovery } from '../public/calc.js';

// 1) 엄격한 숫자 해석
const ok = { '18.65': 18.65, '-3.982': -3.982, '+1.2': 1.2, '.5': 0.5, '5.': 5, '1.4e6': 1400000, '1.4E+06': 1400000, '1,400,000': 1400000, ' 9,362.05 ': 9362.05, '12.29%': 12.29, '\u22123.982': -3.982, '１８.６５': 18.65, '18.65\u00a0': 18.65 };
for (const [s, v] of Object.entries(ok)) assert.equal(parseStrict(s), v, `허용: ${JSON.stringify(s)}`);
for (const s of ['', ' ', '-', '18,65', '1,40', '18.65abc', '18..65', '0x1F', 'Infinity', 'NaN', '18.65 27.1', '1,4000', 'abc', null, undefined, NaN, Infinity]) {
  assert.ok(Number.isNaN(parseStrict(s)), `거부: ${JSON.stringify(s)}`);
}
assert.match(explainInvalid('18,65'), /점\(\.\)/);
assert.match(explainInvalid('18.65abc'), /글자/);

// 2) 엑셀식 반올림 (toFixed와 달라지는 경계값)
const cases = [[1.005, 2, '1.01'], [2.675, 2, '2.68'], [1.255, 2, '1.26'], [0.285, 2, '0.29'], [10.075, 2, '10.08'], [12285.775, 2, '12285.78'], [-1.005, 2, '-1.01'], [-3.98267, 3, '-3.983'], [0.99179, 4, '0.9918'], [78.274, 1, '78.3'], [1e-7, 3, '0.000'], [123456789.125, 2, '123456789.13'], [0, 2, '0.00']];
for (const [x, d, s] of cases) assert.equal(fixed(x, d), s, `fixed(${x}, ${d})`);
assert.equal(fixed(NaN, 2), '');

// 3) 계산 계층은 number(double)만 받는다 — 문자열이 조용히 버려지지 않고 오류가 난다
assert.throws(() => standardCurve([{ conc: 1e6, cts: ['18.65', 20] }, { conc: 1e5, cts: [21, 22] }]), TypeError);
assert.throws(() => standardCurve([{ conc: '1400000', cts: [18, 19] }, { conc: 1e5, cts: [21, 22] }]), TypeError);
assert.throws(() => recovery('26.89', { slope: -3.3, intercept: 40 }, 1e5), TypeError);
// 빈 칸(NaN)은 허용되고 계산에서 제외
const c = standardCurve([{ conc: 1e6, cts: [18, NaN, 18.2] }, { conc: 1e5, cts: [21, 21.1, 21.2] }, { conc: 1e4, cts: [24.5, 24.6, NaN] }]);
assert.equal(c.n, 7);

// 4) 모두 IEEE-754 double: 합이 정확히 재현됨
assert.equal(typeof c.slope, 'number'); assert.ok(Number.isFinite(c.slope));
console.log('num ok');
