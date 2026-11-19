// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
import assert from 'node:assert/strict';
import { erfc, normCdf, normQuantile, chi2sf, probitFit, wilson } from '../public/probit.js';

const close = (a, b, rel = 1e-9, abs = 1e-12) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

// 1) 특수 함수: 알려진 값 (수학 표/표준 구현)
assert.ok(close(erfc(0.5), 0.4795001221869535), 'erfc(0.5)');
assert.ok(close(erfc(1), 0.15729920705028513), 'erfc(1)');
assert.ok(close(erfc(3), 2.209049699858544e-05, 1e-9), 'erfc(3) (급수/연분수 경계)');
assert.ok(close(erfc(5), 1.5374597944280347e-12, 1e-9), 'erfc(5)');
assert.ok(close(erfc(-1), 2 - 0.15729920705028513), 'erfc(-1)');
assert.ok(close(normCdf(1.96), 0.9750021048517795), 'Φ(1.96)');
assert.ok(close(normCdf(-6), 9.865876450376981e-10, 1e-8), 'Φ(-6)');
assert.ok(close(normQuantile(0.975), 1.959963984540054, 1e-12), 'Φ⁻¹(0.975)');
assert.ok(close(normQuantile(0.95), 1.6448536269514722, 1e-12), 'Φ⁻¹(0.95)');
assert.ok(Math.abs(normQuantile(0.5)) < 1e-14 && close(normQuantile(0.05), -1.6448536269514722, 1e-12));
for (const p of [1e-8, 0.001, 0.3, 0.7, 0.999]) assert.ok(close(normCdf(normQuantile(p)), p, 1e-11), `왕복 ${p}`);
assert.ok(close(chi2sf(3.841458820694124, 1), 0.05, 1e-9), 'χ²(1) 5%');
assert.ok(close(chi2sf(5.991464547107979, 2), 0.05, 1e-9), 'χ²(2) 5%');
assert.ok(close(chi2sf(7.814727903251179, 3), 0.05, 1e-9), 'χ²(3) 5%');
assert.ok(close(chi2sf(18.307038053275146, 10), 0.05, 1e-9), 'χ²(10) 5%');
assert.equal(chi2sf(0, 3), 1);

// 2) 별도 최적화(Nelder–Mead)와 교차 확인하는 최대우도
function logLik(L, a, b) { let s = 0; for (const l of L) { const x = Math.log10(l.conc), e = a + b * x; const P = normCdf(e), Q = normCdf(-e); s += (l.k ? l.k * Math.log(P) : 0) + (l.n - l.k ? (l.n - l.k) * Math.log(Q) : 0); } return s; }
function nelderMead(f, x0) {
  let S = [x0, [x0[0] + 0.5, x0[1]], [x0[0], x0[1] + 0.5]].map((p) => ({ p, v: f(p) }));
  for (let it = 0; it < 4000; it++) {
    S.sort((u, v) => u.v - v.v);
    if (Math.abs(S[2].v - S[0].v) < 1e-15) break;
    const c = [(S[0].p[0] + S[1].p[0]) / 2, (S[0].p[1] + S[1].p[1]) / 2], w = S[2].p;
    const mk = (t) => { const p = [c[0] + t * (w[0] - c[0]), c[1] + t * (w[1] - c[1])]; return { p, v: f(p) }; };
    const r = mk(-1);
    if (r.v < S[0].v) { const e = mk(-2); S[2] = e.v < r.v ? e : r; }
    else if (r.v < S[1].v) S[2] = r;
    else { const k = mk(r.v < S[2].v ? -0.5 : 0.5); if (k.v < S[2].v) S[2] = k; else for (const i of [1, 2]) { const p = [(S[0].p[0] + S[i].p[0]) / 2, (S[0].p[1] + S[i].p[1]) / 2]; S[i] = { p, v: f(p) }; } }
  }
  S.sort((u, v) => u.v - v.v); return S[0];
}
const crossCheck = (L, name) => {
  const fit = probitFit(L); assert.ok(fit.ok, `${name}: 적합 성공`);
  const nm = nelderMead(([a, b]) => -logLik(L, a, b), [fit.a + 0.3, fit.b * 0.8]);
  assert.ok(Math.abs(nm.p[0] - fit.a) < 1e-5 && Math.abs(nm.p[1] - fit.b) < 1e-5, `${name}: a,b가 독립 최적화와 일치 (${fit.a}, ${fit.b} vs ${nm.p})`);
  assert.ok(Math.abs(-nm.v - fit.logLik) < 1e-9, `${name}: 로그우도 일치`);
  return fit;
};

// (a) 예시 자료: 농도 1000 → 0.1 (10배 희석), 각 25회
const SAMPLE = [1000, 100, 10, 1, 0.1].map((conc, i) => ({ conc, n: 25, k: [25, 22, 16, 6, 0][i] }));
const f1 = crossCheck(SAMPLE, '예시');
// (b) 공개 고전 자료: Bliss(1935) 딱정벌레 이황화탄소 용량-사망 (Agresti 등 교과서에 실린 자료)
const BLISS = [[1.6907, 59, 6], [1.7242, 60, 13], [1.7552, 62, 18], [1.7842, 56, 28], [1.8113, 63, 52], [1.8369, 59, 53], [1.8610, 62, 61], [1.8839, 60, 60]].map(([x, n, k]) => ({ conc: 10 ** x, n, k }));
const f2 = crossCheck(BLISS, 'Bliss');
console.log('Bliss probit: a =', f2.a.toFixed(3), ' b =', f2.b.toFixed(3), '(교과서 값: 약 -34.94, 19.73)');
assert.ok(Math.abs(f2.a - -34.935) < 0.02 && Math.abs(f2.b - 19.728) < 0.02, '교과서에 실린 Bliss probit 계수와 일치');

// 3) C_p 의 정의와 신뢰구간 성질
for (const f of [f1, f2]) {
  for (const p of [0.05, 0.5, 0.95]) {
    const c = f.cp(p);
    assert.ok(close(normCdf(f.a + f.b * c.x), p, 1e-9), `probit 정의: 적합 곡선이 C${p * 100}에서 ${p}`);
    assert.ok(c.bounded && c.lo < c.c && c.c < c.hi, `C${p * 100} 신뢰구간이 점추정을 포함`);
    for (const bound of [c.lo, c.hi]) {         // Fieller 경계에서 검정통계량 = 1.959964
      const x = Math.log10(bound), z = c.z, se = Math.sqrt(f.cov.aa + 2 * x * f.cov.ab + x * x * f.cov.bb);
      assert.ok(close(Math.abs(f.a + f.b * x - z) / se, 1.959964, 1e-6), `Fieller 경계 통계량 (C${p * 100})`);
    }
  }
  assert.ok(f.C05.c < f.C50.c && f.C50.c < f.C95.c, 'C05 < C50 < C95');
  assert.ok(close(f.C50.c, 10 ** (-f.a / f.b), 1e-12), 'C50 = 10^(-a/b)');
}
assert.ok(f2.pDev > 0.05, 'Bliss 자료는 probit에 적합');

// 4) 입력 처리와 예외
const sep = probitFit([{ conc: 1, n: 10, k: 0 }, { conc: 10, n: 10, k: 10 }]);
assert.equal(sep.ok, false); assert.match(sep.reason, /완전 분리/);
assert.equal(probitFit([{ conc: 1, n: 10, k: 5 }]).ok, false);
const dropped = probitFit([...SAMPLE, { conc: 0, n: 25, k: 0 }, { conc: 5, n: 25, k: 30 }, { conc: NaN, n: 25, k: 1 }]);
assert.ok(dropped.ok && dropped.dropped.length === 3, '잘못된 행은 제외하고 이유를 알려 준다');
assert.deepEqual(dropped.dropped.map((d) => d.row), [6, 7, 8]);
const merged = probitFit([...SAMPLE, { conc: 10, n: 25, k: 17 }]);
assert.ok(merged.used.find((u) => u.conc === 10).n === 50, '같은 농도는 합산');
const w = wilson(8, 25); assert.ok(w[0] < 0.32 && w[1] > 0.32 && w[0] > 0.15 && w[1] < 0.54, 'Wilson 구간');
// 경고
const warn = probitFit([{ conc: 1, n: 5, k: 1 }, { conc: 10, n: 5, k: 3 }, { conc: 100, n: 5, k: 5 }]);
assert.ok(!warn.ok || warn.warnings.length > 0, '자료가 부족하면 경고');
console.log('probit ok', { a: +f1.a.toFixed(4), b: +f1.b.toFixed(4), C05: +f1.C05.c.toFixed(3), C50: +f1.C50.c.toFixed(3), C95: +f1.C95.c.toFixed(2), pDev: +f1.pDev.toFixed(3) });

// --- v0.25: 프로파일 우도 구간, 신뢰 띠 ---
{
  const f = probitFit([{ conc: 1000, n: 25, k: 25 }, { conc: 100, n: 25, k: 22 }, { conc: 10, n: 25, k: 16 }, { conc: 1, n: 25, k: 6 }, { conc: 0.1, n: 25, k: 0 }].map((r) => r), { ci: 'profile' });
  const g = probitFit([{ conc: 1000, n: 25, k: 25 }, { conc: 100, n: 25, k: 22 }, { conc: 10, n: 25, k: 16 }, { conc: 1, n: 25, k: 6 }, { conc: 0.1, n: 25, k: 0 }]);
  const pf = f.cp(0.5), fl = g.cp(0.5);
  assert.ok(pf.bounded && fl.bounded && pf.lo < pf.c && pf.c < pf.hi, 'profile CI brackets C50');
  assert.ok(Math.abs(Math.log10(pf.lo / fl.lo)) < 0.15 && Math.abs(Math.log10(pf.hi / fl.hi)) < 0.15, 'profile ≈ Fieller');
  const b = g.band(30).filter((x) => x.lo !== null);
  assert.ok(b.length > 20 && b.every((x) => x.lo <= x.x && x.x <= x.hi), 'band brackets the curve');
}
