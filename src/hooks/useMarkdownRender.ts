/**
 * useMarkdownRender:把 Markdown 字符串渲染成 HTML,并异步替换 Mermaid / PlantUML 占位
 *
 * 流程:
 *   1. normalizeRenderContent(src) 规整
 *   2. renderMarkdown(...) 产出带占位 div 的 HTML
 *   3. React 渲染后,useEffect 扫 .diagram.mermaid / .diagram.plantuml 节点,异步替换
 *
 * Mermaid 用动态 import('mermaid') 避免首屏体积;PlantUML 用 plantumlPngUrl 直接 img。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, normalizeRenderContent } from "../lib/markdown.js";
import { plantumlSvgUrl } from "../lib/plantuml.js";

export interface UseMarkdownRender {
  html: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  diagramError: string | null;
}

export function useMarkdownRender(src: string): UseMarkdownRender {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  const html = useMemo(() => {
    try {
      const normalized = normalizeRenderContent(src ?? "");
      return renderMarkdown(normalized);
    } catch (e) {
      setDiagramError((e as Error).message ?? String(e));
      return `<pre>${String(src)}</pre>`;
    }
  }, [src]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    let cancelled = false;

    async function renderDiagrams() {
      // Mermaid
      const mermaidNodes = root!.querySelectorAll<HTMLElement>(".diagram.mermaid");
      if (mermaidNodes.length > 0) {
        try {
          const mermaid = (await import("mermaid")).default;
          mermaid.initialize({ startOnLoad: false, theme: "neutral" });
          for (const node of mermaidNodes) {
            if (cancelled) return;
            const source = node.getAttribute("data-source") ?? "";
            try {
              const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
              const { svg } = await mermaid.render(id, source);
              if (cancelled) return;
              node.innerHTML = svg;
            } catch (e) {
              node.innerHTML = `<pre class="diagram-error">${escapeHtml(String((e as Error).message ?? e))}</pre>`;
            }
          }
        } catch (e) {
          if (!cancelled) setDiagramError(`Mermaid 加载失败: ${(e as Error).message}`);
        }
      }

      // PlantUML(用 SVG URL,直接 img)
      const plantNodes = root!.querySelectorAll<HTMLElement>(".diagram.plantuml");
      for (const node of plantNodes) {
        if (cancelled) return;
        const source = node.getAttribute("data-source") ?? "";
        const url = plantumlSvgUrl(source);
        node.innerHTML = `<img src="${url}" alt="PlantUML diagram" class="plantuml-img" />`;
      }
    }

    void renderDiagrams();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return { html, containerRef, diagramError };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
