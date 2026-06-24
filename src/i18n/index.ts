/**
 * FlowMark 前端国际化（阶段 6）
 *
 * 对齐 iOS 7 语言：en / zh-Hans / zh-Hant / ja / ko / de / fr
 * key 前缀沿用 iOS 约定：agent.* / library.* / reader.* / settings.* / history.* / tab.* / localSearch.*
 *
 * 实现策略：纯字典对象 + t(key) 查找，零依赖。
 * 每个 language 一个扁平 Record<string, string>，未命中回退到 en，再回退到 key 本身。
 */

export type AppLanguage = "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "de" | "fr";

export const LANGUAGES: AppLanguage[] = [
  "en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr",
];

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  "en": "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  "ja": "日本語",
  "ko": "한국어",
  "de": "Deutsch",
  "fr": "Français",
};

import { en } from "./en.js";
import { zhHans } from "./zh-Hans.js";
import { zhHant } from "./zh-Hant.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { de } from "./de.js";
import { fr } from "./fr.js";

export const dictionaries: Record<AppLanguage, Record<string, string>> = {
  "en": en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  "ja": ja,
  "ko": ko,
  "de": de,
  "fr": fr,
};

const STORAGE_KEY = "flowmark.language";

/** 读取本地存储的语言偏好，默认 zh-Hans */
export function detectLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGUAGES.includes(stored as AppLanguage)) {
      return stored as AppLanguage;
    }
  } catch {
    // localStorage 不可用时静默回退
  }
  return "zh-Hans";
}

/** 保存语言偏好到 localStorage */
export function persistLanguage(lang: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 忽略写入失败
  }
}

/** 翻译函数：先查当前语言字典，再回退 en，再回退 key */
export function translate(lang: AppLanguage, key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[lang] ?? en;
  let raw = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(new RegExp(`\{${k}\}`, "g"), String(v));
    }
  }
  return raw;
}
