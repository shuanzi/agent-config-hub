//! Agent Config Manager — Tauri 装配（ARC-01/ARC-03）。
//!
//! FE-01 只注册 `frontend_gateway_read` 一个生产 command；不引入 fs/shell/
//! Keychain 等任何插件。`test-harness` feature 额外编译 wdio WebDriver
//! plugin 与测试 command（L3 专用构建，生产二进制物理不含）。

pub mod adapter_registry;
pub mod catalog;
pub mod core;
pub mod domain;
pub mod ipc;
pub mod project_applicability;
pub mod wire;

/// 进程启动记点（PF-01 L3 冷启动：process start → first trusted snapshot）。
static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// main 入口第一行调用；重复调用无副作用（只有首次记点生效）。
pub fn note_process_start() {
    let _ = PROCESS_START.set(std::time::Instant::now());
}

/// 距进程启动记点的 elapsed millis；未记点时返回 None。
pub fn process_start_elapsed_millis() -> Option<u64> {
    PROCESS_START
        .get()
        .map(|start| start.elapsed().as_millis() as u64)
}

pub fn run() {
    #[cfg(feature = "test-harness")]
    test_harness_lifecycle::record_started();

    let gateway_core = core::GatewayCore::new(catalog::Catalog::from_env());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default().manage(gateway_core);

    #[cfg(feature = "test-harness")]
    {
        builder = builder
            .manage(ipc::Fx01ExternalChangeCounter::default())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    #[cfg(not(feature = "test-harness"))]
    let builder = builder.invoke_handler(tauri::generate_handler![ipc::frontend_gateway_read]);

    #[cfg(feature = "test-harness")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ipc::frontend_gateway_read,
        ipc::test_fx01_external_change,
        ipc::test_fx01_cold_start_millis
    ]);

    #[cfg(feature = "test-harness")]
    let result = builder.build(tauri::generate_context!()).map(|app| {
        test_harness_lifecycle::watch_for_exit_request(app.handle().clone());
        app.run(|_, event| {
            // macOS 的 event loop 退出后不会回到 `Builder::run` 后续语句；在
            // 终态 event 内写入，才能让 L3 harness 的正常退出实际可认证。
            if matches!(event, tauri::RunEvent::Exit) {
                test_harness_lifecycle::record_normal_exit();
            }
        });
    });

    #[cfg(not(feature = "test-harness"))]
    let result = builder.run(tauri::generate_context!());

    result.expect("error while running tauri application");
}

/// PF-01 resource evidence 的 PID/normal-exit attestation 只存在于 harness
/// feature。它没有 IPC、不会进入 production build，且仅在 runner 提供的临时
/// lifecycle 文件路径存在时写入。
#[cfg(feature = "test-harness")]
mod test_harness_lifecycle {
    use serde::Deserialize;
    use std::path::Path;
    use std::path::PathBuf;

    const ENV_PATH: &str = "PF01_HARNESS_LIFECYCLE_PATH";
    const EXIT_REQUEST_FILENAME: &str = "pf01-harness-exit-request.json";

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Lifecycle {
        pid: u32,
        binary: String,
        role: String,
        normal_exit: bool,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ExitRequest {
        schema_version: u8,
        kind: String,
        pid: u32,
        binary: String,
        role: String,
    }

    fn destination() -> Option<PathBuf> {
        std::env::var_os(ENV_PATH)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    }

    fn write(normal_exit: bool) {
        let Some(destination) = destination() else {
            return;
        };
        let parent = match destination.parent() {
            Some(parent) if parent.is_dir() => parent,
            _ => return,
        };
        let temporary = parent.join(format!(".pf01-harness-{}.tmp", std::process::id()));
        let payload = format!(
            "{{\"pid\":{},\"binary\":\"agent-config-manager\",\"role\":\"test-harness\",\"normalExit\":{normal_exit}}}\n",
            std::process::id()
        );
        if std::fs::write(&temporary, payload).is_ok() {
            let _ = std::fs::rename(temporary, destination);
        }
    }

    pub fn record_started() {
        write(false);
    }

    pub fn record_normal_exit() {
        write(true);
    }

    /// PF-01 runner 的 afterSession 在成功 deleteSession 后才会原子写入请求。仅
    /// test-harness 轮询同一 sandbox 内、与当前 lifecycle 完整匹配的 marker；
    /// production build 不编译该 watcher。
    pub fn watch_for_exit_request(app: tauri::AppHandle) {
        let Some(lifecycle_path) = destination() else {
            return;
        };
        std::thread::spawn(move || loop {
            if exit_request_matches_lifecycle(&lifecycle_path) {
                app.exit(0);
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        });
    }

    fn exit_request_path(lifecycle: &Path) -> Option<PathBuf> {
        lifecycle
            .parent()
            .map(|parent| parent.join(EXIT_REQUEST_FILENAME))
    }

    fn exit_request_matches_lifecycle(lifecycle_path: &Path) -> bool {
        let Ok(lifecycle_bytes) = std::fs::read(lifecycle_path) else {
            return false;
        };
        let Ok(lifecycle) = serde_json::from_slice::<Lifecycle>(&lifecycle_bytes) else {
            return false;
        };
        let Some(marker_path) = exit_request_path(lifecycle_path) else {
            return false;
        };
        let Ok(marker_bytes) = std::fs::read(marker_path) else {
            return false;
        };
        let Ok(request) = serde_json::from_slice::<ExitRequest>(&marker_bytes) else {
            return false;
        };

        !lifecycle.normal_exit
            && lifecycle.pid == std::process::id()
            && lifecycle.binary == "agent-config-manager"
            && lifecycle.role == "test-harness"
            && request.schema_version == 1
            && request.kind == "pf01-harness-exit-request"
            && request.pid == lifecycle.pid
            && request.binary == lifecycle.binary
            && request.role == lifecycle.role
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn write_lifecycle(path: &std::path::Path, pid: u32, role: &str) {
            std::fs::write(
                path,
                format!(
                    "{{\"pid\":{pid},\"binary\":\"agent-config-manager\",\"role\":\"{role}\",\"normalExit\":false}}"
                ),
            )
            .unwrap();
        }

        #[test]
        fn exit_request_only_matches_the_current_harness_lifecycle_identity() {
            let temporary = tempfile::tempdir().unwrap();
            let lifecycle = temporary.path().join("harness-lifecycle.json");
            let marker = exit_request_path(&lifecycle).unwrap();
            let pid = std::process::id();
            write_lifecycle(&lifecycle, pid, "test-harness");

            std::fs::write(
                &marker,
                format!(
                    "{{\"schemaVersion\":1,\"kind\":\"pf01-harness-exit-request\",\"pid\":{pid},\"binary\":\"agent-config-manager\",\"role\":\"test-harness\"}}"
                ),
            )
            .unwrap();
            assert!(exit_request_matches_lifecycle(&lifecycle));

            std::fs::write(&marker, "{").unwrap();
            assert!(!exit_request_matches_lifecycle(&lifecycle));

            std::fs::write(
                &marker,
                "{\"schemaVersion\":1,\"kind\":\"pf01-harness-exit-request\",\"pid\":1,\"binary\":\"agent-config-manager\",\"role\":\"test-harness\"}",
            )
            .unwrap();
            assert!(!exit_request_matches_lifecycle(&lifecycle));

            std::fs::write(
                &marker,
                format!(
                    "{{\"schemaVersion\":1,\"kind\":\"pf01-harness-exit-request\",\"pid\":{pid},\"binary\":\"agent-config-manager\",\"role\":\"other\"}}"
                ),
            )
            .unwrap();
            assert!(!exit_request_matches_lifecycle(&lifecycle));
        }
    }
}
