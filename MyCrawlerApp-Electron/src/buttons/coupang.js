const { waitForSelector, clickSelectorWhenReady, waitForJsCondition } = require("./_shared");

// 쿠팡: 검색어 입력 -> 낮은가격순 정렬 -> 검색어 키워드를 모두 포함하는
// 첫 번째(=최저가) 상품의 가격을 찾아 리턴.
async function coupangSearchCrawl({ browserView, searchTerm, isCancelled }) {
  const wc = browserView.webContents;

  if (isCancelled()) {
    return null;
  }

  await wc.loadURL("https://coupang.com");

  // ↓ 임시 디버그 로그
  // const isWebdriver = await wc.executeJavaScript("navigator.webdriver");
  // console.log("[coupang] navigator.webdriver =", isWebdriver);
  // console.log("[coupang] UA =", wc.getUserAgent()); // ← 추가

  if (isCancelled()) {
    return null;
  }

  // searchTerm 에서 쌍따옴표, 물결표 제거, 물결표 사이 값도 같이 제거

  const searched = await wc.executeJavaScript(`
    (function () {
      const input = document.querySelector('input.headerSearchKeyword');

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

      const searchButton = document.querySelector('button.headerSearchBtn');

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

  // 검색 결과가 반영되고 정렬 옵션이 나타날 때까지 폴링 대기
  await waitForSelector(wc, 'label[for="sorter-LOW_PRICE"]');

  if (isCancelled()) {
    return null;
  }

  // 정렬 클릭 전, "낮은가격순" li의 현재 className을 기록
  const beforeClass = await wc.executeJavaScript(`
    (function () {
      const label = document.querySelector('label[for="sorter-LOW_PRICE"]');
      const li = label ? label.closest("li") : null;
      return li ? li.className : "";
    })();
  `);

  // "낮은가격순" 라벨이 실제로 나타날 때까지 기다렸다가 나타나는 즉시 클릭
  const sorted = await clickSelectorWhenReady(wc, 'label[for="sorter-LOW_PRICE"]');

  if (!sorted) {
    return "(정렬 버튼을 찾을 수 없음)";
  }

  if (isCancelled()) {
    return null;
  }

  // 클릭 후 li의 className이 클릭 전과 달라질 때까지 대기 = 정렬이 실제로 적용됐다는 신호
  const sortApplied = await waitForJsCondition(wc, `
    (function () {
      const label = document.querySelector('label[for="sorter-LOW_PRICE"]');
      const li = label ? label.closest("li") : null;
      const current = li ? li.className : "";
      return current !== ${JSON.stringify(beforeClass)};
    })();
  `);

  if (!sortApplied) {
    return "(정렬 적용 확인 실패)";
  }

  if (isCancelled()) {
    return null;
  }

  // 정렬 후 목록이 다시 그려질 시간을 조금 준다.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await waitForSelector(wc, "ul#product-list li a");

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

      const anchors = Array.from(document.querySelectorAll("ul#product-list li a div"));

      return anchors.map((anchor) => {
        const nameDiv = nthChildOfTag(anchor, "div", 2);
        const name = nameDiv ? nameDiv.textContent.trim() : "";

        const priceDiv = nthChildOfTag(anchor, "div", 3);

        // #,##0원 형식(예: "23,900원", "999원", "1,234,567원")을 모두 잡아내는 정규식.
        // 숫자로 시작해서 숫자/쉼표가 이어지다 "원"으로 끝나면 매치되므로 천단위 구분 콤마 유무와 무관하게 통과함.
        const priceRegex = /^[0-9][0-9,]*원$/;
        const spans = priceDiv ? Array.from(priceDiv.querySelectorAll("span")) : [];
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
  id: "coupang",
  name: "쿠팡",
  crawl: coupangSearchCrawl
};
