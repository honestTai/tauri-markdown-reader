//! FlowMark Windows 桌面版 - Rust 主进程入口
//!
//! 架构总览见 docs/FLOWMARK_WINDOWS_MIGRATION_PLAN.md
//!
//! 阶段 1：sidecar 骨架
//! 阶段 2：数据模型 + 持久化层命令

mod commands;
mod models;
mod sidecar;
mod store;

use crate::commands::AppState;
use sidecar::{SidecarError, SidecarHandle};
use std::sync::Mutex;
use tauri::Manager;

/// 全局 sidecar 句柄
///
/// 用 `Mutex<Option<...>>` 包裹以支持运行时替换 / 重启 sidecar
struct SidecarState(Mutex<Option<SidecarHandle>>);

/// 返回编译期应用版本（来自 Cargo.toml）
#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// 通过 Rust 转发一次 sidecar ping，验证 stdio JSON-RPC 链路
#[tauri::command]
fn sidecar_ping(state: tauri::State<SidecarState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| format!("锁中毒: {e}"))?;
    let handle = guard.as_ref().ok_or(SidecarError::NotRunning.to_string())?;

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "ping",
        "method": "ping",
        "params": {}
    });

    let resp = handle.request(&request).map_err(|e| e.to_string())?;
    Ok(resp.to_string())
}

/// 应用退出钩子：确保 sidecar 子进程被回收
fn cleanup_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(handle) = guard.take() {
            handle.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 初始化 AppPaths + 确保数据目录存在
            let app_state = match AppState::system() {
                Ok(s) => s,
                Err(e) => {
                    log::error!("AppPaths 初始化失败: {e}");
                    return Err(e.into());
                }
            };
            app.manage(app_state);

            // 决定 sidecar 脚本路径
            let script_path = if cfg!(debug_assertions) {
                "resources/flowmark-agent.cjs".to_string()
            } else {
                let resource_dir = app
                    .path()
                    .resource_dir()
                    .map_err(|e| format!("无法定位 resource_dir: {e}"))?;
                resource_dir
                    .join("resources")
                    .join("flowmark-agent.cjs")
                    .to_string_lossy()
                    .to_string()
            };

            match SidecarHandle::spawn(&script_path) {
                Ok(handle) => {
                    app.manage(SidecarState(Mutex::new(Some(handle))));
                    log::info!("sidecar 初始化完成");
                }
                Err(e) => {
                    log::error!("sidecar 启动失败: {e}");
                    app.manage(SidecarState(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    cleanup_sidecar(&state);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 阶段 1
            get_app_version,
            sidecar_ping,
            // 阶段 2：library
            commands::load_library_state,
            commands::save_library_state,
            commands::read_document_content,
            commands::write_document_content,
            // 阶段 2：sessions
            commands::list_agent_sessions,
            commands::load_agent_session,
            commands::save_agent_session,
            commands::archive_agent_session,
            commands::delete_agent_session,
            // 阶段 2：operation history
            commands::load_operation_history,
            commands::append_operation_history,
            commands::clear_operation_history,
            // 阶段 2：model config
            commands::get_model_config,
            commands::set_model_config,
            commands::get_api_key,
            commands::set_api_key,
            commands::delete_api_key,
            // 阶段 2：longform memory
            commands::load_longform_memory,
            commands::append_longform_memory,
            commands::clear_longform_memory
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
