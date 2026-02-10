import WebSocket from "ws";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "@serverless-openclaw/shared";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  chunks: string[];
  chunkResolve: ((value: IteratorResult<string>) => void) | null;
  chunkReject: ((reason: Error) => void) | null;
}

export class OpenClawClient {
  readonly gatewayUrl: string;
  ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(baseUrl: string, token: string) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    this.gatewayUrl = `${baseUrl}/${separator}token=${token}`;
    this.connect();
  }

  private connect(): void {
    this.ws = new WebSocket(this.gatewayUrl);

    this.ws.on("message", (raw: WebSocket.Data) => {
      const msg = JSON.parse(raw.toString()) as
        | JsonRpcResponse
        | JsonRpcNotification;

      // Stream chunk notification
      if ("method" in msg && msg.method === "stream_chunk") {
        const params = msg.params as { id: number; content: string };
        const pending = this.pending.get(params.id);
        if (pending) {
          if (pending.chunkResolve) {
            const resolve = pending.chunkResolve;
            pending.chunkResolve = null;
            pending.chunkReject = null;
            resolve({ value: params.content, done: false });
          } else {
            pending.chunks.push(params.content);
          }
        }
        return;
      }

      // JSON-RPC response (success or error) — stream end
      if ("id" in msg) {
        const response = msg as JsonRpcResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.error) {
            const err = new Error(response.error.message);
            if (pending.chunkReject) {
              const reject = pending.chunkReject;
              pending.chunkResolve = null;
              pending.chunkReject = null;
              reject(err);
            }
            pending.reject(err);
          } else {
            if (pending.chunkResolve) {
              const resolve = pending.chunkResolve;
              pending.chunkResolve = null;
              pending.chunkReject = null;
              resolve({ value: undefined as unknown as string, done: true });
            }
            pending.resolve(response.result);
          }
        }
      }
    });
  }

  async *sendMessage(
    userId: string,
    message: string,
  ): AsyncGenerator<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method: "sendMessage",
      params: { userId, message },
      id,
    };

    const pending: PendingRequest = {
      resolve: () => {},
      reject: () => {},
      chunks: [],
      chunkResolve: null,
      chunkReject: null,
    };

    const completionPromise = new Promise<unknown>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });

    this.pending.set(id, pending);
    this.ws.send(JSON.stringify(request));

    // Yield chunks as they arrive
    while (true) {
      if (pending.chunks.length > 0) {
        yield pending.chunks.shift()!;
        continue;
      }

      // Wait for next chunk or completion
      const result = await Promise.race([
        new Promise<IteratorResult<string>>((resolve, reject) => {
          pending.chunkResolve = resolve;
          pending.chunkReject = reject;
        }),
        completionPromise.then(
          () => ({ value: undefined as unknown as string, done: true }) as IteratorResult<string>,
          (err) => { throw err; },
        ),
      ]);

      if (result.done) {
        return;
      }
      yield result.value;
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}
