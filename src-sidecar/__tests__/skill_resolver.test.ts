/**
 * skill_resolver 单元测试（阶段 7）
 *
 * 覆盖 routeByUserSkills 的 forced / slash / intent / 未命中 4 条路径。
 * fetchSkillList / fetchSkillBody 涉及反向 RPC，不在单测范围（靠集成测试）。
 */
import { describe, it, expect } from "vitest";
import { routeByUserSkills, type SkillDescriptor } from "../agent/skill_resolver.js";

const skills: SkillDescriptor[] = [
  {
    name: "my-paper",
    description: "论文",
    source: "user",
    slash: "/paper",
    intentKeywords: ["论文", "paper"],
    tools: [],
  },
  {
    name: "novel-x",
    description: "小说",
    source: "user",
    slash: "/novel",
    intentKeywords: ["小说", "novel"],
    tools: ["document_search"],
  },
];

describe("routeByUserSkills", () => {
  it("slash 命中用户 skill", () => {
    const r = routeByUserSkills("/paper 写绪论", skills);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("my-paper");
    expect(r!.routedBy).toBe("slash");
    expect(r!.text).toBe("写绪论");
  });

  it("intent 命中用户 skill", () => {
    const r = routeByUserSkills("帮我写一篇论文", skills);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("my-paper");
    expect(r!.routedBy).toBe("intent");
  });

  it("forced 指定用户 skill", () => {
    const r = routeByUserSkills("写点东西", skills, "novel-x");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("novel-x");
    expect(r!.routedBy).toBe("forced");
  });

  it("forced 与 slash 冲突时标记 override", () => {
    const r = routeByUserSkills("/paper 但我要小说", skills, "novel-x");
    expect(r).not.toBeNull();
    expect(r!.name).toBe("novel-x");
    expect(r!.routedBy).toBe("override");
  });

  it("未命中返回 null（交给内置 router 兜底）", () => {
    const r = routeByUserSkills("今天天气怎么样", skills);
    expect(r).toBeNull();
  });

  it("forced 指向不存在的 skill 时回退到 slash 匹配", () => {
    const r = routeByUserSkills("/paper 绪论", skills, "not-exist");
    // forced 未命中用户 skill → 回退到 slash 匹配
    expect(r).not.toBeNull();
    expect(r!.name).toBe("my-paper");
    expect(r!.routedBy).toBe("slash");
  });

  it("空 skill 列表返回 null", () => {
    const r = routeByUserSkills("/paper 绪论", []);
    expect(r).toBeNull();
  });
});
