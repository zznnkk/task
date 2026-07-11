import glob
import csv
import os

# png, jpg 파일 검색
files = glob.glob("./temp/*.png") + glob.glob("./temp/*.jpg")

# 파일명.확장자만 추출
filenames = [os.path.basename(f) for f in files]

# 소팅
filenames.sort()

# output.csv 생성
with open("output.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["filename"])
    for name in filenames:
        writer.writerow([name])

print(f"✅ {len(filenames)}개 파일 → output.csv 생성 완료")