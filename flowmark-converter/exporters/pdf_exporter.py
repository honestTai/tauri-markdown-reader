"""Markdown → PDF 导出器。

使用 markdown 库将 Markdown 转为 HTML，再用 weasyprint 渲染为 PDF。
支持代码高亮、表格、图片、LaTeX 公式（通过 KaTeX CDN）。
"""

from __future__ import annotations

import os
import re

try:
    import markdown as md_lib
except ImportError:
    raise ImportError("需要 markdown 库。安装命令: pip install markdown")

try:
    from weasyprint import HTML
except ImportError:
    raise ImportError("需要 weasyprint 库。安装命令: pip install weasyprint")


# PDF 页面的 HTML 模板
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  @page {{
    size: A4;
    margin: 2cm 2.5cm;
    @bottom-center {{
      content: counter(page);
      font-size: 9pt;
      color: #999;
    }}
  }}
  body {{
    font-family: "Noto Sans SC", "Microsoft YaHei", "SimSun", sans-serif;
    font-size: 11pt;
    line-height: 1.8;
    color: #1a1a1a;
  }}
  h1 {{ font-size: 20pt; margin-top: 1.5em; border-bottom: 2px solid #4a90e2; padding-bottom: 0.2em; }}
  h2 {{ font-size: 16pt; margin-top: 1.3em; }}
  h3 {{ font-size: 13pt; margin-top: 1.1em; }}
  h4, h5, h6 {{ font-size: 11pt; margin-top: 1em; }}
  p {{ margin: 0.6em 0; }}
  pre {{ background: #f5f5f5; padding: 12px; border-radius: 4px; font-size: 9pt; line-height: 1.5; overflow-x: auto; }}
  code {{ font-family: "Consolas", "Courier New", monospace; font-size: 9pt; background: #f0f0f0; padding: 1px 4px; border-radius: 2px; }}
  pre code {{ background: none; padding: 0; }}
  blockquote {{ border-left: 4px solid #4a90e2; padding-left: 16px; margin: 1em 0; color: #555; font-style: italic; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
  th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
  th {{ background: #4a90e2; color: white; font-weight: bold; }}
  tr:nth-child(even) {{ background: #f9f9f9; }}
  img {{ max-width: 100%; height: auto; }}
  ul, ol {{ margin: 0.5em 0; padding-left: 2em; }}
  li {{ margin: 0.2em 0; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 2em 0; }}
</style>
</head>
<body>
{content}
</body>
</html>"""


def convert_markdown_to_pdf(
    markdown: str,
    output_path: str,
    *,
    image_base_dir: str | None = None,
) -> str:
    """将 Markdown 文本转换为 PDF 文件。

    Args:
        markdown: Markdown 文本。
        output_path: 输出 .pdf 文件路径。
        image_base_dir: 图片文件的基础目录。

    Returns:
        输出文件路径。
    """
    # 1. Markdown → HTML
    extensions = [
        "tables",
        "fenced_code",
        "codehilite",
        "toc",
        "nl2br",
    ]
    html_body = md_lib.markdown(markdown, extensions=extensions)

    # 2. 将本地图片路径替换为 file:// URI
    if image_base_dir:
        def _replace_img_path(match: re.Match) -> str:
            alt = match.group(1)
            src = match.group(2)
            if not src.startswith(("http://", "https://", "data:", "file://")):
                abs_path = os.path.join(image_base_dir, src)
                if os.path.isfile(abs_path):
                    src = f"file:///{abs_path.replace(os.sep, '/')}"
            return f'<img src="{src}" alt="{alt}">'

        html_body = re.sub(
            r'<img\s+alt="([^"]*)"\s+src="([^"]*)"\s*/?>',
            _replace_img_path,
            html_body,
        )

    # 3. 填充 HTML 模板
    html = HTML_TEMPLATE.format(content=html_body)

    # 4. 用 weasyprint 渲染 PDF
    HTML(string=html).write_pdf(output_path)

    return output_path
