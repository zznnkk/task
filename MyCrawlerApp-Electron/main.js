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
    show: false, // 리소스 로드 전엔 숨겨둠
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
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

// 결과값이 "숫자,콤마원" 형식(예: "12,900원")인지 확인
function isPriceText(text) {
  return typeof text === "string" && /^[0-9][0-9,]*원$/.test(text);
}

// 셀에 저장된 "이름|결과" 텍스트에서 "결과" 부분만 뽑아낸다.
// "|"가 없으면(예전 형식이거나 값 자체) 그대로 반환.
function extractResultPart(text) {
  if (typeof text !== "string") {
    return text;
  }

  const sepIndex = text.indexOf("|");

  return sepIndex === -1 ? text : text.slice(sepIndex + 1);
}

// 사이트 crawl()이 반환한 값을 "가격" / "(결과 없음)" / "(크롤링실패)" 셋 중 하나로 정규화.
// 실패 사유(요소못찾음/차단/타임아웃 등)를 세세히 구분하지 않고 전부 "(크롤링실패)"로
// 묶는다 - 재시도 여부를 가르는 기준은 "검색이 끝까지 됐는지"뿐이라 이걸로 충분함.
function normalizeCrawlResult(value) {
  if (value === "(결과 없음)") {
    return value;
  }

  if (isPriceText(value)) {
    return value;
  }

  return "(크롤링실패)";
}

// 셀에 저장된 값이 "다시 크롤링해야 하는 상태"인지 확인.
// 유효한 가격이 아니면(빈칸/"(결과 없음)"/"(크롤링실패)"/그 외 전부) 재처리 대상.
function needsProcessing(value) {
  if (value === null || value === undefined) {
    return true;
  }

  const text = String(value).trim();

  if (text === "") {
    return true;
  }

  return !isPriceText(extractResultPart(text));
}

// searchTerms: [{ rowIndex, term, values }, ...]
// values[i]는 buttons[i](=해당 사이트 열)에 현재 들어있는 값 (렌더러가 그리드에서 읽어 전달)
// checkedSiteIndexes: 체크박스로 선택된 사이트들의 인덱스 배열 (없으면 전체로 간주)
ipcMain.handle("crawl:start", async (event, searchTerms, checkedSiteIndexes) => {
  if (isCrawling) {
    throw new Error("이미 크롤링이 진행 중입니다.");
  }

  const checkedSet = Array.isArray(checkedSiteIndexes)
    ? new Set(checkedSiteIndexes)
    : new Set(buttons.map((_, i) => i));

  // 검색어(행) x 사이트(열) 조합 중, 체크된 사이트이면서 빈칸이거나 실패로 남아있는 것만 골라낸다.
  const workItems = [];

  for (const { rowIndex, term, values } of searchTerms) {
    const siteIndexes = [];

    for (let i = 0; i < buttons.length; i++) {
      if (!checkedSet.has(i)) {
        continue;
      }

      const existing = values ? values[i] : undefined;

      if (needsProcessing(existing)) {
        siteIndexes.push(i);
      }
    }

    if (siteIndexes.length > 0) {
      workItems.push({ rowIndex, term, siteIndexes });
    }
  }

  if (workItems.length === 0) {
    return { stopped: false, nothingToDo: true };
  }

  isCrawling = true;
  cancelRequested = false;

  showOverlay();

  let stopped = false;

  // 바로 직전에 크롤링한 사이트의 인덱스. 이번에 크롤링할 사이트가 이거랑 같으면
  // (예: 실패/결과없음만 남은 두 행이 연달아 같은 사이트로 몰리는 경우) 대기 후 진행.
  let lastSiteIndex = null;

  // 검색어(a) 하나를 두고 -> 사이트 순서대로(1~7) 전부 돈 뒤 -> 다음 검색어(b)로.
  // 같은 사이트를 다시 찾기까지 나머지 사이트들 처리 시간만큼 자연스럽게 간격이 생김.
  outer:
  for (const { rowIndex, term, siteIndexes } of workItems) {
    for (const siteIndex of siteIndexes) {
      if (cancelRequested) {
        stopped = true;
        break outer;
      }

      // (9) 대기: 바로 직전에 크롤링한 사이트와 이번 사이트가 같을 때만
      if (lastSiteIndex === siteIndex) {
        await randomDelay(5000, 7000, () => cancelRequested);

        if (cancelRequested) {
          stopped = true;
          break outer;
        }
      }

      const site = buttons[siteIndex];
      let value;

      try {
        value = await site.crawl({
          browserView,
          mainWindow,
          searchTerm: term,
          isCancelled: () => cancelRequested
        });
      } catch (err) {
        value = "(크롤링실패)";
      }

      lastSiteIndex = siteIndex;

      if (cancelRequested) {
        stopped = true;
        break outer;
      }

      if (value !== null) {
        const colIndex = siteIndex + 1; // A열은 검색어 전용
        const text = `${site.name}|${normalizeCrawlResult(value)}`;

        mainWindow.webContents.send("crawl:progress", {
          rowIndex,
          colIndex,
          text
        });
      }
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
