const { waitForSelector, waitForJsCondition } = require("./_shared");

// 문자열에서 숫자만 뽑아 정수로 변환. "12,900원" -> 12900. 숫자가 없으면 NaN.
function extractPriceNumber(text) {
  if (!text) {
    return NaN;
  }

  const digits = text.match(/[0-9]+/g);

  return digits ? parseInt(digits.join(""), 10) : NaN;
}

// 차별화상회: URL 쿼리스트링으로 검색까지는 가능하지만 정렬 기준이 SCORE(관련도순)
// 밖에 없어서, 검색 결과를 가져온 뒤 Node 쪽에서 직접 낮은가격순으로 비교해야 한다.
async function chabyeolSearchCrawl({ browserView, searchTerm, isCancelled }) {
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

  const targetUrl = `https://www.chabyulhwa.com/search?sortBy=SCORE&query=${urlKeyword}`;

  await wc.loadURL(targetUrl);

  if (isCancelled()) {
    return null;
  }

  // 참고: 상품 셀렉터로 받은 "a.mobile\:hidden"은 Tailwind 스타일 클래스명(콜론 포함)이라
  // CSS 클래스 셀렉터로 쓰려면 콜론을 이스케이프해야 하는데, 이스케이프 처리가
  // Node 템플릿 문자열 -> 브라우저 JS 소스로 두 단계를 거치며 백슬래시가 꼬이기 쉬워서,
  // 대신 속성 선택자 a[class~="mobile:hidden"]로 동일한 대상을 훨씬 안전하게 찾는다.
  const itemSelector = 'a[class~="mobile:hidden"]';

  // 검색 결과 상품 목록이 나타날 때까지 폴링 대기
  await waitForSelector(wc, itemSelector);

  if (isCancelled()) {
    return null;
  }

  // 상품 가격 중 하나라도 "#,##0원" 형식으로 완전히 채워질 때까지 대기.
  // 요소는 먼저 나타나도 가격 숫자가 비동기로 뒤늦게 채워지는 경우가 있어서,
  // "존재"가 아니라 "포맷이 완성됐는지"를 봐야 제대로 된 값을 읽을 수 있다.
  const priceLoaded = await waitForJsCondition(wc, `
    (function () {
      const priceRegex = /^[0-9][0-9,]*원$/;
      const items = Array.from(document.querySelectorAll('${itemSelector}'));

      return items.some((item) => {
        const priceEl = item.querySelector("span.product-list-item-info-discounted-price");
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
      const anchors = Array.from(document.querySelectorAll('${itemSelector}'));

      return anchors.map((anchor) => {
        const nameEl = anchor.querySelector("div.product-list-item-info-title");
        const priceEl = anchor.querySelector("span.product-list-item-info-discounted-price");

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

  // 정렬 기준이 관련도(SCORE)뿐이라 후보들 중 최저가를 직접 계산
  const cheapest = candidates.reduce((min, cur) => (cur.price < min.price ? cur : min));

  // #,##0원 형식으로 변환
  return `${cheapest.price.toLocaleString("ko-KR")}원`;
}

module.exports = {
  id: "chabyeol",
  name: "차별화상회",
  crawl: chabyeolSearchCrawl
};
