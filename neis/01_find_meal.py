"""
NEIS 급식식단 수집기 (long format)
사용법: uv run find_meal.py <status_value>
  예) uv run find_meal.py done20260626

동작:
  1) neis.school_info 에서 status != <status_value> 인 학교 하나 SELECT
  2) 급식 API 호출 (페이징 자동)
  3) row 배열을 그대로 neis.meal_info 에 UPSERT
  4) 해당 학교(school_info) row의 status 를 <status_value> 로 UPDATE
  5) 완료 학교 없을 때까지 반복
"""

import os
import sys
import time
import requests
from dotenv import load_dotenv
import psycopg

# ─── argument 체크 ────────────────────────────────────────
if len(sys.argv) < 2 or not sys.argv[1].strip():
    print("❌ argument 가 필요합니다.")
    print("   사용법: uv run find_meal.py <status_value>")
    sys.exit(1)

STATUS = sys.argv[1].strip()

# ─── 환경변수 ─────────────────────────────────────────────
load_dotenv()
KEY         = os.getenv("NEIS_KEY")
PG_HOST     = os.getenv("PG_HOST")
PG_PORT     = os.getenv("PG_PORT", "5432")
PG_USER     = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD")
PG_DB       = os.getenv("PG_DB", "neis_school")

# ─── 설정 ─────────────────────────────────────────────────
BASE_URL  = "https://open.neis.go.kr/hub/mealServiceDietInfo"
MLSV_FROM = "20260101"
MLSV_TO   = "20261231"
PAGE_SIZE = 1000
SLEEP_SEC = 0.1

# API 출력 필드 15개 (응답 키 그대로)
FIELDS = [
    "ATPT_OFCDC_SC_CODE", "ATPT_OFCDC_SC_NM", "SD_SCHUL_CODE", "SCHUL_NM",
    "MMEAL_SC_CODE", "MMEAL_SC_NM", "MLSV_YMD", "MLSV_FGR",
    "DDISH_NM", "ORPLC_INFO", "CAL_INFO", "NTR_INFO",
    "MLSV_FROM_YMD", "MLSV_TO_YMD", "LOAD_DTM",
]

UPSERT_MEAL_SQL = """
INSERT INTO neis.meal_info (
    atpt_ofcdc_sc_code, atpt_ofcdc_sc_nm, sd_schul_code, schul_nm,
    mmeal_sc_code, mmeal_sc_nm, mlsv_ymd, mlsv_fgr,
    ddish_nm, orplc_info, cal_info, ntr_info,
    mlsv_from_ymd, mlsv_to_ymd, load_dtm
) VALUES (
    %(ATPT_OFCDC_SC_CODE)s, %(ATPT_OFCDC_SC_NM)s, %(SD_SCHUL_CODE)s, %(SCHUL_NM)s,
    %(MMEAL_SC_CODE)s, %(MMEAL_SC_NM)s, %(MLSV_YMD)s, %(MLSV_FGR)s,
    %(DDISH_NM)s, %(ORPLC_INFO)s, %(CAL_INFO)s, %(NTR_INFO)s,
    %(MLSV_FROM_YMD)s, %(MLSV_TO_YMD)s, %(LOAD_DTM)s
)
ON CONFLICT (atpt_ofcdc_sc_code, sd_schul_code, mlsv_ymd, mmeal_sc_code) DO UPDATE SET
    atpt_ofcdc_sc_nm = EXCLUDED.atpt_ofcdc_sc_nm,
    schul_nm         = EXCLUDED.schul_nm,
    mmeal_sc_nm      = EXCLUDED.mmeal_sc_nm,
    mlsv_fgr         = EXCLUDED.mlsv_fgr,
    ddish_nm         = EXCLUDED.ddish_nm,
    orplc_info       = EXCLUDED.orplc_info,
    cal_info         = EXCLUDED.cal_info,
    ntr_info         = EXCLUDED.ntr_info,
    mlsv_from_ymd    = EXCLUDED.mlsv_from_ymd,
    mlsv_to_ymd      = EXCLUDED.mlsv_to_ymd,
    load_dtm         = EXCLUDED.load_dtm;
"""

UPDATE_STATUS_SQL = """
UPDATE neis.school_info
   SET status = %s
 WHERE atpt_ofcdc_sc_code = %s
   AND sd_schul_code      = %s;
"""

PICK_NEXT_SQL = """
SELECT atpt_ofcdc_sc_code, atpt_ofcdc_sc_nm, sd_schul_code, schul_nm
  FROM neis.school_info
 WHERE status IS DISTINCT FROM %s
 LIMIT 1;
"""


# ─── 급식 API 호출 (페이징 자동) ──────────────────────────
def fetch_all_meals(acode: str, scode: str) -> list[dict]:
    """학교 하나의 1~6월 급식 row 전체 반환"""
    all_rows = []
    page = 1
    while True:
        url = (
            f"{BASE_URL}?Type=json&pSize={PAGE_SIZE}&pIndex={page}"
            f"&KEY={KEY}"
            f"&ATPT_OFCDC_SC_CODE={acode}&SD_SCHUL_CODE={scode}"
            f"&MLSV_FROM_YMD={MLSV_FROM}&MLSV_TO_YMD={MLSV_TO}"
        )
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        data = r.json()

        # 정상 응답 키가 없으면 데이터 없음 (INFO-200 등)
        if "mealServiceDietInfo" not in data:
            break

        body = data["mealServiceDietInfo"]
        result = body[0]["head"][1]["RESULT"]
        if result["CODE"] != "INFO-000":
            break

        rows = body[1].get("row", []) if len(body) > 1 else []
        all_rows.extend(rows)

        # 마지막 페이지면 종료
        if len(rows) < PAGE_SIZE:
            break
        page += 1
        time.sleep(SLEEP_SEC)
    return all_rows


# ─── 메인 ─────────────────────────────────────────────────
def main():
    conn = psycopg.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=PG_PASSWORD,
        dbname=PG_DB,
    )

    try:
        # 진행률 표시용 카운트
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(DISTINCT (atpt_ofcdc_sc_code, sd_schul_code))
                  FROM neis.school_info
            """)
            total = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(DISTINCT (atpt_ofcdc_sc_code, sd_schul_code))
                  FROM neis.school_info
                 WHERE status = %s
            """, (STATUS,))
            done = cur.fetchone()[0]

        print(f"▶ 시작: 대상 {total}개 / 이미 완료 {done}개 / status='{STATUS}'\n")

        while True:
            # 다음 학교 1개
            with conn.cursor() as cur:
                cur.execute(PICK_NEXT_SQL, (STATUS,))
                pick = cur.fetchone()
            if pick is None:
                print("\n🎉 모든 학교 작업 완료!")
                break

            acode, aname, scode, sname = pick

            # API 호출
            try:
                rows = fetch_all_meals(acode, scode)
            except Exception as e:
                print(f"❌ HTTP error: {sname} ({acode}/{scode}) - {e}")
                time.sleep(2)
                continue

            # row 그대로 UPSERT (없는 키는 None)
            with conn.cursor() as cur:
                if rows:
                    params_list = [{k: r.get(k) for k in FIELDS} for r in rows]
                    cur.executemany(UPSERT_MEAL_SQL, params_list)
                # 식단이 없어도 status는 마킹 (재실행 시 스킵)
                cur.execute(UPDATE_STATUS_SQL, (STATUS, acode, scode))
            conn.commit()

            done += 1
            print(f"{done}/{total} 학교 식단 업데이트가 완료되었습니다. — {sname} ({len(rows)} rows)")

            time.sleep(SLEEP_SEC)
    finally:
        conn.close()


if __name__ == "__main__":
    main()