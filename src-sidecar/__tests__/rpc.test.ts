/**
 * JSON-RPC 协议层单元测试
 * 验证 isRequest 判断与错误码定义
 */
import { describe, it, expect } from "vitest";
import { isRequest, ErrorCode } from "../rpc.js";

describe("isRequest", () => {
  it("带 id 的消息识别为请求", () => {
    expect(isRequest({ jsonrpc: "2.0", id: "1", method: "ping" })).toBe(true);
    expect(isRequest({ jsonrpc: "2.0", id: 42, method: "ping" })).toBe(true);
  });

  it("无 id 的消息识别为通知", () => {
    expect(isRequest({ jsonrpc: "2.0", method: "notify" })).toBe(false);
  });
});

describe("ErrorCode", () => {
  it("JSON-RPC 标准错误码值正确", () => {
    expect(ErrorCode.PARSE_ERROR).toBe(-32700);
    expect(ErrorCode.INVALID_REQUEST).toBe(-32600);
    expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601);
    expect(ErrorCode.INVALID_PARAMS).toBe(-32602);
    expect(ErrorCode.INTERNAL_ERROR).toBe(-32603);
  });
});
