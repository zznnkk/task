(function () {
  const invoke = window.__TAURI__.core.invoke;
  const listen = window.__TAURI__.event.listen;

  const handlers = {}; // event 이름 -> [콜백들]

  window.api = {
    // 보내기: 객체 그대로 Rust로 넘김 (Rust는 그냥 다시 뿌림)
    send(message) {
      invoke("relay", { message });
    },
    // 받기: 특정 event에 콜백 등록
    on(eventName, callback) {
      (handlers[eventName] ??= []).push(callback);
    },
  };

  // Rust가 다시 뿌려주는 메시지를 받아서, receiver가 나(this webview)일 때만 처리
  listen("ipc-message", (e) => {
    const msg = e.payload;
    if (msg.receiver !== window.__WEBVIEW_LABEL__) return;
    for (const cb of handlers[msg.event] ?? []) {
      cb(msg.payload, msg);
    }
  });
})();