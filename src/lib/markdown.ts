/**
 * Markdown 渲染与规整(阶段 6.6)
 *
 * 对齐 iOS MarkdownRenderNormalizer + MarkdownPreview:
 *   - normalizeRenderContent:规整 Agent 输出(去 markdown 包裹围栏、修 Mermaid/PlantUML 围栏、裸 PlantUML 收拢)
 *   - renderMarkdown:marked + marked-highlight + highlight.js + KaTeX 渲染
 *   - Mermaid/PlantUML 在渲染后由前端异步处理(见 useMarkdownRender)
 *
 * 设计:纯函数,无副作用,便于 vitest 镜像 iOS MarkdownPreviewParserTests
 */

import { marked } from "marked";
import hljs from "highlight.js";
import katex from "katex";

// 配置 marked 一次(全单例)
let markedConfigured = false;

function ensureMarkedConfigured(): void {
  if (markedConfigured) return;
  // 自定义 renderer:Mermaid / PlantUML 用占位 div,普通代码用 highlight.js 高亮
  // 不用 markedHighlight,因为 marked v18 的 MarkedExtension 类型与 markedHighlight 2.2 的
  // SynchronousOptions 在 emptyLangClass 字段上有冲突(见 marked.d.ts MarkedExtension)
  const renderer = {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = (lang ?? "").trim();
      if (language === "mermaid") {
        return `<div class="diagram mermaid" data-source="${escapeAttr(text)}"></div>`;
      }
      if (language === "plantuml" || language === "puml") {
        return `<div class="diagram plantuml" data-source="${escapeAttr(text)}"></div>`;
      }
      const hl = highlightCode(text, language);
      const cls = language ? ` class="hljs language-${language}"` : ' class="hljs"';
      return `<pre><code${cls}>${hl}</code></pre>`;
    },
  };
  marked.use({ renderer });
  markedConfigured = true;
}

/** 高亮代码(highlight.js,与原 markedHighlight 行为对齐) */
function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // 忽略高亮失败
    }
  }
  return hljs.highlightAuto(code).value;
}

/** 转义属性值,防止注入 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 行内 KaTeX 占位(渲染后由前端替换) */
function renderInlineMath(src: string): string {
  // $...$ 行内(非贪婪,且不跨行)
  return src.replace(/\$([^$\n]+)\$/g, (_m, expr: string) => {
    try {
      return katex.renderToString(expr, { throwOnError: false, displayMode: false });
    } catch {
      return `$${expr}$`;
    }
  });
}

/** 块级 KaTeX $$...$$ */
function renderBlockMath(src: string): string {
  return src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), { throwOnError: false, displayMode: true });
    } catch {
      return `$$${expr}$$`;
    }
  });
}

/**
 * 渲染 Markdown 为 HTML
 *
 * 流程:
 *   1. 块级 KaTeX($$...$$)
 *   2. marked(含代码高亮 + Mermaid/PlantUML 占位)
 *   3. 行内 KaTeX($...$)
 *
 * Mermaid / PlantUML 占位 div 由 useMarkdownRender 异步替换成实际图。
 */
export function renderMarkdown(src: string): string {
  ensureMarkedConfigured();
  const withBlockMath = renderBlockMath(src);
  const html = marked.parse(withBlockMath, { async: false }) as string;
  return renderInlineMath(html);
}

// ============ 规整器(对齐 iOS MarkdownRenderNormalizer) ============

/**
 * 规整 Agent 输出便于预览
 *
 * 对齐 iOS MarkdownRenderNormalizer:
 *   - 去掉外层 markdown 包裹围栏(```markdown ... ``` 之类)
 *   - 修 Mermaid/PlantUML 围栏(确保有语言标识)
 *   - 裸 PlantUML(@startuml ... @enduml)收拢成 ```plantuml 围栏块
 *   - 去掉首尾多余空白
 */
export function normalizeRenderContent(src: string): string {
  let s = src;

  // 1. 去外层 ```markdown / ```md 包裹围栏
  const fenceMatch = s.match(/^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    s = fenceMatch[1] ?? "";
  }

  // 2. 裸 PlantUML 收拢成围栏块
  s = collapseBarePlantUml(s);

  // 3. 修 Mermaid/PlantUML 围栏:确保语言标识齐全
  // 匹配 ```mermaid / ```plantuml / ```puml 大小写不敏感,无内容时给空 body
  s = s.replace(/```(mermaid|plantuml|puml)\s*\n([\s\S]*?)```/gi, (_m, lang: string, body: string) => {
    const l = lang.toLowerCase() === "puml" ? "plantuml" : lang.toLowerCase();
    return "```" + l + "\n" + body.trimEnd() + "\n```";
  });

  return s.trim();
}

/**
 * 把裸的 @startuml ... @enduml 收拢成 ```plantuml 围栏块
 *
 * 对齐 iOS MarkdownRenderNormalizer 收拢裸 PlantUML 的逻辑
 */
export function collapseBarePlantUml(src: string): string {
  // 已经在围栏里的不处理(粗略判断:同一行前面有 ```)
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  let inPlantBlock = false;
  let plantBuf: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      // 收尾时若还在 plantBuf 状态,先 flush
      if (inPlantBlock && !inFence) {
        // 这是 plantuml 围栏的关闭行,直接透传
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // 不在围栏里
    if (/^@startuml\b/i.test(trimmed)) {
      inPlantBlock = true;
      plantBuf = [line];
      continue;
    }
    if (inPlantBlock) {
      plantBuf.push(line);
      if (/^@enduml\b/i.test(trimmed)) {
        // 收拢成围栏块
        out.push("```plantuml");
        out.push(...plantBuf);
        out.push("```");
        inPlantBlock = false;
        plantBuf = [];
      }
      continue;
    }
    out.push(line);
  }
  // 末尾未闭合的 plantuml 也收拢(避免丢失)
  if (inPlantBlock && plantBuf.length > 0) {
    out.push("```plantuml");
    out.push(...plantBuf);
    out.push("```");
  }
  return out.join("\n");
}
