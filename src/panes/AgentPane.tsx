/**
 * 右侧 Agent 面板 — 对齐 macOS MacAgentPane
 *
 * - 空状态快速建议（对齐 MacAgentEmptyState）
 * - 消息气泡（iMessage 风格）
 * - 输入框：Enter 发送，Shift+Enter 换行（对齐 macOS Cmd+Return）
 * - skill chip 选择器
 * - 草稿预览（阶段 5 写回）
 */
import { useMemo, useState } from "react";
import type { UseAgent } from "../hooks/useAgent.js";
import type { UseLanguage } from "../hooks/useLanguage.js";
import type { UseLibrary } from "../hooks/useLibrary.js";
import type { AgentSkill, ResolvedDraft } from "../types/index.js";
import { LAUNCH_SKILLS } from "../sidecar-skills.js";
import { useMarkdownRender } from "../hooks/useMarkdownRender.js";

interface Props {
  agent: UseAgent;
  lang: UseLanguage;
  lib: UseLibrary;
}

/** 快速建议项（对齐 macOS MacAgentEmptyState） */
const QUICK_PROMPTS: { labelKey: string; prompt: string; skill: AgentSkill }[] = [
  { labelKey: "agent.task.rewrite", prompt: "请润色并改进这段文字", skill: "review" },
  { labelKey: "agent.suggestion.summary", prompt: "请总结这篇文档的核心要点", skill: "understand" },
  { labelKey: "agent.suggestion.actions", prompt: "根据这篇文档，接下来应该做什么？", skill: "followups" },
  { labelKey: "agent.suggestion.html", prompt: "请帮我把这段内容做成一个美观的 HTML 页面", skill: "htmlAuthor" },
  { labelKey: "agent.suggestion.chat", prompt: "聊聊这篇文档的内容", skill: "chat" },
];

export function AgentPane({ agent, lang, lib }: Props) {
  const { t } = lang;
  const [input, setInput] = useState("");
  const [forcedSkill, setForcedSkill] = useState<AgentSkill | undefined>(undefined);
  const [draft, setDraft] = useState<ResolvedDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const canSend = !agent.running && input.trim().length > 0;

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || agent.running) return;
    setInput("");
    await agent.run(text, {
      forcedSkill,
      documentId: lib.activeDoc?.id,
    });
  };

  // 快速建议（对齐 macOS quick prompt）
  const handleQuickPrompt = async (prompt: string, skill: AgentSkill) => {
    if (agent.running) return;
    setForcedSkill(skill);
    await agent.run(prompt, {
      forcedSkill: skill,
      documentId: lib.activeDoc?.id,
    });
  };

  // 键盘处理：Enter 发送，Shift+Enter 换行
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) handleSubmit();
    }
  };

  // 从最近一条 assistant 消息里捞 draftId
  const lastDraftId = useMemo(() => {
    const last = agent.messages[agent.messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    for (const tc of last.toolCalls ?? []) {
      const r = tc.result as { draftId?: string } | undefined;
      if (r?.draftId) return r.draftId;
    }
    return null;
  }, [agent.messages]);

  const handlePreviewDraft = async () => {
    if (!lastDraftId) return;
    try {
      const d = await agent.proposeDraft(lastDraftId);
      setDraft(d);
      setDraftError(null);
    } catch (e) { setDraftError(String(e)); }
  };

  const handleApplyDraft = async () => {
    if (!draft) return;
    try {
      await agent.applyDraft(draft.id);
      setDraft(null);
      await lib.refresh();
    } catch (e) { setDraftError(String(e)); }
  };

  const handleDiscardDraft = async () => {
    if (!draft) return;
    await agent.discardDraft(draft.id);
    setDraft(null);
  };

  const isEmpty = agent.messages.length === 0 && !agent.running;

  return (
    <aside className="agent-pane">
      {/* 头部 */}
      <div className="agent-header">
        <h2>{t("agent.title")}</h2>
        <div className="agent-skills">
          {LAUNCH_SKILLS.map((s) => (
            <button
              key={s}
              className={`skill-chip ${forcedSkill === s ? "active" : ""}`}
              onClick={() => setForcedSkill(forcedSkill === s ? undefined : s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 消息区 */}
      <div className="agent-messages">
        {isEmpty && (
          <div className="agent-empty">
            <p className="agent-empty-title">{t("agent.emptyTitle") || "开始对话"}</p>
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.labelKey}
                className="quick-prompt-btn"
                onClick={() => handleQuickPrompt(qp.prompt, qp.skill)}
                disabled={agent.running}
              >
                <span className="quick-prompt-label">{t(qp.labelKey) || qp.labelKey}</span>
                <span className="quick-prompt-text">{qp.prompt}</span>
              </button>
            ))}
          </div>
        )}
        {agent.messages.map((m) => (
          <MessageRow key={m.id} m={m} lang={lang} />
        ))}
        {agent.error && <div className="agent-error">{agent.error}</div>}
      </div>

      {/* 草稿预览 */}
      {draft && (
        <DraftPreview
          draft={draft}
          onApply={handleApplyDraft}
          onDiscard={handleDiscardDraft}
          lang={lang}
        />
      )}
      {draftError && <div className="agent-error">{draftError}</div>}

      {lastDraftId && !draft && (
        <button onClick={handlePreviewDraft} className="draft-preview-btn">
          {t("agent.draft.title")}
        </button>
      )}

      {/* 输入区（对齐 macOS composer） */}
      <div className="agent-input-row">
        <textarea
          className="agent-input"
          placeholder={t("agent.inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          rows={3}
        />
        <div className="agent-input-actions">
          <span className="agent-input-hint">
            {agent.running ? "思考中..." : <><kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行</>}
          </span>
          {agent.running ? (
            <button onClick={agent.cancel} className="btn-stop">{t("agent.stop")}</button>
          ) : (
            <>
              <button onClick={agent.clear} className="btn-clear" disabled={agent.messages.length === 0}>
                {t("agent.clear")}
              </button>
              <button onClick={handleSubmit} disabled={!canSend} className="btn-send">
                {t("agent.run")}
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function MessageRow({ m, lang }: { m: import("../types/index.js").AgentMessage; lang: UseLanguage }) {
  const { t } = lang;
  const { html, containerRef } = useMarkdownRender(m.content);

  if (m.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-content">{m.content}</div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="msg-meta">
        {m.skill && <span className="tag tag-skill">{m.skill}</span>}
        {m.routedBy && <span className="tag">{t(`agent.routedBy.${m.routedBy}`)}</span>}
      </div>
      <div className="msg-content">
        <div ref={containerRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {m.sources && m.sources.length > 0 && (
        <details className="msg-sources">
          <summary>{t("agent.sources")} ({m.sources.length})</summary>
          <ul>
            {m.sources.map((s, i) => (
              <li key={i}>
                <span className="muted">{s.documentId}</span>
                {s.heading && <strong> · {s.heading}</strong>}
                <pre className="source-snippet">{s.snippet}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.toolCalls && m.toolCalls.length > 0 && (
        <details className="msg-tools">
          <summary>{t("agent.toolCalls")} ({m.toolCalls.length})</summary>
          <ul>
            {m.toolCalls.map((tc, i) => (
              <li key={i}>
                <strong>{tc.name}</strong>
                <div className="tool-args">{JSON.stringify(tc.arguments, null, 2)}</div>
                {tc.result !== undefined && (
                  <div className="tool-result">{JSON.stringify(tc.result, null, 2)}</div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DraftPreview({
  draft, onApply, onDiscard, lang,
}: {
  draft: ResolvedDraft;
  onApply: () => void;
  onDiscard: () => void;
  lang: UseLanguage;
}) {
  const { t } = lang;
  const { html, containerRef } = useMarkdownRender(draft.content);
  return (
    <div className="draft-preview">
      <h3>{t("agent.draft.title")} ({draft.mode})</h3>
      {!draft.canApply && (
        <div className="agent-error">
          {t("agent.draft.cannotApply", { count: draft.missingSearches.length })}
        </div>
      )}
      <div ref={containerRef} className="markdown-body draft-content" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="draft-actions">
        <button onClick={onApply} disabled={!draft.canApply}>{t("agent.draft.apply")}</button>
        <button onClick={onDiscard}>{t("agent.draft.discard")}</button>
      </div>
    </div>
  );
}
