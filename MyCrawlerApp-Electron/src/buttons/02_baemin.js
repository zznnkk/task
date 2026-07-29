const { waitForJsCondition, runUrlQuerySite } = require("./_shared");

const PRICE_REGEX = /^[0-9][0-9,]*원$/;

// (1)(2)(3): URL 자체가 접속+검색을 겸함. 공백은 그대로 두고 URL 인코딩만.
function buildUrl(cleanedTerm) {
  return `https://mart.baemin.com/search/result?p=0&s=BASIC_A&w=${encodeURIComponent(cleanedTerm)}`;
}

// (5): 카드 2단계 아래 컨테이너들이 존재 + 첫 번째 요소 밑 span 중 하나라도 가격 포맷일 것
function isReady(wc) {
  return waitForJsCondition(
    wc,
    `
      (function () {
        const priceRegex = ${PRICE_REGEX};
        const items = document.querySelectorAll(
          'div[data-testid] a[data-card-size] > div:nth-child(2) > div:nth-child(2)'
        );

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

// (7): 상품명은 카드의 첫 번째 자식 div, 가격은 두 번째 자식 div 아래 span 중
// 가격 포맷을 만족하는 첫 번째 span
function extractItems(wc) {
  return wc.executeJavaScript(`
    (function () {
      const priceRegex = ${PRICE_REGEX};
      const rows = Array.from(
        document.querySelectorAll('div[data-testid] a[data-card-size] > div:nth-child(2)')
      );

      return rows.map((el) => {
        const nameEl = el.querySelector(":scope > div:nth-child(1)");
        const priceContainer = el.querySelector(":scope > div:nth-child(2)");
        const spans = priceContainer ? Array.from(priceContainer.querySelectorAll("span")) : [];
        const priceSpan = spans.find((s) => priceRegex.test(s.textContent.trim()));

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

  // Electron 기본 UA(...Electron/43.x...)를 감지해서 다른 레이아웃(또는 다른 처리)을
  // 내려주는 사이트가 있을 수 있어서(쿠팡 UA 차단 이슈와 유사한 패턴), 매 크롤링
  // 시작 전에 일반 크롬 UA로 덮어씀.
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
  id: "baemin",
  name: "배민상회",
  crawl
};
