"""
02_kakaoapi_matching.py
-----------------------
raw.sqlite > marketmap 테이블의 emd_cd = "-1" 행에 대해
카카오 로컬 API 로 법정동 코드(emd_cd)를 조회하고 업데이트한다.

처리 흐름:
  1) lon/lat 이 "0","0" 이 아니면
       → (1) coord2regioncode API 로 법정동 code 앞 8자리 획득
  2) (1) 실패 또는 좌표가 "0","0" 이면
       → (2) addr 컬럼으로 search/address API 호출 → x,y 획득
       → 획득한 x,y 로 다시 (1) coord2regioncode 호출
  3) 위 모두 실패 → emd_cd = "-2"

의존 라이브러리:
    python-dotenv  httpx

설치:
    uv add python-dotenv httpx

실행:
    uv run 02_kakaoapi_matching.py
"""

import logging
import sqlite3
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
import os

# ── 설정 ──────────────────────────────────────────────────────────────────────

DB_PATH    = "raw.sqlite"
TABLE      = "marketmap"
LOG_FILE   = "02_kakaoapi_matching.log"
CHUNK_SIZE = 100          # API 호출이 포함되므로 작게 유지

COL_PK   = "biz_no"
COL_LON  = "lon"
COL_LAT  = "lat"
COL_ADDR = "addr"
COL_EMD  = "emd_cd"

KAKAO_COORD2REGION = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
KAKAO_ADDR2COORD   = "https://dapi.kakao.com/v2/local/search/address.json"

# API 호출 간격 (초) — 과도한 요청 방지
REQUEST_INTERVAL = 0.05   # 초당 최대 20건

# ── 로거 ──────────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    logger = logging.getLogger("kakao_matching")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


# ── API 헬퍼 ──────────────────────────────────────────────────────────────────

def get_emd_cd_from_coord(
    client: httpx.Client,
    headers: dict,
    lon: str,
    lat: str,
) -> str | None:
    """
    (1) coord2regioncode API: 경도(x), 위도(y) → 법정동 code 앞 8자리
    실패 또는 법정동 결과 없으면 None 반환.
    """
    try:
        resp = client.get(
            KAKAO_COORD2REGION,
            headers=headers,
            params={"x": lon, "y": lat},
            timeout=10.0,
        )
        time.sleep(REQUEST_INTERVAL)
        if resp.status_code != 200:
            return None
        docs = resp.json().get("documents", [])
        for doc in docs:
            if doc.get("region_type") == "B":
                code = doc.get("code", "")
                if len(code) >= 8:
                    return code[:8]
        return None
    except Exception:
        return None


def get_coord_from_addr(
    client: httpx.Client,
    headers: dict,
    addr: str,
) -> tuple[str, str] | None:
    """
    (2) search/address API: 주소 문자열 → (lon, lat) 튜플
    실패 또는 결과 없으면 None 반환.
    """
    if not addr or not addr.strip():
        return None
    try:
        resp = client.get(
            KAKAO_ADDR2COORD,
            headers=headers,
            params={"query": addr.strip(), "size": 1},
            timeout=10.0,
        )
        time.sleep(REQUEST_INTERVAL)
        if resp.status_code != 200:
            return None
        docs = resp.json().get("documents", [])
        if not docs:
            return None
        doc = docs[0]
        # 최상위 x,y 우선, 없으면 address/road_address 하위 확인
        x = doc.get("x") or (doc.get("address") or {}).get("x") or (doc.get("road_address") or {}).get("x")
        y = doc.get("y") or (doc.get("address") or {}).get("y") or (doc.get("road_address") or {}).get("y")
        if x and y:
            return (str(x), str(y))
        return None
    except Exception:
        return None


def resolve_emd_cd(
    client: httpx.Client,
    headers: dict,
    lon: str,
    lat: str,
    addr: str | None,
) -> str:
    """
    단일 행에 대해 emd_cd 를 결정한다.
    성공 → 8자리 법정동 코드 (text)
    실패 → "-2"
    """
    # ── 경로 1: 유효 좌표 → coord2regioncode
    is_zero = (lon in ("0", "0.0", "") or lat in ("0", "0.0", ""))
    if not is_zero:
        result = get_emd_cd_from_coord(client, headers, lon, lat)
        if result:
            return result

    # ── 경로 2: 주소 → 좌표 → coord2regioncode
    if addr:
        coords = get_coord_from_addr(client, headers, addr)
        if coords:
            result = get_emd_cd_from_coord(client, headers, coords[0], coords[1])
            if result:
                return result

    return "-2"


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    start = time.time()
    logger = setup_logger()

    # .env 로드
    load_dotenv()
    api_key = os.getenv("KAKAO_APIKEY", "").strip()
    if not api_key:
        logger.error(".env 파일에 KAKAO_APIKEY 가 없습니다.")
        raise ValueError("KAKAO_APIKEY 미설정")

    headers = {"Authorization": f"KakaoAK {api_key}"}

    # DB 연결
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")

    # 대상 행 수 파악
    (total_target,) = conn.execute(
        f"SELECT COUNT(*) FROM {TABLE} WHERE {COL_EMD} = '-1'"
    ).fetchone()
    logger.info(f"처리 대상 행 수 (emd_cd='-1'): {total_target:,}")

    if total_target == 0:
        logger.info("처리할 행이 없습니다. 종료.")
        conn.close()
        return

    processed   = 0
    success_cnt = 0
    fail_cnt    = 0
    chunk_index = 0

    with httpx.Client() as client:
        while True:
            # 항상 OFFSET 0 — UPDATE 후 조건에서 빠지므로
            rows = conn.execute(
                f"SELECT {COL_PK}, {COL_LON}, {COL_LAT}, {COL_ADDR} "
                f"FROM {TABLE} "
                f"WHERE {COL_EMD} = '-1' "
                f"LIMIT {CHUNK_SIZE}"
            ).fetchall()

            if not rows:
                break

            chunk_index += 1
            updates: list[tuple[str, str]] = []  # (emd_cd, biz_no)

            for biz_no, lon, lat, addr in rows:
                emd_cd = resolve_emd_cd(
                    client, headers,
                    lon or "0",
                    lat or "0",
                    addr,
                )
                updates.append((emd_cd, biz_no))
                if emd_cd != "-2":
                    success_cnt += 1
                else:
                    fail_cnt += 1

            # 일괄 UPDATE
            conn.executemany(
                f"UPDATE {TABLE} SET {COL_EMD} = ? WHERE {COL_PK} = ?",
                updates,
            )
            conn.commit()

            processed += len(rows)
            elapsed = time.time() - start

            logger.info(
                f"청크 {chunk_index:>4d} 완료 | "
                f"처리: {len(rows):>5,}행 | "
                f"성공: {success_cnt:>7,} / 실패: {fail_cnt:>6,} | "
                f"누적: {processed:>8,}/{total_target:,} | "
                f"경과: {elapsed:>8.2f}초"
            )

    conn.close()
    elapsed_total = time.time() - start
    logger.info(
        f"완료 — 총 {processed:,}행 처리 | "
        f"성공: {success_cnt:,} / 실패(-2): {fail_cnt:,} | "
        f"총 소요 시간: {elapsed_total:.2f}초"
    )


if __name__ == "__main__":
    main()
