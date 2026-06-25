"""文档导入的图片三级降级策略。

Level 3（最优）: LLM vision 模型用自然语言描述图片内容。
Level 2（良好）: 本地 OCR（rapidocr-onnxruntime）提取图片中的文字。
Level 1（兜底）: 原图 base64 data URI 内嵌到 Markdown。

调用方（Rust 侧）通过 JSON-RPC params 传入 api_key + endpoint。
若提供了 api_key，优先尝试 Level 3；失败后依次降级到 Level 2 和 Level 1。
"""

from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


def _is_image_file(filepath: str) -> bool:
    """检查文件是否为支持的图片格式。"""
    ext = os.path.splitext(filepath)[-1].lower()
    return ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif")


def _encode_image_base64(filepath: str) -> str:
    """将图片文件编码为 base64 data URI 字符串。"""
    ext = os.path.splitext(filepath)[-1].lower().lstrip(".")
    mime_map = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "webp": "image/webp",
        "tiff": "image/tiff",
        "tif": "image/tiff",
    }
    mime = mime_map.get(ext, "application/octet-stream")

    with open(filepath, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")

    return f"data:{mime};base64,{data}"


# ============ Level 3: LLM Vision 视觉描述 ============

def _llm_vision_describe(
    image_path: str,
    api_key: str,
    endpoint: str | None = None,
    model: str = "gpt-4o-mini",
) -> str | None:
    """使用 OpenAI 兼容的 vision 模型描述图片内容。

    Returns:
        描述文本，失败时返回 None。
    """
    if not api_key:
        return None

    base_url = (endpoint or "https://api.openai.com/v1").rstrip("/")
    url = f"{base_url}/chat/completions"

    data_uri = _encode_image_base64(image_path)

    # 构造 vision 请求
    payload = json.dumps({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "请详细描述这张图片的内容，使用与周围文本相同的语言。"
                            "描述你看到的内容：物体、文字、布局、图表、示意图等。"
                            "如果图片中有文字，请准确抄录。"
                            "力求简洁但全面。"
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": data_uri},
                    },
                ],
            }
        ],
        "max_tokens": 1000,
        "temperature": 0.1,
    }).encode("utf-8")

    req = Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = (
                result.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if content:
                return f"> [AI 图片描述]\n>\n> {content.strip()}"
            return None
    except (URLError, HTTPError, json.JSONDecodeError, OSError) as e:
        print(f"[converter] LLM vision 调用失败: {e}", file=sys.stderr, flush=True)
        return None


# ============ Level 2: 本地 OCR ============

_ocr_engine = None


def _get_ocr_engine():
    """懒加载 rapidocr-onnxruntime 引擎（单例）。"""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_engine = RapidOCR()
            print("[converter] RapidOCR 引擎已加载", file=sys.stderr, flush=True)
        except ImportError:
            print(
                "[converter] rapidocr-onnxruntime 未安装，OCR 功能已禁用。",
                file=sys.stderr,
                flush=True,
            )
            _ocr_engine = False
    return _ocr_engine if _ocr_engine is not False else None


def _local_ocr_extract(image_path: str) -> str | None:
    """使用 rapidocr-onnxruntime 从图片中提取文字。

    Returns:
        提取的文字，失败时返回 None。
    """
    engine = _get_ocr_engine()
    if engine is None:
        return None

    try:
        result, _ = engine(image_path)
        if result and len(result) > 0:
            lines = [item[1] for item in result if item[1]]
            if lines:
                text = "\n".join(lines)
                return f"> [OCR 识别结果]\n>\n> {text.strip()}"
        return None
    except Exception as e:
        print(f"[converter] OCR 识别失败: {e}", file=sys.stderr, flush=True)
        return None


# ============ 统一入口 ============

def process_image(
    image_path: str,
    *,
    api_key: str | None = None,
    endpoint: str | None = None,
    model: str = "gpt-4o-mini",
    fallback_level: int = 3,
) -> str:
    """按三级降级链处理图片。

    Args:
        image_path: 图片文件路径。
        api_key: OpenAI 兼容的 API 密钥，用于 LLM vision（Level 3）。
        endpoint: API 端点基础 URL。
        model: Vision 模型名称。
        fallback_level: 最大降级等级 (1-3)。

    Returns:
        表示图片的 Markdown 字符串（描述、OCR 文本或 base64 内嵌）。
    """
    if not os.path.isfile(image_path) or not _is_image_file(image_path):
        return ""

    # Level 3: LLM vision 视觉描述
    if fallback_level >= 3 and api_key:
        result = _llm_vision_describe(image_path, api_key, endpoint, model)
        if result:
            return result + "\n\n"
        print(
            "[converter] LLM vision 失败，降级到 OCR",
            file=sys.stderr, flush=True,
        )

    # Level 2: 本地 OCR
    if fallback_level >= 2:
        result = _local_ocr_extract(image_path)
        if result:
            return result + "\n\n"
        print(
            "[converter] OCR 失败，降级到原图内嵌",
            file=sys.stderr, flush=True,
        )

    # Level 1: 原图 base64 内嵌
    data_uri = _encode_image_base64(image_path)
    filename = os.path.basename(image_path)
    return f"![{filename}]({data_uri})\n\n"
