#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 치치박사&박박사
"""결과서 HWPX → 빈 입력 템플릿(public/template.hwpx) 생성.

- 입력 칸(Ct, 기재값, 회수율 표, 기관 정보 등)을 비우고 연녹색(#C6EFCE)으로 칠한다.
- 개인정보/실험 이미지 제거: 증폭곡선 그림, 미리보기 이미지, 문서 작성자/수정자 메타.
사용: python3 tools/make_template.py "<원본.hwpx>" public/template.hwpx
"""
import re, sys, zipfile, copy, zlib, struct
from lxml import etree

NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph', 'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
      'hc': 'http://www.hancom.co.kr/hwpml/2011/core', 'opf': 'http://www.idpf.org/2007/opf/'}
HP = '{%s}' % NS['hp']
GREEN = '#C6EFCE'

def txt(tc):
    return ''.join(t.text or '' for t in tc.iter(HP + 't')).strip()

def addr(tc):
    a = tc.find('hp:cellAddr', NS)
    return int(a.get('rowAddr')), int(a.get('colAddr'))

def leaf_tables(root):
    return [t for t in root.iter(HP + 'tbl') if next(t.iter(HP + 'tbl'), None) is None or
            len(list(t.iter(HP + 'tbl'))) == 1]  # 자기 자신만 포함 = leaf

def clear(tc):
    ts = list(tc.iter(HP + 't'))
    for i, t in enumerate(ts):
        t.text = ''
        for ch in list(t): t.remove(ch)

def placeholder_png(w, h):
    """그래프 자리표시자(흰 바탕 + 회색 테두리). 앱이 내보낼 때 실제 그래프로 교체한다."""
    raw = b''
    for y in range(h):
        row = bytearray(b'\xff' * (w * 3))
        if y in (0, 1, h - 2, h - 1):
            row[:] = b'\xaa' * (w * 3)
        else:
            for x in (0, 1, w - 2, w - 1):
                row[x * 3:x * 3 + 3] = b'\xaa\xaa\xaa'
        raw += b'\x00' + bytes(row)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def main(src, dst):
    zin = zipfile.ZipFile(src)
    files = {n: zin.read(n) for n in zin.namelist()}
    order = zin.namelist()

    sec = etree.fromstring(files['Contents/section0.xml'])

    # 1) 둘째 쪽(시험결과 기술) 제거: pageBreak 단락
    for p in list(sec):
        if p.tag == HP + 'p' and p.get('pageBreak') == '1':
            sec.remove(p)
    # 1-1) 표준곡선 표의 빈 칸('-', 2×2 병합) → Efficiency 기록 자리
    for tc in sec.iter(HP + 'tc'):
        if txt(tc) == '-' and tc.find('hp:cellAddr', NS).get('colAddr') == '4':
            next(tc.iter(HP + 't')).text = 'Efficiency (%)'
    # 2) 머리글에서 '및 시험결과 기술' 제거
    for t in sec.iter(HP + 't'):
        if t.text and '및 시험결과 기술 ' in t.text:
            t.text = t.text.replace('및 시험결과 기술 ', '')
    # 3) 증폭곡선 그림 표: Amplification Plot 행 제거 (BCoV standard curve만 유지)
    for tbl in [x for x in sec.iter(HP + 'tbl') if len(list(x.iter(HP + 'tbl'))) == 1]:  # 안쪽(leaf) 표만
        for tr in list(tbl.iter(HP + 'tr')):
            if 'Amplification' in ''.join(x.text or '' for x in tr.iter(HP + 't')):
                h = int(tr.find('hp:tc/hp:cellSz', NS).get('height'))
                tr.getparent().remove(tr)
                tbl.set('rowCnt', str(int(tbl.get('rowCnt')) - 1))
                sz = tbl.find('hp:sz', NS); sz.set('height', str(int(sz.get('height')) - h))
    for c in sec.iter(HP + 'shapeComment'):
        c.text = 'BCoV standard curve (앱에서 자동 생성되는 그래프 자리)'
    inputs = []  # 입력 칸 tc 목록
    for tbl in leaf_tables(sec):
        cells = {addr(tc): tc for tc in tbl.iter(HP + 'tc')}
        texts = {k: txt(v) for k, v in cells.items()}
        vals = list(texts.values())
        rows = max(r for r, _ in cells) + 1
        if any('기관명' in v for v in vals):                      # 기관 정보 표: 값 칸 = 홀수 열
            inputs += [cells[k] for k in cells if k[1] % 2 == 1]
        if 'Slope' in vals:                                       # 표준곡선 표
            for r in range(rows):
                if re.match(r'^10', texts.get((r, 0), '')) and (r, 1) in cells:
                    inputs += [cells[(r, c)] for c in (1, 2, 3) if (r, c) in cells]
                if texts.get((r, 4), '').replace(' ', '').lower() in ('slope', 'y-inter', 'r2'):
                    inputs.append(cells[(r, 5)])
        if any(v.startswith('반복 횟수') for v in vals):          # 회수율 표 (Spiked 열은 기본값 100,000 유지)
            for r in range(1, rows):
                if re.match(r'^\d+$', texts.get((r, 0), '').strip()):
                    inputs += [cells[(r, c)] for c in (1, 2, 3, 4) if (r, c) in cells]
            inputs += [cells[(1, c)] for c in (5, 6, 7) if (1, c) in cells]

    # 헤더: 연녹색 borderFill 복제
    hdr = etree.fromstring(files['Contents/header.xml'])
    bfs = hdr.find('.//hh:borderFills', NS)
    byid = {b.get('id'): b for b in bfs.findall('hh:borderFill', NS)}
    nxt = max(int(i) for i in byid) + 1
    green_of = {}
    for tc in inputs:
        old = tc.get('borderFillIDRef')
        if old not in green_of:
            nb = copy.deepcopy(byid[old]); nb.set('id', str(nxt))
            for f in nb.findall('hc:fillBrush', NS): nb.remove(f)
            fb = etree.SubElement(nb, '{%s}fillBrush' % NS['hc'])
            wb = etree.SubElement(fb, '{%s}winBrush' % NS['hc'])
            wb.set('faceColor', GREEN); wb.set('hatchColor', '#999999'); wb.set('alpha', '0')
            bfs.append(nb); green_of[old] = str(nxt); nxt += 1
        tc.set('borderFillIDRef', green_of[old])
    bfs.set('itemCnt', str(len(bfs.findall('hh:borderFill', NS))))

    # 값 비우기 (회수율 표의 Spiked 열은 기본값 유지)
    keep = set()
    for tbl in leaf_tables(sec):
        if any(txt(tc).startswith('반복 횟수') for tc in tbl.iter(HP + 'tc')):
            keep |= {id(tc) for tc in tbl.iter(HP + 'tc') if addr(tc)[1] == 2 and addr(tc)[0] >= 1}
    for tc in inputs:
        if id(tc) not in keep: clear(tc)

    # 남은 그림(BCoV standard curve 자리)은 유지 — 이미지는 자리표시자 PNG로 교체

    ser = lambda e: etree.tostring(e, xml_declaration=True, encoding='UTF-8', standalone=True)
    files['Contents/section0.xml'] = ser(sec)
    files['Contents/header.xml'] = ser(hdr)

    # 매니페스트 / 메타 / 미리보기 정리
    hpf = files['Contents/content.hpf'].decode('utf8')
    hpf = re.sub(r'<opf:item id="image2"[^>]*/>', '', hpf)
    hpf = re.sub(r'<opf:item id="image1"[^>]*/>', '<opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/>', hpf)
    hpf = re.sub(r'(<opf:meta name="(?:creator|lastsaveby)" content="text">)[^<]*', r'\1', hpf)
    files['Contents/content.hpf'] = hpf.encode('utf8')
    for n in [n for n in files if n.startswith('BinData/') or n == 'Preview/PrvImage.png']:
        del files[n]; order.remove(n)
    files['BinData/image1.png'] = placeholder_png(1037, 606); order.append('BinData/image1.png')
    files['Preview/PrvText.txt'] = '하수 내 병원체 검출검사 숙련도 평가 결과서 입력 템플릿 (녹색 칸에 입력)'.encode('utf8')

    with zipfile.ZipFile(dst, 'w') as zo:
        for n in order:
            zo.writestr(n, files[n], zipfile.ZIP_STORED if n == 'mimetype' else zipfile.ZIP_DEFLATED)
    print('inputs:', len(inputs), 'green fills:', green_of, '->', dst)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
