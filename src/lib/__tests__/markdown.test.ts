/**
 * markdown 渲染与规整单测(阶段 6.6)
 *
 * 对齐 iOS MarkdownPreviewParserTests:
 *   - normalizeRenderContent:去外层围栏、修 Mermaid/PlantUML、收拢裸 PlantUML
 *   - renderMarkdown:基础渲染(代码高亮 / Mermaid 占位 / KaTeX)
 */
import { describe, it, expect } from "vitest";
import {
  normalizeRenderContent,
  collapseBarePlantUml,
  renderMarkdown,
} from "../markdown.js";

describe("normalizeRenderContent", () => {
  it("去掉外层 ```markdown 包裹", () => {
    const src = "```markdown\n# 标题\n正文\n```";
    expect(normalizeRenderContent(src)).toBe("# 标题\n正文");
  });

  it("去掉外层 ```md 包裹", () => {
    const src = "```md\n# Hello\n```";
    expect(normalizeRenderContent(src)).toBe("# Hello");
  });

  it("无围栏时原样返回(仅 trim)", () => {
    expect(normalizeRenderContent("# 标题\n正文")).toBe("# 标题\n正文");
  });

  it("修 Mermaid 围栏语言大小写", () => {
    const src = "```MERMAID\ngraph TD\nA-->B\n```";
    const out = normalizeRenderContent(src);
    expect(out).toContain("```mermaid");
  });

  it("修 puml → plantuml", () => {
    const src = "```puml\n@startuml\ns->t\n@enduml\n```";
    const out = normalizeRenderContent(src);
    expect(out).toContain("```plantuml");
    expect(out).not.toContain("```puml");
  });
});

describe("collapseBarePlantUml", () => {
  it("把裸 @startuml/@enduml 收拢成围栏块", () => {
    const src = "前面\n@startuml\nA -> B\n@enduml\n后面";
    const out = collapseBarePlantUml(src);
    expect(out).toContain("```plantuml");
    expect(out).toContain("@startuml");
    expect(out).toContain("@enduml");
    expect(out).toContain("后面");
  });

  it("已在围栏里的不重复收拢", () => {
    const src = "```plantuml\n@startuml\nA->B\n@enduml\n```";
    const out = collapseBarePlantUml(src);
    expect(out.match(/```plantuml/g)?.length).toBe(1);
  });

  it("未闭合的 @startuml 末尾也收拢", () => {
    const src = "@startuml\nA->B";
    const out = collapseBarePlantUml(src);
    expect(out).toContain("```plantuml");
  });
});

describe("renderMarkdown", () => {
  it("渲染标题与段落", () => {
    const html = renderMarkdown("# 标题\n正文");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<p>正文</p>");
  });

  it("代码块高亮且加 hljs class", () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain("hljs");
  });

  it("Mermaid 块输出占位 div", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\nA-->B\n```");
    expect(html).toContain('class="diagram mermaid"');
  });

  it("PlantUML 块输出占位 div", () => {
    const html = renderMarkdown("```plantuml\n@startuml\nA->B\n@enduml\n```");
    expect(html).toContain('class="diagram plantuml"');
  });

  it("行内 KaTeX 渲染", () => {
    const html = renderMarkdown("公式 $a^2 + b^2 = c^2$");
    expect(html).toContain("katex");
  });

  it("块级 KaTeX 渲染", () => {
    const html = renderMarkdown("$$\na^2 + b^2 = c^2\n$$");
    expect(html).toContain("katex");
  });
});
