use std::env;
use std::fs;
use std::path::Path;

fn main() {
    tauri_build::build();

    // dist/_shared 폴더가 바뀌면 재빌드 트리거
    println!("cargo:rerun-if-changed=dist/_shared");

    let shared_dir = Path::new("dist/_shared");
    let mut combined = String::new();

    if shared_dir.exists() {
        let mut entries: Vec<_> = fs::read_dir(shared_dir)
            .expect("dist/_shared 읽기 실패")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("js"))
            .collect();
        entries.sort(); // 파일명 순서 고정

        for path in entries {
            let content = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{:?} 읽기 실패: {}", path, e));
            combined.push_str(&content);
            combined.push('\n');
        }
    }

    let out_dir = env::var("OUT_DIR").unwrap();
    let dest = Path::new(&out_dir).join("shared_init.js");
    fs::write(dest, combined).expect("shared_init.js 쓰기 실패");
}