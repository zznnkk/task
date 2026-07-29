const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

// 장보자닷컴은 다담몰과 달리 "원"이 붙어있는 형식 (확인 완료)
const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 그대로 두고 URL 인코딩만.
function buildUrl(cleanedTerm) {
  return `https://jangboja.com/goods/searchItemList?keyword=${encodeURIComponent(cleanedTerm)}`;
}

// (5): 상품 목록이 존재 + 첫 번째 요소의 가격이 완성된 포맷일 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll("div#search-result-display div.item-box ul li");

        if (items.length === 0) {
          return false;
        }

        const priceEl = items[0].querySelector("div.current-price");

        return !!(priceEl && priceRegex.test(priceEl.textContent.trim()));
      })();
    `,
    { timeout: 5000 }
  );
}

// (7): 상품명/상품가격 크롤링
function extractItems(wc) {
  return wc.executeJavaScript(`
    (function () {
      const rows = Array.from(
        document.querySelectorAll("div#search-result-display div.item-box ul li")
      );

      return rows.map((el) => {
        const nameEl = el.querySelector("a.product-title");
        const priceEl = el.querySelector("div.current-price");

        return {
          name: nameEl ? nameEl.textContent.trim() : "",
          priceText: priceEl ? priceEl.textContent.trim() : ""
        };
      });
    })();
  `);
}

async function crawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  // Electron 기본 UA(...Electron/43.x...) 감지로 인한 차단이나 다른 레이아웃
  // 노출을 방지하기 위해 매 크롤링 시작 전에 일반 크롬 UA로 덮어씀.
  wc.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  return runUrlQuerySite(wc, searchTerm, isCancelled, {
    buildUrl, // (1)(2)(3)
    afterLoadDelayMs: [1000, 1500], // (4)
    isReady, // (5)
    extractItems, // (7)
    priceRegex: PRICE_REGEX // (7)(8)
  });
}

module.exports = {
  id: "jangboja",
  name: "장보자닷컴",
  crawl
};
