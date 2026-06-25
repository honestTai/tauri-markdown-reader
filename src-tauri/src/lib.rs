//! FlowMark Windows 桌面版 - Rust 主进程入口
//!
//! 架构总览见 docs/FLOWMARK_WINDOWS_MIGRATION_PLAN.md
//!
//! 阶段 1：sidecar 骨架
//! 阶段 2：数据模型 + 持久化层命令
//! 阶段 4 Part 2：agent.run / agent.cancel Tauri 命令 + sidecar 异步事件转发

mod commands;
mod converter;
mod index;
mod models;
mod sidecar;
mod store;

use crate::commands::AppState;
use converter::ConverterHandle;
use sidecar::{SidecarError, SidecarHandle, ToolDispatcherRegistry};
use std::sync::{Arc, Mutex};
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
async fn sidecar_ping(
    sidecar_state: tauri::State<'_, SidecarState>,
) -> Result<String, String> {
    let bus = {
        let guard = sidecar_state
            .0
            .lock()
            .map_err(|e| format!("锁中毒: {e}"))?;
        guard
            .as_ref()
            .ok_or(SidecarError::NotRunning.to_string())?
            .bus()
    };

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "ping",
        "method": "ping",
        "params": {}
    });

    let resp = bus.request(&request).await.map_err(|e| e.to_string())?;
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
        .plugin(tauri_plugin_dialog::init())
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

            // 注入 resource_dir（release 模式下定位内置 skill 用）
            // dev 模式 SkillRepository 走 CARGO_MANIFEST_DIR，传 None 即可
            let resource_dir = if cfg!(debug_assertions) {
                commands::ResourceDir(None)
            } else {
                let rd = app
                    .path()
                    .resource_dir()
                    .map_err(|e| format!("无法定位 resource_dir: {e}"))?;
                commands::ResourceDir(Some(rd))
            };
            app.manage(resource_dir);

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

            // 预注入空状态，防止前端访问时 panic
            app.manage(SidecarState(Mutex::new(None)));
            app.manage(converter::ConverterState(Mutex::new(None)));

            // 后台启动 Node sidecar（不阻塞窗口显示）
            {
                let app_handle = app.handle().clone();
                let paths = app.state::<AppState>().paths.clone();
                let script = script_path;
                std::thread::spawn(move || {
                    match SidecarHandle::spawn(app_handle.clone(), &script) {
                        Ok(handle) => {
                            handle.bus().set_tool_dispatcher(Arc::new(
                                ToolDispatcherRegistry::new(paths),
                            ));
                            let h = app_handle.clone();
                            let _ = h.run_on_main_thread({
                                let h2 = h.clone();
                                move || {
                                    if let Some(state) = h2.try_state::<SidecarState>() {
                                        if let Ok(mut guard) = state.0.lock() {
                                            *guard = Some(handle);
                                        }
                                    }
                                    log::info!("Node sidecar 初始化完成");
                                }
                            });
                        }
                        Err(e) => {
                            log::error!("Node sidecar 启动失败: {e}");
                        }
                    }
                });
            }

            // 后台启动 Python 转换器（PyInstaller exe 解压慢，不阻塞窗口）
            {
                let app_handle = app.handle().clone();
                // 提前在 setup 线程计算 release 模式下的 exe 路径
                let converter_exe_path = if cfg!(debug_assertions) {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .parent()
                        .map(|p| p.join("flowmark-converter").join("main.py"))
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                } else {
                    app.path()
                        .resource_dir()
                        .map(|rd| rd.join("resources").join("flowmark-converter.exe"))
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                };

                std::thread::spawn(move || {
                    let converter_result = if cfg!(debug_assertions) {
                        ConverterHandle::spawn("python", &converter_exe_path)
                    } else {
                        ConverterHandle::spawn_exe(&converter_exe_path)
                    };

                    match converter_result {
                        Ok(handle) => {
                            match handle.ping() {
                                Ok(resp) => {
                                    log::info!(
                                        "Python 转换器就绪: {}",
                                        resp.get("pythonVersion")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                    );
                                    let h = app_handle.clone();
                                    let _ = h.run_on_main_thread({
                                        let h2 = h.clone();
                                        move || {
                                            if let Some(state) = h2.try_state::<converter::ConverterState>() {
                                                if let Ok(mut guard) = state.0.lock() {
                                                    *guard = Some(handle);
                                                }
                                            }
                                        }
                                    });
                                }
                                Err(e) => {
                                    log::error!("Python 转换器 ping 失败: {e}");
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Python 转换器启动失败: {e}");
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    cleanup_sidecar(&state);
                }
                // 清理 Python 转换器
                if let Some(conv_state) = window
                    .app_handle()
                    .try_state::<converter::ConverterState>()
                {
                    if let Ok(mut guard) = conv_state.0.lock() {
                        if let Some(handle) = guard.take() {
                            handle.kill();
                        }
                    }
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
            // 阶段 6：library 扩展
            commands::list_document_versions,
            commands::read_version_content,
            commands::restore_document_version,
            commands::delete_document,
            commands::set_workspace_root,
            commands::scan_workspace,
            commands::import_document,
            commands::import_all_from_workspace,
            commands::create_document,
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
            commands::clear_longform_memory,
            // 阶段 3：index
            commands::build_index,
            commands::build_index_batch,
            commands::search_index,
            commands::read_index_chunk,
            commands::index_stats,
            commands::list_indexed_documents,
            commands::delete_indexed_document,
            // 阶段 4 Part 2：agent
            commands::agent_run,
            commands::agent_cancel,
            // 阶段 5：agent 草稿写回
            commands::propose_agent_draft,
            commands::apply_agent_draft,
            commands::discard_agent_draft,
            // 阶段 7：skill 管理
            commands::list_skills,
            commands::load_skill,
            commands::save_skill,
            commands::delete_skill,
            commands::import_skill_file,
            commands::import_skill_folder,
            // 阶段 7 Part 2：Word/PDF 导入
            commands::import_docx_file,
            commands::import_pdf_file,
            // 阶段 7 Part 3：Markdown 导出
            commands::export_to_docx,
            commands::export_to_pdf
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
