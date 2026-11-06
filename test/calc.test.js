// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { standardCurve, recovery, mean, sd } from '../public/calc.js';

const rows = [1.4e6, 1.4e5, 1.4e4, 1.4e3, 1.4e2].map((conc, i) => ({
  conc,
  cts: [[18.65,18.65,18.69],[21.99,22.19,21.64],[25.37,25.39,25.79],[30.91,29.95,29.98],[35.05,33.89,34.28]][i],
}));
const c = standardCurve(rows, 'log');
assert.ok(Math.abs(c.slope - -3.982) < 0.001, 'slope');
assert.ok(Math.abs(c.r2 - 0.992) < 0.001, 'r2');
// 결과서의 Y-inter(43.174)와 계산값(42.674)은 0.5 차이 -> 앱이 경고해야 하는 케이스
assert.ok(Math.abs(c.intercept - 42.674) < 0.001, 'intercept');

const rep = { slope: -3.982, intercept: 43.174 };
const pcts = [26.89, 26.98, 27.36].map((ct) => recovery(ct, rep, 1e5).pct);
assert.ok(Math.abs(pcts[0] - 12.29) < 0.01);
assert.ok(Math.abs(mean(pcts) - 11.10) < 0.01);
assert.ok(Math.abs(sd(pcts, false) - 1.26) < 0.01, 'SD는 모집단(STDEV.P) 기준');
assert.ok(Math.abs(sd(pcts, false) / mean(pcts) * 100 - 11.32) < 0.02, 'RSD');
console.log('ok', c);

// 버전/문서 일관성
import { readFileSync } from 'node:fs';
import { VERSION } from '../public/version.js';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
assert.equal(VERSION, pkg.version, 'version.js와 package.json 버전 불일치');
assert.ok(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').includes(`## [${VERSION}]`), 'CHANGELOG에 현재 버전 없음');
console.log('version ok', VERSION);
