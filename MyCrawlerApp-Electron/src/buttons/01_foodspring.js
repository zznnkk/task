const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

// (5)(7)(8)에서 공통으로 쓰는 가격 유효성 정규식
const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 "+"로 연결, 토큰별 URL 인코딩.
function buildUrl(cleanedTerm) {
  const keyword = cleanedTerm
    .split(" ")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");

  return `https://www.foodspring.co.kr/search/all?key=${keyword}&searchFilter=%5B%5D`;
}

// (5): a[data-ds] 존재 + 첫 번째 요소의 original-price가 완성된 가격 포맷일 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll('a[data-ds]');

        if (items.length === 0) {
          return false;
        }

        const priceEl = items[0].querySelector('span[data-testid="original-price"]');

        return !!(priceEl && priceRegex.test(priceEl.textContent.trim()));
      })();
    `,
    { timeout: 5000 }
  );
}

// (7): 상품명/상품가격 크롤링 (sale-price 없거나 비어있으면 original-price로 대체)
function extractItems(wc) {
  return wc.executeJavaScript(`
    (function () {
      const anchors = Array.from(document.querySelectorAll('a[data-ds]'));

      return anchors.map((el) => {
        const nameEl = el.querySelector('span[data-testid="item-name"]');
        const saleEl = el.querySelector('span[data-testid="sale-price"]');
        const originalEl = el.querySelector('span[data-testid="original-price"]');

        let priceText = saleEl ? saleEl.textContent.trim() : "";

        if (!priceText && originalEl) {
          priceText = originalEl.textContent.trim();
        }

        return {
          name: nameEl ? nameEl.textContent.trim() : "",
          priceText
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

  // (1)~(9) 전체 흐름은 _shared.js의 runUrlQuerySite가 담당.
  // (4) 대기, (6) 제스처, (8) 정렬+최저가 채택은 오케스트레이터 내부에서 공통 처리됨.
  return runUrlQuerySite(wc, searchTerm, isCancelled, {
    buildUrl, // (1)(2)(3)
    afterLoadDelayMs: [1000, 1500], // (4)
    isReady, // (5)
    extractItems, // (7)
    priceRegex: PRICE_REGEX // (7)(8) 필터링/정렬 기준
  });
}

module.exports = {
  id: "foodspring",
  name: "식봄",
  crawl
};
