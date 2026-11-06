// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
//go:build !windows

package main

import (
	"os"
	"os/exec"
	"runtime"
)

func openBrowser(url string) bool {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	return exec.Command(name, url).Start() == nil
}

func notify(msg string) { os.Stderr.WriteString(msg + "\n") }
