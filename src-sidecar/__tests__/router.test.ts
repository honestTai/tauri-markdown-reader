/**
 * Router 单元测试
 *
 * 对齐 iOS AgentRouterTests：slash / intent / default / forced / override
 */
import { describe, it, expect } from "vitest";
import { route, stripSlashPrefix, LAUNCH_SKILLS } from "../agent/router.js";

describe("stripSlashPrefix", () => {
  it("无 slash 的输入原样返回", () => {
    const r = stripSlashPrefix("hello world");
    expect(r.text).toBe("hello world");
    expect(r.slash).toBeNull();
  });

  it("剥离 /cmd 前缀", () => {
    const r = stripSlashPrefix("/translate hello");
    expect(r.slash).toBe("/translate");
    expect(r.text).toBe("hello");
  });

  it("仅 /cmd 无后续文本", () => {
    const r = stripSlashPrefix("/chat");
    expect(r.slash).toBe("/chat");
    expect(r.text).toBe("");
  });

  it("非 slash 开头的不剥离", () => {
    const r = stripSlashPrefix("see /cmd");
    expect(r.slash).toBeNull();
  });
});

describe("route - slash 别名", () => {
  it("/translate 路由到 translate skill", () => {
    const r = route("/translate hello world", "general");
    expect(r.skill).toBe("translate");
    expect(r.routedBy).toBe("slash");
    expect(r.text).toBe("hello world");
  });

  it("/小说 路由到 novel skill", () => {
    const r = route("/小说 一段故事", "general");
    expect(r.skill).toBe("novel");
    expect(r.routedBy).toBe("slash");
  });

  it("未知 slash 命令回退到 default", () => {
    const r = route("/unknown xxx", "general");
    expect(r.routedBy).toBe("default");
    expect(r.skill).toBe("chat");
  });
});

describe("route - intent 关键词", () => {
  it("含「翻译」路由到 translate", () => {
    const r = route("请翻译这段话", "general");
    expect(r.skill).toBe("translate");
    expect(r.routedBy).toBe("intent");
  });

  it("含「论文」路由到 academic", () => {
    const r = route("帮我写论文摘要", "general");
    expect(r.skill).toBe("academic");
    expect(r.routedBy).toBe("intent");
  });

  it("含「ppt」路由到 presentation", () => {
    const r = route("做一个 ppt 大纲", "general");
    expect(r.skill).toBe("presentation");
    expect(r.routedBy).toBe("intent");
  });
});

describe("route - profile default", () => {
  it("general profile 默认 chat", () => {
    const r = route("随便聊聊", "general");
    expect(r.skill).toBe("chat");
    expect(r.routedBy).toBe("default");
  });

  it("academic profile 默认 academic", () => {
    const r = route("一段无关键词的输入", "academic");
    expect(r.skill).toBe("academic");
    expect(r.routedBy).toBe("default");
  });

  it("novel profile 默认 novel", () => {
    const r = route("一段无关键词的输入", "novel");
    expect(r.skill).toBe("novel");
  });

  it("html profile 默认 htmlAuthor", () => {
    const r = route("一段无关键词的输入", "html");
    expect(r.skill).toBe("htmlAuthor");
  });
});

describe("route - forced / override", () => {
  it("forced 直接覆盖 default", () => {
    const r = route("随便聊聊", "general", "academic");
    expect(r.skill).toBe("academic");
    expect(r.routedBy).toBe("forced");
  });

  it("forced 与 slash 冲突时为 override", () => {
    const r = route("/translate hello", "general", "chat");
    expect(r.skill).toBe("chat");
    expect(r.routedBy).toBe("override");
  });

  it("forced 与 slash 一致时为 forced", () => {
    const r = route("/translate hello", "general", "translate");
    expect(r.skill).toBe("translate");
    expect(r.routedBy).toBe("forced");
  });
});

describe("LAUNCH_SKILLS", () => {
  it("包含 6 个默认 skill", () => {
    expect(LAUNCH_SKILLS).toHaveLength(6);
    expect(LAUNCH_SKILLS).toContain("chat");
    expect(LAUNCH_SKILLS).toContain("academic");
    expect(LAUNCH_SKILLS).toContain("novel");
    expect(LAUNCH_SKILLS).toContain("htmlAuthor");
    expect(LAUNCH_SKILLS).toContain("presentation");
    expect(LAUNCH_SKILLS).toContain("compare");
  });
});
