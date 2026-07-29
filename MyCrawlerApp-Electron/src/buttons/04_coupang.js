const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 "+"로 연결, 토큰별 URL 인코딩.
function buildUrl(cleanedTerm) {
  const keyword = cleanedTerm
    .split(" ")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");

  return `https://www.coupang.com/np/search?q=${keyword}`;
}

// (5): 상품 목록이 존재 + 첫 번째 요소 아래 span 중 하나라도 가격 포맷일 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll("ul#product-list li a");

        if (items.length === 0) {
          return false;
        }

        const spans = Array.from(items[0].querySelectorAll("span"));

        return spans.some((s) => priceRegex.test(s.textContent.trim()));
      })();
    `,
    { timeout: 5000 }
  );
}

// (7): 상품명, 가격 포맷을 만족하는 첫 번째 span을 가격으로 채택
function extractItems(wc) {
  return wc.executeJavaScript(`
    (function () {
      const priceRegex = ${PRICE_REGEX};
      const rows = Array.from(document.querySelectorAll("ul#product-list li a"));

      return rows.map((el) => {
        const nameEl = el.querySelector('div[class^="ProductUnit_productName"]');
        const priceSpans = Array.from(el.querySelectorAll('div[class^="PriceArea"] span'));
        const priceSpan = priceSpans.find((s) => priceRegex.test(s.textContent.trim()));

        return {
          name: nameEl ? nameEl.textContent.trim() : "",
          priceText: priceSpan ? priceSpan.textContent.trim() : ""
        };
      });
    })();
  `);
}

async function crawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  // 쿠팡의 Akamai 봇탐지가 Electron 기본 UA(...Electron/43.x...)를 신호로 잡아서
  // 차단하는 문제가 있었음 -> 매 크롤링 시작 전에 일반 크롬 UA로 덮어씀.
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
  id: "coupang",
  name: "쿠팡",
  crawl
};
