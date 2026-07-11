const path = require("path");
const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  Menu
} = require("electron");

const buttons = require("./src/buttons.js");

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
