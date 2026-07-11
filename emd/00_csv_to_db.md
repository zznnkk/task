# 과제
- input.csv 내용을 sqlite 사용하여 db 파일 생성

# 기술스택
- 윈11, python, uv 사용, 라이브러리는 알아서 제안
- `00_csv_to_db.py` 라는 한개의 스크립트 파일로 코드 작성

# 코드
- sqlite 사용하여 db 파일 생성, 파일 이름은 `raw.sqlite`
- 그 안에 `marketmap` 테이블 생성, 칼럼은 `biz_no`(text, primary), `lon`(text), `lat`(text), `addr`(text), `emd_cd`(text) 생성
- 참고로 칼럼중 일부는 숫자를 다루기도 하지만 형식은 모두 text

- 반복문으로 `input.csv` 를 청크 로드, 청크 단위는 알아서 판단
- 각 row 를 `raw.sqlite` 에 칼럼에 맞춰 삽입, 즉 csv 를 sqlite db 안에 넣는다고 생각하면 됨

- 청크 한단위가 완료되면, 콜솔과 `00_csv_to_db.log` 파일에 로그 출력
- 로그 출력할 땐 스크립트 시작부터 로그 출력시점까지 얼마나 시간이 경과했는지 추가