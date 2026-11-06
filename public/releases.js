// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 오른쪽 사이드 패널의 "Releases": 변경 이력(CHANGELOG.md)에서 버전 목록을, releases.json(배포 때 생성)에서 다운로드 파일을 읽어 보여 준다.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ICON = { exe: '🪟', zip: '🗜️' };

export async function initSidePanel({ local, openChangelog }) {
  let versions = [];
  try {
    const t = await (await fetch('CHANGELOG.md', { cache: 'no-cache' })).text();
    versions = [...t.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/gm)].map((m) => ({ v: m[1], d: m[2] }));
  } catch { /* 목록 없이도 동작 */ }
  $('relCount').textContent = versions.length || '–';

  let man = null;
  if (!local) { try { const r = await fetch('releases.json', { cache: 'no-cache' }); if (r.ok) man = await r.json(); } catch { /* 없으면 아래 안내 */ } }
  const ver = man?.version ?? versions[0]?.v, date = man?.date ?? versions[0]?.d;

  let html = '';
  if (ver) {
    html += `<div class="rel-head"><span>🏷️</span><b>v${esc(ver)}</b><span class="latest">Latest</span></div><div class="rel-date">${esc(date ?? '')} · 베타</div>`;
    if (man?.notes?.length) html += `<ul class="rel-notes">${man.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  }
  if (man?.assets?.length) {
    html += '<div class="assets">' + man.assets.map((a) =>
      `<a class="asset" href="${esc(a.path)}" download><span class="ai">${ICON[a.kind] ?? '📦'}</span><span class="an">${esc(a.name)}<small>${size(a.size)} · ${esc(a.note ?? '')}</small></span><span class="ad">⬇</span></a>`).join('') + '</div>';
    if (man.exe) html += `<div class="sha" title="${esc(man.exe.sha256)}">exe SHA-256 <code>${esc(man.exe.sha256.slice(0, 12))}…</code><button type="button" id="shaCopy">복사</button></div>`;
    html += '<div class="note" style="margin-top:8px">압축을 풀고 <b>exe를 더블클릭</b>하세요. 코드 서명이 없어 처음에는 Windows 경고(SmartScreen)가 뜰 수 있어요 → <b>추가 정보 → 실행</b>. (무료 호스팅 정책상 exe는 zip으로 제공해요)</div>';
  } else if (local) {
    html += '<div class="dl-empty">지금 실행 파일(exe)로 사용 중이에요. 최신 exe는 웹 사이트에서 받을 수 있어요.</div><a class="asset" href="https://wwpcr.web.app/#releases" target="_blank" rel="noopener"><span class="ai">🌐</span><span class="an">웹 사이트의 Releases<small>wwpcr.web.app</small></span><span class="ad">↗</span></a>';
  } else {
    html += '<div class="dl-empty">다운로드 파일 목록을 불러오지 못했어요.</div>';
  }
  $('relLatest').innerHTML = html;

  $('relOlder').innerHTML = versions.slice(1, 5).map((x) => `<li><b>v${esc(x.v)}</b><span>${esc(x.d)}</span></li>`).join('');
  const all = $('relAll');
  all.textContent = versions.length > 5 ? `+ ${versions.length - 5}개 더 · 변경 이력 보기` : '변경 이력 보기';
  all.addEventListener('click', openChangelog);
  $('shaCopy')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(man.exe.sha256); e.target.textContent = '복사됨 ✓'; setTimeout(() => { e.target.textContent = '복사'; }, 1500); } catch { e.target.textContent = '복사 실패'; }
  });
}
