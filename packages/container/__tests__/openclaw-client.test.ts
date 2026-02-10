import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenClawClient } from "../src/openclaw-client.js";

// vi.hoisted runs before imports — can't use EventEmitter directly.
// Instead, use __mocks__ pattern: mock ws module with a factory that
// dynamically requires EventEmitter at runtime.
vi.mock("ws", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_url: string) {
      super();
      queueMicrotask(() => this.emit("open"));
    }
  }

  return {
    default: MockWebSocket,
    WebSocket: MockWebSocket,
  };
});

describe("OpenClawClient", () => {
  let client: OpenClawClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new OpenClawClient("ws://localhost:18789", "test-token");
  });

  afterEach(() => {
    client.close();
    vi.useRealTimers();
  });

  it("should connect with token in query string", () => {
    expect(client.gatewayUrl).toBe("ws://localhost:18789/?token=test-token");
  });

  it("should send JSON-RPC request via sendMessage", async () => {
    await vi.advanceTimersByTimeAsync(0);

    const generator = client.sendMessage("user-1", "Hello");
    const resultPromise = generator.next();

    await vi.advanceTimersByTimeAsync(0);

    expect(client.ws?.send).toHaveBeenCalledWith(
      expect.stringContaining('"method"'),
    );

    const sentMsg = JSON.parse(
      (client.ws?.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    );
    expect(sentMsg.jsonrpc).toBe("2.0");
    expect(sentMsg.method).toBe("sendMessage");
    expect(sentMsg.params).toEqual({ userId: "user-1", message: "Hello" });
    expect(typeof sentMsg.id).toBe("number");

    const rpcId = sentMsg.id;
    client.ws?.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "stream_chunk",
        params: { id: rpcId, content: "Hello " },
      }),
    );

    const chunk1 = await resultPromise;
    expect(chunk1.value).toBe("Hello ");
    expect(chunk1.done).toBe(false);

    const chunk2Promise = generator.next();
    client.ws?.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "stream_chunk",
        params: { id: rpcId, content: "world!" },
      }),
    );

    const chunk2 = await chunk2Promise;
    expect(chunk2.value).toBe("world!");

    const endPromise = generator.next();
    client.ws?.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        result: { status: "complete" },
        id: rpcId,
      }),
    );

    const end = await endPromise;
    expect(end.done).toBe(true);
  });

  it("should handle error responses", async () => {
    await vi.advanceTimersByTimeAsync(0);

    const generator = client.sendMessage("user-1", "Hello");
    const resultPromise = generator.next();
    await vi.advanceTimersByTimeAsync(0);

    const sentMsg = JSON.parse(
      (client.ws?.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    );

    client.ws?.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid request" },
        id: sentMsg.id,
      }),
    );

    await expect(resultPromise).rejects.toThrow("Invalid request");
  });

  it("should close the WebSocket connection", async () => {
    await vi.advanceTimersByTimeAsync(0);
    client.close();
    expect(client.ws?.close).toHaveBeenCalled();
  });
});
