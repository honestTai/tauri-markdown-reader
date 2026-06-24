/**
 * 中间编辑/预览面板(阶段 6.1)
 *
 * 对齐 iOS MacEditorPane:
 *   - 模式:edit / preview / split
 *   - edit:textarea 直接编辑,失焦/快捷键保存
 *   - preview:useMarkdownRender 渲染
 *   - split:左右分屏
 */
import { useEffect, useRef, useState } from "react";
import type { UseLibrary } from "../hooks/useLibrary.js";
import type { UseLanguage } from "../hooks/useLanguage.js";
import { useMarkdownRender } from "../hooks/useMarkdownRender.js";

interface Props {
  lib: UseLibrary;
  lang: UseLanguage;
}

type Mode = "edit" | "preview" | "split";

export function EditorPane({ lib, lang }: Props) {
  const { t } = lang;
  const [mode, setMode] = useState<Mode>("split");
  const [draft, setDraft] = useState(lib.activeContent);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { html, containerRef } = useMarkdownRender(draft);

  // 当 activeDocument 切换或外部 reload 时,同步 draft
  useEffect(() => {
    setDraft(lib.activeContent);
  }, [lib.activeContent, lib.activeDoc?.id]);

  const dirty = draft !== lib.activeContent;

  const save = async () => {
    await lib.saveActiveContent(draft);
  };

  // Cmd/Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!lib.activeDoc) {
    return (
      <section className="editor-pane empty">
        <p className="muted">{t("reader.empty")}</p>
      </section>
    );
  }

  return (
    <section className="editor-pane">
      <div className="editor-toolbar">
        <div className="editor-title">{lib.activeDoc.title}</div>
        <div className="editor-mode">
          <ModeBtn active={mode === "edit"} onClick={() => setMode("edit")} label={t("reader.edit")} />
          <ModeBtn active={mode === "split"} onClick={() => setMode("split")} label={t("reader.split")} />
          <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")} label={t("reader.preview")} />
        </div>
        <button onClick={save} disabled={!dirty} className="save-btn">
          {dirty ? t("reader.save") : t("reader.saved")}
        </button>
      </div>
      <div className={`editor-body mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            spellCheck={false}
          />
        )}
        {mode !== "edit" && (
          <div
            ref={containerRef}
            className="editor-preview markdown-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
      <div className="editor-footer muted">
        {t("reader.wordCount", { count: draft.length })}
      </div>
    </section>
  );
}

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`mode-btn ${active ? "active" : ""}`} onClick={onClick}>{label}</button>
  );
}
