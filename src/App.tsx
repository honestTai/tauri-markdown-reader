/**
 * FlowMark 主窗口（阶段 7 — 对齐 macOS MacWritingWorkspace 布局）
 *
 * 三栏布局：
 *   左: DocumentSidebar（文档树，含工作区操作 + 搜索）
 *   中: EditorPane（编辑 + 预览 + 版本历史）
 *   右: AgentPane（Agent 会话，固定占右侧）
 *
 * 顶部工具栏：标题 + 操作按钮
 *
 * 模态弹窗：LocalSearch / History / Settings（对齐 macOS sheet 模式）
 */
import { useEffect, useState } from "react";
import { useLanguage } from "./hooks/useLanguage.js";
import { useLibrary } from "./hooks/useLibrary.js";
import { useAgent } from "./hooks/useAgent.js";
import { DocumentSidebar } from "./panes/DocumentSidebar.js";
import { EditorPane } from "./panes/EditorPane.js";
import { AgentPane } from "./panes/AgentPane.js";
import { LocalKnowledgeSearch } from "./panes/LocalKnowledgeSearch.js";
import { SettingsPane } from "./panes/SettingsPane.js";
import { HistoryPane } from "./panes/HistoryPane.js";

type Modal = "settings" | "history" | "localSearch" | null;

export default function App() {
  const lang = useLanguage();
  const lib = useLibrary();
  const agent = useAgent();
  const [modal, setModal] = useState<Modal>(null);

  return (
    <div className="workspace">
      {/* 顶部工具栏 */}
      <header className="workspace-toolbar">
        <div className="toolbar-left">
          <span className="toolbar-brand">FlowMark</span>
        </div>
        <div className="toolbar-center">
          {lib.activeDoc && (
            <>
              <span className="toolbar-doc-title">{lib.activeDoc.title}</span>
              <span className="toolbar-doc-path">{lib.activeDoc.path}</span>
            </>
          )}
        </div>
        <div className="toolbar-right">
          <button
            className="toolbar-btn"
            onClick={() => setModal("localSearch")}
            title={lang.t("tab.localSearch")}
          >
            🔍
          </button>
          <button
            className="toolbar-btn"
            onClick={() => lang.cycleLanguage()}
            title={lang.t("settings.language")}
          >
            🌐
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setModal("history")}
            title={lang.t("tab.history")}
          >
            🕐
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setModal("settings")}
            title={lang.t("tab.settings")}
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="workspace-body">
        <DocumentSidebar lib={lib} lang={lang} />
        <EditorPane lib={lib} lang={lang} />
        <AgentPane agent={agent} lang={lang} lib={lib} />
      </div>

      {/* 模态弹窗 */}
      {modal === "settings" && (
        <ModalOverlay onClose={() => setModal(null)} title={lang.t("tab.settings")}>
          <SettingsPane lang={lang} />
        </ModalOverlay>
      )}
      {modal === "history" && (
        <ModalOverlay onClose={() => setModal(null)} title={lang.t("tab.history")}>
          <HistoryPane lang={lang} />
        </ModalOverlay>
      )}
      {modal === "localSearch" && (
        <ModalOverlay onClose={() => setModal(null)} title={lang.t("tab.localSearch")}>
          <LocalKnowledgeSearch lang={lang} lib={lib} />
        </ModalOverlay>
      )}
    </div>
  );
}

/** 模态弹窗外壳 — ESC 关闭 */
function ModalOverlay({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  // ESC 关闭弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
