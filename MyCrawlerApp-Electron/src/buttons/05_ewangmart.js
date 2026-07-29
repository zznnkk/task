const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 "+"로 연결, 토큰별 URL 인코딩.
function buildUrl(cleanedTerm) {
  const keyword = cleanedTerm
    .split(" ")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");

  return `https://www.ewangmart.com/goods/search.do?sword=${keyword}`;
}

// (5): 상품 목록이 존재 + 첫 번째 요소의 sale-price가 가격 포맷일 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll("div.goods-list li.goods-item");

        if (items.length === 0) {
          return false;
        }

        const priceEl = items[0].querySelector("span.sale-price");

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
      const rows = Array.from(document.querySelectorAll("div.goods-list li.goods-item"));

      return rows.map((el) => {
        const nameEl = el.querySelector("span.goods-title");
        const priceEl = el.querySelector("span.sale-price");

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
  id: "ewangmart",
  name: "식자재왕",
  crawl
};
