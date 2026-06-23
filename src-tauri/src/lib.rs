//! FlowMark Windows 桌面版 - Rust 主进程入口
//!
//! 架构总览见 docs/FLOWMARK_WINDOWS_MIGRATION_PLAN.md
//! 阶段 1 范围：
//!   1. 注册最小 Tauri 命令集（get_app_version / sidecar_ping）
//!   2. 启动 Node sidecar 并管理其生命周期
//!   3. 验证 Rust ↔ sidecar ↔ React 三方链路通畅

mod sidecar;

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
///
/// 返回 sidecar 响应的原始字符串，前端用于显示状态
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

    let resp = handle
        .request(&request)
        .map_err(|e| e.to_string())?;

    Ok(resp.to_string())
}

/// 应用退出钩子：确保 sidecar 子进程被回收，避免孤儿进程
fn cleanup_sidecar(state: &SidecarState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(handle) = guard.take() {
            handle.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 简单日志：阶段 1 用 env_logger 即可，后续阶段可换 tracing
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 决定 sidecar 脚本路径：
            //   - dev 模式：直接跑 src-sidecar 的编译产物（由 build:sidecar 生成到 resources/）
            //   - release 模式：从 Tauri resource 目录读取
            let script_path = if cfg!(debug_assertions) {
                // dev：用工作区根的 sidecar 编译产物（pnpm build:sidecar 产出）
                // 路径相对 cargo manifest，即 src-tauri/
                "resources/flowmark-agent.cjs".to_string()
            } else {
                // release：resource_dir 由 Tauri 在打包时注入
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
                    // sidecar 起不来不阻塞 UI，前端会显示错误，后续可加重试
                    log::error!("sidecar 启动失败: {e}");
                    app.manage(SidecarState(Mutex::new(None)));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 主窗口关闭时清理 sidecar
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    cleanup_sidecar(&state);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_app_version, sidecar_ping])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
