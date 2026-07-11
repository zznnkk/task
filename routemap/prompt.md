# 과제
- 예전에 만들었던 sample.html 를 변형

# 수정사항 개괄
- 전체적인 디자인은 그대로 유지
- 컨트롤패널(div#control-panel)에서 `밀도 단계 설정`, `센터`, `N회전` 아래에 `🥣 업종` 추가
- 업종(아래 DATA 상수 참조) 161개 모두 체크박스로 나타내고 처음에는 모두 체크되어 있음
- GEOJSON_EMD, GEOJSON_SGG, GEOJSON_SIDO 는 용량관계 상 sample.html 에는 지워져있으나 나중에 채울 것으로 geojson 형식임
- GEOJSON_EMD 의 속성은 emd_cd, GEOJSON_SGG 속성은 sgg_cd, GEOJSON_SIDO 속성은 sido_cd 만 존재
- DATA 상수는 { emd_cd: {emd_nm, area_km2, 업종161개... }, ... } 와 같은 형태로 용량관계상 일단 한줄만 써있음, emd_cd 는 읍면동 코드(문자열로 된 숫자), emd_nm 은 읍면동 이름, area_km2 는 제곱킬로미터 단위 면적, 업종161개는 음식점 개수임
- leaflet 위에 커서를 올렸을 때 팝업 뜨게하지 말고, 클릭했을 때 GEOJSON_EMD 기준으로 팝업 표시하고, end_nm 내용과 계산된 밀도를 표시
- 기존 sample.html 에서 밀도는 density 속성 사용했으나 없음, DATA 안의 area_km2 키와 체크가되어있는 업종들 값의 합계로 계산 (업종값들의 합계/area_km2) 해야 함
- 따라서 밀도 단계별로 색상을 emd_cd 별로 다 계산을 해서 색을 칠해줘야함, 이는 밀도 범례 기준이 바뀌거나 업종 체크가 바뀔때마다 재실행 되어야 함
