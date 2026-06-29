"""
원본 데이터 파일을 map.html 이 읽을 수 있는 JS 파일로 변환합니다.
이 스크립트를 map.html 과 같은 폴더에 놓고 실행하세요:
    python convert.py
"""
import json, os

CONVERSIONS = [
    ("emd.geojson",  "emd.js",  "GEOJSON_EMD"),
    ("sgg.geojson",  "sgg.js",  "GEOJSON_SGG"),
    ("sido.geojson", "sido.js", "GEOJSON_SIDO"),
    ("upjong.json",  "data.js", "DATA"),
]

for src, dst, var in CONVERSIONS:
    if not os.path.exists(src):
        print(f"[SKIP] {src} 없음")
        continue
    with open(src, encoding="utf-8") as f:
        content = f.read().strip()
    # 유효한 JSON인지 확인
    try:
        json.loads(content)
    except json.JSONDecodeError as e:
        print(f"[ERROR] {src} JSON 파싱 실패: {e}")
        continue
    with open(dst, "w", encoding="utf-8") as f:
        f.write(f"window.{var} = {content};\n")
    print(f"[OK] {src} → {dst}  (window.{var})")

print("완료.")
