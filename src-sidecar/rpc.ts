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

/** sidecar → Rust 的反向工具调用请求 */
export interface ToolCallRequestMessage {
  jsonrpc: "2.0";
  id: string | number;
  method: "tool.call";
  params: ToolCallRequest;
}

/** 反向工具调用参数（与 agent/types.ts 的 ToolCallRequest 一致） */
export interface ToolCallRequest {
  tool: string;
  args: unknown;
}

/** Rust → sidecar 的工具调用响应 */
export interface ToolCallResponseMessage {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: RpcError;
}

/** 任意入站消息的联合类型 */
export type InboundMessage =
  | RpcRequest
  | RpcNotification
  | RpcResponse
  | ToolCallResponseMessage;

/** 判断入站消息是否为请求（需要回复） */
export function isRequest(msg: InboundMessage): msg is RpcRequest {
  return (
    "id" in msg &&
    msg.id !== undefined &&
    msg.id !== null &&
    "method" in msg &&
    typeof (msg as { method?: unknown }).method === "string"
  );
}

/** 判断入站消息是否为响应（对 sidecar→Rust 反向调用的回复） */
export function isResponse(
  msg: InboundMessage,
): msg is ToolCallResponseMessage {
  return (
    "id" in msg &&
    msg.id !== undefined &&
    msg.id !== null &&
    !("method" in msg) &&
    ("result" in msg || "error" in msg)
  );
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
  /** 持久字节缓冲，保留跨 data 事件的半行余量 */
  private buffer = "";
  /** 待读的完整行队列（先入先出） */
  private readonly pendingLines: string[] = [];
  /** 等待 readLine 的 resolver 队列 */
  private readonly waiters: Array<(line: string | null) => void> = [];
  private stdinSetup = false;

  async read(): Promise<InboundMessage | null> {
    if (process.stdin.readableEnded) return null;
    const line = await this.readLine();
    if (line === null) return null;
    if (line.trim() === "") return this.read();
    try {
      return JSON.parse(line) as InboundMessage;
    } catch (e) {
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

  /** 逐行读 stdin，返回 null 表示 EOF；多行缓存会按序返回 */
  private readLine(): Promise<string | null> {
    if (this.pendingLines.length > 0) {
      return Promise.resolve(this.pendingLines.shift() ?? null);
    }
    this.ensureStdinListeners();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** 懒挂载 stdin 监听器，只挂一次 */
  private ensureStdinListeners(): void {
    if (this.stdinSetup) return;
    this.stdinSetup = true;

    const onData = (chunk: Buffer): void => {
      this.buffer += this.decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(line);
        } else {
          this.pendingLines.push(line);
        }
      }
    };
    const onEnd = (): void => {
      const rest = this.buffer;
      this.buffer = "";
      // 把残留的最后一行（无换行）也派发出去
      if (rest.length > 0) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(rest);
        else this.pendingLines.push(rest);
      }
      // 剩下的等待者全部返回 null（EOF）
      while (this.waiters.length > 0) {
        this.waiters.shift()?.(null);
      }
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  }
}
