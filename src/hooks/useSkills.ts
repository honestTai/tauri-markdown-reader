/**
 * useSkills: Skill 管理 hook（阶段 7）
 *
 * 对接 Rust 侧：
 *   - list_skills / load_skill
 *   - save_skill / delete_skill
 *   - import_skill_file / import_skill_folder
 *
 * 持有 skill 列表，提供 CRUD 方法。SettingsPane 用这个渲染 skill 管理区。
 */
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SkillDescriptor } from "../types/index.js";

export interface UseSkills {
  skills: SkillDescriptor[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadSkill: (name: string) => Promise<SkillDescriptor>;
  saveSkill: (name: string, content: string) => Promise<SkillDescriptor>;
  deleteSkill: (name: string) => Promise<void>;
  importSkillFile: (path: string) => Promise<SkillDescriptor>;
  importSkillFolder: (path: string) => Promise<SkillDescriptor>;
}

export function useSkills(): UseSkills {
  const [skills, setSkills] = useState<SkillDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<SkillDescriptor[]>("list_skills");
      setSkills(list);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSkill = useCallback(async (name: string) => {
    return invoke<SkillDescriptor>("load_skill", { name });
  }, []);

  const saveSkill = useCallback(async (name: string, content: string) => {
    const saved = await invoke<SkillDescriptor>("save_skill", { name, content });
    await refresh();
    return saved;
  }, [refresh]);

  const deleteSkill = useCallback(async (name: string) => {
    await invoke("delete_skill", { name });
    await refresh();
  }, [refresh]);

  const importSkillFile = useCallback(async (path: string) => {
    const saved = await invoke<SkillDescriptor>("import_skill_file", { path });
    await refresh();
    return saved;
  }, [refresh]);

  const importSkillFolder = useCallback(async (path: string) => {
    const saved = await invoke<SkillDescriptor>("import_skill_folder", { path });
    await refresh();
    return saved;
  }, [refresh]);

  return {
    skills,
    loading,
    error,
    refresh,
    loadSkill,
    saveSkill,
    deleteSkill,
    importSkillFile,
    importSkillFolder,
  };
}
