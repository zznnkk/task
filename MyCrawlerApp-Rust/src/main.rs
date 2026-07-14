// 콘솔 창 숨김 (GUI 앱)
#![windows_subsystem = "windows"]

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use serde::Deserialize;
use tao::dpi::{LogicalPosition, LogicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::{Rect, WebView, WebViewBuilder};

// C# 버전의 AvaloniaResource 임베드와 동일한 역할: 컴파일 타임에 exe 안으로 박아넣음
const LEFT_HTML: &str = include_str!("leftside.html");
const RIGHT_HTML: &str = include_str!("rightside.html");

/// leftside.html / rightside.html -> Rust 로 오는 IPC 메시지 스키마.
/// C# 버전의 NavigateRequest 와 동일한 역할. 확장 시 variant 추가.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum IpcMessage {
    Ready,
    Navigate { url: String },
}

/// 이벤트 루프로 되돌려 보낼 사용자 정의 이벤트.
/// ipc_handler 는 별도 콜백에서 호출되므로, 실제 처리(창 표시/네비게이션)는
/// 메인 이벤트 루프 쪽에서 하도록 이벤트로 전달.
#[derive(Debug, Clone)]
enum UserEvent {
    PaneReady,
    Navigate(String),
}

fn main() -> wry::Result<()> {
    // let event_loop: EventLoop<UserEvent> = EventLoop::with_user_event();
    let event_loop: EventLoop<UserEvent> = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    // 깜빡임 방지: 처음엔 숨겨서 시작 -> 양쪽 웹뷰 로드 완료되면 보여줌
    // (C# 버전의 "최소화 시작 -> 준비되면 정상화" 와 동일한 목적)
    let window = WindowBuilder::new()
        .with_title("MyBrowserApp")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .with_visible(false)
        .build(&event_loop)
        .expect("윈도우 생성 실패");

    let size = window
        .inner_size()
        .to_logical::<f64>(window.scale_factor());
    let half_width = size.width / 2.0;

    // WebView2 데이터 폴더(쿠키/캐시/localStorage)를 exe 옆이 아니라
    // 시스템 임시폴더(%TEMP%\MyBrowserApp\WebView2Data) 아래로 지정.
    // 지정 안 하면 기본값으로 exe 옆에 "<exe이름>.WebView2" 폴더가 자동 생성됨.
    let data_dir: PathBuf = std::env::temp_dir()
        .join("MyBrowserApp")
        .join("WebView2Data");
    let _ = std::fs::create_dir_all(&data_dir);

    let mut web_context = wry::WebContext::new(Some(data_dir));

    // 우측 웹뷰는 리사이즈 시 bounds 재조정, 좌측 input 값 네비게이션 등에서
    // 이벤트 루프 클로저가 계속 참조해야 하므로 Rc<RefCell<>>로 보관.
    // (같은 메인 스레드에서만 접근하므로 Rc/RefCell로 충분, Arc/Mutex 불필요)
    let right_holder: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(None));

    let right_proxy = proxy.clone();
    let right = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_bounds(Rect {
            position: LogicalPosition::new(half_width, 0.0).into(),
            size: LogicalSize::new(half_width, size.height).into(),
        })
        .with_html(RIGHT_HTML)
        .with_ipc_handler(move |req| {
            if let Ok(IpcMessage::Ready) = serde_json::from_str(req.body()) {
                let _ = right_proxy.send_event(UserEvent::PaneReady);
            }
        })
        .build_as_child(&window)?;

    *right_holder.borrow_mut() = Some(right);

    let left_proxy = proxy.clone();
    let left = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_bounds(Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(half_width, size.height).into(),
        })
        .with_html(LEFT_HTML)
        .with_ipc_handler(move |req| {
            match serde_json::from_str::<IpcMessage>(req.body()) {
                Ok(IpcMessage::Ready) => {
                    let _ = left_proxy.send_event(UserEvent::PaneReady);
                }
                Ok(IpcMessage::Navigate { url }) => {
                    let _ = left_proxy.send_event(UserEvent::Navigate(url));
                }
                Err(_) => {
                    // 잘못된 형식의 메시지는 무시 (확장 시 로깅 추가 권장)
                }
            }
        })
        .build_as_child(&window)?;

    let left_holder: Rc<RefCell<Option<WebView>>> = Rc::new(RefCell::new(Some(left)));

    let mut ready_count = 0;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,

            Event::WindowEvent {
                event: WindowEvent::Resized(physical_size),
                ..
            } => {
                let logical = physical_size.to_logical::<f64>(window.scale_factor());
                let half = logical.width / 2.0;

                if let Some(lv) = left_holder.borrow().as_ref() {
                    let _ = lv.set_bounds(Rect {
                        position: LogicalPosition::new(0.0, 0.0).into(),
                        size: LogicalSize::new(half, logical.height).into(),
                    });
                }

                if let Some(rv) = right_holder.borrow().as_ref() {
                    let _ = rv.set_bounds(Rect {
                        position: LogicalPosition::new(half, 0.0).into(),
                        size: LogicalSize::new(half, logical.height).into(),
                    });
                }
            }

            // 좌/우 웹뷰 둘 다 DOMContentLoaded 완료 -> 이제 창을 보여줌 (깜빡임 없이 한 번에)
            Event::UserEvent(UserEvent::PaneReady) => {
                ready_count += 1;
                if ready_count >= 2 {
                    window.set_visible(true);
                }
            }

            // leftside.html 의 input Enter -> 우측 웹뷰 네비게이션
            Event::UserEvent(UserEvent::Navigate(url)) => {
                let normalized = if url.contains("://") {
                    url
                } else {
                    format!("https://{url}")
                };

                if let Some(rv) = right_holder.borrow().as_ref() {
                    let _ = rv.load_url(&normalized);
                }
            }

            _ => {}
        }
    });
}
