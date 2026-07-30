// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // PF-01 L3 冷启动记点：进程启动即记录（§3.16 process start 锚点）。
    agent_config_manager_lib::note_process_start();
    agent_config_manager_lib::run();
}
