#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{
    webview::PageLoadEvent, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
    Window, Runtime,
};

// ── 설정값 ──────────────────────────────────────────────
const WINDOW_TITLE: &str = "Dual Pane";
const WINDOW_WIDTH: f64 = 1200.0;
const WINDOW_HEIGHT: f64 = 800.0;

const WEBVIEW_A_URL: &str = "webviewA/index.html";
const WEBVIEW_B_URL: &str = "webviewB/index.html";

const TOTAL_WEBVIEWS: u8 = 2; // A, B 둘 다 로드되면 show()

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn compute_layout(ww: f64, wh: f64) -> (Rect, Rect) {
    let a = Rect { x: 0.0, y: 0.0, width: ww * 0.5, height: wh };
    let b = Rect { x: ww * 0.5, y: 0.0, width: ww * 0.5, height: wh };
    (a, b)
}
// ──────────────────────────────────────────────────────

fn relayout<R: Runtime>(window: &Window<R>) -> tauri::Result<()> {
    let size = window.inner_size()?;
    let scale = window.scale_factor()?;
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    let (a, b) = compute_layout(logical_w, logical_h);

    if let Some(webview_a) = window.get_webview("a") {
        webview_a.set_position(LogicalPosition::new(a.x, a.y))?;
        webview_a.set_size(LogicalSize::new(a.width, a.height))?;
    }
    if let Some(webview_b) = window.get_webview("b") {
        webview_b.set_position(LogicalPosition::new(b.x, b.y))?;
        webview_b.set_size(LogicalSize::new(b.width, b.height))?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 1. 창을 처음부터 숨긴 상태로 생성
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title(WINDOW_TITLE)
                .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
                .visible(false)
                .build()?;

            let (a, b) = compute_layout(WINDOW_WIDTH, WINDOW_HEIGHT);

            // 2. 로드 완료 카운터 (A, B 둘 다 끝나야 show)
            let loaded_count = Arc::new(Mutex::new(0u8));

            let window_for_a = window.clone();
            let count_for_a = loaded_count.clone();
            let webview_a = WebviewBuilder::new("a", WebviewUrl::App(WEBVIEW_A_URL.into()))
                .on_page_load(move |_webview, payload| {
                    if let PageLoadEvent::Finished = payload.event() {
                        let mut count = count_for_a.lock().unwrap();
                        *count += 1;
                        if *count >= TOTAL_WEBVIEWS {
                            let _ = window_for_a.show();
                        }
                    }
                });
            window.add_child(
                webview_a,
                LogicalPosition::new(a.x, a.y),
                LogicalSize::new(a.width, a.height),
            )?;

            let window_for_b = window.clone();
            let count_for_b = loaded_count.clone();
            let webview_b = WebviewBuilder::new("b", WebviewUrl::App(WEBVIEW_B_URL.into()))
                .on_page_load(move |_webview, payload| {
                    if let PageLoadEvent::Finished = payload.event() {
                        let mut count = count_for_b.lock().unwrap();
                        *count += 1;
                        if *count >= TOTAL_WEBVIEWS {
                            let _ = window_for_b.show();
                        }
                    }
                });
            window.add_child(
                webview_b,
                LogicalPosition::new(b.x, b.y),
                LogicalSize::new(b.width, b.height),
            )?;

            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    let _ = relayout(&window_clone);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}