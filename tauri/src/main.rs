#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window, Runtime};

// ── 설정값 ──────────────────────────────────────────────
const WINDOW_TITLE: &str = "Dual Pane";
const WINDOW_WIDTH: f64 = 1200.0;
const WINDOW_HEIGHT: f64 = 800.0;

const WEBVIEW_A_URL: &str = "webviewA/index.html";
const WEBVIEW_B_URL: &str = "webviewB/index.html";

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 여기서 A, B의 배치를 자유롭게 정의합니다.
/// 창 크기(ww, wh)를 받아서 각 웹뷰의 x/y/width/height를 계산.
fn compute_layout(ww: f64, wh: f64) -> (Rect, Rect) {
    let a = Rect { x: 0.0, y: 0.0, width: ww * 0.2, height: wh };
    let b = Rect { x: ww * 0.2, y: 0.0, width: ww * 0.8, height: wh };

    
    // ── 예시 1: 좌우 배치 (반반) ──
    // let a = Rect { x: 0.0, y: 0.0, width: ww * 0.5, height: wh };
    // let b = Rect { x: ww * 0.5, y: 0.0, width: ww * 0.5, height: wh };

    // ── 예시 2: 상하 배치로 바꾸려면 위 두 줄 대신 ──
    // let a = Rect { x: 0.0, y: 0.0, width: ww, height: wh * 0.5 };
    // let b = Rect { x: 0.0, y: wh * 0.5, width: ww, height: wh * 0.5 };

    // ── 예시 3: A는 300px 고정, B가 나머지 전부 (좌우) ──
    // let fixed_a_width = 300.0;
    // let a = Rect { x: 0.0, y: 0.0, width: fixed_a_width, height: wh };
    // let b = Rect { x: fixed_a_width, y: 0.0, width: ww - fixed_a_width, height: wh };

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
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title(WINDOW_TITLE)
                .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
                .build()?;

            let (a, b) = compute_layout(WINDOW_WIDTH, WINDOW_HEIGHT);

            let webview_a = WebviewBuilder::new("a", WebviewUrl::App(WEBVIEW_A_URL.into()));
            window.add_child(
                webview_a,
                LogicalPosition::new(a.x, a.y),
                LogicalSize::new(a.width, a.height),
            )?;

            let webview_b = WebviewBuilder::new("b", WebviewUrl::App(WEBVIEW_B_URL.into()));
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