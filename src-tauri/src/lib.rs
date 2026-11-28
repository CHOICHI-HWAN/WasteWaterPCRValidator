// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 치치박사&박박사
// Park&Choi Heavenly Lab(LabPhobia) 데스크톱 앱.
// 화면은 ../public 의 웹 앱(HTML/JS)을 그대로 쓰고, 서버나 브라우저 없이 이 창 안의 WebView 에서 열린다.
// 파일 저장은 Windows 의 "다른 이름으로 저장" 창(dialog)과 fs 플러그인으로 처리한다.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("앱을 실행하지 못했어요");
}
