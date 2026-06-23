/**
 * FlowMark Node Sidecar 入口
 *
 * 阶段 1 范围：
 *   - 实现 JSON-RPC 2.0 协议层（rpc.ts）
 *   - 注册最小方法集：ping
 *   - 维持进程运行直到 stdin EOF 或收到 shutdown
 *
 * 后续阶段 4 扩展：
 *   - agent.run（流式 LangChain）
 *   - agent.cancel
 *   - tool.call（转发到 Rust）
 *
 * 设计模式：
 *   - 策略模式：RpcTransport 抽象通信通道
 *   - 命令模式：每个 method 是一个 handler 函数，注册表统一分发
 *   - 模板方法：mainLoop 描述消息处理骨架，具体方法由 dispatch 决定
 */

import { StdioTransport, isRequest, ErrorCode, type RpcRequest, type RpcResponse, type InboundMessage } from "./rpc.js";

/** 方法处理器签名：接收请求，返回结果或抛错 */
type MethodHandler = (params: unknown) => Promise<unknown>;

/** 方法注册表（命令模式） */
const handlers = new Map<string, MethodHandler>();

/** 注册一个方法 */
function register(method: string, handler: MethodHandler): void {
  handlers.set(method, handler);
}

// ============ 阶段 1 方法实现 ============

/**
 * ping - 健康检查
 * 返回 sidecar 版本与运行时信息，供 Rust 验证链路
 */
register("ping", async () => {
  return {
    pong: true,
    sidecarVersion: "1.0.0",
    nodeVersion: process.version,
    timestamp: Date.now(),
  };
});

/**
 * shutdown - 优雅退出
 * 调用方在结束前发这个，避免 Rust 侧直接 kill
 */
register("shutdown", async () => {
  log("收到 shutdown，准备退出");
  setTimeout(() => process.exit(0), 50);
  return { ok: true };
});

// ============ 分发与主循环 ============

/** 分发单条请求到对应 handler，返回响应（通知返回 null） */
async function dispatch(msg: InboundMessage): Promise<RpcResponse | null> {
  if (!isRequest(msg)) {
    // 通知：暂不处理，记日志后忽略
    log(`收到通知（不回复）: ${msg.method}`);
    return null;
  }

  const req = msg as RpcRequest;
  const handler = handlers.get(req.method);
  if (!handler) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: ErrorCode.METHOD_NOT_FOUND,
        message: `未知方法: ${req.method}`,
      },
    };
  }

  try {
    const result = await handler(req.params);
    return { jsonrpc: "2.0", id: req.id, result };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: (e as Error).message ?? String(e),
      },
    };
  }
}

/** 统一日志输出到 stderr（不污染 stdout 的 JSON-RPC 通道） */
function log(msg: string): void {
  process.stderr.write(`[sidecar] ${msg}\n`);
}

/** 主循环：读消息 → 分发 → 写响应，直到 EOF */
async function mainLoop(): Promise<void> {
  const transport = new StdioTransport();
  log(`sidecar 启动，node ${process.version}`);

  while (true) {
    const msg = await transport.read();
    if (msg === null) {
      log("stdin EOF，退出主循环");
      break;
    }
    const resp = await dispatch(msg);
    if (resp) {
      await transport.write(resp);
    }
  }

  process.exit(0);
}

// 捕获未处理异常，避免进程静默崩溃
process.on("uncaughtException", (e) => {
  log(`未捕获异常: ${e.stack ?? e.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log(`未处理的 Promise rejection: ${String(reason)}`);
  process.exit(1);
});

mainLoop().catch((e) => {
  log(`主循环异常: ${e}`);
  process.exit(1);
});
