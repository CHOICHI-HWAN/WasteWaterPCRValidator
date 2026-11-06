// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 릴리스 산출물 만들기: Windows exe 빌드 → public/downloads/ 에 exe·zip 배치 → public/releases.json(다운로드 목록) 생성.
// 웹 사이트의 "Releases" 사이드 패널이 releases.json 을 읽어 링크를 보여 준다. (생성물은 git에 올리지 않고 배포 때만 올라간다)
//   node tools/release.mjs          (npm run release)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// JSZip(UMD)을 CommonJS처럼 불러온다 (프로젝트가 type:module 이라 require()로는 바로 못 읽음)
const JSZip = (() => { const m = { exports: {} }; new Function('module', 'exports', 'require', readFileSync(path.join(root, 'public/vendor/jszip/jszip.min.js'), 'utf8'))(m, m.exports, require); return m.exports; })();
const ver = /VERSION = '([^']+)'/.exec(readFileSync(path.join(root, 'public/version.js'), 'utf8'))[1];
const date = process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10);
const sha = (b) => createHash('sha256').update(b).digest('hex');

// 1) 다운로드 폴더를 비운 뒤 exe 빌드 (exe 안에 이전 exe가 들어가지 않도록)
rmSync(path.join(root, 'public/downloads'), { recursive: true, force: true });
rmSync(path.join(root, 'public/releases.json'), { force: true });
execFileSync(process.execPath, ['tools/build-exe.mjs'], { cwd: root, stdio: 'inherit' });

// 2) 배치
const dl = path.join(root, 'public/downloads'); mkdirSync(dl, { recursive: true });
const exeName = 'WasteWaterPCRValidator-win-x64.exe';
// 주의: Firebase 무료(Spark) 요금제는 .exe 호스팅을 금지하므로 exe 단독 파일은 올리지 않고 zip 안에만 넣는다.
const exe = readFileSync(path.join(root, 'dist', exeName)), exeSha = sha(exe);

// 3) zip (사용방법 + Go 라이선스 + exe)
const guide = readFileSync(path.join(root, 'desktop/사용방법.template.txt'), 'utf8').replaceAll('{{VERSION}}', `v${ver}`).replaceAll('{{SHA}}', exeSha);
const zip = new JSZip();
zip.file('사용방법.txt', guide); zip.file('GO_LICENSE.txt', readFileSync(path.join(root, 'desktop/GO_LICENSE.txt')));
zip.file(exeName, exe, { compression: 'DEFLATE', compressionOptions: { level: 9 } });
const zipName = `WasteWaterPCRValidator-win-x64_v${ver}.zip`;
const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
writeFileSync(path.join(dl, zipName), zipBuf);

// 4) 변경 이력에서 이번 버전의 항목 요약
const log = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const sec = new RegExp(`## \\[${ver.replace(/\\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`).exec(log)?.[1] ?? '';
const notes = sec.split('\n').filter((l) => l.startsWith('- ')).slice(0, 3).map((l) => l.slice(2).replace(/\*\*/g, '').replace(/`/g, '').replace(/\([^)]*\)/g, '').trim().slice(0, 110));

// 5) 목록
const manifest = {
  version: ver, date, notes,
  exe: { name: exeName, size: exe.length, sha256: exeSha },   // zip 안의 exe (압축을 푼 뒤 확인용)
  assets: [
    { kind: 'zip', name: zipName, path: `downloads/${zipName}`, size: zipBuf.length, sha256: sha(zipBuf), note: '압축을 풀면 exe(' + (exe.length / 1048576).toFixed(2) + ' MB) · Windows 10/11 · 설치·인터넷 불필요' },
  ],
};
writeFileSync(path.join(root, 'public/releases.json'), JSON.stringify(manifest, null, 2));
console.log(`릴리스 v${ver} (${date}) — zip ${(zipBuf.length / 1048576).toFixed(2)} MB (exe ${(exe.length / 1048576).toFixed(2)} MB 포함)`);
