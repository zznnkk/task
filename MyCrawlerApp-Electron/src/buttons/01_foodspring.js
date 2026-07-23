const { waitForSelector, waitForJsCondition } = require("./_shared");

// 식봄: 검색창/검색버튼을 조작하는 대신, URL 쿼리스트링에 검색어와 정렬 조건을
// 직접 실어서 요청한다. sort=PRICE_ASC라 결과가 이미 가격 오름차순으로 오므로,
// 목록을 순서대로 훑다가 검색어 조건(쌍따옴표=포함, 물결표=제외)에 맞는
// 첫 번째 상품을 찾으면 그게 곧 최저가 상품이다.
async function foodspringSearchCrawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  if (isCancelled()) {
    return null;
  }

  // 다른 사이트들과 동일하게 쌍따옴표 제거, 물결표(및 물결표 사이 값) 제거 후,
  // 남은 공백은 "+"로 치환해서 URL 쿼리에 반영한다.
  const cleanedTerm = searchTerm.replace(/"/g, "").replace(/~.*?~/g, "").trim();
  const urlKeyword = cleanedTerm
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");

  const targetUrl = `https://www.foodspring.co.kr/search/all?key=${urlKeyword}&searchFilter=%5B%5D&sort=PRICE_ASC`;

  await wc.loadURL(targetUrl);

  if (isCancelled()) {
    return null;
  }

  // 검색 결과 상품 목록이 나타날 때까지 폴링 대기
  await waitForSelector(wc, "a[data-ds]");

  if (isCancelled()) {
    return null;
  }

  // 가격(판매가 또는 정가) 중 하나라도 "#,##0원" 형식으로 완전히 채워질 때까지 대기.
  // 요소는 먼저 나타나도 가격 숫자가 비동기로 뒤늦게 채워지는 경우가 있어서,
  // "존재"가 아니라 "포맷이 완성됐는지"를 봐야 제대로 된 값을 읽을 수 있다.
  const priceLoaded = await waitForJsCondition(wc, `
    (function () {
      const priceRegex = /^[0-9][0-9,]*원$/;
      const items = Array.from(document.querySelectorAll('a[data-ds]'));

      return items.some((item) => {
        const priceEl =
          item.querySelector('span[data-testid="sale-price"]')
          || item.querySelector('span[data-testid="original-price"]');

        return priceEl && priceRegex.test(priceEl.textContent.trim());
      });
    })();
  `);

  if (!priceLoaded) {
    return "(가격 로딩 실패)";
  }

  if (isCancelled()) {
    return null;
  }

  const items = await wc.executeJavaScript(`
    (function () {
      const anchors = Array.from(document.querySelectorAll('a[data-ds]'));

      return anchors.map((anchor) => {
        const nameEl = anchor.querySelector('span[data-testid="item-name"]');
        const priceEl =
          anchor.querySelector('span[data-testid="sale-price"]')
          || anchor.querySelector('span[data-testid="original-price"]');

        return {
          name: nameEl ? nameEl.textContent.trim() : "",
          price: priceEl ? priceEl.textContent.trim() : ""
        };
      });
    })();
  `);

  if (isCancelled()) {
    return null;
  }

  // 키워드 중 쌍따옴표를 모두 포함하고, 물결표를 모두 제외하는 상품을 찾는다.
  const keywords = searchTerm.trim().split(" ").filter(Boolean);

  const mustHave = keywords.filter((x) => x.startsWith('"') && x.endsWith('"')).map((y) => y.replace(/"/g, ""));
  const mustNotHave = keywords.filter((x) => x.startsWith('~') && x.endsWith('~')).map((y) => y.replace(/~/g, ""));

  // 이미 가격 오름차순으로 정렬된 목록이므로, 조건에 맞는 첫 번째 항목이 곧 최저가 상품이다.
  const matched = items.find((item) =>
    mustHave.every((keyword) => item.name.toLowerCase().includes(keyword.toLowerCase()))
    && mustNotHave.every((keyword) => !item.name.toLowerCase().includes(keyword.toLowerCase()))
  );

  // 가격이 이미 "#,##0원" 형식 그대로이므로 별도 가공 없이 반환
  return matched ? matched.price : "(결과 없음)";
}

module.exports = {
  id: "foodspring",
  name: "식봄",
  crawl: foodspringSearchCrawl
};
