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
        ipc::test_fx01_external_change
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
