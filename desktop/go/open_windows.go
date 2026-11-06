// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// 기본 브라우저로 열기 (콘솔 창이 깜박이지 않도록 rundll32 사용)
func openBrowser(url string) bool {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start() == nil
}

// 창이 없는 프로그램이라 오류는 메시지 상자로 알린다
func notify(msg string) {
	t, _ := syscall.UTF16PtrFromString("하수 PCR 검증기")
	m, _ := syscall.UTF16PtrFromString(msg)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x40)
}
