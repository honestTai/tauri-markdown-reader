/**
 * 右侧 Agent 面板(阶段 6.2)
 *
 * 对齐 iOS MacAgentPane:
 *   - 消息流(user / assistant)
 *   - 路由标签(AgentRoutedBy)
 *   - sources / toolCalls 折叠
 *   - 输入框 + run / stop / clear
 *   - skill 选择(LAUNCH_SKILLS)
 *   - 草稿预览(对接阶段 5 写回)
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

export function AgentPane({ agent, lang, lib }: Props) {
  const { t } = lang;
  const [input, setInput] = useState("");
  const [forcedSkill, setForcedSkill] = useState<AgentSkill | undefined>(undefined);
  const [draft, setDraft] = useState<ResolvedDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || agent.running) return;
    setInput("");
    await agent.run(text, {
      forcedSkill,
      documentId: lib.activeDoc?.id,
    });
  };

  // 从最近一条 assistant 消息里捞 draftId(来自 tool_result)
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
    } catch (e) {
      setDraftError(String(e));
    }
  };

  const handleApplyDraft = async () => {
    if (!draft) return;
    try {
      await agent.applyDraft(draft.id);
      setDraft(null);
      await lib.refresh();
    } catch (e) {
      setDraftError(String(e));
    }
  };

  const handleDiscardDraft = async () => {
    if (!draft) return;
    await agent.discardDraft(draft.id);
    setDraft(null);
  };

  return (
    <aside className="agent-pane">
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

      <div className="agent-messages">
        {agent.messages.length === 0 && <p className="muted">{t("agent.previewMode")}</p>}
        {agent.messages.map((m) => (
          <MessageRow key={m.id} m={m} lang={lang} />
        ))}
        {agent.error && <div className="agent-error">{agent.error}</div>}
      </div>

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

      <div className="agent-input-row">
        <textarea
          className="agent-input"
          placeholder={t("agent.inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={3}
        />
        <div className="agent-input-actions">
          {agent.running ? (
            <button onClick={agent.cancel} className="danger">{t("agent.stop")}</button>
          ) : (
            <button onClick={handleSubmit} disabled={!input.trim()}>{t("agent.run")}</button>
          )}
          <button onClick={agent.clear}>{t("agent.clear")}</button>
        </div>
      </div>
    </aside>
  );
}

function MessageRow({ m, lang }: { m: import("../types/index.js").AgentMessage; lang: UseLanguage }) {
  const { t } = lang;
  const { html, containerRef } = useMarkdownRender(m.content);
  if (m.role === "user") {
    return <div className="msg msg-user">{m.content}</div>;
  }
  return (
    <div className="msg msg-assistant">
      <div className="msg-meta">
        {m.skill && <span className="tag tag-skill">{m.skill}</span>}
        {m.routedBy && <span className="tag tag-route">{t(`agent.routedBy.${m.routedBy}`)}</span>}
      </div>
      <div ref={containerRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      {m.sources && m.sources.length > 0 && (
        <details className="msg-sources">
          <summary>{t("agent.sources")}({m.sources.length})</summary>
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
          <summary>{t("agent.toolCalls")}({m.toolCalls.length})</summary>
          <ul>
            {m.toolCalls.map((tc, i) => (
              <li key={i}>
                <strong>{tc.name}</strong>
                <pre className="tool-args">{JSON.stringify(tc.arguments, null, 2)}</pre>
                {tc.result !== undefined && (
                  <pre className="tool-result">{JSON.stringify(tc.result, null, 2)}</pre>
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
      <h3>{t("agent.draft.title")}({draft.mode})</h3>
      {!draft.canApply && (
        <div className="agent-error">
          {t("agent.draft.cannotApply", { count: draft.missingSearches.length })}
        </div>
      )}
      <div ref={containerRef} className="markdown-body draft-content" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="draft-actions">
        <button onClick={onApply} disabled={!draft.canApply}>{t("agent.draft.apply")}</button>
        <button onClick={onDiscard} className="danger">{t("agent.draft.discard")}</button>
      </div>
    </div>
  );
}
