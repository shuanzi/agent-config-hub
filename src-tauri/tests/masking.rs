//! L1：合成占位值遮蔽语义（与 fixtures/sensitive-masking.ts 一致）。

use agent_config_manager_lib::catalog::{mask_synthetic_secrets, SENSITIVE_MASK};

#[test]
fn masks_placeholder_values() {
    let raw = format!(
        "API_KEY={}\n",
        ["SYNTHETIC-SECRET", "demo-skill-0001"].join("-")
    );
    let masked = mask_synthetic_secrets(&raw);
    assert_eq!(masked, format!("API_KEY={SENSITIVE_MASK}\n"));
    assert!(!masked.contains("SYNTHETIC-SECRET"));
    assert!(!masked.contains("demo-skill-0001"));
}

#[test]
fn masks_multiple_occurrences_and_all_suffix_shapes() {
    let raw = "a SYNTHETIC-SECRET-a b SYNTHETIC-SECRET-A0-b-2 c\nSYNTHETIC-SECRET-x";
    let masked = mask_synthetic_secrets(raw);
    assert_eq!(
        masked,
        format!("a {SENSITIVE_MASK} b {SENSITIVE_MASK} c\n{SENSITIVE_MASK}")
    );
}

#[test]
fn leaves_non_placeholder_text_untouched() {
    let cases = [
        "plain text without markers",
        "SYNTHETIC-SECRET-",          // 空 suffix 不是占位值
        "SYNTHETIC-SECRET-?",         // 非字母数字起始不是占位值
        "prefixSYNTHETIC-SECRET- ok", // 后缀空格结尾，同样不匹配
        "SYNTHETIC-SECRETS-x",        // 前缀本身不匹配
        "synthetic-secret-abc",       // 大小写敏感
    ];
    for raw in cases {
        assert_eq!(mask_synthetic_secrets(raw), raw, "raw: {raw:?}");
    }
}

#[test]
fn placeholder_at_line_end_and_adjacent_punctuation() {
    // 占位值后跟标点/行尾时，标点保留。
    let raw = "token=(SYNTHETIC-SECRET-ab1);";
    assert_eq!(
        mask_synthetic_secrets(raw),
        format!("token=({SENSITIVE_MASK});")
    );
}
