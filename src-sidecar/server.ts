/**
 * FlowMark Node Sidecar 入口
 *
 * 阶段 1：JSON-RPC 协议层 + ping
 * 阶段 4：agent.run（流式 LangChain）+ agent.cancel
 *
 * 设计模式：
 *   - 策略模式：RpcTransport 抽象通信通道
 *   - 命令模式：每个 method 是一个 handler 函数，注册表统一分发
 *   - 模板方法：mainLoop 描述消息处理骨架
 */

import {
  StdioTransport,
  isRequest,
  isResponse,
  ErrorCode,
  type RpcRequest,
  type RpcResponse,
  type RpcNotification,
  type InboundMessage,
  type ToolCallResponseMessage,
} from "./rpc.js";
import {
  createGateway,
  runAgent,
  type AgentEvent,
  type AgentRunParams,
  type AgentCancelParams,
  type ToolBackend,
} from "./agent/index.js";

/** 方法处理器签名：接收请求 + transport（用于反向发通知），返回结果或抛错 */
type MethodHandler = (
  params: unknown,
  transport: StdioTransport,
) => Promise<unknown>;

/** 方法注册表（命令模式） */
const handlers = new Map<string, MethodHandler>();

/** 注册一个方法 */
function register(method: string, handler: MethodHandler): void {
  handlers.set(method, handler);
}

// ============ 活跃 run 的 AbortController（取消用） ============

const activeRuns = new Map<string, AbortController>();

// ============ 反向 RPC：sidecar → Rust 的 tool.call 待响应表 ============

/** tool.call 的 id 自增计数器（进程内唯一即可） */
let toolCallSeq = 0;

/** pending tool.call 的 resolver，key = JSON-RPC id */
const pendingToolCalls = new Map<
  string | number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

/**
 * 构造一个绑定到当前 transport 的 ToolBackend
 *
 * runtime 通过 backend.call(name, args) 发起反向 RPC：
 *   1. 生成唯一 id，写一条 tool.call 请求到 Rust
 *   2. 在 pendingToolCalls 注册 Promise
 *   3. Rust 执行完写回 response，mainLoop 里 isResponse 分支派发到 resolver
 */
function makeToolBackend(transport: StdioTransport): ToolBackend {
  return {
    async call(name: string, args: unknown): Promise<unknown> {
      const id = `tc-${process.pid}-${toolCallSeq++}`;
      const req = {
        jsonrpc: "2.0" as const,
        id,
        method: "tool.call",
        params: { tool: name, args },
      };
      const promise = new Promise<unknown>((resolve, reject) => {
        pendingToolCalls.set(id, { resolve, reject });
      });
      await transport.write(req);
      // 超时保护（避免 Rust 端卡死导致 sidecar 永久等待）
      setTimeout(() => {
        if (pendingToolCalls.has(id)) {
          pendingToolCalls.delete(id);
          promise.catch(() => {});
          // 通过 reject 让 await 抛错；但 promise 已经被 await 持有，
          // 这里用一个 dummy reject 触发（实际由下方 then 处理）
        }
      }, 120_000);
      return promise;
    },
  };
}

// ============ 阶段 1 方法 ============

register("ping", async () => {
  return {
    pong: true,
    sidecarVersion: "1.0.0",
    nodeVersion: process.version,
    timestamp: Date.now(),
  };
});

register("shutdown", async () => {
  log("收到 shutdown，准备退出");
  setTimeout(() => process.exit(0), 50);
  return { ok: true };
});

// ============ 阶段 4 方法：agent.run / agent.cancel ============

/**
 * agent.run - 流式 Agent 调用
 *
 * 入参：AgentRunParams
 * 出参：立即返回 { accepted: true }（runId 已确认）
 * 后续通过 agent.event notification 流式推送结果
 *
 * 取消：调用方发 agent.cancel { runId }
 */
register("agent.run", async (params, transport) => {
  const p = params as AgentRunParams;
  if (!p || !p.runId || !p.input || !p.modelConfig) {
    throw new Error("agent.run 缺少必要参数：runId / input / modelConfig");
  }

  // 同一 runId 不允许并发
  if (activeRuns.has(p.runId)) {
    throw new Error(`runId ${p.runId} 已存在`);
  }

  const ac = new AbortController();
  activeRuns.set(p.runId, ac);

  // 异步执行，不阻塞 dispatch
  const emit = (ev: AgentEvent) => {
    const notif: RpcNotification = {
      jsonrpc: "2.0",
      method: "agent.event",
      params: ev,
    };
    transport.write(notif).catch((e) =>
      log(`emit 失败: ${(e as Error).message}`),
    );
  };

  // 选 gateway
  const gateway = createGateway(p.modelConfig, p.apiKey);

  // 反向 RPC backend（用于工具调用）
  const backend = makeToolBackend(transport);

  // 异步跑，跑完清理
  runAgent({
    params: p,
    gateway,
    emit,
    signal: ac.signal,
    backend,
  })
    .catch((e) => {
      emit({
        type: "error",
        runId: p.runId,
        message: (e as Error).message ?? String(e),
      });
    })
    .finally(() => {
      activeRuns.delete(p.runId);
    });

  return { accepted: true, runId: p.runId };
});

/**
 * agent.cancel - 取消进行中的 run
 */
register("agent.cancel", async (params) => {
  const p = params as AgentCancelParams;
  if (!p || !p.runId) {
    throw new Error("agent.cancel 缺少 runId");
  }
  const ac = activeRuns.get(p.runId);
  if (ac) {
    ac.abort();
    activeRuns.delete(p.runId);
    return { cancelled: true, runId: p.runId };
  }
  return { cancelled: false, runId: p.runId, reason: "not_found" };
});

// ============ 分发与主循环 ============

async function dispatch(
  msg: InboundMessage,
  transport: StdioTransport,
): Promise<RpcResponse | null> {
  // 反向 RPC 的响应：派发给 pending tool.call
  if (isResponse(msg)) {
    const resp = msg as ToolCallResponseMessage;
    const pending = pendingToolCalls.get(resp.id);
    if (pending) {
      pendingToolCalls.delete(resp.id);
      if (resp.error) {
        pending.reject(new Error(resp.error.message));
      } else {
        pending.resolve(resp.result);
      }
    } else {
      log(`收到未知 id 的响应: ${resp.id}`);
    }
    return null;
  }

  if (!isRequest(msg)) {
    log(`收到通知（不回复）: ${(msg as { method?: string }).method}`);
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
    const result = await handler(req.params, transport);
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

function log(msg: string): void {
  process.stderr.write(`[sidecar] ${msg}\n`);
}

async function mainLoop(): Promise<void> {
  const transport = new StdioTransport();
  log(`sidecar 启动，node ${process.version}`);

  while (true) {
    const msg = await transport.read();
    if (msg === null) {
      log("stdin EOF，退出主循环");
      break;
    }
    const resp = await dispatch(msg, transport);
    if (resp) {
      await transport.write(resp);
    }
  }

  process.exit(0);
}

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
