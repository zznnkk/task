"""
NEIS 학교기본정보 수집 → PostgreSQL (RAW, 중복 허용)
- pIndex 1부터 순회, CODE != INFO-000 이면 종료
- 모든 row를 그대로 INSERT (UPSERT 아님)
"""

import os
import time
import requests
from dotenv import load_dotenv
import psycopg
from psycopg.types.json import Jsonb

# ─── 환경변수 ──────────────────────────────────────────────
load_dotenv()

KEY         = os.getenv("NEIS_KEY")
PG_HOST     = os.getenv("PG_HOST")
PG_PORT     = os.getenv("PG_PORT", "5432")
PG_USER     = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD")
PG_DB       = os.getenv("PG_DB", "neis_school")

# ─── 설정 ─────────────────────────────────────────────────
BASE_URL  = "https://open.neis.go.kr/hub/schoolInfo"
PAGE_SIZE = 1000
SLEEP_SEC = 0.1

# API row 필드 25개
FIELDS = [
    "ATPT_OFCDC_SC_CODE", "ATPT_OFCDC_SC_NM",  "SD_SCHUL_CODE",  "SCHUL_NM",       "ENG_SCHUL_NM",
    "SCHUL_KND_SC_NM",    "LCTN_SC_NM",        "JU_ORG_NM",      "FOND_SC_NM",     "ORG_RDNZC",
    "ORG_RDNMA",          "ORG_RDNDA",         "ORG_TELNO",      "HMPG_ADRES",     "COEDU_SC_NM",
    "ORG_FAXNO",          "HS_SC_NM",          "INDST_SPECL_CCCCL_EXST_YN", "HS_GNRL_BUSNS_SC_NM",
    "SPCLY_PURPS_HS_ORD_NM", "ENE_BFE_SEHF_SC_NM", "DGHT_SC_NM", "FOND_YMD",
    "FOAS_MEMRD",         "LOAD_DTM",
]

INSERT_SQL = """
INSERT INTO neis.school_info (
    atpt_ofcdc_sc_code, atpt_ofcdc_sc_nm, sd_schul_code, schul_nm, eng_schul_nm,
    schul_knd_sc_nm, lctn_sc_nm, ju_org_nm, fond_sc_nm, org_rdnzc,
    org_rdnma, org_rdnda, org_telno, hmpg_adres, coedu_sc_nm,
    org_faxno, hs_sc_nm, indst_specl_ccccl_exst_yn, hs_gnrl_busns_sc_nm,
    spcly_purps_hs_ord_nm, ene_bfe_sehf_sc_nm, dght_sc_nm, fond_ymd,
    foas_memrd, load_dtm, raw_json, page_idx, row_idx_in_page
) VALUES (
    %(ATPT_OFCDC_SC_CODE)s, %(ATPT_OFCDC_SC_NM)s, %(SD_SCHUL_CODE)s, %(SCHUL_NM)s, %(ENG_SCHUL_NM)s,
    %(SCHUL_KND_SC_NM)s, %(LCTN_SC_NM)s, %(JU_ORG_NM)s, %(FOND_SC_NM)s, %(ORG_RDNZC)s,
    %(ORG_RDNMA)s, %(ORG_RDNDA)s, %(ORG_TELNO)s, %(HMPG_ADRES)s, %(COEDU_SC_NM)s,
    %(ORG_FAXNO)s, %(HS_SC_NM)s, %(INDST_SPECL_CCCCL_EXST_YN)s, %(HS_GNRL_BUSNS_SC_NM)s,
    %(SPCLY_PURPS_HS_ORD_NM)s, %(ENE_BFE_SEHF_SC_NM)s, %(DGHT_SC_NM)s, %(FOND_YMD)s,
    %(FOAS_MEMRD)s, %(LOAD_DTM)s, %(_raw)s, %(_page)s, %(_row_idx)s
);
"""


# ─── API 호출 ─────────────────────────────────────────────
def fetch_page(i: int) -> tuple[str, str, list[dict], int]:
    url = f"{BASE_URL}?KEY={KEY}&Type=json&pIndex={i}&pSize={PAGE_SIZE}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    data = r.json()

    if "schoolInfo" in data:
        head = data["schoolInfo"][0]["head"]
        total = head[0].get("list_total_count", 0)
        result = head[1]["RESULT"]
        code, msg = result["CODE"], result["MESSAGE"]
        rows = data["schoolInfo"][1].get("row", []) if len(data["schoolInfo"]) > 1 else []
        return code, msg, rows, total

    if "RESULT" in data:
        return data["RESULT"]["CODE"], data["RESULT"]["MESSAGE"], [], 0

    return "UNKNOWN", f"unexpected response: {data}", [], 0


# ─── 메인 루프 ────────────────────────────────────────────
def main():
    conn = psycopg.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=PG_PASSWORD,
        dbname=PG_DB,
    )

    inserted = 0
    i = 1
    try:
        with conn.cursor() as cur:
            while True:
                print(f"[page {i:>3}] fetching...", end=" ", flush=True)
                try:
                    code, msg, rows, total = fetch_page(i)
                except Exception as e:
                    print(f"❌ HTTP error: {e}")
                    break

                if code != "INFO-000":
                    print(f"🛑 stop (CODE={code} / {msg})")
                    break
                if not rows:
                    print("🛑 stop (empty row)")
                    break

                params_list = []
                for idx, row in enumerate(rows, start=1):
                    p = {k: row.get(k) for k in FIELDS}
                    p["_raw"] = Jsonb(row)
                    p["_page"] = i
                    p["_row_idx"] = idx
                    params_list.append(p)

                cur.executemany(INSERT_SQL, params_list)
                conn.commit()

                inserted += len(rows)
                print(f"✅ {len(rows):>4} rows  (inserted total: {inserted}/{total})")

                i += 1
                time.sleep(SLEEP_SEC)
    finally:
        conn.close()

    print(f"\n🎉 done. total inserted: {inserted}")


if __name__ == "__main__":
    main()