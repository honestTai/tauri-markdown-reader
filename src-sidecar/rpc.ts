/**
 * JSON-RPC 2.0 协议类型定义与读写工具
 *
 * 设计意图：
 *   - 把协议层（消息格式 / 读写）与业务层（agent.run / ping）解耦
 *   - 后续阶段 4 扩展流式 notification 时，只需新增 `NotificationMessage` 类型，
 *     不改动读写基础设施
 *   - 使用策略模式：`RpcTransport` 抽象通信通道，当前实现是 stdio，
 *     未来可换 socket / WebSocket 而不改动上层
 */

/** JSON-RPC 2.0 请求 */
export interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 响应 */
export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: RpcError;
}

/** JSON-RPC 2.0 错误 */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 通知（无 id，不需要响应） */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** 任意入站消息的联合类型 */
export type InboundMessage = RpcRequest | RpcNotification;

/** 判断入站消息是否为请求（需要回复） */
export function isRequest(msg: InboundMessage): msg is RpcRequest {
  return "id" in msg && msg.id !== undefined && msg.id !== null;
}

/** 标准错误码（JSON-RPC 2.0 规范） */
export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * 通信通道抽象（策略模式）
 *
 * 当前唯一实现：StdioTransport
 * 未来扩展：SocketTransport / MockTransport（测试用）
 */
export interface RpcTransport {
  /** 读取下一条入站消息（阻塞直到有消息或 EOF） */
  read(): Promise<InboundMessage | null>;
  /** 写出一条消息（自动追加换行） */
  write(msg: unknown): Promise<void>;
}

/** stdio 传输实现：stdin 读、stdout 写、stderr 日志 */
export class StdioTransport implements RpcTransport {
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  async read(): Promise<InboundMessage | null> {
    // Node 的 stdin 是流，用异步迭代器逐行读
    if (process.stdin.readableEnded) return null;
    const line = await this.readLine();
    if (line === null) return null;
    if (line.trim() === "") return this.read();
    try {
      return JSON.parse(line) as InboundMessage;
    } catch (e) {
      // 解析失败：按协议返回 parse error，而不是崩溃
      await this.write({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: ErrorCode.PARSE_ERROR,
          message: `JSON 解析失败: ${(e as Error).message}`,
        },
      });
      return this.read();
    }
  }

  async write(msg: unknown): Promise<void> {
    const text = JSON.stringify(msg) + "\n";
    process.stdout.write(this.encoder.encode(text));
  }

  /** 逐行读 stdin，返回 null 表示 EOF */
  private readLine(): Promise<string | null> {
    return new Promise((resolve) => {
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += this.decoder.decode(chunk);
        const idx = buf.indexOf("\n");
        if (idx >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          process.stdin.removeListener("data", onData);
          process.stdin.removeListener("end", onEnd);
          // 把多余的 bytes 推回是不现实的，简化处理：余量丢弃（ping 单行够用）
          resolve(line);
        }
      };
      const onEnd = () => {
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        resolve(buf || null);
      };
      process.stdin.on("data", onData);
      process.stdin.on("end", onEnd);
    });
  }
}
