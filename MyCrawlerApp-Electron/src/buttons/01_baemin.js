const { waitForSelector, clickButtonWhenReady } = require("./_shared");

// 배민상회: 검색어 입력 -> 낮은가격순 정렬 -> 검색어 키워드를 모두 포함하는
// 첫 번째(=최저가) 상품의 가격을 찾아 리턴.
async function baeminSearchCrawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  if (isCancelled()) {
    return null;
  }

  await wc.loadURL("https://mart.baemin.com/");

  if (isCancelled()) {
    return null;
  }

  // serchTerm 에서 쌍따옴표, 물결표 제거, 물결표 사이 값도 같이 제거

  const searched = await wc.executeJavaScript(`
    (function () {
      const input = document.querySelector('input[name="search input"]');

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
      // serchTerm 에서 쌍따옴표, 물결표 제거, 물결표 사이 값도 같이 제거
      nativeSetter.call(input, ${JSON.stringify(  searchTerm.replace(/"/g, "").replace(/~.*?~/g, "")  )});  
      input.dispatchEvent(new Event("input", { bubbles: true }));

      // input과 형제 관계에 있는 돋보기(검색) 버튼을 찾아 클릭
      const container = input.parentElement;
      const searchButton = container ? container.querySelector("button") : null;

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

  // SPA라 페이지 전체 이동이 없으므로, 검색 반영 및 정렬 버튼이 나타날 때까지 폴링 대기
  await waitForSelector(wc, "button");

  if (isCancelled()) {
    return null;
  }

  // "낮은가격순" 버튼이 실제로 나타날 때까지 기다렸다가 나타나는 즉시 클릭
  const sorted = await clickButtonWhenReady(wc, "낮은가격순");

  if (!sorted) {
    return "(정렬 버튼을 찾을 수 없음)";
  }

  if (isCancelled()) {
    return null;
  }

  // 정렬 후 목록이 다시 그려질 시간을 조금 준다.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await waitForSelector(wc, "a[data-card-size]");

  if (isCancelled()) {
    return null;
  }

  const items = await wc.executeJavaScript(`
    (function () {
      function nthChildOfTag(parent, tag, n) {
        if (!parent) {
          return null;
        }

        const children = Array.from(parent.children).filter(
          (el) => el.tagName.toLowerCase() === tag
        );

        return children[n - 1] || null;
      }

      const anchors = Array.from(document.querySelectorAll("div[data-testid] a[data-card-size]"));

      return anchors.map((anchor) => {
        const secondDiv = nthChildOfTag(anchor, "div", 2);

        const nameDiv = nthChildOfTag(secondDiv, "div", 1);
        const nameEl = nameDiv ? nameDiv.querySelector("p") : null;
        const name = nameEl ? nameEl.textContent.trim() : "";

        const priceOuterDiv = nthChildOfTag(secondDiv, "div", 2);
        const priceDiv = priceOuterDiv ? priceOuterDiv.querySelector("div") : null;
        const priceFirstDiv = nthChildOfTag(priceDiv, "div", 1);

        const priceRegex = /[0-9,]+원$/;
        const spans = priceFirstDiv ? Array.from(priceFirstDiv.querySelectorAll("span")) : [];
        const priceSpan = spans.find((span) => priceRegex.test(span.textContent.trim()));
        const price = priceSpan ? priceSpan.textContent.trim() : "";

        return { name, price };
      });
    })();
  `);

  if (isCancelled()) {
    return null;
  }

  // items는 이미 "낮은가격순"으로 정렬된 순서 그대로이므로,
  // 키워드 중 쌍따옴표를 모두 포함하고, 물결표를 모두 제외한 첫 번째 상품 = 최저가 상품이다.
  const keywords = searchTerm.trim().split(" ").filter(Boolean);

  const mustHave = keywords.filter((x) => x.startsWith('"') && x.endsWith('"')).map((y) => y.replace(/"/g, ""));
  const mustNotHave = keywords.filter((x) => x.startsWith('~') && x.endsWith('~')).map((y) => y.replace(/~/g, ""));

  const matched = items.find((item) =>
    mustHave.every((keyword) => item.name.toLowerCase().includes(keyword.toLowerCase()))
    && mustNotHave.every((keyword) => !item.name.toLowerCase().includes(keyword.toLowerCase()))
  );

  return matched ? matched.price : "(결과 없음)";
}

module.exports = {
  id: "baemin",
  name: "배민상회",
  crawl: baeminSearchCrawl
};
