# 과제
- sqlite db 안에서 emd_cd 가 "-1" 인 row 들을 읽어와서 위/경도를 읽어와서, 카카오 rest api 통해 어느 행정구역에 포함되는지를 판단하여 매칭한 뒤, 다시 sqlite db 에 기록

# 기술스택
- 윈11, python, uv 사용중, 라이브러리는 알아서 제안
- 카카오 api 를 사용, api 설명서는 `https://developers.kakao.com/docs/ko/local/dev-guide` 에 있으며, 아래 두개 api 를 사용
  - (1) 좌표로 행정구역 정보 변환: `https://dapi.kakao.com/v2/local/geo/coord2regioncode.${FORMAT}`
  - (2) 주소로 좌표 변환: `https://dapi.kakao.com/v2/local/search/address.${FORMAT}`
- 카카오 api 키는 `.env` 파일에 `KAKAO_APIKEY` 로 정의되어 있음
- `02_kakaoapi_matching.py` 라는 한개의 스크립트 파일로 코드 작성

# 코드
- `raw.sqlite` db 안 `marketmap` 테이블 에서 `emd_cd` 가 "-1" 인 row 를 읽어옴, row 를 몇개씩 읽어서 처리해야 효율적일지는 알아서 판단
- row 의 칼럼이 `lon`, `lat` 은 각각 경도, 위도를 나타냄, 각각의 값이 "0", "0" 이 아니라면 이 좌표로 위 (1) api 호출
  - 호출 결과에서 `region_type` 이 "B" 인 객체에서 `code` 값을 가져오되, 앞의 8 자리만을 취해서 `emd_cd` 칼럼에 삽입, 숫자지만 text 형식이어야 함
- 만일 `lon`, `lat` 의 값이 "0", "0" 이거나, (1) api 호출로 결과를 가져오지 못했을 경우, `area` 칼럼의 값을 가지고 (2) api 호출
  - 호출 결과에서 `address` 또는 `road_address` 아래 `x`, `y` 값을 가져와서 다시 (1) api 호출하여 그 결과를 `emd_cd` 칼럼에 삽입, 숫자지만 text 형식이어야 함
- 만일 어느 api 로도 결과를 도출하지 못했다면 "-2" 를 `emd_cd` 칼럼에 삽입

- db 처리 한단위가 완료되면, 콜솔과 `02_kakaoapi_matching.log` 파일에 로그 출력
- 로그 출력할 땐 스크립트 시작부터 로그 출력시점까지 얼마나 시간이 경과했는지 추가
