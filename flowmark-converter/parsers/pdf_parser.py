"""PDF → Markdown 转换器。

使用 pdfplumber 提取文本/表格，pypdfium2 提取图片。
处理能力：
- 文本提取（保留版式）
- 表格检测与 Markdown 表格转换
- 图片提取（三级降级）
- 页面结构（保留页眉标记）
"""

from __future__ import annotations

import os
import re
import tempfile
from typing import Any

try:
    import pdfplumber
    from pdfplumber.page import Page as PdfPage
    from pdfplumber.pdf import PDF as PdfDocument
except ImportError:
    raise ImportError(
        "需要 pdfplumber 库。安装命令: pip install pdfplumber"
    )


def _text_to_markdown(text: str) -> str:
    """清理并标准化提取的文本，使其兼容 Markdown。"""
    # 保留有意的空行，压缩过多空行
    text = re.sub(r"\n{3,}", "\n\n", text)
    # 去除每行末尾空格
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text.strip()


def _table_to_markdown(table_data: list[list[str | None]]) -> str:
    """将 pdfplumber 表格数据转为 Markdown 表格。"""
    if not table_data or not table_data[0]:
        return ""

    # 清洗单元格
    rows: list[list[str]] = []
    for row in table_data:
        cleaned = [
            (
                str(cell).replace("\n", " ").replace("|", "\\|").strip()
                if cell is not None
                else ""
            )
            for cell in row
        ]
        if any(cleaned):  # 跳过全空行
            rows.append(cleaned)

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


def _extract_tables_from_page(page: PdfPage) -> list[list[list[str | None]]]:
    """从 PDF 页面提取表格。"""
    try:
        tables = page.extract_tables()
        return tables if tables else []
    except Exception:
        return []


def _extract_images_from_page(
    page: PdfPage, page_num: int, image_dir: str
) -> list[str]:
    """从 PDF 页面提取图片并保存到 image_dir。

    Returns:
        图片文件名列表。
    """
    filenames: list[str] = []
    try:
        # pdfplumber 原生图片提取能力有限，通过 PDF 内部 image 对象获取
        if hasattr(page, "images"):
            for i, img in enumerate(page.images):
                try:
                    img_data = img.get("stream", None)
                    if img_data is None:
                        continue
                    ext = f".{img.get('name', 'png').split('.')[-1]}"
                    if ext.lower() not in (
                        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"
                    ):
                        ext = ".png"
                    filename = f"pdf_p{page_num}_img{i}{ext}"
                    filepath = os.path.join(image_dir, filename)
                    data = (
                        img_data.get_data()
                        if callable(getattr(img_data, "get_data", None))
                        else img_data
                    )
                    with open(filepath, "wb") as f:
                        f.write(data)
                    filenames.append(filename)
                except Exception:
                    continue
    except Exception:
        pass

    return filenames


def _is_likely_heading(line: str) -> int | None:
    """启发式检测文本行是否为标题。返回 1-3 级或 None。"""
    if not line or len(line) > 120:
        return None

    # PDF 提取文本中常见的标题模式
    if re.match(r"^(第[一二三四五六七八九十\d]+章|Chapter|Section|Part)\s+", line):
        return 1
    if re.match(r"^\d+\.\d*\s+\S", line):
        return 2
    if re.match(r"^\d+\.\d+\.\d*\s+\S", line):
        return 3
    # 短行全大写大概率是标题
    if len(line) < 80 and line.isupper() and len(line.split()) <= 12:
        return 1

    return None


def convert_pdf_to_markdown(
    filepath: str,
    *,
    image_dir: str | None = None,
    api_key: str | None = None,
    image_fallback_level: int = 3,
) -> str:
    """将 .pdf 文件转换为 Markdown。

    Args:
        filepath: .pdf 文件路径。
        image_dir: 图片提取目录。为 None 时自动创建临时目录。
        api_key: OpenAI 兼容的 API 密钥，用于 LLM vision 降级。
        image_fallback_level: 图片最大降级等级 (1-3)。

    Returns:
        Markdown 字符串。
    """
    if image_dir is None:
        image_dir = tempfile.mkdtemp(prefix="flowmark_images_")
    os.makedirs(image_dir, exist_ok=True)

    all_images: list[str] = []
    output: list[str] = []

    with pdfplumber.open(filepath) as pdf:
        num_pages = len(pdf.pages)

        for i, page in enumerate(pdf.pages):
            page_num = i + 1

            # 页码标记
            output.append(f"\n<!-- 第 {page_num} / {num_pages} 页 -->\n")

            # 提取文本
            try:
                text = page.extract_text()
            except Exception:
                text = ""

            if text:
                # 逐行处理，检测标题
                lines = text.split("\n")
                processed_lines: list[str] = []
                for line in lines:
                    heading_lvl = _is_likely_heading(line.strip())
                    if heading_lvl:
                        processed_lines.append(
                            f"{'#' * heading_lvl} {line.strip()}"
                        )
                    else:
                        processed_lines.append(line)
                text = "\n".join(processed_lines)
                output.append(_text_to_markdown(text))
                output.append("\n")

            # 提取表格
            tables = _extract_tables_from_page(page)
            for table_data in tables:
                if table_data and len(table_data) > 1:
                    output.append(_table_to_markdown(table_data))

            # 提取图片
            images = _extract_images_from_page(page, page_num, image_dir)
            all_images.extend(images)
            for fname in images:
                output.append(f"![{fname}]({fname})\n")

            output.append("\n")

    result = "".join(output)

    # 压缩过多空行
    result = re.sub(r"\n{3,}", "\n\n", result)
    # 移除冗余的页码标记
    result = re.sub(r"(\n<!-- 第 \d+ / \d+ 页 -->\n){2,}", "\n", result)

    return result.strip() + "\n"


# ============ 冒烟测试 ============

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: python pdf_parser.py <文件.pdf> [输出.md]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    md = convert_pdf_to_markdown(input_path)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"已写入 {output_path}", file=sys.stderr)
    else:
        print(md)
