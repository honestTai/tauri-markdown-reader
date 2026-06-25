//! Python 文档转换器 sidecar 管理
//!
//! 职责：
//!   - 启动 / 停止 Python sidecar 子进程（flowmark-converter/main.py）
//!   - 通过 stdio 维持 JSON-RPC 2.0 通信
//!   - 提供 convert_docx / convert_pdf 等命令
//!
//! 与 Node sidecar (sidecar.rs) 的区别：
//!   - 无需异步事件转发（转换器是请求-响应模式）
//!   - 无需反向 RPC（转换器不主动请求 Rust）
//!   - 每个转换请求对应一个 JSON-RPC 调用，同步等待响应

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 下隐藏子进程控制台窗口
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 转换器通信错误
#[derive(Debug, thiserror::Error)]
pub enum ConverterError {
    #[error("转换器未启动")]
    NotRunning,
    #[error("启动转换器失败: {0}")]
    SpawnFailed(String),
    #[error("转换器通信失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("转换器返回非法 JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("转换器超时")]
    Timeout,
    #[error("转换器业务错误: {0}")]
    ConverterError(String),
}

/// 转换结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    /// 转换后的 Markdown 文本
    pub markdown: String,
    /// 源格式: "docx" / "pdf"
    pub format: String,
    /// 源文件路径
    pub source_file: String,
}

/// 转换请求参数
#[derive(Debug, Clone, serde::Serialize)]
struct ConvertRequest {
    file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_fallback_level: Option<i32>,
}

/// Python 转换器句柄
///
/// 持有子进程 + stdin writer（stdout reader 是"按需读响应"模式）
pub struct ConverterHandle {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    stdout: Mutex<Option<BufReader<std::process::ChildStdout>>>,
}

impl ConverterHandle {
    /// 启动 Python 转换器 sidecar（开发模式：python + 脚本）
    ///
    /// `python_cmd` 是 Python 可执行文件名或路径（如 "python"）
    /// `script_path` 是 main.py 的绝对路径
    pub fn spawn(python_cmd: &str, script_path: &str) -> Result<Self, ConverterError> {
        let mut cmd = Command::new(python_cmd);
        cmd.arg("-u") // 无缓冲 stdout（关键！否则 JSON-RPC 消息会被缓存）
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        Self::start_from_command(cmd, &format!("{python_cmd} {script_path}"))
    }

    /// 启动打包好的独立 exe（release 模式：PyInstaller 产物）
    ///
    /// `exe_path` 是 flowmark-converter.exe 的绝对路径
    pub fn spawn_exe(exe_path: &str) -> Result<Self, ConverterError> {
        let mut cmd = Command::new(exe_path);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        Self::start_from_command(cmd, exe_path)
    }

    /// 内部方法：从已配置的 Command 启动子进程
    fn start_from_command(mut cmd: Command, label: &str) -> Result<Self, ConverterError> {
        let mut child = cmd
            .spawn()
            .map_err(|e| ConverterError::SpawnFailed(format!("无法启动转换器: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or(ConverterError::SpawnFailed("无法获取 stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(ConverterError::SpawnFailed("无法获取 stdout".into()))?;

        log::info!("Python 转换器已启动: {label}");

        Ok(Self {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(Some(stdin)),
            stdout: Mutex::new(Some(BufReader::new(stdout))),
        })
    }

    /// 发送 JSON-RPC 请求并等待响应
    ///
    /// 这是同步方法，blocking I/O。每个转换请求独立调用。
    fn send_request(&self, method: &str, params: &serde_json::Value) -> Result<serde_json::Value, ConverterError> {
        // 构造 JSON-RPC 请求
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": method,
            "method": method,
            "params": params,
        });

        let request_line = serde_json::to_string(&request)? + "\n";

        // 写入 stdin
        {
            let mut guard = self
                .stdin
                .lock()
                .map_err(|_| ConverterError::NotRunning)?;
            let stdin = guard
                .as_mut()
                .ok_or(ConverterError::NotRunning)?;
            stdin.write_all(request_line.as_bytes())?;
            stdin.flush()?;
        }

        // 读取 stdout 响应
        let mut response_line = String::new();
        {
            let mut guard = self
                .stdout
                .lock()
                .map_err(|_| ConverterError::NotRunning)?;
            let reader = guard
                .as_mut()
                .ok_or(ConverterError::NotRunning)?;
            response_line.clear();
            reader.read_line(&mut response_line)?;
        }

        if response_line.trim().is_empty() {
            return Err(ConverterError::ConverterError("转换器返回空响应".into()));
        }

        let response: serde_json::Value =
            serde_json::from_str(response_line.trim())?;

        // 检查 JSON-RPC 错误
        if let Some(error) = response.get("error") {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("未知错误");
            return Err(ConverterError::ConverterError(msg.to_string()));
        }

        // 提取 result
        let result = response
            .get("result")
            .cloned()
            .ok_or_else(|| ConverterError::ConverterError("响应缺少 result 字段".into()))?;

        Ok(result)
    }

    /// 健康检查
    pub fn ping(&self) -> Result<serde_json::Value, ConverterError> {
        self.send_request("ping", &serde_json::json!({}))
    }

    /// 将 .docx 文件转为 Markdown
    ///
    /// `file_path`: .docx 文件的绝对路径
    /// `api_key`: 可选的 OpenAI API key（用于图片 LLM vision 降级）
    /// `endpoint`: 可选的 API endpoint
    pub fn convert_docx(
        &self,
        file_path: &str,
        api_key: Option<&str>,
        endpoint: Option<&str>,
    ) -> Result<ConvertResult, ConverterError> {
        let params = serde_json::json!({
            "filePath": file_path,
            "apiKey": api_key,
            "endpoint": endpoint,
            "imageFallbackLevel": 3,
        });

        let result = self.send_request("convert.docx_to_md", &params)?;

        Ok(ConvertResult {
            markdown: result["markdown"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            format: result["format"]
                .as_str()
                .unwrap_or("docx")
                .to_string(),
            source_file: result["sourceFile"]
                .as_str()
                .unwrap_or(file_path)
                .to_string(),
        })
    }

    /// 将 .pdf 文件转为 Markdown
    ///
    /// `file_path`: .pdf 文件的绝对路径
    /// `api_key`: 可选的 OpenAI API key（用于图片 LLM vision 降级）
    /// `endpoint`: 可选的 API endpoint
    pub fn convert_pdf(
        &self,
        file_path: &str,
        api_key: Option<&str>,
        endpoint: Option<&str>,
    ) -> Result<ConvertResult, ConverterError> {
        let params = serde_json::json!({
            "filePath": file_path,
            "apiKey": api_key,
            "endpoint": endpoint,
            "imageFallbackLevel": 3,
        });

        let result = self.send_request("convert.pdf_to_md", &params)?;

        Ok(ConvertResult {
            markdown: result["markdown"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            format: result["format"]
                .as_str()
                .unwrap_or("pdf")
                .to_string(),
            source_file: result["sourceFile"]
                .as_str()
                .unwrap_or(file_path)
                .to_string(),
        })
    }

    /// 将 Markdown 转为 .docx 文件
    ///
    /// `markdown`: Markdown 文本
    /// `output_path`: 输出 .docx 文件的绝对路径
    pub fn convert_md_to_docx(
        &self,
        markdown: &str,
        output_path: &str,
    ) -> Result<ConvertResult, ConverterError> {
        let params = serde_json::json!({
            "markdown": markdown,
            "outputPath": output_path,
        });

        let result = self.send_request("convert.md_to_docx", &params)?;

        Ok(ConvertResult {
            markdown: String::new(),
            format: "docx".to_string(),
            source_file: result["outputPath"]
                .as_str()
                .unwrap_or(output_path)
                .to_string(),
        })
    }

    /// 将 Markdown 转为 .pdf 文件
    ///
    /// `markdown`: Markdown 文本
    /// `output_path`: 输出 .pdf 文件的绝对路径
    pub fn convert_md_to_pdf(
        &self,
        markdown: &str,
        output_path: &str,
    ) -> Result<ConvertResult, ConverterError> {
        let params = serde_json::json!({
            "markdown": markdown,
            "outputPath": output_path,
        });

        let result = self.send_request("convert.md_to_pdf", &params)?;

        Ok(ConvertResult {
            markdown: String::new(),
            format: "pdf".to_string(),
            source_file: result["outputPath"]
                .as_str()
                .unwrap_or(output_path)
                .to_string(),
        })
    }

    /// 终止 Python 转换器子进程
    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
                log::info!("Python 转换器已终止");
            }
        }
    }
}

/// 全局转换器状态
pub struct ConverterState(pub Mutex<Option<ConverterHandle>>);
