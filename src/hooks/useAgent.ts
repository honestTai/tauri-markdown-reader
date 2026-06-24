/**
 * useAgent:Agent 会话与流式事件 hook
 *
 * 对接 Rust 侧:
 *   - agent_run / agent_cancel
 *   - 监听 agent://event 事件流,累积成消息
 *   - propose_agent_draft / apply_agent_draft / discard_agent_draft
 *
 * 维护"正在运行中的 runId"用于取消。每次 run 的 delta 累积成一条 assistant 消息,
 * done 时最终化;error 时把错误信息附加到消息上。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentEvent,
  AgentRunArgs,
  AgentRunAccepted,
  AgentMessage,
  AgentSkill,
  AgentRoutedBy,
  AgentSource,
  ResolvedDraft,
  ApplyDraftResult,
} from "../types/index.js";

interface PendingRun {
  runId: string;
  buffer: string;
  skill?: AgentSkill;
  routedBy?: AgentRoutedBy;
  sources: AgentSource[];
  toolCalls: Array<{ name: string; args: unknown; result?: unknown }>;
}

export interface UseAgent {
  messages: AgentMessage[];
  running: boolean;
  currentRunId: string | null;
  error: string | null;
  run: (input: string, opts?: { profile?: string; forcedSkill?: AgentSkill; documentId?: string; sessionId?: string }) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
  proposeDraft: (draftId: string) => Promise<ResolvedDraft>;
  applyDraft: (draftId: string) => Promise<ApplyDraftResult>;
  discardDraft: (draftId: string) => Promise<void>;
}

function newId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAgent(): UseAgent {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingRun | null>(null);
  const sessionIdRef = useRef<string>(`s-${Date.now()}`);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<AgentEvent>("agent://event", (e) => {
        const ev = e.payload;
        handleEvent(ev);
      });
    })();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvent = useCallback((ev: AgentEvent) => {
    switch (ev.type) {
      case "metadata": {
        pendingRef.current = {
          runId: ev.runId,
          buffer: "",
          skill: ev.skill,
          routedBy: ev.routedBy,
          sources: [],
          toolCalls: [],
        };
        break;
      }
      case "delta": {
        const p = pendingRef.current;
        if (p && p.runId === ev.runId) {
          p.buffer += ev.text;
        }
        break;
      }
      case "tool_call": {
        const p = pendingRef.current;
        if (p && p.runId === ev.runId) {
          p.toolCalls.push({ name: ev.tool, args: ev.args });
        }
        break;
      }
      case "tool_result": {
        const p = pendingRef.current;
        if (p && p.runId === ev.runId) {
          const last = p.toolCalls[p.toolCalls.length - 1];
          if (last && last.name === ev.tool) {
            last.result = ev.result;
          }
        }
        break;
      }
      case "done": {
        const p = pendingRef.current;
        const finalText = p?.buffer ?? ev.finalText;
        const sources = ev.sources.length > 0 ? ev.sources : (p?.sources ?? []);
        const msg: AgentMessage = {
          id: newId(),
          role: "assistant",
          content: finalText,
          skill: p?.skill,
          routedBy: p?.routedBy,
          sources,
          toolCalls: p?.toolCalls.map((tc) => ({
            name: tc.name,
            arguments: tc.args,
            result: tc.result,
          })) ?? [],
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        pendingRef.current = null;
        setRunning(false);
        setCurrentRunId(null);
        break;
      }
      case "error": {
        setError(ev.message);
        setRunning(false);
        setCurrentRunId(null);
        pendingRef.current = null;
        break;
      }
    }
  }, []);

  const run = useCallback(async (
    input: string,
    opts?: { profile?: string; forcedSkill?: AgentSkill; documentId?: string; sessionId?: string },
  ) => {
    setError(null);
    const userMsg: AgentMessage = {
      id: newId(),
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const args: AgentRunArgs = {
      sessionId: opts?.sessionId ?? sessionIdRef.current,
      input,
      profile: opts?.profile,
      forcedSkill: opts?.forcedSkill,
      documentId: opts?.documentId,
    };
    setRunning(true);
    try {
      const res = await invoke<AgentRunAccepted>("agent_run", { args });
      if (!res.accepted) {
        setError("sidecar 未接受运行请求");
        setRunning(false);
        return;
      }
      setCurrentRunId(res.runId);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!currentRunId) return;
    try {
      await invoke<boolean>("agent_cancel", { args: { runId: currentRunId } });
    } catch (e) {
      setError(String(e));
    }
    setRunning(false);
    setCurrentRunId(null);
    pendingRef.current = null;
  }, [currentRunId]);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    pendingRef.current = null;
  }, []);

  const proposeDraft = useCallback(async (draftId: string) => {
    return await invoke<ResolvedDraft>("propose_agent_draft", { args: { draftId } });
  }, []);

  const applyDraft = useCallback(async (draftId: string) => {
    return await invoke<ApplyDraftResult>("apply_agent_draft", { draftId });
  }, []);

  const discardDraft = useCallback(async (draftId: string) => {
    await invoke("discard_agent_draft", { draftId });
  }, []);

  return {
    messages,
    running,
    currentRunId,
    error,
    run,
    cancel,
    clear,
    proposeDraft,
    applyDraft,
    discardDraft,
  };
}
