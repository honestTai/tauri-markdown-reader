"""Word (.docx) → Markdown 转换器。

处理能力：
- 段落（基于样式检测标题级别 Heading 1-6）
- 粗体、斜体、下划线、删除线等内联格式
- 超链接
- 表格（转为 Markdown 表格）
- 图片：提取到临时目录，在 Markdown 中引用
- 列表（有序/无序）
- MathType 公式（OMML 提取）

图片三级降级由 image_handler 模块统一处理。
"""

from __future__ import annotations

import os
import re
import tempfile
from typing import Any

try:
    from docx import Document as DocxDocument
    from docx.document import Document as DocxDocType
    from docx.table import Table as DocxTable
    from docx.text.paragraph import Paragraph as DocxParagraph
    from docx.text.run import Run
except ImportError:
    raise ImportError(
        "需要 python-docx 库。安装命令: pip install python-docx"
    )

# OMML 命名空间，用于检测 MathType 公式
OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"


def _extract_omml_as_text(omml_elem) -> str:
    """提取 OMML 数学公式的文本表示。"""
    parts: list[str] = []
    for elem in omml_elem.iter():
        if elem.text:
            parts.append(elem.text.strip())
        if elem.tail:
            parts.append(elem.tail.strip())
    text = " ".join(p for p in parts if p)
    if text:
        return f"$$\n{text}\n$$"
    return r"$$\text{[公式]}$$"


def _extract_math_elements(paragraph: DocxParagraph) -> list[str]:
    """从段落中查找并提取 OMML 数学公式。"""
    formulas: list[str] = []
    for elem in paragraph._element.iter():
        tag_local = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag_local in ("oMath", "oMathPara"):
            formulas.append(_extract_omml_as_text(elem))
    return formulas


def _detect_heading_level(paragraph: DocxParagraph) -> int | None:
    """根据段落样式检测标题级别。"""
    if paragraph.style is None:
        return None
    name = (paragraph.style.name or "").lower()

    # 匹配 "Heading 1" ~ "Heading 6" 及常见本地化变体
    for level in range(1, 7):
        if f"heading {level}" in name:
            return level
        if f"标题 {level}" in name:  # 中文
            return level
        if f"見出し {level}" in name:  # 日文
            return level

    # 尝试读取大纲级别（部分 ParagraphFormat 无此属性）
    try:
        outline_lvl = paragraph.paragraph_format.outline_level
        if outline_lvl is not None and 0 <= outline_lvl <= 8:
            return min(outline_lvl + 1, 6)
    except AttributeError:
        pass

    return None


def _is_list_item(paragraph: DocxParagraph) -> str | None:
    """检测段落是否为列表项。'-' 表示无序，'1.' 表示有序，None 表示不是列表。"""
    if paragraph.style is None:
        return None
    name = (paragraph.style.name or "").lower()
    if "list bullet" in name:
        return "-"
    if "list number" in name:
        return "1."

    # 检查 OOXML numPr 元素（直接编号）
    numPr = paragraph._element.find(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr/"
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}numPr"
    )
    if numPr is not None:
        # 保守策略：有编号标记的统一视为有序列表
        numId = numPr.find(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}numId"
        )
        if numId is not None:
            return "1."
    return None


def _format_run_text(run: Run) -> str:
    """对 run 文本应用 Markdown 内联格式。"""
    text = run.text
    if not text:
        return ""

    if run.bold:
        text = f"**{text}**"
    if run.italic:
        text = f"*{text}*"
    if run.underline:
        text = f"<u>{text}</u>"
    if run.font.strike:
        text = f"~~{text}~~"

    return text


def _paragraph_to_markdown(paragraph: DocxParagraph) -> str:
    """将单个段落转为 Markdown。"""
    # 优先检查数学公式
    formulas = _extract_math_elements(paragraph)
    if formulas:
        return "\n\n".join(formulas) + "\n"

    # 检查标题
    heading_level = _detect_heading_level(paragraph)
    if heading_level is not None:
        text_parts: list[str] = []
        for run in paragraph.runs:
            text_parts.append(_format_run_text(run))
        text = "".join(text_parts).strip()
        if text:
            return f"{'#' * heading_level} {text}\n\n"
        return ""

    # 拼接所有 run 的文本（含超链接）
    parts: list[str] = []
    for run in paragraph.runs:
        parts.append(_format_run_text(run))

    text = "".join(parts).strip()

    if not text:
        return "\n"

    # 列表项
    list_marker = _is_list_item(paragraph)
    if list_marker == "-":
        return f"- {text}\n"
    if list_marker == "1.":
        return f"1. {text}\n"

    return f"{text}\n\n"


def _table_to_markdown(table: DocxTable) -> str:
    """将 Word 表格转为 Markdown 表格。"""
    rows: list[list[str]] = []
    for row in table.rows:
        cells: list[str] = []
        for cell in row.cells:
            cell_text = " ".join(
                p.text.strip() for p in cell.paragraphs if p.text.strip()
            )
            # 转义表格中可能冲突的竖线字符
            cell_text = cell_text.replace("|", "\\|").replace("\n", " ")
            cells.append(cell_text)
        rows.append(cells)

    if not rows:
        return ""

    # 补齐列数不一致的行
    max_cols = max(len(r) for r in rows)
    for r in rows:
        while len(r) < max_cols:
            r.append("")

    lines: list[str] = []
    # 表头
    lines.append("| " + " | ".join(rows[0]) + " |")
    # 分隔行
    lines.append("|" + "|".join("---" for _ in range(max_cols)) + "|")
    # 数据行
    for row in rows[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines) + "\n\n"


def _extract_images_from_docx(docx: DocxDocType, image_dir: str) -> dict[str, str]:
    """提取 docx 中嵌入的图片并保存到 image_dir。

    Returns:
        rId → 相对图片路径 的映射字典。
    """
    image_map: dict[str, str] = {}
    try:
        for rel in docx.part.rels.values():
            if "image" in rel.reltype:
                image_data = rel.target_part.blob
                ext = os.path.splitext(rel.target_part.partname)[-1] or ".png"
                if ext.lower() not in (
                    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"
                ):
                    ext = ".png"

                r_id = rel.rId
                filename = f"img_{r_id.replace('rId', '')}{ext}"
                filepath = os.path.join(image_dir, filename)

                with open(filepath, "wb") as f:
                    f.write(image_data)

                image_map[r_id] = filename
    except Exception:
        pass  # 部分 docx 文件的 rels 可能已损坏

    return image_map


def _insert_image_references(content: str, image_map: dict[str, str]) -> str:
    """在 Markdown 末尾追加提取的图片引用。"""
    if not image_map:
        return content

    refs: list[str] = []
    for _r_id, filename in sorted(image_map.items()):
        refs.append(f"![{filename}]({filename})")

    if refs:
        content += "\n\n---\n\n## 提取的图片\n\n"
        content += "\n\n".join(refs) + "\n"

    return content


def convert_docx_to_markdown(
    filepath: str,
    *,
    image_dir: str | None = None,
    api_key: str | None = None,
    image_fallback_level: int = 3,
) -> str:
    """将 .docx 文件转换为 Markdown。

    Args:
        filepath: .docx 文件路径。
        image_dir: 图片提取目录。为 None 时自动创建临时目录。
        api_key: OpenAI 兼容的 API 密钥，用于 LLM vision 降级（Level 3）。
        image_fallback_level: 图片最大降级等级:
            1 = 原图 base64 内嵌
            2 = 本地 OCR（rapidocr-onnxruntime）
            3 = LLM vision 描述（需 api_key）

    Returns:
        Markdown 字符串。
    """
    if image_dir is None:
        image_dir = tempfile.mkdtemp(prefix="flowmark_images_")
    os.makedirs(image_dir, exist_ok=True)

    docx = DocxDocument(filepath)
    image_map = _extract_images_from_docx(docx, image_dir)

    # 按顺序遍历 body 中的所有元素（段落 + 表格）
    body = docx.element.body
    output: list[str] = []

    for child in body:
        tag_local = child.tag.split("}")[-1] if "}" in child.tag else child.tag

        if tag_local == "p":
            # 段落
            para = DocxParagraph(child, docx)
            output.append(_paragraph_to_markdown(para))

        elif tag_local == "tbl":
            # 表格：匹配对应的 DocxTable 对象
            tbl = None
            for t in docx.tables:
                if t._element is child:
                    tbl = t
                    break
            if tbl is not None:
                output.append(_table_to_markdown(tbl))

    result = "".join(output)

    # 压缩过多的空行
    result = re.sub(r"\n{3,}", "\n\n", result)

    # 追加图片引用
    result = _insert_image_references(result, image_map)

    return result.strip() + "\n"


# ============ 冒烟测试 ============

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: python docx_parser.py <文件.docx> [输出.md]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    md = convert_docx_to_markdown(input_path)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"已写入 {output_path}", file=sys.stderr)
    else:
        print(md)
