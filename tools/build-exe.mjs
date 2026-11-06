// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 데스크톱 실행 파일 빌드 (Go, 아주 작은 단일 exe).
//   node tools/build-exe.mjs            → dist/WasteWaterPCRValidator-win-x64.exe      (Windows 10/11 64비트)
//   node tools/build-exe.mjs --arm64    → dist/WasteWaterPCRValidator-win-arm64.exe    (Windows on ARM)
//   node tools/build-exe.mjs --linux    → dist/WasteWaterPCRValidator-linux-x64        (이 PC에서 동작 확인용)
// 앱 파일(public/)을 gzip으로 압축해 exe 안에 넣는다. 필요: Node.js 18+, Go 1.22+ (없으면 build/toolchain 에 자동 설치: 인터넷 필요)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(root, 'build'), DIST = path.join(root, 'dist'), GODIR = path.join(root, 'desktop/go');
const arg = (n) => process.argv.includes(n);
const target = arg('--linux') ? { os: 'linux', arch: 'amd64', out: 'WasteWaterPCRValidator-linux-x64', gui: false }
  : arg('--arm64') ? { os: 'windows', arch: 'arm64', out: 'WasteWaterPCRValidator-win-arm64.exe', gui: true }
    : { os: 'windows', arch: 'amd64', out: 'WasteWaterPCRValidator-win-x64.exe', gui: true };
mkdirSync(BUILD, { recursive: true }); mkdirSync(DIST, { recursive: true });
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opt });

// 1) 문서 동기화 + 앱 파일 압축 묶음(assets.bin): [이름길이 u16][크기 u32][gzip길이 u32][이름][gzip]
run(process.execPath, ['tools/sync-docs.js']);
const files = [];
(function walk(dir) {
  for (const n of readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (!/\.(map|bak)$/.test(n) && !/^(releases\.json)$/.test(n) && !p.includes(`${path.sep}downloads${path.sep}`)) files.push(p);   // 다운로드 폴더·목록은 exe 안에 넣지 않는다
  }
})(path.join(root, 'public'));
const parts = [];
let raw = 0, gz = 0;
for (const p of files) {
  const name = Buffer.from(path.relative(path.join(root, 'public'), p).split(path.sep).join('/'));
  const data = readFileSync(p), z = gzipSync(data, { level: 9 });
  const h = Buffer.alloc(10); h.writeUInt16LE(name.length, 0); h.writeUInt32LE(data.length, 2); h.writeUInt32LE(z.length, 6);
  parts.push(h, name, z); raw += data.length; gz += z.length;
}
writeFileSync(path.join(GODIR, 'assets.bin'), Buffer.concat(parts));
console.log(`앱 파일 ${files.length}개 · ${(raw / 1024).toFixed(0)} KB → 압축 ${(gz / 1024).toFixed(0)} KB`);

// 2) Go 도구 찾기 (PATH → build/toolchain → 자동 설치)
let go = 'go';
try { execFileSync(go, ['version'], { stdio: 'ignore' }); } catch {
  go = path.join(BUILD, 'toolchain/go/bin/go');
  if (!existsSync(go)) {
    const meta = await (await fetch('https://go.dev/dl/?mode=json')).json();
    const os = process.platform === 'darwin' ? 'darwin' : 'linux', arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    if (process.platform === 'win32') throw new Error('Windows에서는 https://go.dev/dl/ 에서 Go를 설치한 뒤 다시 실행하세요.');
    const f = meta[0].files.find((x) => x.os === os && x.arch === arch && x.kind === 'archive');
    const buf = Buffer.from(await (await fetch(`https://go.dev/dl/${f.filename}`)).arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('Go 다운로드 SHA-256 불일치');
    mkdirSync(path.join(BUILD, 'toolchain'), { recursive: true });
    const tgz = path.join(BUILD, 'toolchain/go.tgz'); writeFileSync(tgz, buf);
    run('tar', ['xzf', tgz, '-C', path.join(BUILD, 'toolchain')]);
    console.log('Go 설치 완료', meta[0].version);
  }
}

// 3) 빌드: 외부 라이브러리 없음, 심볼/디버그 정보 제거, Windows는 콘솔 창 없는 GUI 프로그램
const ver = /VERSION = '([^']+)'/.exec(readFileSync(path.join(root, 'public/version.js'), 'utf8'))[1];
const out = path.join(DIST, target.out);
const ld = `-s -w -X main.version=v${ver}${target.gui ? ' -H=windowsgui' : ''}`;
run(go, ['build', '-trimpath', '-buildvcs=false', '-ldflags', ld, '-o', out, '.'], {
  cwd: GODIR, env: { ...process.env, GOOS: target.os, GOARCH: target.arch, CGO_ENABLED: '0', GOCACHE: path.join(BUILD, 'gocache'), GOFLAGS: '-mod=mod' },
});
console.log('완료:', out, `(${(statSync(out).size / 1048576).toFixed(2)} MB)`);
