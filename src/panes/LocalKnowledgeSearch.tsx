/**
 * 本地知识搜索面板(阶段 6.3)
 *
 * 对齐 iOS MacLocalKnowledgeSearchView:
 *   - 输入关键词 → search_index
 *   - 显示命中分块(heading / snippet)
 *   - 跳转到对应文档
 */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UseLanguage } from "../hooks/useLanguage.js";
import type { UseLibrary } from "../hooks/useLibrary.js";

interface SearchHit {
  chunkId: string;
  documentId: string;
  heading?: string;
  snippet: string;
  score: number;
}

interface Props {
  lang: UseLanguage;
  lib: UseLibrary;
}

export function LocalKnowledgeSearch({ lang, lib }: Props) {
  const { t } = lang;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await invoke<SearchHit[]>("search_index", { query, limit: 50 });
      setHits(res);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="local-search">
      <h2>{t("localSearch.title")}</h2>
      <div className="search-row">
        <input
          type="search"
          placeholder={t("localSearch.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doSearch();
          }}
        />
        <button onClick={doSearch} disabled={searching}>{t("agent.run")}</button>
      </div>
      <div className="search-results">
        {query.trim() === "" && <p className="muted">{t("localSearch.empty")}</p>}
        {query.trim() !== "" && hits.length === 0 && !searching && (
          <p className="muted">{t("localSearch.noResults")}</p>
        )}
        {hits.length > 0 && (
          <p className="muted">{t("localSearch.results", { count: hits.length })}</p>
        )}
        <ul className="hit-list">
          {hits.map((h) => (
            <li
              key={h.chunkId}
              className="hit-item"
              onClick={() => lib.selectDocument(h.documentId)}
            >
              <div className="hit-heading">
                {h.heading && <strong>{h.heading}</strong>}
                <span className="muted"> · {h.documentId}</span>
              </div>
              <pre className="hit-snippet">{h.snippet}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
