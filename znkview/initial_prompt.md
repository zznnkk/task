# 목표
- 윈도우11 전용 desktop app 만들 때 활용할 수 있는 보일러 플레이트를 설계하고자 함
- backend 와 frontend 를 두고, backend 는 하드웨어 조작/frontend 각 요소의 통신 지원(예를들어 frontend A 요소가 frontend B 요소에메세지 보낼 때의 경유)
-  


# backend
- rust + tao + wry 기반, 하나의 window 한에 3 개의 webview 배치
- 모든 webview 의 
- 향후 frontend 변동에 따


# frontend
- 각 webview 는 독립된 js context 를 지님
- 
