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

    let result = builder.run(tauri::generate_context!());

    #[cfg(feature = "test-harness")]
    if result.is_ok() {
        test_harness_lifecycle::record_normal_exit();
    }

    result.expect("error while running tauri application");
}

/// PF-01 resource evidence 的 PID/normal-exit attestation 只存在于 harness
/// feature。它没有 IPC、不会进入 production build，且仅在 runner 提供的临时
/// lifecycle 文件路径存在时写入。
#[cfg(feature = "test-harness")]
mod test_harness_lifecycle {
    use std::path::PathBuf;

    const ENV_PATH: &str = "PF01_HARNESS_LIFECYCLE_PATH";

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
}
