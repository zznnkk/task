const { waitForSelector, waitForJsCondition } = require("./_shared");

// 문자열에서 숫자만 뽑아 정수로 변환. "12,900원" -> 12900. 숫자가 없으면 NaN.
function extractPriceNumber(text) {
  if (!text) {
    return NaN;
  }

  const digits = text.match(/[0-9]+/g);

  return digits ? parseInt(digits.join(""), 10) : NaN;
}

// 장보자닷컴: 낮은가격순 정렬 기능이 없는 사이트라, 검색 결과 1페이지의 상품을
// 전부 가져온 뒤 검색어 조건(쌍따옴표=포함, 물결표=제외)에 맞는 것만 추려서
// Node 쪽에서 직접 가격을 비교해 최저가를 찾는다.
async function jangbojaSearchCrawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  if (isCancelled()) {
    return null;
  }

  await wc.loadURL("https://www.jangboja.com/");

  if (isCancelled()) {
    return null;
  }

  // searchTerm 에서 쌍따옴표, 물결표 제거, 물결표 사이 값도 같이 제거

  const searched = await wc.executeJavaScript(`
    (function () {
      const input = document.querySelector('input#searchInput');

      if (!input) {
        return false;
      }

      // 리액트 기반 사이트는 input.value = ... 로 바로 대입하면
      // 리액트 내부 상태가 값 변경을 못 감지하는 경우가 있어서,
      // 네이티브 input의 value setter를 직접 호출해 우회한다.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;

      input.focus();
      // searchTerm 에서 쌍따옴표, 물결표 제거, 물결표 사이 값도 같이 제거
      nativeSetter.call(input, ${JSON.stringify(  searchTerm.replace(/"/g, "").replace(/~.*?~/g, "")  )});
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const searchButton = document.querySelector('button.btn-search-big');

      if (!searchButton) {
        return false;
      }

      searchButton.click();
      return true;
    })();
  `);

  if (!searched) {
    return "(검색창을 찾을 수 없음)";
  }

  if (isCancelled()) {
    return null;
  }

  // 검색 결과의 상품 목록이 나타날 때까지 폴링 대기
  await waitForSelector(wc, "div.product-info");

  if (isCancelled()) {
    return null;
  }

  // div.current-price 중 하나라도 완전히 "#,##0원" 형식으로 채워질 때까지 대기.
  // 요소는 먼저 나타나도 가격 숫자가 비동기로 뒤늦게 채워지는 경우가 있어서,
  // "존재"가 아니라 "포맷이 완성됐는지"를 봐야 제대로 된 값을 읽을 수 있다.
  const priceLoaded = await waitForJsCondition(wc, `
    (function () {
      const priceRegex = /^[0-9][0-9,]*원$/;
      const prices = Array.from(document.querySelectorAll("div.product-info div.current-price"));
      return prices.some((el) => priceRegex.test(el.textContent.trim()));
    })();
  `);

  if (!priceLoaded) {
    return "(가격 로딩 실패)";
  }

  if (isCancelled()) {
    return null;
  }

  // 목록이 완전히 다 그려질 시간을 조금 준다.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const items = await wc.executeJavaScript(`
    (function () {
      const boxes = Array.from(document.querySelectorAll("div.product-info"));

      return boxes.map((box) => {
        const nameEl = box.querySelector("a.product-title");
        const priceEl = box.querySelector("div.current-price");

        return {
          name: nameEl ? nameEl.textContent.trim() : "",
          priceText: priceEl ? priceEl.textContent.trim() : ""
        };
      });
    })();
  `);

  if (isCancelled()) {
    return null;
  }

  // 키워드 중 쌍따옴표를 모두 포함하고, 물결표를 모두 제외한 상품들만 후보로 남긴다.
  const keywords = searchTerm.trim().split(" ").filter(Boolean);

  const mustHave = keywords.filter((x) => x.startsWith('"') && x.endsWith('"')).map((y) => y.replace(/"/g, ""));
  const mustNotHave = keywords.filter((x) => x.startsWith('~') && x.endsWith('~')).map((y) => y.replace(/~/g, ""));

  const candidates = items
    .filter((item) =>
      mustHave.every((keyword) => item.name.toLowerCase().includes(keyword.toLowerCase()))
      && mustNotHave.every((keyword) => !item.name.toLowerCase().includes(keyword.toLowerCase()))
    )
    .map((item) => ({
      name: item.name,
      price: extractPriceNumber(item.priceText)
    }))
    .filter((item) => !Number.isNaN(item.price));

  if (candidates.length === 0) {
    return "(결과 없음)";
  }

  // 정렬 기능이 없으므로 후보들 중 최저가를 직접 계산
  const cheapest = candidates.reduce((min, cur) => (cur.price < min.price ? cur : min));

  // #,##0원 형식으로 변환
  return `${cheapest.price.toLocaleString("ko-KR")}원`;
}

module.exports = {
  id: "jangboja",
  name: "장보자닷컴",
  crawl: jangbojaSearchCrawl
};
