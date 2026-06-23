import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent, AgentRunArgs } from "./types";

/**
 * App 根组件（阶段 4 Part 2 验证版）
 *
 * 后续阶段 6 会重构成三栏工作区（MacWritingWorkspace 等价物）：
 *   左侧文档树 / 中间编辑器 / 右侧 Agent 面板
 *
 * 当前阶段验证：
 *   1. Rust 命令 invoke 链路通
 *   2. Node sidecar ping 链路通（通过 Rust 异步转发）
 *   3. agent_run → agent://event 流式事件链路通（Preview 模式）
 */
function App() {
  const [appVersion, setAppVersion] = useState<string>("loading...");
  const [sidecarPing, setSidecarPing] = useState<string>("pending...");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      // 拉取应用版本
      invoke<string>("get_app_version")
        .then(setAppVersion)
        .catch((e) => setAppVersion(`error: ${e}`));

      // sidecar ping
      invoke<string>("sidecar_ping")
        .then(setSidecarPing)
        .catch((e) => setSidecarPing(`error: ${e}`));

      // 订阅 agent 事件流
      unlisten = await listen<AgentEvent>("agent://event", (e) => {
        setEvents((prev) => [...prev, e.payload]);
        if (e.payload.type === "done" || e.payload.type === "error") {
          setRunning(false);
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const runAgent = async () => {
    setEvents([]);
    setRunning(true);
    const args: AgentRunArgs = {
      sessionId: "demo",
      input: "随便聊聊",
      profile: "general",
    };
    try {
      const res = await invoke<{ runId: string; accepted: boolean }>(
        "agent_run",
        { args },
      );
      if (!res.accepted) {
        setRunning(false);
        setEvents((prev) => [
          ...prev,
          { type: "error", runId: res.runId, message: "sidecar 未接受" },
        ]);
      }
    } catch (e) {
      setRunning(false);
      setEvents((prev) => [
        ...prev,
        { type: "error", runId: "?", message: String(e) },
      ]);
    }
  };

  const cancelAgent = async (runId: string) => {
    try {
      await invoke<boolean>("agent_cancel", { args: { runId } });
    } catch (e) {
      console.error("cancel 失败", e);
    }
  };

  const lastRunId = [...events].reverse().find((e) => "runId" in e)?.runId;

  return (
    <main className="app-root">
      <header className="app-header">
        <h1>FlowMark</h1>
        <p className="app-subtitle">Windows 版 · 阶段 4 Part 2 Agent 链路</p>
      </header>
      <section className="app-status">
        <div>应用版本：{appVersion}</div>
        <div>Sidecar ping：{sidecarPing}</div>
      </section>
      <section className="app-agent">
        <h2>Agent 预览</h2>
        <div className="agent-controls">
          <button onClick={runAgent} disabled={running}>
            {running ? "运行中..." : "发起 Agent run"}
          </button>
          {running && lastRunId && (
            <button onClick={() => cancelAgent(lastRunId)}>取消</button>
          )}
        </div>
        <div className="agent-events">
          {events.length === 0 && <p className="muted">暂无事件</p>}
          {events.map((ev, i) => (
            <EventRow key={i} ev={ev} />
          ))}
        </div>
      </section>
    </main>
  );
}

function EventRow({ ev }: { ev: AgentEvent }) {
  const ts = new Date().toLocaleTimeString();
  switch (ev.type) {
    case "metadata":
      return (
        <div className="ev ev-meta">
          <span className="ev-ts">{ts}</span>
          <strong>metadata</strong> skill={ev.skill} routedBy={ev.routedBy}
        </div>
      );
    case "delta":
      return (
        <div className="ev ev-delta">
          <span className="ev-ts">{ts}</span>
          <span className="ev-text">{ev.text}</span>
        </div>
      );
    case "tool_call":
      return (
        <div className="ev ev-tool">
          <span className="ev-ts">{ts}</span>
          <strong>tool_call</strong> {ev.tool} {JSON.stringify(ev.args)}
        </div>
      );
    case "tool_result":
      return (
        <div className="ev ev-tool">
          <span className="ev-ts">{ts}</span>
          <strong>tool_result</strong> {ev.tool}{" "}
          {JSON.stringify(ev.result).slice(0, 200)}
        </div>
      );
    case "done":
      return (
        <div className="ev ev-done">
          <span className="ev-ts">{ts}</span>
          <strong>done</strong> finalText={(ev.finalText || "").slice(0, 120)}
        </div>
      );
    case "error":
      return (
        <div className="ev ev-error">
          <span className="ev-ts">{ts}</span>
          <strong>error</strong> {ev.message}
        </div>
      );
  }
}

export default App;
