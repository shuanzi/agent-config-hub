//! Agent Config Manager — Tauri 装配（ARC-01/ARC-03）。
//!
//! FE-01 只注册 `frontend_gateway_read` 一个生产 command；不引入 fs/shell/
//! Keychain 等任何插件。`test-harness` feature 额外编译 wdio WebDriver
//! plugin 与测试 command（L3 专用构建，生产二进制物理不含）。

pub mod catalog;
pub mod core;
pub mod domain;
pub mod ipc;
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

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
