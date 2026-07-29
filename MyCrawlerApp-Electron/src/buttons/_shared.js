// 여러 버튼(크롤러)에서 공통으로 쓰는 헬퍼 모음.
// 파일명이 _로 시작하므로 main.js의 loadButtons()에서 버튼으로 취급하지 않고 스킵함.
//
// 지금은 7개 사이트가 전부 "URL에 검색어를 실어 접속하는" 방식이라
// (1)(2)(3)이 URL 접속 하나로 합쳐지고, (4)~(9) 흐름이 사이트마다 거의 동일함.
// 그래서 이 파일에 그 공통 흐름을 오케스트레이터(runUrlQuerySite)로 만들어두고,
// 사이트별 파일은 셀렉터/URL 조합 같은 "재료"만 config로 넘겨준다.

// min~max(ms) 사이 랜덤 시간만큼 대기. 100ms 단위로 취소 여부를 확인해서,
// 대기 중에 취소 버튼을 눌러도 즉시 반응하게 한다.
function randomDelay(minMs, maxMs, isCancelledFn) {
  const target = minMs + Math.random() * (maxMs - minMs);
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      if ((isCancelledFn && isCancelledFn()) || Date.now() - start >= target) {
        resolve();
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}

// 임의의 JS 표현식(문자열)이 true가 될 때까지 폴링.
// "요소가 존재하는지"뿐 아니라 "특정 조건(예: 첫 상품 가격이 완성된 포맷인지)"까지
// 확인해야 할 때 쓴다.
async function waitForJsCondition(webContents, jsExpression, { timeout = 5000, interval = 250 } = {}) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await webContents.executeJavaScript(jsExpression).catch(() => false);

    if (result) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

// 문자열에서 숫자만 뽑아 정수로 변환. "12,900원" -> 12900. 숫자가 없으면 NaN.
function extractPriceNumber(text) {
  if (!text) {
    return NaN;
  }

  const digits = text.match(/[0-9]+/g);

  return digits ? parseInt(digits.join(""), 10) : NaN;
}

// ---------------------------------------------------------------------------
// (6) 제스처 - ghost-cursor의 path 알고리즘(3차 베지어 곡선 기반 좌표 생성)만
// 떼어와서 여기 이식. 실제 이동은 페이지 JS가 아니라 Electron의
// webContents.sendInputEvent (OS 레벨 입력 주입)로 실행되므로, 페이지 입장에서
// isTrusted: true인 진짜 마우스 이벤트로 보인다. (page-JS의 dispatchEvent는
// 스펙상 무조건 isTrusted: false라 이 방식으로는 절대 흉내낼 수 없음)
// ---------------------------------------------------------------------------

function cubicBezierPoint(t, p0, p1, p2, p3) {
  const c = 1 - t;

  return {
    x: c * c * c * p0.x + 3 * c * c * t * p1.x + 3 * c * t * t * p2.x + t * t * t * p3.x,
    y: c * c * c * p0.y + 3 * c * c * t * p1.y + 3 * c * t * t * p2.y + t * t * t * p3.y
  };
}

// start -> end 사이를, 이동 방향에 수직인 방향으로 살짝 흔들리는 3차 베지어 곡선을
// 따라가는 좌표 배열로 만든다. (ghost-cursor의 핵심 아이디어를 단순화해서 이식)
function generateGesturePath(start, end, { steps = 24, spread = 40 } = {}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // 이동 방향에 수직인 단위 벡터 (베지어 컨트롤포인트를 이 방향으로 흔들어서 곡선을 만듦)
  const nx = -dy / dist;
  const ny = dx / dist;

  const offset1 = (Math.random() - 0.5) * spread;
  const offset2 = (Math.random() - 0.5) * spread;

  const p1 = {
    x: start.x + dx * 0.33 + nx * offset1,
    y: start.y + dy * 0.33 + ny * offset1
  };
  const p2 = {
    x: start.x + dx * 0.66 + nx * offset2,
    y: start.y + dy * 0.66 + ny * offset2
  };

  const points = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    points.push(cubicBezierPoint(t, start, p1, p2, end));
  }

  return points;
}

// 미리 준비해둔 제스처 4~5종. 매번 이 중 하나를 랜덤으로 고르고,
// 좌표/거리/스텝수도 그때그때 랜덤하게 줘서 매번 다른 움직임이 나오게 한다.
const GESTURE_PRESETS = [
  // 1) 짧은 좌우 이동
  () => ({
    start: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 150 },
    end: { x: 500 + Math.random() * 200, y: 220 + Math.random() * 150 },
    spread: 20 + Math.random() * 20,
    steps: 15 + Math.floor(Math.random() * 10)
  }),
  // 2) 대각선으로 길게 이동
  () => ({
    start: { x: 150 + Math.random() * 100, y: 150 + Math.random() * 100 },
    end: { x: 700 + Math.random() * 150, y: 500 + Math.random() * 150 },
    spread: 40 + Math.random() * 40,
    steps: 25 + Math.floor(Math.random() * 15)
  }),
  // 3) 위아래(수직 위주) 짧은 이동
  () => ({
    start: { x: 400 + Math.random() * 150, y: 150 + Math.random() * 100 },
    end: { x: 420 + Math.random() * 150, y: 450 + Math.random() * 150 },
    spread: 15 + Math.random() * 20,
    steps: 18 + Math.floor(Math.random() * 10)
  }),
  // 4) 작은 원호처럼 살짝 휘어지는 짧은 이동
  () => ({
    start: { x: 300 + Math.random() * 150, y: 300 + Math.random() * 100 },
    end: { x: 380 + Math.random() * 150, y: 340 + Math.random() * 100 },
    spread: 50 + Math.random() * 30,
    steps: 12 + Math.floor(Math.random() * 8)
  }),
  // 5) 화면을 가로지르는 긴 이동
  () => ({
    start: { x: 100 + Math.random() * 80, y: 400 + Math.random() * 100 },
    end: { x: 800 + Math.random() * 100, y: 200 + Math.random() * 100 },
    spread: 60 + Math.random() * 40,
    steps: 30 + Math.floor(Math.random() * 15)
  })
];

// 준비된 제스처 중 하나를 랜덤으로 골라 실제로 마우스를 움직인다.
// webContents.sendInputEvent는 Electron이 OS/크로미움 입력 파이프라인을 통해
// 전달하는 진짜 입력이라, 페이지에서 isTrusted: true로 보인다.
async function performRandomGesture(webContents) {
  const preset = GESTURE_PRESETS[Math.floor(Math.random() * GESTURE_PRESETS.length)];
  const { start, end, spread, steps } = preset();
  const path = generateGesturePath(start, end, { spread, steps });

  for (const point of path) {
    webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(point.x),
      y: Math.round(point.y)
    });

    // 사람 손 속도처럼 보이게 스텝마다 짧게 랜덤 텀
    await new Promise((resolve) => setTimeout(resolve, 8 + Math.random() * 14));
  }
}

// ---------------------------------------------------------------------------
// URL+query 방식 사이트 공통 오케스트레이터
//
// 지금 7개 사이트 전부 "URL에 검색어를 실어서 접속하면 그 자체로 (1)(2)(3)이 끝나는"
// 구조라, 이 함수 하나로 (1)~(9) 공통 흐름을 처리하고 사이트별 파일은 재료만 준다.
//
// config:
//   buildUrl(cleanedTerm)         : 정리된 검색어로 최종 URL 문자열 생성 (1)(2)(3)
//   afterLoadDelayMs = [a, b]     : (4) URL 로드 후 대기
//   isReady(wc)                  : (5) 아이템 노출 확인 (5초 타임아웃은 내부에서 처리)
//   extractItems(wc)             : (7) [{ name, priceText }] 추출
//   priceRegex                   : 가격 텍스트 유효성 검사용 정규식 (사이트마다 "원" 유무 다름)
//
// 리턴값: "12,900원" / "(결과 없음)" / "(아이템 노출 실패)" 중 하나.
// (main.js가 이 값을 받아서 가격이 아니면 전부 "(크롤링실패)"로 정규화함)
async function runUrlQuerySite(webContents, term, isCancelled, config) {
  const {
    buildUrl,
    afterLoadDelayMs = [1000, 1500],
    isReady,
    extractItems,
    priceRegex
  } = config;

  if (isCancelled()) {
    return null;
  }

  // 검색어 정리: 쌍따옴표는 벗기고, 물결표는 물결표 안 내용까지 통째로 제거
  const cleanedTerm = term
    .replace(/"/g, "")
    .replace(/~.*?~/g, "")
    .trim()
    .replace(/\s+/g, " ");

  const url = buildUrl(cleanedTerm);

  // (1)(2)(3) URL 접속 자체가 사이트 접속 + 검색창 확인 + 검색값 입력을 겸함
  await webContents.loadURL(url);

  if (isCancelled()) {
    return null;
  }

  // (4) 대기
  await randomDelay(afterLoadDelayMs[0], afterLoadDelayMs[1], isCancelled);

  if (isCancelled()) {
    return null;
  }

  // (5) 아이템 노출 확인 (5초 타임아웃, 실패 시 이 검색어는 실패로 기록하고 종료)
  const ready = await isReady(webContents);

  if (!ready) {
    return "(아이템 노출 실패)";
  }

  if (isCancelled()) {
    return null;
  }

  // (6) 제스처
  await performRandomGesture(webContents);

  if (isCancelled()) {
    return null;
  }

  // (7) 크롤링 + 필터링
  const items = await extractItems(webContents);

  const keywords = term.trim().split(" ").filter(Boolean);

  const mustHave = keywords
    .filter((x) => x.startsWith('"') && x.endsWith('"'))
    .map((y) => y.replace(/"/g, ""));

  const mustNotHave = keywords
    .filter((x) => x.startsWith("~") && x.endsWith("~"))
    .map((y) => y.replace(/~/g, ""));

  const candidates = items.filter((item) => {
    if (!priceRegex.test(item.priceText.trim())) {
      return false;
    }

    return (
      mustHave.every((k) => item.name.toLowerCase().includes(k.toLowerCase()))
      && mustNotHave.every((k) => !item.name.toLowerCase().includes(k.toLowerCase()))
    );
  });

  if (candidates.length === 0) {
    return "(결과 없음)";
  }

  // (8) 오름차순 정렬 후 최저가 채택
  const cheapest = candidates.reduce((min, cur) => {
    const curPrice = extractPriceNumber(cur.priceText);
    const minPrice = extractPriceNumber(min.priceText);

    return curPrice < minPrice ? cur : min;
  });

  const priceNum = extractPriceNumber(cheapest.priceText);

  if (Number.isNaN(priceNum)) {
    return "(아이템 노출 실패)";
  }

  // 원본에 "원"이 있든 없든(다담몰/장보자닷컴처럼) 여기서 항상 "#,##0원" 형식으로 통일
  return `${priceNum.toLocaleString("ko-KR")}원`;
}

module.exports = {
  randomDelay,
  waitForJsCondition,
  extractPriceNumber,
  generateGesturePath,
  performRandomGesture,
  runUrlQuerySite
};
