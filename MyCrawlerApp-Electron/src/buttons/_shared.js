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

// min~max(ms) 사이 랜덤 시간만큼 대기. 100ms 단위로 취소 여부를 확인해서,
// 대기 중에 취소 버튼을 눌러도 즉시 반응하게 한다.
// (예전엔 main.js에만 있었는데, 사이트별 crawlAll에서도 (4)/(9) 단계에
// 서로 다른 min~max로 이 함수를 그대로 쓸 수 있게 여기로 옮겼다.)
function randomDelay(minMs, maxMs, isCancelledFn) {
  const target = minMs + Math.random() * (maxMs - minMs);
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if ((isCancelledFn && isCancelledFn()) || Date.now() - start >= target) {
        resolve();
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}

// 문자열에서 숫자만 뽑아 정수로 변환. "12,900원" -> 12900. 숫자가 없으면 NaN.
function extractPriceNumber(text) {
  if (!text) {
    return NaN;
  }

  const digits = text.match(/[0-9]+/g);

  return digits ? parseInt(digits.join(""), 10) : NaN;
}

// (7) 사람이 마우스 휠을 살짝 굴린 것처럼 보이게 하는 아주 작은 스크롤 제스처.
// 페이지 하단으로 스크롤하면 무한스크롤/다음 페이지가 로드되는 사이트도 있어서,
// 일부러 큰 폭이 아니라 100px 정도만 살짝 움직인다.
async function wiggleScroll(webContents) {
  await webContents
    .executeJavaScript(`
      (function () {
        window.scrollTo({ top: 0 });
        window.scrollBy({ top: 100 });
      })();
    `)
    .catch(() => {});
}

// 검색어 하나 처리 실패 시 사유. 오케스트레이터가 실패 유형에 따라
// 다르게 대응(재시도 vs 사이트 재접속)하거나, 최종적으로 결과 셀에
// 사람이 알아볼 수 있는 문구를 남길 때 쓴다.
const FAILURE_REASON = {
  NO_ELEMENT: "no-element", // 검색창/버튼/아이템 셀렉터 자체를 못 찾음
  BLOCKED: "blocked", // 사이트의 차단 문구를 감지함
  TIMEOUT: "timeout" // 셀렉터/조건은 있는데 정해진 시간 안에 준비가 안 됨
};

// 검색창을 쓰는 일반 온라인몰 사이트용 공통 오케스트레이터.
//
// 흐름: connect(1) 한 번 -> 검색어들을 순회하며 (2)~(9) 반복
//       -> 전체 순회 끝나면 실패한 검색어만 모아 한 번 더 반복
//
// 검색어 하나 처리 중 실패하면(요소못찾음/차단/타임아웃) 그 검색어는 실패로
// 기록하고, 다음 검색어로 넘어가기 전에 사이트를 재접속(connect)해서
// 차단 상태나 이상해진 화면 상태를 초기화한다.
//
// config:
//   connect(wc)                       : (1) 사이트 접속
//   findSearchBox(wc)                 : (2) 검색창/버튼 존재 확인 -> boolean
//   inputSearch(wc, cleanedTerm)      : (3) 검색어 입력 + 검색 실행 -> boolean
//   itemsReady(wc)                    : (5) 아이템 목록이 완전히 로드됐는지 확인 -> boolean
//   extractItems(wc)                  : (6) [{ name, priceText }] 추출
//   sorted                            : extractItems 결과가 이미 낮은가격순인지 (기본 false)
//   isBlocked(wc)                     : (선택) 차단 문구 감지 -> boolean
//   afterInputDelayMs = [min, max]    : (4) 검색 직후 대기
//   nextTermDelayMs = [min, max]      : (9) 다음 검색어 넘어가기 전 대기
//   maxRetriesPerTerm = 2             : 검색어 하나당 (2)로 되돌아가는 최대 재시도 횟수
//
// 인자로 받는 onTermDone(rowIndex, value)은 검색어 하나(성공이든 최종실패든)가
// 끝날 때마다 즉시 호출돼서, main.js가 그 자리에서 jspreadsheet에 바로 반영할 수 있게 한다.
async function runSearchBoxSite(webContents, searchTerms, isCancelled, onTermDone, config) {
  const {
    connect,
    findSearchBox,
    inputSearch,
    itemsReady,
    extractItems,
    sorted = false,
    isBlocked = null,
    afterInputDelayMs = [1500, 2500],
    nextTermDelayMs = [3000, 6000],
    maxRetriesPerTerm = 2
  } = config;

  await connect(webContents);

  // 검색어 하나를 (2)~(8)까지 처리. 실패하면 재시도 여지가 있는 한 (2)부터 다시.
  async function processTerm(term) {
    for (let attempt = 0; attempt <= maxRetriesPerTerm; attempt++) {
      if (isCancelled()) {
        return { ok: false, reason: "cancelled" };
      }

      // (2) 검색창 확인
      const hasBox = await findSearchBox(webContents);

      if (!hasBox) {
        if (attempt < maxRetriesPerTerm) {
          continue;
        }
        return { ok: false, reason: FAILURE_REASON.NO_ELEMENT };
      }

      // 검색어 정리: 쌍따옴표는 벗기고, 물결표는 물결표 안 내용까지 통째로 제거
      const cleanedTerm = term.replace(/"/g, "").replace(/~.*?~/g, "").trim();

      // (3) 검색값 입력 + 검색 실행
      const searched = await inputSearch(webContents, cleanedTerm);

      if (!searched) {
        if (attempt < maxRetriesPerTerm) {
          continue;
        }
        return { ok: false, reason: FAILURE_REASON.NO_ELEMENT };
      }

      if (isCancelled()) {
        return { ok: false, reason: "cancelled" };
      }

      // (4) 대기
      await randomDelay(afterInputDelayMs[0], afterInputDelayMs[1], isCancelled);

      if (isCancelled()) {
        return { ok: false, reason: "cancelled" };
      }

      if (isBlocked && (await isBlocked(webContents))) {
        return { ok: false, reason: FAILURE_REASON.BLOCKED };
      }

      // (5) 아이템 노출 확인 (타임아웃 있으면 여기서 걸림)
      const ready = await itemsReady(webContents);

      if (!ready) {
        if (isBlocked && (await isBlocked(webContents))) {
          return { ok: false, reason: FAILURE_REASON.BLOCKED };
        }
        if (attempt < maxRetriesPerTerm) {
          continue;
        }
        return { ok: false, reason: FAILURE_REASON.TIMEOUT };
      }

      // (7) 사람처럼 스크롤 살짝 (크롤링보다 먼저 - 순서 바꿔도 된다고 확인됨)
      await wiggleScroll(webContents);

      if (isCancelled()) {
        return { ok: false, reason: "cancelled" };
      }

      // (6) 크롤링
      const items = await extractItems(webContents);

      // (8) 필터링 + 정렬
      const keywords = term.trim().split(" ").filter(Boolean);

      const mustNotHave = keywords
        .filter((x) => x.startsWith("~") && x.endsWith("~"))
        .map((y) => y.replace(/~/g, ""));

      const mustHave = keywords
        .filter((x) => !(x.startsWith("~") && x.endsWith("~")))
        .map((y) => y.replace(/"/g, ""));

      const candidates = items.filter((item) =>
        mustHave.every((k) => item.name.toLowerCase().includes(k.toLowerCase()))
        && mustNotHave.every((k) => !item.name.toLowerCase().includes(k.toLowerCase()))
      );

      if (candidates.length === 0) {
        return { ok: true, value: "(결과 없음)" };
      }

      const cheapest = sorted
        ? candidates[0]
        : candidates.reduce((min, cur) => {
            const curPrice = extractPriceNumber(cur.priceText);
            const minPrice = extractPriceNumber(min.priceText);
            return curPrice < minPrice ? cur : min;
          });

      const priceNum = extractPriceNumber(cheapest.priceText);
      const value = Number.isNaN(priceNum)
        ? cheapest.priceText
        : `${priceNum.toLocaleString("ko-KR")}원`;

      return { ok: true, value };
    }

    return { ok: false, reason: FAILURE_REASON.TIMEOUT };
  }

  // 검색어 목록 하나를 순회. 실패한 항목들을 리턴해서 2차 패스에 재사용.
  async function runPass(terms) {
    const failed = [];

    for (const { rowIndex, term } of terms) {
      if (isCancelled()) {
        break;
      }

      const result = await processTerm(term);

      if (result.ok) {
        onTermDone(rowIndex, result.value);
      } else if (result.reason === "cancelled") {
        break;
      } else {
        failed.push({ rowIndex, term, reason: result.reason });
        // 실패했으니 다음 검색어를 위해 사이트를 재접속해서 상태를 초기화
        await connect(webContents);
      }

      if (isCancelled()) {
        break;
      }

      // (9) 다음 검색어로 넘어가기 전 대기
      await randomDelay(nextTermDelayMs[0], nextTermDelayMs[1], isCancelled);
    }

    return failed;
  }

  const firstPassFailed = await runPass(searchTerms);

  let secondPassFailed = [];

  if (firstPassFailed.length > 0 && !isCancelled()) {
    secondPassFailed = await runPass(firstPassFailed);
  }

  const FAILURE_LABEL = {
    [FAILURE_REASON.BLOCKED]: "(차단됨)",
    [FAILURE_REASON.NO_ELEMENT]: "(요소를 찾을 수 없음)",
    [FAILURE_REASON.TIMEOUT]: "(시간 초과)"
  };

  for (const { rowIndex, reason } of secondPassFailed) {
    const label = FAILURE_LABEL[reason] || "(실패)";
    onTermDone(rowIndex, label);
  }
}

module.exports = {
  waitForLoad,
  waitForSelector,
  clickButtonWhenReady,
  clickSelectorWhenReady,
  waitForJsCondition,
  randomDelay,
  extractPriceNumber,
  wiggleScroll,
  FAILURE_REASON,
  runSearchBoxSite
};
