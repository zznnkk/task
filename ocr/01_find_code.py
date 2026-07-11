# main.py
import os
import sys
import cv2
import numpy as np
import PIL.ImageFile
from pyzbar.pyzbar import decode as pyzbar_decode
from PIL import Image, ImageEnhance, ImageFilter
import zxingcpp
import psycopg2
from dotenv import load_dotenv

PIL.ImageFile.LOAD_TRUNCATED_IMAGES = True

load_dotenv()

# ── DB 연결 ────────────────────────────────────────
def get_connection():
    return psycopg2.connect(
        host=os.getenv("PG_HOST"),
        port=os.getenv("PG_PORT", 5432),
        dbname="ocr_db",
        user=os.getenv("PG_USER"),
        password=os.getenv("PG_PASSWORD"),
    )

# ── DB / 테이블 / 칼럼 검증 ────────────────────────
def validate_db(conn):
    cur = conn.cursor()

    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'ocr'
        )
    """)
    if not cur.fetchone()[0]:
        print("❌ 오류: 'ocr' 테이블이 존재하지 않습니다.")
        sys.exit(1)

    cur.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ocr'
    """)
    columns = {row[0]: {"type": row[1], "nullable": row[2]} for row in cur.fetchall()}

    expected = {
        "id":              {"type": "bigint", "nullable": "NO"},
        "filename":        {"type": "text",   "nullable": "NO"},
        "88code_pyzbar":   {"type": "text",   "nullable": "YES"},
        "88code_zxingcpp": {"type": "text",   "nullable": "YES"},
    }

    for col, spec in expected.items():
        if col not in columns:
            print(f"❌ 오류: '{col}' 칼럼이 없습니다.")
            sys.exit(1)
        actual_type = columns[col]["type"]
        if actual_type != spec["type"]:
            print(f"❌ 오류: '{col}' 칼럼 타입 불일치 (기대: {spec['type']}, 실제: {actual_type})")
            sys.exit(1)

    cur.execute("""
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'ocr' AND tc.constraint_type = 'PRIMARY KEY'
    """)
    pk_cols = [row[0] for row in cur.fetchall()]
    if "id" not in pk_cols:
        print("❌ 오류: 'id' 칼럼이 PRIMARY KEY가 아닙니다.")
        sys.exit(1)

    print("✅ DB 스키마 검증 통과")
    cur.close()

# ── 이미지 전처리 변형 생성 ────────────────────────
def get_variants(image_path):
    pil_orig = Image.open(image_path)
    w, h = pil_orig.size
    gray = pil_orig.convert("L")

    variants = [
        ("원본",          pil_orig),
        ("흑백",          gray),
        ("대비강화x2",    ImageEnhance.Contrast(gray).enhance(2.0)),
        ("대비강화x3",    ImageEnhance.Contrast(gray).enhance(3.0)),
        ("샤프닝",        pil_orig.filter(ImageFilter.SHARPEN)),
        ("엣지강화",      pil_orig.filter(ImageFilter.EDGE_ENHANCE_MORE)),
        ("2배확대",       pil_orig.resize((w*2, h*2), Image.LANCZOS)),
        ("3배확대",       pil_orig.resize((w*3, h*3), Image.LANCZOS)),
        ("흑백+대비+2배", ImageEnhance.Contrast(gray).enhance(2.0).resize((w*2, h*2), Image.LANCZOS)),
        ("흑백+대비+3배", ImageEnhance.Contrast(gray).enhance(2.0).resize((w*3, h*3), Image.LANCZOS)),
    ]

    cv_img = cv2.imread(image_path)
    cv_gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(cv_gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thresh_large = cv2.resize(thresh, (w*2, h*2), interpolation=cv2.INTER_CUBIC)
    variants.append(("이진화(Otsu)", Image.fromarray(thresh)))
    variants.append(("이진화+2배",   Image.fromarray(thresh_large)))

    return variants

# ── 바코드 인식 ────────────────────────────────────
def read_pyzbar(variants):
    for label, img in variants:
        results = pyzbar_decode(img)
        if results:
            return results[0].data.decode("utf-8"), label
    return None, None

def read_zxing(variants):
    for label, img in variants:
        results = zxingcpp.read_barcodes(img)
        if results:
            return results[0].text, label
    return None, None

# ── 메인 ──────────────────────────────────────────
def main():
    try:
        conn = get_connection()
    except Exception as e:
        print(f"❌ DB 연결 실패: {e}")
        sys.exit(1)

    validate_db(conn)

    cur = conn.cursor()

    # 두 칼럼 모두 null인 레코드 조회
    cur.execute("""
        SELECT id, filename FROM ocr
        WHERE "88code_pyzbar" IS NULL AND "88code_zxingcpp" IS NULL
    """)
    rows = cur.fetchall()

    if not rows:
        print("ℹ️  처리할 레코드가 없습니다.")
        cur.close()
        conn.close()
        return

    print(f"\n총 {len(rows)}건 처리 시작\n")

    for record_id, filename in rows:
        image_path = f"./temp/{filename}"
        print(f"[{record_id}] {filename}")

        # 파일 없음
        if not os.path.exists(image_path):
            print(f"  ⚠️  파일 없음 → 둘 다 -1 저장\n")
            cur.execute("""
                UPDATE ocr SET "88code_pyzbar" = %s, "88code_zxingcpp" = %s WHERE id = %s
            """, ("-1", "-1", record_id))
            conn.commit()
            continue

        # 이미지 로드
        try:
            variants = get_variants(image_path)
        except Exception as e:
            print(f"  ⚠️  이미지 로드 실패: {e} → 둘 다 -1 저장\n")
            cur.execute("""
                UPDATE ocr SET "88code_pyzbar" = %s, "88code_zxingcpp" = %s WHERE id = %s
            """, ("-1", "-1", record_id))
            conn.commit()
            continue

        # 인식
        pyzbar_val, pyzbar_label = read_pyzbar(variants)
        zxing_val,  zxing_label  = read_zxing(variants)

        pyzbar_save = pyzbar_val if pyzbar_val else "-1"
        zxing_save  = zxing_val  if zxing_val  else "-1"

        print(f"  pyzbar   : {'✅ ' + pyzbar_label + ' - ' + pyzbar_val if pyzbar_val else '❌ 인식 실패'} → {pyzbar_save}")
        print(f"  zxing-cpp: {'✅ ' + zxing_label  + ' - ' + zxing_val  if zxing_val  else '❌ 인식 실패'} → {zxing_save}")

        cur.execute("""
            UPDATE ocr SET "88code_pyzbar" = %s, "88code_zxingcpp" = %s WHERE id = %s
        """, (pyzbar_save, zxing_save, record_id))
        conn.commit()
        print()

    print("✅ 전체 처리 완료")
    cur.close()
    conn.close()

if __name__ == "__main__":
    main()