/**
 * 设置面板(阶段 6.4)
 *
 * 对齐 iOS SettingsView:
 *   - 模型配置(endpoint / model / api key,key 走 Credential Manager)
 *   - 语言切换
 *   - 本地知识库管理(重建索引 / 查看统计)
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UseLanguage } from "../hooks/useLanguage.js";
import { LANGUAGES, LANGUAGE_LABELS, type AppLanguage } from "../i18n/index.js";
import type { ModelConfiguration } from "../types/index.js";

interface Props {
  lang: UseLanguage;
}

export function SettingsPane({ lang }: Props) {
  const { t, lang: currentLang, setLang } = lang;
  const [config, setConfig] = useState<ModelConfiguration>({
    endpoint: "",
    model: "",
    timeoutSecs: 60,
    contextWindow: 16384,
  });
  const [apiKey, setApiKey] = useState("");
  const [savedFlag, setSavedFlag] = useState(false);
  const [indexStats, setIndexStats] = useState<{ docs: number; chunks: number } | null>(null);
  const [rebuildFlag, setRebuildFlag] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await invoke<ModelConfiguration>("get_model_config");
        setConfig(c);
        const k = await invoke<string | null>("get_api_key");
        setApiKey(k ?? "");
        await loadIndexStats();
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const loadIndexStats = async () => {
    try {
      const docs = await invoke<string[]>("list_indexed_documents");
      let chunks = 0;
      for (const id of docs) {
        const s = await invoke<{ chunkCount: number } | null>("index_stats", { documentId: id });
        if (s) chunks += s.chunkCount;
      }
      setIndexStats({ docs: docs.length, chunks });
    } catch {
      setIndexStats(null);
    }
  };

  const handleSave = async () => {
    await invoke("set_model_config", { config });
    await invoke("set_api_key", { apiKey });
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 1500);
  };

  const handleRebuildIndex = async () => {
    setRebuildFlag(null);
    try {
      // 重建:遍历 library 所有文档,build_index_batch
      const lib = await invoke<{ documents: Array<{ id: string; title: string; path: string }> }>("load_library_state");
      const items = [];
      for (const doc of lib.documents) {
        const content = await invoke<string>("read_document_content", { library: lib, docId: doc.id });
        items.push({
          documentId: doc.id,
          title: doc.title,
          content,
          updatedAt: Date.now(),
        });
      }
      const res = await invoke<{ rebuilt: number; skipped: number; errors: string[] }>(
        "build_index_batch",
        { items },
      );
      setRebuildFlag(t("settings.index.rebuilt", { count: res.rebuilt }));
      await loadIndexStats();
    } catch (e) {
      setRebuildFlag(String(e));
    }
  };

  return (
    <div className="settings">
      <h2>{t("settings.title")}</h2>

      <section className="settings-section">
        <h3>{t("settings.model")}</h3>
        <label>
          <span>{t("settings.endpoint")}</span>
          <input
            type="text"
            value={config.endpoint}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
          />
          <small className="muted">{t("settings.endpointHint")}</small>
        </label>
        <label>
          <span>{t("settings.modelName")}</span>
          <input
            type="text"
            value={config.model}
            placeholder="gpt-4o-mini"
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
          />
          <small className="muted">{t("settings.modelNameHint")}</small>
        </label>
        <label>
          <span>{t("settings.apiKey")}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <small className="muted">{t("settings.apiKeyHint")}</small>
        </label>
        <button onClick={handleSave}>{t("settings.save")}</button>
        {savedFlag && <span className="muted">  ✓ {t("settings.saved")}</span>}
      </section>

      <section className="settings-section">
        <h3>{t("settings.language")}</h3>
        <select
          value={currentLang}
          onChange={(e) => setLang(e.target.value as AppLanguage)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>
          ))}
        </select>
      </section>

      <section className="settings-section">
        <h3>{t("settings.index")}</h3>
        {indexStats && (
          <p className="muted">
            {t("settings.index.stats", { docs: indexStats.docs, chunks: indexStats.chunks })}
          </p>
        )}
        <button onClick={handleRebuildIndex}>{t("settings.index.rebuild")}</button>
        {rebuildFlag && <span className="muted">  {rebuildFlag}</span>}
      </section>
    </div>
  );
}
