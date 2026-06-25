/**
 * useLanguage:语言切换 hook
 *
 * 持有当前语言状态,切换时同步 localStorage + 触发重渲染
 */
import { useCallback, useState } from "react";
import {
  detectLanguage,
  LANGUAGES,
  persistLanguage,
  translate,
  type AppLanguage,
} from "../i18n/index.js";

export interface UseLanguage {
  lang: AppLanguage;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLang: (lang: AppLanguage) => void;
  cycleLanguage: () => void;
}

export function useLanguage(): UseLanguage {
  const [lang, setLangState] = useState<AppLanguage>(() => detectLanguage());

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
    persistLanguage(next);
  }, []);

  const cycleLanguage = useCallback(() => {
    const idx = LANGUAGES.indexOf(lang);
    const next = LANGUAGES[(idx + 1) % LANGUAGES.length];
    setLang(next);
  }, [lang, setLang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  return { lang, t, setLang, cycleLanguage };
}
