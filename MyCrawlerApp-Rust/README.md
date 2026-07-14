# MyBrowserApp (Rust / wry + tao)

C# + Avalonia + WebView2 버전과 동일한 기능을 Rust + wry + tao로 이식.
구조 비교를 위해 html 위치는 원래처럼 `src/` 아래 유지.

## 구조

```
MyBrowserApp-Rust/
├── Cargo.toml
├── .cargo/
│   └── config.toml         # MSVC CRT 정적 링크 -> 진짜 단일 exe
└── src/
    ├── main.rs              # 창 생성, 웹뷰 2개 배치, IPC 라우팅
    ├── leftside.html         # input 1개, Enter 시 window.ipc.postMessage
    └── rightside.html        # "안녕하세요" 표시, 이후 임의 URL로 대체됨
```

## C# 버전과의 대응 관계

| C# (Avalonia)                          | Rust (wry + tao)                          |
|-----------------------------------------|--------------------------------------------|
| `NativeWebView` 컨트롤 2개               | `WebViewBuilder::build_as_child()` 2개     |
| `AvaloniaResource` 임베드 + `avares://`  | `include_str!()` (컴파일 타임에 바이너리 삽입) |
| `invokeCSharpAction()` / `WebMessageReceived` | `window.ipc.postMessage()` / `with_ipc_handler()` |
| `JsonSerializerContext` (AOT-safe)      | `serde` + `serde_json` (derive 매크로)      |
| `PublishAot` (그래도 dll 여러 개 남음)   | 기본이 네이티브 단일 바이너리 + CRT 정적 링크로 완전 단일 exe |
| `WindowState="Minimized"` → 정상화       | `with_visible(false)` → `set_visible(true)` |

## 동작 방식

1. 창을 `with_visible(false)`로 숨긴 채 생성 → 좌/우 웹뷰를 `build_as_child()`로 각각
   윈도우 절반씩 배치.
2. 각 html은 `DOMContentLoaded` 시점에 `{"type":"ready"}`를 IPC로 보냄 → 둘 다 도착하면
   `window.set_visible(true)` (C# 버전의 "최소화 시작 → 정상화"와 동일한 깜빡임 방지 목적).
3. `leftside.html`의 input에서 Enter → `{"type":"navigate","url":"..."}` IPC 전송.
4. `main.rs`에서 `serde_json`으로 파싱 → 우측 웹뷰 `load_url()` 호출.
5. 스킴 없으면 자동으로 `https://` 붙임 (C# 버전과 동일 로직).
6. `WindowEvent::Resized`에서 좌/우 웹뷰 `set_bounds()`로 5:5 유지.

## 빌드 (Windows에서만 — WebView2/GUI 특성상)

```powershell
cargo build --release
```

결과물: `target/release/MyBrowserApp.exe` 하나. `.cargo/config.toml`의
`target-feature=+crt-static` 덕분에 vcruntime 계열 dll도 필요 없이 이 exe 파일
하나만 복사하면 됩니다 (C# 버전에서 겪었던 "publish 폴더째 복사해야 하는 문제" 없음).
WebView2 런타임 자체는 요구사항대로 사용자 Win11 기본 탑재분을 그대로 사용.

## 반드시 확인/조정할 것

- **wry / tao 버전**: `Cargo.toml`의 `wry = "0.55"`, `tao = "0.35"`는 예시입니다.
  `cargo build` 시 `with_ipc_handler`, `build_as_child`, `Rect`/`set_bounds` 관련
  시그니처가 버전마다 조금씩 바뀌었으니, 컴파일 에러 나면 해당 버전 docs.rs 기준으로
  맞춰야 합니다. (C# 버전에서 `Avalonia.Controls.WebView` 버전 이슈 겪었던 것과 같은 종류의 이슈)
- ipc_handler 콜백이 실제로 메인 스레드에서 호출되는지는 wry 내부 구현에 따라 다를 수
  있어, 안전하게 `EventLoopProxy`로 이벤트를 던져 메인 루프에서만 웹뷰를 조작하도록 설계함.
- 지금은 `{type:"navigate", url}` 메시지 하나만 처리. 기능 확장 시 `IpcMessage` enum에
  variant 추가 → `event_loop.run` 안의 `match` 에서 분기 처리하면 됨.
