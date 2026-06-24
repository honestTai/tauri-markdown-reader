/**
 * i18n 单元测试
 *
 * - 所有 7 种语言字典都包含 en 的全部 key(防止漏 key 回退到英文)
 * - translate 在缺失时回退到 en,再回退到 key 本身
 * - translate 支持 {var} 占位符替换
 */
import { describe, it, expect } from "vitest";
import { dictionaries, LANGUAGES, translate, type AppLanguage } from "../index.js";

const enKeys = Object.keys(dictionaries.en).sort();

describe("i18n dictionaries", () => {
  it("提供 7 种语言", () => {
    expect(LANGUAGES).toEqual([
      "en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr",
    ]);
  });

  for (const lang of LANGUAGES) {
    it(`语言 ${lang} 覆盖 en 的所有 key`, () => {
      const dict = dictionaries[lang as AppLanguage];
      const keys = Object.keys(dict).sort();
      for (const k of enKeys) {
        if (!keys.includes(k)) {
          throw new Error(`语言 ${lang} 缺失 key: ${k}`);
        }
      }
    });
  }
});

describe("translate", () => {
  it("命中当前语言字典", () => {
    expect(translate("zh-Hans", "tab.library")).toBe("文档库");
    expect(translate("ja", "tab.library")).toBe("ライブラリ");
  });

  it("缺失时回退到 en", () => {
    const dict = dictionaries["zh-Hans"];
    const saved = dict["tab.library"];
    delete dict["tab.library"];
    try {
      expect(translate("zh-Hans", "tab.library")).toBe("Library");
    } finally {
      dict["tab.library"] = saved;
    }
  });

  it("en 也缺失时回退到 key 本身", () => {
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });

  it("支持 {var} 占位符", () => {
    expect(translate("en", "reader.wordCount", { count: 42 })).toBe("42 words");
    expect(translate("zh-Hans", "reader.wordCount", { count: 5 })).toBe("5 字");
    expect(translate("en", "settings.index.stats", { docs: 3, chunks: 10 }))
      .toBe("3 documents · 10 chunks");
  });
});
