/**
 * 设置面板(阶段 6.4 + 阶段 7 扩展)
 *
 * 对齐 iOS SettingsView:
 *   - 模型配置(endpoint / model / api key,key 走 Credential Manager)
 *   - 语言切换
 *   - 本地知识库管理(重建索引 / 查看统计)
 *   - Agent skill 管理(阶段 7:列表 / 上传文件 / 上传文件夹 / 新建 / 删除)
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UseLanguage } from "../hooks/useLanguage.js";
import { useSkills } from "../hooks/useSkills.js";
import { LANGUAGES, LANGUAGE_LABELS, type AppLanguage } from "../i18n/index.js";
import type { ModelConfiguration, SkillDescriptor } from "../types/index.js";

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

  // 阶段 7：skill 管理
  const skills = useSkills();
  const [editingSkill, setEditingSkill] = useState<{ name: string; content: string } | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await invoke<ModelConfiguration>("get_model_config");
        setConfig(c);
        const k = await invoke<string | null>("get_api_key");
        setApiKey(k ?? "");
        await loadIndexStats();
        await skills.refresh();
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ============ 阶段 7：skill 管理 ============

  const handleImportSkillFile = async () => {
    setSkillError(null);
    // 用浏览器原生 prompt 收集路径（避免引入 dialog 插件依赖）
    // 后续可升级为 @tauri-apps/plugin-dialog
    const path = window.prompt(t("settings.skills.importFile") + " — 输入 .md 文件绝对路径");
    if (!path) return;
    try {
      await skills.importSkillFile(path);
    } catch (e) {
      setSkillError((e as Error).message ?? String(e));
    }
  };

  const handleImportSkillFolder = async () => {
    setSkillError(null);
    const path = window.prompt(t("settings.skills.importFolder") + " — 输入 skill 文件夹绝对路径（需含 skill.md）");
    if (!path) return;
    try {
      await skills.importSkillFolder(path);
    } catch (e) {
      setSkillError((e as Error).message ?? String(e));
    }
  };

  const handleDeleteSkill = async (s: SkillDescriptor) => {
    setSkillError(null);
    if (s.source === "builtIn") {
      setSkillError(t("settings.skills.cannotDeleteBuiltIn"));
      return;
    }
    if (!window.confirm(t("settings.skills.deleteConfirm", { name: s.name }))) return;
    try {
      await skills.deleteSkill(s.name);
    } catch (e) {
      setSkillError((e as Error).message ?? String(e));
    }
  };

  const handleNewSkill = () => {
    setEditingSkill({
      name: "",
      content:
        "---\nname: my-skill\ndescription: 一句话描述\nslash: /my\nintentKeywords: [关键词1]\ntools: []\n---\n\n在这里写 skill 的系统提示词正文。\n",
    });
  };

  const handleEditSkill = async (s: SkillDescriptor) => {
    try {
      const full = await skills.loadSkill(s.name);
      setEditingSkill({ name: s.name, content: serializeSkillForEdit(full) });
    } catch (e) {
      setSkillError((e as Error).message ?? String(e));
    }
  };

  const handleSaveEditing = async () => {
    if (!editingSkill) return;
    setSkillError(null);
    const name = editingSkill.name.trim() || extractNameFromFrontmatter(editingSkill.content) || "skill";
    try {
      await skills.saveSkill(name, editingSkill.content);
      setEditingSkill(null);
    } catch (e) {
      setSkillError((e as Error).message ?? String(e));
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

      <section className="settings-section">
        <h3>{t("settings.skills")}</h3>
        <p className="muted">{t("settings.skills.hint")}</p>

        <div className="skills-toolbar">
          <button onClick={() => skills.refresh()}>{t("settings.skills.refresh")}</button>
          <button onClick={handleNewSkill}>{t("settings.skills.new")}</button>
          <button onClick={handleImportSkillFile}>{t("settings.skills.importFile")}</button>
          <button onClick={handleImportSkillFolder}>{t("settings.skills.importFolder")}</button>
        </div>

        {skillError && <p className="error">⚠ {skillError}</p>}
        {skills.error && <p className="error">⚠ {skills.error}</p>}

        <ul className="skills-list">
          {skills.skills.length === 0 && (
            <li className="muted">{t("settings.skills.empty")}</li>
          )}
          {skills.skills.map((s) => (
            <li key={s.name + s.source} className="skill-item">
              <div className="skill-head">
                <strong>{s.name}</strong>
                <span className={`skill-badge skill-${s.source}`}>
                  {s.source === "builtIn" ? t("settings.skills.builtIn") : t("settings.skills.user")}
                </span>
                {s.slash && <code className="muted">{s.slash}</code>}
              </div>
              {s.description && <p className="muted skill-desc">{s.description}</p>}
              <div className="skill-actions">
                <button onClick={() => handleEditSkill(s)}>✎</button>
                <button
                  onClick={() => handleDeleteSkill(s)}
                  disabled={s.source === "builtIn"}
                  title={s.source === "builtIn" ? t("settings.skills.cannotDeleteBuiltIn") : t("settings.skills.delete")}
                >
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>

        {editingSkill && (
          <div className="skill-editor">
            <h4>{t("settings.skills.new")}</h4>
            <label>
              <span>{t("settings.skills.name")}</span>
              <input
                type="text"
                value={editingSkill.name}
                placeholder="my-skill"
                onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
              />
            </label>
            <label>
              <span>{t("settings.skills.content")}</span>
              <textarea
                rows={12}
                value={editingSkill.content}
                onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
              />
            </label>
            <div className="skill-editor-actions">
              <button onClick={handleSaveEditing}>{t("settings.skills.save")}</button>
              <button onClick={() => setEditingSkill(null)}>✕</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ============ skill 序列化辅助 ============

/** 把 SkillDescriptor 重新序列化成 md 文本（frontmatter + body），便于编辑 */
function serializeSkillForEdit(s: SkillDescriptor): string {
  const fm: string[] = ["---"];
  fm.push(`name: ${s.name}`);
  if (s.description) fm.push(`description: ${s.description}`);
  if (s.profile) fm.push(`profile: ${s.profile}`);
  if (s.slash) fm.push(`slash: ${s.slash}`);
  if (s.intentKeywords.length > 0) fm.push(`intentKeywords: [${s.intentKeywords.join(", ")}]`);
  if (s.tools.length > 0) fm.push(`tools: [${s.tools.join(", ")}]`);
  fm.push("---");
  return fm.join("\n") + "\n" + (s.body ?? "");
}

/** 从 frontmatter 文本里提取 name 字段（编辑期兜底） */
function extractNameFromFrontmatter(content: string): string | null {
  const m = content.match(/^---\n[\s\S]*?\nname:\s*(\S+)/m);
  return m ? m[1] : null;
}
