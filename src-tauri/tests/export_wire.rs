//! L1：export-wire 输出确定性 —— 同一输入两次导出逐字节相同。

use std::process::Command;

#[test]
fn export_wire_is_byte_deterministic() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    for dir in [first.path(), second.path()] {
        let status = Command::new(env!("CARGO_BIN_EXE_export-wire"))
            .arg(dir)
            .status()
            .expect("export-wire runs");
        assert!(status.success());
    }
    let a = std::fs::read(first.path().join("gateway-wire.ts")).unwrap();
    let b = std::fs::read(second.path().join("gateway-wire.ts")).unwrap();
    assert_eq!(a, b, "two exports must be byte-identical");

    let text = String::from_utf8(a).unwrap();
    assert!(text.contains("DO NOT EDIT"));
    assert!(text.contains("export const GATEWAY_WIRE_VERSION = 1 as const;"));
    assert!(text.contains("ReadRequestEnvelope"));
    assert!(text.contains("WorkspaceEventEnvelope"));
}
