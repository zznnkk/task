// 여러 버튼(크롤러)에서 공통으로 쓰는 헬퍼 모음.
// 파일명이 _로 시작하므로 main.js의 loadButtons()에서 버튼으로 취급하지 않고 스킵함.

// 다음 로드가 끝날 때까지 기다리는 헬퍼.
// executeJavaScript로 네비게이션을 유발하기 "직전"에 호출해서
// Promise를 미리 준비해둬야 이벤트를 놓치지 않는다.
function waitForLoad(webContents) {
  return new Promise((resolve) => {
    webContents.once("did-finish-load", () => resolve());
  });
}

// SPA(전체 페이지 리로드 없이 화면만 바뀌는 사이트)에서는
// did-finish-load가 뜨지 않으므로, 원하는 셀렉터가 나타날 때까지 주기적으로 확인한다.
async function waitForSelector(webContents, selector, { timeout = 10000, interval = 300 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const found = await webContents.executeJavaScript(
      `!!document.querySelector(${JSON.stringify(selector)})`
    );

    if (found) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

// MutationObserver로 텍스트가 일치하는 <button>이 DOM에 나타나는 순간을 감지해서
// 바로 클릭까지 처리한다. "버튼이 존재하는지"가 아니라 "찾는 버튼이 새로 생기는지"를
// 봐야 하는 SPA 상황에서는 일반 폴링(waitForSelector)보다 이 방식이 훨씬 정확하다.
function clickButtonWhenReady(webContents, text, timeout = 10000) {
  return webContents.executeJavaScript(`
    new Promise((resolve) => {
      const target = ${JSON.stringify(text)};

      function findButton() {
        return Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent.trim() === target
        );
      }

      function tryClick() {
        const btn = findButton();

        if (btn) {
          btn.click();
          return true;
        }

        return false;
      }

      if (tryClick()) {
        resolve(true);
        return;
      }

      const observer = new MutationObserver(() => {
        if (tryClick()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, ${timeout});
    });
  `);
}

// clickButtonWhenReady와 동일한 방식이지만, 텍스트로 <button>을 찾는 대신
// 임의의 CSS 셀렉터(예: label[for="..."])로 클릭 대상을 찾을 때 사용.
function clickSelectorWhenReady(webContents, selector, timeout = 10000) {
  return webContents.executeJavaScript(`
    new Promise((resolve) => {
      const sel = ${JSON.stringify(selector)};

      function tryClick() {
        const el = document.querySelector(sel);

        if (el) {
          el.click();
          return true;
        }

        return false;
      }

      if (tryClick()) {
        resolve(true);
        return;
      }

      const observer = new MutationObserver(() => {
        if (tryClick()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, ${timeout});
    });
  `);
}

// 임의의 JS 표현식(문자열)이 true가 될 때까지 폴링.
// waitForSelector는 "요소가 존재하는지"만 보지만, 이 함수는 "특정 조건이 참이 되는지"를
// 볼 수 있어서 - 예: 가격 텍스트가 로딩 중 placeholder가 아니라 실제 포맷으로 채워졌는지 -
// 더 정확한 대기가 필요할 때 사용한다.
async function waitForJsCondition(webContents, jsExpression, { timeout = 10000, interval = 300 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await webContents.executeJavaScript(jsExpression);

    if (result) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

module.exports = {
  waitForLoad,
  waitForSelector,
  clickButtonWhenReady,
  clickSelectorWhenReady,
  waitForJsCondition
};
