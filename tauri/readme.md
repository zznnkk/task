# 적용 기술
- 창 하나 + 서브 웹뷰 2개(A/B), 위치·크기는 compute_layout() 함수로 자유롭게 조정 가능
- 정적 파일(dist/webviewA, dist/webviewB) 임베드 방식, 번들 없이 단일 exe
- 초기 로딩 깜빡임 방지 (숨김 → 로드완료 시 show)