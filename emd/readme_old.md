# 행정구역 자료 다운로드
- 법정 읍면동 경계도: [지오서비스](https://www.geoservice.co.kr/)
- 법정 읍면동 코드: [행정표준관리시스템](https://www.code.go.kr/stdcode/regCodeL.do)
- 행정 읍면동 경계도: [vuskli](https://github.com/vuski/admdongkor)
- 행정 읍면동 코드: [행정안전부](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000052) 주민등록, 인감 페이지 내 "행정기관(행정동) ... 변경내역" 최근 자료의 첨부자료

# 읍면동 geojson 생성
- 지오서비스에서 shp 파일 등이 포함된 zip 다운
- [mapshaper](https://mapshaper.org/) 에서 `encoding=euc-kr` 옵션으로 임포트
- 콘솔창에서 아래 명령어 실행
```text
-clean rewind
-each "AREA_M2 = $.planarArea"
-snap interval=100
-simplify dp 5%
-each "SGG_CD=EMD_CD.substring(0,5); SIDO_CD=EMD_CD.substring(0,2)"
-proj wgs84
-o emd.geojson
```
- 폴리곤 정합성은 [geojson.io](https://geojson.io/next/) 에서 확인

## 읍면동 --> 시군구, 시도 폴리곤 변환
- mapshaper 콘솔창에서 아래 명령어 실행
```text
-dissolve SGG_CD sum-fields=AREA_M2 copy-fields=SIDO_CD
-o sgg.geojson
-dissolve SIDO_CD sum-fields=AREA_M2
-o sido.geojson
```

## 속성 이름 삭제 및 변환
- mapshaper 콘솔창에서 아래 명령어 실행
```
-each 'STATE_NAME=NAME, delete NAME'
```
- 기타 도움말은 [도움말](https://mapshaper.org/docs/reference.html) 참고







# 자료 다운로드
- [지오서비스](https://www.geoservice.co.kr/)에서 제공하는 법정 읍면동 shp 파일이 담긴 26년 3월기준 `읍면동.zip` 다운로드
- [행정표준관리시스템](https://www.code.go.kr/stdcode/regCodeL.do)에서 26년 5월 현시점 기준으로 `법정동 코드 전체자료` 버튼 클릭하여 `법정동코드 전체자료.txt` 다운로드

# 읍면동 geojson 생성
- [mapshaper](https://mapshaper.org/) 사이트 접속 --> `with advanced options` 선택 --> `읍면동.zip` 을 드래그&드랍 --> `import options` 창에 `encoding=euc-kr` 입력하고 `submit` 버튼 클릭
- 왼쪽에 `console` 탭 클릭 --> 아래 명령어를 순서대로 입력 (마이너스 기호 포함하여 입력해야 함)

```text
-clean rewind
-each "AREA_M2 = $.planarArea"
-snap interval=100
-simplify dp 5%
-each "SGG_CD=EMD_CD.substring(0,5); SIDO_CD=EMD_CD.substring(0,2)"
-proj wgs84
-o emd.geojson
```

- 브라우저 창을 그대로둔 채, 다운로드 폴더에 `emd.geojson` 파일이 생성되어 있는지 확인
- 새로운 창을 열어 [geojson.io](https://geojson.io/next/) 사이트에 접속 --> 오른쪽 위 `import` 클릭 --> `emd.geojson` 파일 선택하고 `import` 버튼 클릭 --> 한국 지도에 geojson 폴리곤이 지도에 잘 덧씌워져 생성되어 있는지 판단

# 시군구, 시도 geojson 생성
- 다시 원래의 mapshaper 창으로 돌아가 콘솔화면에 아래 명령어를 계속 이어나감

```text
-dissolve SGG_CD sum-fields=AREA_M2 copy-fields=SIDO_CD
-o sgg.geojson
-dissolve SIDO_CD sum-fields=AREA_M2
-o sido.geojson
```

- 생성된 `sgg.geojson`, `sido.geojson` 도 geojson.io 사이트에서 폴리곤이 제대로 생성되었는지 확인

# 음식점 정보에 행정구역 코드 매칭
- 마켓맵 raw 에서, `rs_id,lng,lat` 칼럼만 있는 `음식점.csv` 파일 생성  (lng 는 경도, lat 는 위도), id 는 나중에 음식점을 식별하기 위한 임의의 번호
- 클로드 바이브 코딩으로 매칭해주는 `geocode_match.py` 생성
- 사전에 python 준비, geopandas 라이브러리 설치되어 있어야 하며, 위 파일 실행하면 `matched.csv` 생성되며, `rs_id,lng,lat,emd_cd,sgg_cd,sido_cd` 칼럼 존재

# 최종 결과물 작성
- [mapshaper] 사이트에 `emd.geojson` 업로드한 뒤, csv 로 출력 `읍면동.csv` 생성
- 위에서 언급한 `법정동코드 전체자료.txt` 준비
- `matched.csv` 준비
- 위 3개 파일을 이용하여 행정구역별 음식점 밀도(음식점수 / 행정구역면적) 계산