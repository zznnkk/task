"""
01_shp_matching.py
------------------
raw.sqlite > marketmap 테이블의 NULL emd_cd 행에 대해
emd.zip(shp) 폴리곤 공간매칭을 수행하고 emd_cd 를 업데이트한다.

의존 라이브러리:
    geopandas  (shapely, pyproj 포함)
    pandas

설치:
    uv add geopandas pandas

실행:
    uv run 01_shp_matching.py
"""

import logging
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd

# ── 설정 ──────────────────────────────────────────────────────────────────────

DB_PATH    = "raw.sqlite"
TABLE      = "marketmap"
SHP_ZIP    = "emd.zip"
LOG_FILE   = "01_shp_matching.log"
CHUNK_SIZE = 5_000   # NULL 행을 몇 개씩 처리할지

# DB 컬럼명 (이전 스크립트 기준: lon / lat)
COL_LON = "lon"
COL_LAT = "lat"
COL_PK  = "biz_no"
COL_EMD = "emd_cd"

# SHP 속성 컬럼명
SHP_EMD_CD = "EMD_CD"

# emd.zip 안 shp 파일 인코딩 (EUC-KR 이 일반적)
SHP_ENCODING = "cp949"

# WGS84 (경위도 입력 CRS)
CRS_WGS84 = "EPSG:4326"

# SHP 원본 CRS (한국 단일 TM)
CRS_SHP = (
    "+proj=tmerc +x_0=1000000 +y_0=2000000 "
    "+lon_0=127.5 +k_0=0.9996 +lat_0=38 +ellps=GRS80"
)

# ── 로거 ──────────────────────────────────────────────────────────────────────

def setup_logger() -> logging.Logger:
    logger = logging.getLogger("shp_matching")
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


# ── SHP 로드 ──────────────────────────────────────────────────────────────────

def load_shp(zip_path: str, logger: logging.Logger) -> gpd.GeoDataFrame:
    """emd.zip 을 임시 디렉토리에 압축 해제 후 shp 를 읽어 WGS84 로 재투영."""
    logger.info(f"SHP 로드 중: {zip_path}")

    with zipfile.ZipFile(zip_path) as zf:
        shp_names = [n for n in zf.namelist() if n.lower().endswith(".shp")]
        if not shp_names:
            raise FileNotFoundError(f"{zip_path} 안에 .shp 파일 없음")
        shp_name = shp_names[0]
        logger.info(f"  사용할 shp: {shp_name}")

        # 임시 디렉토리에 전체 압축 해제 (사이드카 파일 포함)
        tmp_dir = tempfile.mkdtemp(prefix="emd_shp_")
        zf.extractall(tmp_dir)

    shp_path = Path(tmp_dir) / shp_name
    logger.info(f"  압축 해제 경로: {shp_path}")

    gdf = gpd.read_file(str(shp_path), encoding=SHP_ENCODING)

    # CRS 설정 및 WGS84 재투영
    if gdf.crs is None:
        gdf = gdf.set_crs(CRS_SHP)
    gdf = gdf.to_crs(CRS_WGS84)

    _ = gdf.sindex  # 공간 인덱스 빌드

    logger.info(f"  폴리곤 수: {len(gdf):,}  /  CRS → {gdf.crs.to_epsg() or 'custom'}")
    return gdf[[SHP_EMD_CD, "geometry"]].copy()


# ── 공간 매칭 ─────────────────────────────────────────────────────────────────

def match_chunk(
    chunk_df: pd.DataFrame,
    emd_gdf: gpd.GeoDataFrame,
) -> list[tuple[str, str]]:
    """
    chunk_df (biz_no, lon, lat) 각 행의 포인트가 어느 폴리곤에 속하는지 판단.
    반환값: [(emd_cd, biz_no), ...]  — executemany 순서
    """
    # 유효 좌표 필터 (변환 실패 방지)
    chunk_df = chunk_df.copy()
    chunk_df[COL_LON] = pd.to_numeric(chunk_df[COL_LON], errors="coerce")
    chunk_df[COL_LAT] = pd.to_numeric(chunk_df[COL_LAT], errors="coerce")

    valid_mask = (
        chunk_df[COL_LON].notna()
        & chunk_df[COL_LAT].notna()
        & chunk_df[COL_LON].between(-180, 180)
        & chunk_df[COL_LAT].between(-90, 90)
    )

    results: dict[str, str] = {row[COL_PK]: "-1" for _, row in chunk_df.iterrows()}

    valid_df = chunk_df[valid_mask].copy()
    if valid_df.empty:
        return [(v, k) for k, v in results.items()]

    # GeoDataFrame 생성
    pts_gdf = gpd.GeoDataFrame(
        valid_df[[COL_PK]],
        geometry=gpd.points_from_xy(valid_df[COL_LON], valid_df[COL_LAT]),
        crs=CRS_WGS84,
    )

    # 공간 조인 (predicate="within")
    joined = gpd.sjoin(
        pts_gdf,
        emd_gdf,
        how="left",
        predicate="within",
    )

    # 중복 제거 (한 포인트가 경계에 걸쳐 복수 폴리곤에 매칭될 때 첫 번째 선택)
    joined = joined[~joined.index.duplicated(keep="first")]

    for _, row in joined.iterrows():
        biz = row[COL_PK]
        emd = row.get(SHP_EMD_CD)
        results[biz] = str(emd) if pd.notna(emd) else "-1"

    return [(v, k) for k, v in results.items()]   # (emd_cd, biz_no)


# ── DB 업데이트 ───────────────────────────────────────────────────────────────

def update_db(conn: sqlite3.Connection, pairs: list[tuple[str, str]]) -> None:
    """(emd_cd, biz_no) 리스트로 일괄 UPDATE."""
    conn.executemany(
        f"UPDATE {TABLE} SET {COL_EMD} = ? WHERE {COL_PK} = ?",
        pairs,
    )
    conn.commit()


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main() -> None:
    start = time.time()
    logger = setup_logger()

    # SHP 로드
    emd_gdf = load_shp(SHP_ZIP, logger)

    # DB 연결
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")

    # NULL emd_cd 총 행 수 파악
    (total_null,) = conn.execute(
        f"SELECT COUNT(*) FROM {TABLE} WHERE {COL_EMD} IS NULL"
    ).fetchone()
    logger.info(f"매칭 대상 행 수: {total_null:,}")

    if total_null == 0:
        logger.info("매칭할 행이 없습니다. 종료.")
        conn.close()
        return

    processed   = 0
    chunk_index = 0
    offset      = 0

    while True:
        rows = conn.execute(
            f"SELECT {COL_PK}, {COL_LON}, {COL_LAT} "
            f"FROM {TABLE} "
            f"WHERE {COL_EMD} IS NULL "
            f"LIMIT {CHUNK_SIZE} OFFSET {offset}"
        ).fetchall()

        if not rows:
            break

        chunk_index += 1
        chunk_df = pd.DataFrame(rows, columns=[COL_PK, COL_LON, COL_LAT])

        pairs = match_chunk(chunk_df, emd_gdf)
        update_db(conn, pairs)

        processed += len(rows)
        elapsed = time.time() - start
        matched_cnt  = sum(1 for emd, _ in pairs if emd != "-1")
        missed_cnt   = len(pairs) - matched_cnt

        logger.info(
            f"청크 {chunk_index:>4d} 완료 | "
            f"처리: {len(rows):>6,}행 | "
            f"매칭 성공: {matched_cnt:>6,} / 실패: {missed_cnt:>5,} | "
            f"누적: {processed:>10,}/{total_null:,} | "
            f"경과: {elapsed:>8.2f}초"
        )

        # NULL 행이 UPDATE 되었으므로 offset 은 고정 0 유지
        # (이미 처리된 행은 WHERE emd_cd IS NULL 에서 제외됨)

    conn.close()
    elapsed_total = time.time() - start
    logger.info(
        f"완료 — 총 {processed:,}행 처리 | 총 소요 시간: {elapsed_total:.2f}초"
    )


if __name__ == "__main__":
    main()
