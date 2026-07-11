"""
00_csv_to_db.py
---------------
input.csv → raw.sqlite (marketmap 테이블) 변환 스크립트

의존 라이브러리:
    pandas (uv add pandas)

실행:
    uv run 00_csv_to_db.py
"""

import sqlite3
import logging
import time
from pathlib import Path

import pandas as pd

# ── 설정 ──────────────────────────────────────────────────────────────────────

INPUT_CSV   = "input.csv"
OUTPUT_DB   = "raw.sqlite"
TABLE_NAME  = "marketmap"
CHUNK_SIZE  = 10_000          # 행 수 기준 청크 크기 (파일 크기에 따라 조절)
LOG_FILE    = "00_csv_to_db.log"

# CSV 컬럼 → DB 컬럼 매핑 (CSV 헤더명이 다를 경우 여기서 조정)
COLUMN_MAP = {
    # "csv_header": "db_column"
    # 헤더가 동일하면 그대로 매핑됨 — 아래는 기본값(동일 이름 가정)
}

# DB 컬럼 정의 순서
DB_COLUMNS = ["biz_no", "lon", "lat", "addr", "emd_cd"]

# ── 로거 설정 ─────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    logger = logging.getLogger("csv_to_db")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    # 콘솔 핸들러
    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # 파일 핸들러
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger


# ── DB 초기화 ─────────────────────────────────────────────────────────────────

def init_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL;")   # 쓰기 성능 향상
    conn.execute("PRAGMA synchronous=NORMAL;") # 안정성 ↔ 속도 균형
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            biz_no TEXT PRIMARY KEY,
            lon    TEXT,
            lat    TEXT,
            addr   TEXT,
            emd_cd TEXT
        )
    """)
    conn.commit()
    return conn


# ── 행 삽입 ───────────────────────────────────────────────────────────────────

def insert_chunk(conn: sqlite3.Connection, chunk: pd.DataFrame) -> int:
    """
    청크 DataFrame을 DB에 삽입하고 삽입된 행 수를 반환한다.
    biz_no 중복 시 기존 행을 덮어씀 (INSERT OR REPLACE).
    """
    # 컬럼 이름 정규화: 앞뒤 공백 제거 후 소문자
    chunk.columns = [c.strip().lower() for c in chunk.columns]

    # 사용자 정의 매핑 적용
    if COLUMN_MAP:
        chunk = chunk.rename(columns=COLUMN_MAP)

    # DB 컬럼만 선택 (없는 컬럼은 None/NULL 처리)
    for col in DB_COLUMNS:
        if col not in chunk.columns:
            chunk[col] = None

    chunk = chunk[DB_COLUMNS].copy()

    # 모든 값을 문자열로 변환 (None/NaN → NULL 유지)
    chunk = chunk.where(chunk.notna(), other=None)
    chunk = chunk.apply(lambda s: s.map(
        lambda v: str(v) if v is not None else None
    ))

    rows = chunk.values.tolist()
    conn.executemany(
        f"INSERT OR REPLACE INTO {TABLE_NAME} "
        f"(biz_no, lon, lat, addr, emd_cd) VALUES (?,?,?,?,?)",
        rows
    )
    conn.commit()
    return len(rows)


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    start_time = time.time()
    logger = setup_logger()

    csv_path = Path(INPUT_CSV)
    if not csv_path.exists():
        logger.error(f"입력 파일을 찾을 수 없습니다: {csv_path.resolve()}")
        raise FileNotFoundError(f"{INPUT_CSV} 없음")

    logger.info(f"시작 — 입력: {INPUT_CSV} / DB: {OUTPUT_DB} / 청크: {CHUNK_SIZE:,}행")

    conn = init_db(OUTPUT_DB)

    total_rows   = 0
    chunk_index  = 0

    try:
        reader = pd.read_csv(
            INPUT_CSV,
            chunksize=CHUNK_SIZE,
            dtype=str,          # 모든 컬럼을 처음부터 문자열로 읽기
            encoding="utf-8",   # 필요시 "cp949" 또는 "utf-8-sig" 로 변경
            keep_default_na=False,
        )

        for chunk in reader:
            chunk_index += 1
            inserted = insert_chunk(conn, chunk)
            total_rows += inserted

            elapsed = time.time() - start_time
            logger.info(
                f"청크 {chunk_index:>4d} 완료 | "
                f"이번 청크: {inserted:>7,}행 | "
                f"누적: {total_rows:>10,}행 | "
                f"경과: {elapsed:>8.2f}초"
            )

    finally:
        conn.close()

    elapsed_total = time.time() - start_time
    logger.info(
        f"완료 — 총 {total_rows:,}행 삽입 | "
        f"총 소요 시간: {elapsed_total:.2f}초"
    )


if __name__ == "__main__":
    main()
