//! Node Sidecar 进程管理
//!
//! 职责：
//!   - 启动 / 停止 Node sidecar 子进程（`flowmark-agent.cjs`）
//!   - 通过 stdio 维持 JSON-RPC 2.0 通信通道
//!   - 同步 ping（阶段 1 验证用）
//!   - 异步事件转发（阶段 4 Part 2）：
//!     * 后台线程读 sidecar stdout，按 JSON-RPC id 分发响应、按 method 转发 notification
//!     * agent.run 的多条 agent.event notification 通过 Tauri event 转发到前端
//!     * sidecar 发起的 tool.call 反向请求路由到 ToolDispatcher 执行后回写
//!
//! 设计要点：
//!   1. 进程生命周期由 `SidecarHandle` 持有，App 退出时统一 kill
//!   2. dev 模式下连 `src-sidecar/server.ts`（热重载），release 模式下连打包后的 `resources/flowmark-agent.cjs`
//!   3. Windows 下用 `CREATE_NO_WINDOW` 避免弹出黑框
//!   4. 子进程异常退出时记录原因，便于诊断
//!   5. stdin 写入由 Mutex 串行化；stdout 读取由独立线程持续 pump
//!   6. Tauri AppHandle 通过 `Arc<SidecarBus>` 注入，bus 内部管理 pending 请求与事件订阅

use crate::store::AppPaths;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 下隐藏子进程控制台窗口的 flag
/// 见 https://learn.microsoft.com/en-us/windows/win32/procthreadprocess-creation-flags
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// sidecar 通信错误
#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("sidecar 未启动")]
    NotRunning,
    #[error("启动 sidecar 失败: {0}")]
    SpawnFailed(String),
    #[error("sidecar 通信失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("sidecar 返回非法 JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("sidecar 超时（{0:?}）")]
    Timeout(std::time::Duration),
    #[error("反向工具调用失败: {0}")]
    ToolDispatch(String),
}

/// JSON-RPC id（字符串或数字，sidecar 用字符串）
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct RpcId(String);

impl RpcId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// 从 JSON value 提取 id（字符串 / 数字都转成字符串 key）
fn id_from_value(v: &serde_json::Value) -> Option<RpcId> {
    match v {
        serde_json::Value::String(s) => Some(RpcId::new(s.clone())),
        serde_json::Value::Number(n) => Some(RpcId::new(n.to_string())),
        _ => None,
    }
}

/// sidecar 总线：管理 pending 请求 + 事件转发 + 反向 tool.call 路由
///
/// 线程安全：
///   - `pending` 用 Mutex 保护，stdout 线程写、命令线程读
///   - `app` 是 Tauri AppHandle（Clone + Send + Sync），直接持有
///   - `tool_dispatcher` 由命令层在启动时注入
pub struct SidecarBus {
    app: AppHandle,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    pending: Mutex<HashMap<RpcId, oneshot::Sender<serde_json::Value>>>,
    tool_dispatcher: Mutex<Option<Arc<dyn ToolDispatcher>>>,
}

/// 反向工具调用派发器（命令层实现，注入到 bus）
pub trait ToolDispatcher: Send + Sync {
    /// 执行一次 tool.call，返回结果（成功）或错误消息（失败）
    fn dispatch(&self, tool: &str, args: serde_json::Value) -> Result<serde_json::Value, String>;
}

impl SidecarBus {
    fn new(app: AppHandle, stdin: std::process::ChildStdin) -> Arc<Self> {
        Arc::new(Self {
            app,
            stdin: Mutex::new(Some(stdin)),
            pending: Mutex::new(HashMap::new()),
            tool_dispatcher: Mutex::new(None),
        })
    }

    /// 注入反向工具调用派发器
    pub fn set_tool_dispatcher(&self, d: Arc<dyn ToolDispatcher>) {
        let mut g = self.tool_dispatcher.lock().expect("tool_dispatcher 锁中毒");
        *g = Some(d);
    }

    /// 发送一条 JSON-RPC 消息到 sidecar（不等待响应）
    fn write_raw(&self, msg: &serde_json::Value) -> Result<(), SidecarError> {
        let mut g = self.stdin.lock().map_err(|_| SidecarError::NotRunning)?;
        let stdin = g.as_mut().ok_or(SidecarError::NotRunning)?;
        let line = serde_json::to_string(msg)? + "\n";
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    /// 发送请求并等待响应（用于 ping / agent.cancel 等"一问一答"方法）
    ///
    /// agent.run 不用这个：它立即返回 `{ accepted: true }`，
    /// 真正的结果通过 agent.event notification 流式推送。
    pub async fn request(&self, request: &serde_json::Value) -> Result<serde_json::Value, SidecarError> {
        let id = id_from_value(request)
            .ok_or_else(|| SidecarError::ToolDispatch("请求缺少 id".into()))?;
        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().expect("pending 锁中毒");
            p.insert(id.clone(), tx);
        }
        self.write_raw(request)?;
        match rx.await {
            Ok(v) => Ok(v),
            Err(_) => Err(SidecarError::NotRunning),
        }
    }

    /// 发送通知（无 id，不等响应），用于 agent.cancel 之外的 fire-and-forget
    pub fn notify(&self, method: &str, params: serde_json::Value) -> Result<(), SidecarError> {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.write_raw(&msg)
    }

    /// 处理一行 stdout 消息（由 reader 线程调用）
    ///
    /// 三类消息：
    ///   1. 响应（有 id + result/error）→ 派发给 pending request
    ///   2. 通知（无 id，有 method）：
    ///      - agent.event → 转发到 Tauri 前端 `agent://event`
    ///      - 其他 → 记日志
    ///   3. 反向请求（有 id + method == "tool.call"）→ 调 ToolDispatcher，回写响应
    fn handle_message(&self, msg: serde_json::Value) {
        let has_id = msg.get("id").is_some();
        let method = msg.get("method").and_then(|v| v.as_str());
        let has_result_or_error = msg.get("result").is_some() || msg.get("error").is_some();

        // 1. 响应
        if has_id && has_result_or_error && method.is_none() {
            if let Some(id) = id_from_value(&msg["id"]) {
                let tx = {
                    let mut p = self.pending.lock().expect("pending 锁中毒");
                    p.remove(&id)
                };
                if let Some(tx) = tx {
                    let _ = tx.send(msg);
                }
            }
            return;
        }

        // 2. 反向 tool.call 请求
        if has_id && method == Some("tool.call") {
            self.handle_tool_call(msg);
            return;
        }

        // 3. 通知
        if let Some(m) = method {
            if m == "agent.event" {
                // 转发到前端
                let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
                let _ = self.app.emit("agent://event", params);
            } else {
                log::debug!("sidecar 通知未处理: {m}");
            }
        }
    }

    /// 处理 sidecar 发来的 tool.call 反向请求
    fn handle_tool_call(&self, msg: serde_json::Value) {
        let id = msg["id"].clone();
        let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
        let tool = params.get("tool").and_then(|v| v.as_str()).unwrap_or("");
        let args = params.get("args").cloned().unwrap_or(serde_json::Value::Null);

        let dispatcher = {
            let g = self.tool_dispatcher.lock().expect("tool_dispatcher 锁中毒");
            g.clone()
        };

        let result = match dispatcher {
            Some(d) => match d.dispatch(tool, args) {
                Ok(v) => serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": v }),
                Err(e) => serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32603, "message": e }
                }),
            },
            None => serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "tool dispatcher 未注入" }
            }),
        };

        if let Err(e) = self.write_raw(&result) {
            log::error!("回写 tool.call 响应失败: {e}");
        }
    }
}

/// sidecar 子进程句柄
///
/// 持有 child + bus，App 退出时统一 kill
pub struct SidecarHandle {
    child: Mutex<Option<Child>>,
    bus: Arc<SidecarBus>,
}

impl SidecarHandle {
    /// 启动 sidecar
    ///
    /// `script_path` 指向要执行的 JS 文件：
    ///   - dev: `resources/flowmark-agent.cjs`（构建后的 bundle）
    ///   - release: `<resource_dir>/resources/flowmark-agent.cjs`
    pub fn spawn(app: AppHandle, script_path: &str) -> Result<Self, SidecarError> {
        let mut cmd = Command::new("node");
        cmd.arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| SidecarError::SpawnFailed(format!("{e}")))?;

        let stdin = child.stdin.take().ok_or(SidecarError::NotRunning)?;
        let stdout = child.stdout.take().ok_or(SidecarError::NotRunning)?;

        let bus = SidecarBus::new(app, stdin);

        // 启动 stdout reader 线程：持续读行，解析 JSON，派发给 bus
        {
            let bus = bus.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let trimmed = l.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<serde_json::Value>(trimmed) {
                                Ok(msg) => bus.handle_message(msg),
                                Err(e) => {
                                    log::warn!("sidecar stdout 非 JSON 行: {trimmed} ({e})")
                                }
                            }
                        }
                        Err(e) => {
                            log::info!("sidecar stdout 读取结束: {e}");
                            break;
                        }
                    }
                }
            });
        }

        log::info!("sidecar 已启动: node {script_path}");
        Ok(Self {
            child: Mutex::new(Some(child)),
            bus,
        })
    }

    /// 暴露总线（命令层用来发请求 / 注入 dispatcher）
    pub fn bus(&self) -> Arc<SidecarBus> {
        self.bus.clone()
    }

    /// 发送一条 JSON-RPC 请求并等待响应（同步阻塞，阶段 1 ping 用）
    ///
    /// 注意：这只是兼容旧接口；新代码应通过 `bus().request().await` 走异步。
    pub fn request_sync(&self, request: &serde_json::Value) -> Result<serde_json::Value, SidecarError> {
        // 同步包装：在当前线程跑一个临时 runtime
        let bus = self.bus.clone();
        let req = request.clone();
        tauri::async_runtime::block_on(async move { bus.request(&req).await })
    }

    /// 终止 sidecar 子进程
    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
                log::info!("sidecar 已终止");
            }
        }
    }
}

/// 从 AppState 取 SidecarBus（命令层用）
#[allow(dead_code)]
pub fn bus_from_app(app: &AppHandle) -> Result<Arc<SidecarBus>, SidecarError> {
    let state = app
        .try_state::<SidecarState>()
        .ok_or(SidecarError::NotRunning)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| SidecarError::NotRunning)?;
    guard
        .as_ref()
        .map(|h| h.bus())
        .ok_or(SidecarError::NotRunning)
}

/// 全局 sidecar 状态（持有 SidecarHandle）
pub struct SidecarState(pub Mutex<Option<SidecarHandle>>);

/// 默认实现：占位，实际在 lib.rs setup 里注入
impl Default for ToolDispatcherRegistry {
    fn default() -> Self {
        Self {
            paths: None,
        }
    }
}

/// 工具派发器注册表（持有 AppPaths，实现 ToolDispatcher）
pub struct ToolDispatcherRegistry {
    paths: Option<AppPaths>,
}

impl ToolDispatcherRegistry {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths: Some(paths) }
    }
}

impl ToolDispatcher for ToolDispatcherRegistry {
    fn dispatch(&self, tool: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        let paths = self.paths.as_ref().ok_or("AppPaths 未注入")?;
        crate::commands::dispatch_tool_call(paths, tool, args).map_err(|e| e.to_string())
    }
}
