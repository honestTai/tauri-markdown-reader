/**
 * 左侧文档树侧栏(阶段 6.1)
 *
 * 对齐 iOS MacDocumentSidebar:
 *   - 工作区选择 / 新建文档 / 导入全部 / 导入 Word / 导入 PDF
 *   - 文档列表(置顶 + 收藏 + 全部过滤)
 *   - 搜索框(本地子串过滤,前端做)
 *   - 文档项:点击选中,star/unstar,删除
 */
import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { UseLibrary } from "../hooks/useLibrary.js";
import type { UseLanguage } from "../hooks/useLanguage.js";
import type { MarkdownDocument } from "../types/index.js";

interface Props {
  lib: UseLibrary;
  lang: UseLanguage;
}

type Filter = "all" | "starred" | "pinned";

export function DocumentSidebar({ lib, lang }: Props) {
  const { t } = lang;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const docs = lib.library?.documents ?? [];
  const visible = useMemo(() => {
    let arr = docs.slice();
    if (filter === "starred") arr = arr.filter((d) => d.starred);
    if (filter === "pinned") arr = arr.filter((d) => d.pinned);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q));
    }
    // 置顶在前,然后按 updated_at 倒序
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    return arr;
  }, [docs, filter, query]);

  const handlePickWorkspace = async () => {
    // 简化版:用 prompt 收集路径。后续阶段 7 可换成 tauri dialog
    const root = window.prompt(t("library.pickWorkspace"), lib.library?.workspaceRoot ?? "");
    if (root) {
      await lib.pickWorkspace(root);
    }
  };

  const handleImportDocx = async () => {
    const selected = await open({
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
      multiple: false,
    });
    if (selected && lib.library) {
      await lib.importDocx(selected as string);
    }
  };

  const handleImportPdf = async () => {
    const selected = await open({
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
      multiple: false,
    });
    if (selected && lib.library) {
      await lib.importPdf(selected as string);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>{t("library.title")}</h2>
        <div className="sidebar-actions">
          <button onClick={handlePickWorkspace} title={t("library.pickWorkspace")}>📁</button>
          <button onClick={() => lib.createDocument(t("library.untitled"))} title={t("library.newDocument")}>＋</button>
          <button onClick={() => lib.importAll()} title={t("library.importAll")}>⇪</button>
          <button onClick={handleImportDocx} title={t("library.importDocx")} className="import-btn">📄W</button>
          <button onClick={handleImportPdf} title={t("library.importPdf")} className="import-btn">📄P</button>
        </div>
      </div>

      <input
        className="sidebar-search"
        type="search"
        placeholder={t("library.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="sidebar-filter">
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")} label={t("library.all")} />
        <FilterButton active={filter === "starred"} onClick={() => setFilter("starred")} label={t("library.starred")} />
      </div>

      <ul className="sidebar-list">
        {visible.length === 0 && <li className="muted">{t("library.empty")}</li>}
        {visible.map((doc) => (
          <DocItem
            key={doc.id}
            doc={doc}
            active={lib.library?.activeDocumentId === doc.id}
            onSelect={() => lib.selectDocument(doc.id)}
            onToggleStar={() => lib.toggleStar(doc.id)}
            onDelete={() => {
              if (window.confirm(t("library.confirmDelete"))) {
                lib.deleteDocument(doc.id);
              }
            }}
            t={t}
          />
        ))}
      </ul>
    </aside>
  );
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`filter-btn ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function DocItem({
  doc, active, onSelect, onToggleStar, onDelete, t,
}: {
  doc: MarkdownDocument;
  active: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  t: (k: string) => string;
}) {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // 显示自定义右键菜单
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.innerHTML = `
      <button class="ctx-menu-item">${doc.starred ? t("reader.unstar") : t("reader.star")}</button>
      <button class="ctx-menu-item danger">${t("library.delete")}</button>
    `;
    menu.querySelectorAll("button")[0]?.addEventListener("click", () => {
      onToggleStar();
      menu.remove();
    });
    menu.querySelectorAll("button")[1]?.addEventListener("click", () => {
      if (window.confirm(t("library.confirmDelete"))) {
        onDelete();
      }
      menu.remove();
    });
    document.body.appendChild(menu);
    // 点击其他地方关闭
    const closeMenu = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      }
    };
    setTimeout(() => document.addEventListener("click", closeMenu), 0);
  };

  return (
    <li
      className={`doc-item ${active ? "active" : ""}`}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      <div className="doc-item-main">
        <span className="doc-title">{doc.pinned ? "📌 " : ""}{doc.starred ? "★ " : ""}{doc.title || t("library.untitled")}</span>
        <span className="doc-path muted">{doc.path}</span>
      </div>
      <div className="doc-item-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={onToggleStar} title={doc.starred ? t("reader.unstar") : t("reader.star")}>
          {doc.starred ? "★" : "☆"}
        </button>
        <button onClick={onDelete} title={t("library.delete")} className="danger">×</button>
      </div>
    </li>
  );
}
