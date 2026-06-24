/**
 * FlowMark 主窗口(阶段 6)
 *
 * 对齐 iOS MacWritingWorkspace 的三栏布局:
 *   左:DocumentSidebar(文档树)
 *   中:EditorPane(编辑 + 预览)
 *   右:AgentPane(Agent 会话)
 *
 * 顶部 tab 切换右侧/中间区域显示 Library / Agent / LocalSearch / History / Settings。
 * 对齐 iOS 的 tab 体系(library / reader / agent / settings / history / localSearch)。
 */
import { useState } from "react";
import { useLanguage } from "./hooks/useLanguage.js";
import { useLibrary } from "./hooks/useLibrary.js";
import { useAgent } from "./hooks/useAgent.js";
import { DocumentSidebar } from "./panes/DocumentSidebar.js";
import { EditorPane } from "./panes/EditorPane.js";
import { AgentPane } from "./panes/AgentPane.js";
import { LocalKnowledgeSearch } from "./panes/LocalKnowledgeSearch.js";
import { SettingsPane } from "./panes/SettingsPane.js";
import { HistoryPane } from "./panes/HistoryPane.js";

type Tab = "agent" | "localSearch" | "history" | "settings";

export default function App() {
  const lang = useLanguage();
  const lib = useLibrary();
  const agent = useAgent();
  const [tab, setTab] = useState<Tab>("agent");

  return (
    <div className="workspace">
      <DocumentSidebar lib={lib} lang={lang} />
      <EditorPane lib={lib} lang={lang} />
      <div className="right-pane">
        <nav className="tab-bar">
          <TabBtn active={tab === "agent"} onClick={() => setTab("agent")} label={lang.t("tab.agent")} />
          <TabBtn active={tab === "localSearch"} onClick={() => setTab("localSearch")} label={lang.t("tab.localSearch")} />
          <TabBtn active={tab === "history"} onClick={() => setTab("history")} label={lang.t("tab.history")} />
          <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} label={lang.t("tab.settings")} />
        </nav>
        <div className="tab-body">
          {tab === "agent" && <AgentPane agent={agent} lang={lang} lib={lib} />}
          {tab === "localSearch" && <LocalKnowledgeSearch lang={lang} lib={lib} />}
          {tab === "history" && <HistoryPane lang={lang} />}
          {tab === "settings" && <SettingsPane lang={lang} />}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`tab-btn ${active ? "active" : ""}`} onClick={onClick}>{label}</button>
  );
}
