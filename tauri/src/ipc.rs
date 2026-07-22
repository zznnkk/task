use tauri::{AppHandle, Emitter};

/// build.rs가 dist/_shared/*.js를 합쳐서 만든 파일을 컴파일 타임에 그대로 임베드.
/// 여기서부터는 exe 안에 박혀있어서 런타임 파일 접근이 전혀 필요 없음 (단일 exe 유지).
const SHARED_JS: &str = include_str!(concat!(env!("OUT_DIR"), "/shared_init.js"));

/// 웹뷰 라벨(a, b 등)을 주입하고 공유 스크립트를 이어 붙여
/// initialization_script로 넘길 최종 문자열을 만듦
pub fn build_init_script(label: &str) -> String {
    format!("window.__WEBVIEW_LABEL__ = \"{}\";\n{}", label, SHARED_JS)
}

/// Rust는 내용을 전혀 해석하지 않고, 받은 객체를 그대로 모든 웹뷰에 다시 뿌리기만 함.
/// 실제 receiver 필터링과 처리(비즈니스 로직)는 전부 JS(api.on)에서 담당.
#[tauri::command]
pub fn relay(app: AppHandle, message: serde_json::Value) -> Result<(), String> {
    app.emit("ipc-message", message).map_err(|e| e.to_string())
}