//! Node Sidecar 进程管理
//!
//! 职责：
//!   - 启动 / 停止 Node sidecar 子进程（`flowmark-agent.cjs`）
//!   - 通过 stdio 维持 JSON-RPC 2.0 通信通道
//!   - 提供同步 ping（阶段 1 验证用），后续阶段扩展为异步事件流转发
//!
//! 设计要点：
//!   1. 进程生命周期由 `SidecarHandle` 持有，App 退出时统一 kill
//!   2. dev 模式下连 `src-sidecar/server.ts`（热重载），release 模式下连打包后的 `resources/flowmark-agent.cjs`
//!   3. Windows 下用 `CREATE_NO_WINDOW` 避免弹出黑框
//!   4. 子进程异常退出时记录原因，便于诊断

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

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
    #[allow(dead_code)] // 阶段 4 异步流式时启用
    Timeout(std::time::Duration),
}

/// sidecar 子进程句柄 + 通信管道
///
/// `stdin` 用于下发 JSON-RPC 请求，子进程 stdout 由后台线程读取转发
pub struct SidecarHandle {
    child: Mutex<Option<Child>>,
}

impl SidecarHandle {
    /// 启动 sidecar
    ///
    /// `script_path` 指向要执行的 JS 文件：
    ///   - dev: `src-sidecar/server.ts`（实际通过 `node --import tsx` 或编译后运行，阶段 1 简化为直接 node cjs）
    ///   - release: `<resource_dir>/resources/flowmark-agent.cjs`
    pub fn spawn(script_path: &str) -> Result<Self, SidecarError> {
        let mut cmd = Command::new("node");
        cmd.arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd
            .spawn()
            .map_err(|e| SidecarError::SpawnFailed(format!("{e}")))?;

        log::info!("sidecar 已启动: node {script_path}");
        Ok(Self {
            child: Mutex::new(Some(child)),
        })
    }

    /// 发送一行 JSON-RPC 请求并等待一行响应（同步阻塞，阶段 1 ping 用）
    ///
    /// 注意：真正的 Agent 流式场景（阶段 4）会改成异步事件转发，
    /// 不再使用这种"一问一答"模式，因为流式响应是多条 notification。
    pub fn request(&self, request: &serde_json::Value) -> Result<serde_json::Value, SidecarError> {
        let mut guard = self.child.lock().map_err(|_| SidecarError::NotRunning)?;
        let child = guard.as_mut().ok_or(SidecarError::NotRunning)?;

        let stdin = child.stdin.as_mut().ok_or(SidecarError::NotRunning)?;
        let line = serde_json::to_string(request)? + "\n";
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;

        let stdout = child.stdout.as_mut().ok_or(SidecarError::NotRunning)?;
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        reader.read_line(&mut buf)?;

        let resp: serde_json::Value = serde_json::from_str(buf.trim())?;
        Ok(resp)
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
