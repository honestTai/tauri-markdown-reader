"""FlowMark Converter - JSON-RPC 2.0 stdio transport layer.

Reads one JSON object per line from stdin, writes one JSON object per line to stdout.
Protocol: each line is a complete JSON-RPC message (request, response, or notification).
"""

import json
import sys
from typing import Any


class StdioTransport:
    """stdin/stdout line-delimited JSON transport."""

    def read_message(self) -> dict[str, Any] | None:
        """从 stdin 读取一条 JSON-RPC 消息。EOF 时返回 None。"""
        try:
            line = sys.stdin.readline()
            if not line:
                return None
            line = line.strip()
            if not line:
                return self.read_message()
            return json.loads(line)
        except json.JSONDecodeError as e:
            self._log(f"Invalid JSON on stdin: {e}")
            return None
        except EOFError:
            return None

    def write_message(self, msg: dict[str, Any]) -> None:
        """将一条 JSON-RPC 消息写入 stdout。"""
        line = json.dumps(msg, ensure_ascii=False, default=str)
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    def write_error(self, id_val: Any, code: int, message: str) -> None:
        """写入 JSON-RPC 错误响应。"""
        self.write_message({
            "jsonrpc": "2.0",
            "id": id_val,
            "error": {"code": code, "message": message},
        })

    def write_result(self, id_val: Any, result: Any) -> None:
        """写入 JSON-RPC 成功响应。"""
        self.write_message({
            "jsonrpc": "2.0",
            "id": id_val,
            "result": result,
        })

    @staticmethod
    def _log(msg: str) -> None:
        """日志输出到 stderr（stdout 仅用于 JSON-RPC 通信）。"""
        print(f"[converter] {msg}", file=sys.stderr, flush=True)
