const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  Menu
} = require("electron");


// min~max(ms) 사이 랜덤 시간만큼 대기. 100ms 단위로 취소 여부를 확인해서,
// 대기 중에 취소 버튼을 눌러도 즉시 반응하게 한다.
function randomDelay(minMs, maxMs, isCancelledFn) {
  const target = minMs + Math.random() * (maxMs - minMs);
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if (isCancelledFn() || Date.now() - start >= target) {
        resolve();
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}


// src/buttons 폴더 안의 각 .js 파일이 버튼 하나(= { id, name, crawl })를 export함.
// _로 시작하는 파일(_shared.js 등)은 버튼이 아니라 공통 헬퍼이므로 로드에서 제외.
function loadButtons() {
  const dir = path.join(__dirname, "src", "buttons");

  const buttonFiles = fs.readdirSync(dir)
    .filter((file) => file.endsWith(".js") && !file.startsWith("_"))
    .sort(); // 파일명 순서 = 버튼 노출 순서

  const loaded = [];
  const seenIds = new Set();

  for (const file of buttonFiles) {
    let button;

    try {
      button = require(path.join(dir, file));
    } catch (err) {
      console.error(`[buttons] ${file} 로드 실패:`, err);
      continue;
    }

    if (!button || !button.id || !button.name || typeof button.crawl !== "function") {
      console.error(`[buttons] ${file}은 { id, name, crawl } 형식이 아니라서 건너뜀`);
      continue;
    }

    if (seenIds.has(button.id)) {
      console.error(`[buttons] id "${button.id}"가 중복됨 (${file}) - 건너뜀`);
      continue;
    }

    seenIds.add(button.id);
    loaded.push(button);
  }

  return loaded;
}

const buttons = loadButtons();

let mainWindow;
let browserView;
let overlayView;

let isCrawling = false;
let cancelRequested = false;

function getViewBounds() {
  const [width, height] = mainWindow.getContentSize();

  return {
    x: Math.floor(width / 2),
    y: 0,
    width: Math.floor(width / 2),
    height
  };
}

function resizeViews() {
  const bounds = getViewBounds();

  browserView.setBounds(bounds);
  overlayView.setBounds(bounds);
}

function showOverlay() {
  // 이미 붙어 있어도 removeBrowserView는 조용히 무시되므로 안전하게 재적용
  mainWindow.removeBrowserView(overlayView);
  mainWindow.addBrowserView(overlayView);
  resizeViews();
}

function hideOverlay() {
  mainWindow.removeBrowserView(overlayView);
}

function disableUserInput(view) {
  const blockCSS = "html, body { pointer-events: none !important; }";

  const applyGuard = () => {
    view.webContents.insertCSS(blockCSS).catch(() => {});
  };

  // 자동화로 페이지가 새로 로드될 때마다 다시 적용
  view.webContents.on("dom-ready", applyGuard);

  // 실제 키보드 입력 차단 (자동화는 executeJavaScript로만 동작하므로 영향 없음)
  view.webContents.on("before-input-event", (event) => {
    event.preventDefault();
  });

  // 우클릭 컨텍스트 메뉴 차단
  view.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });
}

function suppressDialogsAndPermissions(view) {
  const wc = view.webContents;

  // alert/confirm/prompt 등 JS 다이얼로그를 CDP 레벨에서 자동으로 취소
  wc.debugger.attach("1.3");

  wc.debugger.on("message", (event, method) => {
    if (method === "Page.javascriptDialogOpening") {
      wc.debugger.sendCommand("Page.handleJavaScriptDialog", {
        accept: false
      });
    }
  });

  wc.debugger.sendCommand("Page.enable");

  // 카메라/마이크/위치/알림 등 권한 요청 자동 거부
  wc.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadFile(
    path.join(__dirname, "src", "index.html")
  );

  browserView = new BrowserView();
  overlayView = new BrowserView();

  // ↓ 추가
  browserView.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  overlayView.setBackgroundColor("#00000000");
  overlayView.webContents.loadFile(
    path.join(__dirname, "src", "overlay.html")
  );

  disableUserInput(browserView);
  suppressDialogsAndPermissions(browserView);

  // addBrowserView는 여러 뷰를 쌓을 수 있는 API. 나중에 추가된 뷰가 위로 렌더링됨.
  mainWindow.addBrowserView(browserView);

  resizeViews();

  mainWindow.on("resize", () => {
    resizeViews();
  });

  browserView.webContents.loadFile(
    path.join(__dirname, "src", "placeholder.html")
  );
}

ipcMain.handle("buttons:list", async () => {
  return buttons.map(({ crawl, ...button }) => button);
});

// searchTerms: [{ rowIndex, term }, ...] (렌더러에서 그리드 1열을 읽어 만들어 전달)
ipcMain.handle("crawl:start", async (event, id, searchTerms) => {
  if (isCrawling) {
    throw new Error("이미 크롤링이 진행 중입니다.");
  }

  const target = buttons.find((button) => button.id === id);

  if (!target) {
    throw new Error(`알 수 없는 버튼 id: ${id}`);
  }

  isCrawling = true;
  cancelRequested = false;

  showOverlay();

  let stopped = false;

  for (const { rowIndex, term } of searchTerms) {
    if (cancelRequested) {
      stopped = true;
      break;
    }

    let value;

    try {
      value = await target.crawl({
        browserView,
        mainWindow,
        searchTerm: term,
        isCancelled: () => cancelRequested
      });
    } catch (err) {
      value = `에러: ${err.message}`;
    }

    if (cancelRequested) {
      stopped = true;
      break;
    }

    if (value !== null) {
      mainWindow.webContents.send("crawl:progress", {
        rowIndex,
        text: `${target.name}|${value}`
      });
    }

    // ↓ 여기 추가: 다음 검색어로 넘어가기 전 1~2.5초 랜덤 숨고르기
    if (!cancelRequested) {
      await randomDelay(1100, 2500, () => cancelRequested);
    }
  }

  hideOverlay();
  isCrawling = false;

  mainWindow.webContents.send("crawl:done", { stopped });

  return { stopped };
});

ipcMain.handle("crawl:stop", async () => {
  cancelRequested = true;
  return true;
});

app.whenReady().then(createWindow);
