// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// 릴리스 빌드에서 Windows 콘솔 창이 같이 뜨지 않게 한다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    heavenly_lab_lib::run()
}
