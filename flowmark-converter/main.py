"""
FlowMark Converter — 文档导入/导出的 Python sidecar。

JSON-RPC 2.0 stdio 服务器。每行一个 JSON 对象。

支持的方法:
  - ping                    健康检查
  - shutdown                优雅退出
  - convert.docx_to_md      将 .docx 转为 Markdown
  - convert.pdf_to_md       将 .pdf 转为 Markdown
  - convert.md_to_docx      将 Markdown 转为 .docx（Part 3 实现）
  - convert.md_to_pdf       将 Markdown 转为 .pdf（Part 3 实现）

协议格式:
  请求:  {"jsonrpc":"2.0","id":"...","method":"...","params":{...}}
  响应:  {"jsonrpc":"2.0","id":"...","result":{...}}
         {"jsonrpc":"2.0","id":"...","error":{"code":...,"message":"..."}}
"""

from __future__ import annotations

import sys
import traceback
from typing import Any

from rpc import StdioTransport
from parsers.docx_parser import convert_docx_to_markdown
from parsers.pdf_parser import convert_pdf_to_markdown
from exporters.word_exporter import convert_markdown_to_docx
from exporters.pdf_exporter import convert_markdown_to_pdf


# JSON-RPC 2.0 标准错误码
ERROR_PARSE = -32700
ERROR_INVALID_REQUEST = -32600
ERROR_METHOD_NOT_FOUND = -32601
ERROR_INVALID_PARAMS = -32602
ERROR_INTERNAL = -32603


def handle_ping(_params: dict[str, Any]) -> dict[str, Any]:
    """健康检查。"""
    return {
        "pong": True,
        "converterVersion": "1.0.0",
        "pythonVersion": sys.version,
    }


def handle_shutdown(_params: dict[str, Any]) -> dict[str, Any]:
    """优雅退出。"""
    import threading

    def _exit():
        sys.exit(0)

    threading.Timer(0.1, _exit).start()
    return {"ok": True}


def handle_convert_docx_to_md(params: dict[str, Any]) -> dict[str, Any]:
    """将 .docx 文件转为 Markdown。"""
    filepath = params.get("filePath") or params.get("filepath")
    if not filepath:
        raise ValueError("缺少必要参数: filePath")

    api_key = params.get("apiKey")
    endpoint = params.get("endpoint")
    image_dir = params.get("imageDir")
    fallback_level = params.get("imageFallbackLevel", 3)

    markdown = convert_docx_to_markdown(
        filepath,
        image_dir=image_dir,
        api_key=api_key,
        image_fallback_level=fallback_level,
    )

    return {
        "markdown": markdown,
        "format": "docx",
        "sourceFile": filepath,
    }


def handle_convert_pdf_to_md(params: dict[str, Any]) -> dict[str, Any]:
    """将 .pdf 文件转为 Markdown。"""
    filepath = params.get("filePath") or params.get("filepath")
    if not filepath:
        raise ValueError("缺少必要参数: filePath")

    api_key = params.get("apiKey")
    endpoint = params.get("endpoint")
    image_dir = params.get("imageDir")
    fallback_level = params.get("imageFallbackLevel", 3)

    markdown = convert_pdf_to_markdown(
        filepath,
        image_dir=image_dir,
        api_key=api_key,
        image_fallback_level=fallback_level,
    )

    return {
        "markdown": markdown,
        "format": "pdf",
        "sourceFile": filepath,
    }


def handle_convert_md_to_docx(params: dict[str, Any]) -> dict[str, Any]:
    """将 Markdown 转为 .docx。"""
    markdown = params.get("markdown")
    if not markdown:
        raise ValueError("缺少必要参数: markdown")

    output_path = params.get("outputPath")
    if not output_path:
        raise ValueError("缺少必要参数: outputPath")

    image_base_dir = params.get("imageBaseDir")

    convert_markdown_to_docx(
        markdown,
        output_path,
        image_base_dir=image_base_dir,
    )

    return {
        "outputPath": output_path,
        "format": "docx",
    }


def handle_convert_md_to_pdf(params: dict[str, Any]) -> dict[str, Any]:
    """将 Markdown 转为 .pdf。"""
    markdown = params.get("markdown")
    if not markdown:
        raise ValueError("缺少必要参数: markdown")

    output_path = params.get("outputPath")
    if not output_path:
        raise ValueError("缺少必要参数: outputPath")

    image_base_dir = params.get("imageBaseDir")

    convert_markdown_to_pdf(
        markdown,
        output_path,
        image_base_dir=image_base_dir,
    )

    return {
        "outputPath": output_path,
        "format": "pdf",
    }


# 方法路由表
HANDLERS: dict[str, Any] = {
    "ping": handle_ping,
    "shutdown": handle_shutdown,
    "convert.docx_to_md": handle_convert_docx_to_md,
    "convert.pdf_to_md": handle_convert_pdf_to_md,
    "convert.md_to_docx": handle_convert_md_to_docx,
    "convert.md_to_pdf": handle_convert_md_to_pdf,
}


def dispatch(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """将方法调用路由到对应的处理器。"""
    handler = HANDLERS.get(method)
    if handler is None:
        raise ValueError(f"未知方法: {method}")
    return handler(params)


def main_loop() -> None:
    """JSON-RPC 主循环：从 stdin 读取请求，分发处理，将响应写入 stdout。"""
    transport = StdioTransport()
    print("[converter] FlowMark Converter 已启动", file=sys.stderr, flush=True)

    while True:
        msg = transport.read_message()
        if msg is None:
            print("[converter] stdin 已关闭，退出", file=sys.stderr, flush=True)
            break

        # 校验 JSON-RPC 格式
        if msg.get("jsonrpc") != "2.0":
            transport.write_error(
                msg.get("id"), ERROR_INVALID_REQUEST, "jsonrpc 必须为 '2.0'"
            )
            continue

        method = msg.get("method")
        req_id = msg.get("id")

        if not method:
            transport.write_error(req_id, ERROR_INVALID_REQUEST, "缺少 method")
            continue

        params = msg.get("params", {})
        if not isinstance(params, dict):
            params = {}

        try:
            result = dispatch(method, params)
            transport.write_result(req_id, result)
        except ValueError as e:
            transport.write_error(
                req_id,
                (
                    ERROR_METHOD_NOT_FOUND
                    if "未知方法" in str(e)
                    else ERROR_INVALID_PARAMS
                ),
                str(e),
            )
        except NotImplementedError as e:
            transport.write_error(req_id, ERROR_METHOD_NOT_FOUND, str(e))
        except Exception as e:
            print(f"[converter] 内部错误: {e}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            transport.write_error(req_id, ERROR_INTERNAL, str(e))

    sys.exit(0)


if __name__ == "__main__":
    main_loop()
