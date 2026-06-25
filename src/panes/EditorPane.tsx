/**
 * 中间编辑/预览面板 — 对齐 macOS MacEditorPane
 *
 * 工具栏: 标题编辑 / 星标 / 字数 / 版本历史 / 导出菜单
 * 编辑区: edit / preview / split 三模式
 */
import { useEffect, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { UseLibrary } from "../hooks/useLibrary.js";
import type { UseLanguage } from "../hooks/useLanguage.js";
import { useMarkdownRender } from "../hooks/useMarkdownRender.js";
import type { DocumentVersion } from "../types/index.js";

interface Props {
  lib: UseLibrary;
  lang: UseLanguage;
}

type Mode = "edit" | "preview" | "split";

export function EditorPane({ lib, lang }: Props) {
  const { t } = lang;
  const [mode, setMode] = useState<Mode>("split");
  const [draft, setDraft] = useState(lib.activeContent);
  const [titleDraft, setTitleDraft] = useState("");
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { html, containerRef } = useMarkdownRender(draft);

  // 同步
  useEffect(() => {
    setDraft(lib.activeContent);
    setTitleDraft(lib.activeDoc?.title || "");
  }, [lib.activeContent, lib.activeDoc?.id]);

  const dirty = draft !== lib.activeContent;
  const wordCount = draft.replace(/\s/g, "").length; // 中文字数

  const save = async () => {
    await lib.saveActiveContent(draft);
    // TODO: save title separately when we have a rename API
  };

  // Cmd/Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  // 自动保存（2 秒防抖，对齐 macOS autosave）
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => save(), 2000);
    return () => clearTimeout(timer);
  }, [draft]);

  // 加载版本历史
  const loadVersions = async () => {
    if (!lib.activeDoc) return;
    const v = await lib.listVersions(lib.activeDoc.id);
    setVersions(v);
    setShowVersions(true);
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!lib.activeDoc) return;
    await lib.restoreVersion(lib.activeDoc.id, versionId);
    setShowVersions(false);
  };

  // 导出
  const doExport = async (ext: string) => {
    const filePath = await saveDialog({
      filters: [{ name: `${ext.toUpperCase()} 文档`, extensions: [ext] }],
      defaultPath: `${lib.activeDoc?.title || "document"}.${ext}`,
    });
    if (filePath) {
      if (dirty) await save();
      if (ext === "docx") await lib.exportDocx(filePath);
      else if (ext === "pdf") await lib.exportPdf(filePath);
    }
    setShowExportMenu(false);
  };

  if (!lib.activeDoc) {
    return (
      <section className="editor-pane empty">
        <p className="muted">{t("reader.empty")}</p>
      </section>
    );
  }

  return (
    <section className="editor-pane">
      {/* 工具栏 — 对齐 macOS editorToolbar */}
      <div className="editor-toolbar">
        <div className="editor-title-area">
          <input
            className="editor-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={save}
            placeholder={t("library.untitled")}
          />
          <span className="editor-title-path">{lib.activeDoc.path}</span>
        </div>

        <span className="editor-status">
          {dirty ? t("reader.edit") : t("reader.saved")} · {wordCount} 字
        </span>

        <div className="editor-mode">
          <ModeBtn active={mode === "edit"} onClick={() => setMode("edit")} label={t("reader.edit")} />
          <ModeBtn active={mode === "split"} onClick={() => setMode("split")} label={t("reader.split")} />
          <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")} label={t("reader.preview")} />
        </div>

        <button
          onClick={() => lib.toggleStar(lib.activeDoc!.id)}
          className="toolbar-icon-btn"
          title={lib.activeDoc.starred ? t("reader.unstar") : t("reader.star")}
        >
          {lib.activeDoc.starred ? "★" : "☆"}
        </button>

        <button onClick={loadVersions} className="toolbar-icon-btn" title={t("library.versions")}>
          🕐
        </button>

        <button onClick={save} disabled={!dirty} className="save-btn">
          {dirty ? t("reader.save") : t("reader.saved")}
        </button>

        {/* 导出下拉菜单 */}
        <div className="export-menu-wrapper">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="toolbar-icon-btn"
            title={t("reader.exportDocx")}
          >
            📤
          </button>
          {showExportMenu && (
            <div className="export-dropdown">
              <button onClick={() => doExport("docx")}>{t("reader.exportDocx")}</button>
              <button onClick={() => doExport("pdf")}>{t("reader.exportPdf")}</button>
              <button onClick={() => {
                // 导出 .md 纯文本
                const blob = new Blob([draft], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${lib.activeDoc?.title || "document"}.md`;
                a.click();
                URL.revokeObjectURL(url);
                setShowExportMenu(false);
              }}>
                Markdown (.md)
              </button>
              <button onClick={() => {
                const blob = new Blob([html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${lib.activeDoc?.title || "document"}.html`;
                a.click();
                URL.revokeObjectURL(url);
                setShowExportMenu(false);
              }}>
                HTML (.html)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 版本历史面板 */}
      {showVersions && (
        <div className="versions-panel">
          <div className="versions-header">
            <h3>{t("library.versions")}</h3>
            <button onClick={() => setShowVersions(false)}>×</button>
          </div>
          <ul className="versions-list">
            {versions.length === 0 && <li className="muted">暂无版本历史</li>}
            {versions.map((v) => (
              <li key={v.id} className="version-item">
                <span className="version-note">{v.note || `版本 ${v.id.slice(0, 8)}`}</span>
                <span className="version-time muted">{new Date(v.timestamp).toLocaleString()}</span>
                <button onClick={() => handleRestoreVersion(v.id)}>{t("library.restore")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 编辑区 */}
      <div className={`editor-body mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
        {lib.activeDoc.path} · {wordCount} 字
      </div>
    </section>
  );
}

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`mode-btn ${active ? "active" : ""}`} onClick={onClick}>{label}</button>
  );
}
