// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
//
// HeavenlyLab(LabPhobia) — 데스크톱 실행기 (아주 작은 단일 exe).
// 앱 파일(압축)을 실행 파일 안에 넣어 두고, 이 PC(127.0.0.1)에서만 접속되는 작은 서버로 열어 기본 브라우저로 띄운다.
// 입력한 데이터·업로드한 파일은 이 PC 밖으로 나가지 않는다(인터넷 연결 불필요).
// 실행 파일을 작게 유지하려고 net/http, fmt 없이 표준 라이브러리의 net/bufio만 사용한다.
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/binary"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed assets.bin
var assetsBin []byte

var version = "dev"

type asset struct {
	gz     []byte
	rawLen int
}

var (
	assets  = map[string]asset{}
	port    = 47321
	mu      sync.Mutex
	tabs    = map[string]time.Time{} // 열려 있는 브라우저 탭 → 마지막 신호 시각
	seen    bool                     // 한 번이라도 탭 신호를 받았는가
	emptyAt time.Time                // 마지막 탭이 닫힌 시각
	started = time.Now()
)

const (
	tabTTL    = 150 * time.Second // 백그라운드 탭은 신호가 느려질 수 있어 넉넉히
	byeGrace  = 8 * time.Second   // 마지막 탭이 닫히고 이 시간 안에 새 신호가 없으면 종료(새로고침은 유지)
	neverSeen = 5 * time.Minute   // 브라우저가 끝내 연결하지 않으면 종료
)

func loadAssets() {
	b := assetsBin
	for len(b) >= 10 {
		nl := int(binary.LittleEndian.Uint16(b))
		rawLen := int(binary.LittleEndian.Uint32(b[2:]))
		gzLen := int(binary.LittleEndian.Uint32(b[6:]))
		b = b[10:]
		if len(b) < nl+gzLen {
			break
		}
		assets[string(b[:nl])] = asset{gz: b[nl : nl+gzLen], rawLen: rawLen}
		b = b[nl+gzLen:]
	}
}

var mime = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".json": "application/json", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
	".hwpx": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
}

// 이 PC 밖으로 나가는 요청을 브라우저 차원에서도 막는다(앱은 외부 통신을 하지 않는다)
const csp = "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
	"connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

func writeResp(c net.Conn, status string, headers []string, body []byte, head bool) {
	var sb strings.Builder
	sb.WriteString("HTTP/1.1 " + status + "\r\n")
	for _, h := range headers {
		sb.WriteString(h + "\r\n")
	}
	sb.WriteString("Content-Length: " + strconv.Itoa(len(body)) + "\r\nConnection: close\r\n\r\n")
	c.Write([]byte(sb.String()))
	if !head {
		c.Write(body)
	}
}

func simple(c net.Conn, status, msg string) {
	writeResp(c, status, []string{"Content-Type: text/plain; charset=utf-8", "Cache-Control: no-store"}, []byte(msg), false)
}

func unescape(s string) (string, bool) {
	if !strings.Contains(s, "%") {
		return s, true
	}
	var out []byte
	for i := 0; i < len(s); i++ {
		if s[i] != '%' {
			out = append(out, s[i])
			continue
		}
		if i+2 >= len(s) {
			return "", false
		}
		v, err := strconv.ParseUint(s[i+1:i+3], 16, 8)
		if err != nil {
			return "", false
		}
		out = append(out, byte(v))
		i += 2
	}
	return string(out), true
}

func queryID(q string) string {
	for _, kv := range strings.Split(q, "&") {
		if strings.HasPrefix(kv, "id=") {
			id := kv[3:]
			if len(id) > 64 {
				id = id[:64]
			}
			return id
		}
	}
	return "-"
}

func handle(c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(15 * time.Second))
	br := bufio.NewReaderSize(c, 8192)
	line, err := br.ReadSlice('\n')
	if err != nil {
		return
	}
	parts := strings.Fields(string(line))
	if len(parts) < 2 {
		return
	}
	method, target := parts[0], parts[1]
	host, accept, clen := "", "", 0
	for n := 0; n < 64; n++ {
		l, err := br.ReadSlice('\n')
		if err != nil {
			return
		}
		s := strings.TrimRight(string(l), "\r\n")
		if s == "" {
			break
		}
		i := strings.IndexByte(s, ':')
		if i < 0 {
			continue
		}
		k, v := strings.ToLower(strings.TrimSpace(s[:i])), strings.TrimSpace(s[i+1:])
		switch k {
		case "host":
			host = strings.ToLower(v)
		case "accept-encoding":
			accept = strings.ToLower(v)
		case "content-length":
			clen, _ = strconv.Atoi(v)
		}
	}
	if clen > 0 && clen < 1<<16 {
		io.CopyN(io.Discard, br, int64(clen))
	}
	// DNS rebinding 방지: 이 PC의 주소로 접속한 요청만 허용
	p := strconv.Itoa(port)
	if host != "127.0.0.1:"+p && host != "localhost:"+p {
		simple(c, "403 Forbidden", "forbidden")
		return
	}
	if method != "GET" && method != "HEAD" && method != "POST" {
		simple(c, "405 Method Not Allowed", "method not allowed")
		return
	}
	path, query := target, ""
	if i := strings.IndexByte(target, '?'); i >= 0 {
		path, query = target[:i], target[i+1:]
	}
	path, ok := unescape(path)
	if !ok || strings.Contains(path, "..") || strings.Contains(path, "\\") || strings.IndexByte(path, 0) >= 0 {
		simple(c, "400 Bad Request", "bad request")
		return
	}
	path = strings.TrimLeft(path, "/")
	switch path {
	case "__ping":
		mu.Lock()
		tabs[queryID(query)] = time.Now()
		seen, emptyAt = true, time.Time{}
		mu.Unlock()
		writeResp(c, "204 No Content", []string{"Cache-Control: no-store"}, nil, true)
		return
	case "__bye":
		mu.Lock()
		delete(tabs, queryID(query))
		if len(tabs) == 0 {
			emptyAt = time.Now()
		}
		mu.Unlock()
		writeResp(c, "204 No Content", []string{"Cache-Control: no-store"}, nil, true)
		return
	case "__id": // 이미 실행 중인지 확인용
		writeResp(c, "200 OK", []string{"Content-Type: text/plain", "X-WWPCR: 1", "Cache-Control: no-store"}, []byte("WWPCR"), false)
		return
	case "":
		path = "index.html"
	}
	a, ok := assets[path]
	if !ok {
		simple(c, "404 Not Found", "Not found")
		return
	}
	ext := ""
	if i := strings.LastIndexByte(path, '.'); i >= 0 {
		ext = strings.ToLower(path[i:])
	}
	ct := mime[ext]
	if ct == "" {
		ct = "application/octet-stream"
	}
	h := []string{"Content-Type: " + ct, "Cache-Control: no-cache", "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer", "Content-Security-Policy: " + csp, "Vary: Accept-Encoding"}
	if strings.Contains(accept, "gzip") {
		h = append(h, "Content-Encoding: gzip")
		writeResp(c, "200 OK", h, a.gz, method == "HEAD")
		return
	}
	zr, err := gzip.NewReader(bytes.NewReader(a.gz))
	if err != nil {
		simple(c, "500 Internal Server Error", "error")
		return
	}
	raw, _ := io.ReadAll(zr)
	writeResp(c, "200 OK", h, raw, method == "HEAD")
}

// 같은 앱이 이미 이 포트에서 실행 중인가?
func isOurs(p int) bool {
	c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(p), 400*time.Millisecond)
	if err != nil {
		return false
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(800 * time.Millisecond))
	c.Write([]byte("GET /__id HTTP/1.1\r\nHost: 127.0.0.1:" + strconv.Itoa(p) + "\r\nConnection: close\r\n\r\n"))
	b, _ := io.ReadAll(c)
	return bytes.Contains(b, []byte("X-WWPCR: 1"))
}

func watchdog() {
	for range time.Tick(2 * time.Second) {
		mu.Lock()
		now := time.Now()
		for id, t := range tabs {
			if now.Sub(t) > tabTTL {
				delete(tabs, id)
				if len(tabs) == 0 && emptyAt.IsZero() {
					emptyAt = now
				}
			}
		}
		gone := seen && len(tabs) == 0 && !emptyAt.IsZero() && now.Sub(emptyAt) > byeGrace
		never := !seen && now.Sub(started) > neverSeen
		mu.Unlock()
		if gone || never {
			os.Exit(0)
		}
	}
}

func main() {
	loadAssets()
	if v, err := strconv.Atoi(os.Getenv("WWPCR_PORT")); err == nil && v > 0 {
		port = v
	}
	var ln net.Listener
	for p := port; p < port+20; p++ {
		if isOurs(p) { // 이미 실행 중이면 새로 띄우지 않고 그 화면만 연다
			openBrowser("http://127.0.0.1:" + strconv.Itoa(p) + "/")
			return
		}
		l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err == nil {
			ln, port = l, p
			break
		}
	}
	if ln == nil {
		notify("서버를 시작하지 못했습니다. 다른 프로그램이 포트를 사용 중일 수 있습니다.")
		os.Exit(1)
	}
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/"
	os.Stdout.WriteString("HeavenlyLab(LabPhobia) " + version + " (베타 · 숙련도 평가용 임시 사용)\n제작: 치치박사&박박사 · GPL v3\n주소: " + url + "\n입력한 데이터와 파일은 이 PC 밖으로 나가지 않습니다. 브라우저 탭을 닫으면 자동 종료됩니다.\n")
	go watchdog()
	if os.Getenv("WWPCR_NO_OPEN") != "1" {
		if !openBrowser(url) {
			notify("브라우저를 열지 못했습니다. 브라우저에서 아래 주소를 직접 열어 주세요.\n\n" + url)
		}
	}
	for {
		c, err := ln.Accept()
		if err != nil {
			continue
		}
		go handle(c)
	}
}
