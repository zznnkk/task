const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// 상품 하나하나를 감싸는 실제 반복 요소. class에 콜론(:)이 있는 Tailwind 클래스라
// CSS 클래스 셀렉터(a.mobile\:hidden)로 쓰면 이스케이프가 꼬이기 쉬워서,
// 속성 선택자로 안전하게 찾음 (콜론이 그냥 문자로 취급됨).
const ITEM_SELECTOR = 'a[class~="mobile:hidden"]';

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 "+"로 연결, 토큰별 URL 인코딩.
function buildUrl(cleanedTerm) {
  const keyword = cleanedTerm
    .split(" ")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");

  return `https://www.chabyulhwa.com/search?query=${keyword}`;
}

// (5): 상품 카드(a.mobile:hidden)들이 존재 + 첫 번째 카드의 가격이 포맷을 만족할 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll('${ITEM_SELECTOR}');

        if (items.length === 0) {
          return false;
        }

        const first = items[0];
        const discountEl = first.querySelector("span.product-list-item-info-discounted-price");
        const originalEl = first.querySelector("span.product-list-item-info-original-price");
        const priceEl = discountEl && discountEl.textContent.trim() ? discountEl : originalEl;

        return !!(priceEl && priceRegex.test(priceEl.textContent.trim()));
      })();
    `,
    { timeout: 5000 }
  );
}

// (7): 할인가가 없거나 비어있으면 원가로 대체
function extractItems(wc) {
  return wc.executeJavaScript(`
    (function () {
      const rows = Array.from(document.querySelectorAll('${ITEM_SELECTOR}'));

      return rows.map((el) => {
        const nameEl = el.querySelector("div.product-list-item-info-title");
        const discountEl = el.querySelector("span.product-list-item-info-discounted-price");
        const originalEl = el.querySelector("span.product-list-item-info-original-price");

        let priceText = discountEl ? discountEl.textContent.trim() : "";

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

  return runUrlQuerySite(wc, searchTerm, isCancelled, {
    buildUrl, // (1)(2)(3)
    afterLoadDelayMs: [1000, 1500], // (4)
    isReady, // (5)
    extractItems, // (7)
    priceRegex: PRICE_REGEX // (7)(8)
  });
}

module.exports = {
  id: "chabyeol",
  name: "차별화상회",
  crawl
};