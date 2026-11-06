// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 루트의 문서(LICENSE, CHANGELOG, THIRD_PARTY_NOTICES)를 public/로 복사해 앱에서 보여줄 수 있게 한다.
import { copyFileSync } from 'node:fs';
for (const f of ['LICENSE.txt:LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md']) {
  const [dst, src] = f.includes(':') ? f.split(':') : [f, f];
  copyFileSync(src, `public/${dst}`);
}
console.log('docs synced');
