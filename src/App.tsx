import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * App 根组件（阶段 1 骨架版）
 *
 * 后续阶段 6 会重构成三栏工作区（MacWritingWorkspace 等价物）：
 *   左侧文档树 / 中间编辑器 / 右侧 Agent 面板
 *
 * 当前阶段仅做最小验证：
 *   1. Rust 命令 invoke 链路通
 *   2. Node sidecar ping 链路通（通过 Rust 转发）
 */
function App() {
  const [appVersion, setAppVersion] = useState<string>("loading...");
  const [sidecarPing, setSidecarPing] = useState<string>("pending...");

  useEffect(() => {
    // 拉取应用版本（验证 Rust 命令链路）
    invoke<string>("get_app_version")
      .then(setAppVersion)
      .catch((e) => setAppVersion(`error: ${e}`));

    // 通过 Rust 转发一次 sidecar ping（验证 stdio JSON-RPC 链路）
    invoke<string>("sidecar_ping")
      .then(setSidecarPing)
      .catch((e) => setSidecarPing(`error: ${e}`));
  }, []);

  return (
    <main className="app-root">
      <header className="app-header">
        <h1>FlowMark</h1>
        <p className="app-subtitle">Windows 版 · 阶段 1 骨架</p>
      </header>
      <section className="app-status">
        <div>应用版本：{appVersion}</div>
        <div>Sidecar ping：{sidecarPing}</div>
      </section>
    </main>
  );
}

export default App;
