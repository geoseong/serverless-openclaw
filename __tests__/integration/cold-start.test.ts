/**
 * Cold Start Measurement — Integration Test
 *
 * Connects to the deployed WebSocket API, sends "Hello!", and measures
 * the time from message send to first AI response (stream_chunk).
 *
 * Prerequisites:
 *   - .env with: HTTP_API_URL, WEBSOCKET_URL, COGNITO_USER_POOL_ID,
 *     COGNITO_CLIENT_ID, TEST_USERNAME, TEST_PASSWORD
 *   - Deployed environment (all 8 CDK stacks)
 *
 * Run:
 *   npm run test:integration
 */
import { describe, it, expect, beforeAll } from "vitest";
import WebSocket from "ws";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

// ── Env ─────────────────────────────────────────────────────────────
const HTTP_API_URL = process.env.HTTP_API_URL ?? "";
const WEBSOCKET_URL = process.env.WEBSOCKET_URL ?? "";
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? "";
const TEST_USERNAME = process.env.TEST_USERNAME ?? "";
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "";

const STATUS_POLL_INTERVAL_MS = 30_000; // 30s between status polls
const STATUS_POLL_MAX_MS = 35 * 60_000; // 35min max wait for idle
const RESPONSE_TIMEOUT_MS = 5 * 60_000; // 5min for AI response

// ── Helpers ─────────────────────────────────────────────────────────

function authenticate(): Promise<string> {
  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    });
    const user = new CognitoUser({ Username: TEST_USERNAME, Pool: pool });
    const authDetails = new AuthenticationDetails({
      Username: TEST_USERNAME,
      Password: TEST_PASSWORD,
    });
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(err),
    });
  });
}

async function getStatus(token: string): Promise<string> {
  const resp = await fetch(`${HTTP_API_URL}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`GET /status → ${resp.status}`);
  const body = (await resp.json()) as { status?: string };
  return body.status ?? "idle";
}

function connectWs(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const sep = WEBSOCKET_URL.includes("?") ? "&" : "?";
    const ws = new WebSocket(`${WEBSOCKET_URL}${sep}token=${token}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => reject(err));
  });
}

interface TimedMessage {
  ts: number;
  msg: Record<string, unknown>;
}

function collectMessages(ws: WebSocket): TimedMessage[] {
  const messages: TimedMessage[] = [];
  ws.on("message", (data) => {
    try {
      messages.push({ ts: Date.now(), msg: JSON.parse(data.toString()) });
    } catch {
      // ignore non-JSON
    }
  });
  return messages;
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<TimedMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`)),
      timeoutMs,
    );
    const handler = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve({ ts: Date.now(), msg });
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", handler);
  });
}

// ── Test ─────────────────────────────────────────────────────────────

describe("Cold Start Measurement", () => {
  let idToken: string;

  beforeAll(() => {
    const missing = [
      ["HTTP_API_URL", HTTP_API_URL],
      ["WEBSOCKET_URL", WEBSOCKET_URL],
      ["COGNITO_USER_POOL_ID", COGNITO_USER_POOL_ID],
      ["COGNITO_CLIENT_ID", COGNITO_CLIENT_ID],
      ["TEST_USERNAME", TEST_USERNAME],
      ["TEST_PASSWORD", TEST_PASSWORD],
    ].filter(([, v]) => !v);

    if (missing.length > 0) {
      throw new Error(
        `Missing env vars: ${missing.map(([k]) => k).join(", ")}. ` +
          "Add them to .env and run: npm run test:integration",
      );
    }
  });

  it("should authenticate with Cognito", async () => {
    console.log("Authenticating with Cognito...");
    idToken = await authenticate();
    expect(idToken).toBeTruthy();
    console.log("Authenticated successfully");
  });

  it("should wait for container to be idle (cold start condition)", async () => {
    const status = await getStatus(idToken);
    console.log(`Current container status: ${status}`);

    if (status === "Running" || status === "Starting") {
      console.log(
        "Container is active. Waiting for idle " +
          `(polling every ${STATUS_POLL_INTERVAL_MS / 1000}s, max ${STATUS_POLL_MAX_MS / 60_000}min)...`,
      );
      const deadline = Date.now() + STATUS_POLL_MAX_MS;
      let current = status;

      while (current !== "idle" && current !== "Idle" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
        current = await getStatus(idToken);
        const elapsed = ((Date.now() + STATUS_POLL_MAX_MS - deadline) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] Status: ${current}`);
      }

      if (current !== "idle" && current !== "Idle") {
        throw new Error(`Container did not become idle within ${STATUS_POLL_MAX_MS / 60_000}min`);
      }
    }

    console.log("Container is idle — ready for cold start measurement");
  });

  it("should measure cold start time", async () => {
    // Connect WebSocket
    console.log("Connecting to WebSocket...");
    const ws = await connectWs(idToken);
    const messages = collectMessages(ws);

    try {
      // Start timer and send message
      const t0 = Date.now();
      console.log(`\nSending "Hello!" at ${new Date(t0).toISOString()}`);
      ws.send(JSON.stringify({ action: "sendMessage", message: "Hello!" }));

      // Wait for "Starting" status push (Lambda sends this on cold start)
      const startingPromise = waitForMessage(
        ws,
        (m) =>
          m.type === "status" &&
          (m.status === "Starting" || m.status === "starting"),
        30_000,
      ).catch(() => null); // may not arrive if container is warm

      const startingMsg = await startingPromise;
      if (startingMsg) {
        const tStarting = startingMsg.ts - t0;
        console.log(`  "Starting" status received: +${tStarting}ms`);
      }

      // Wait for first AI content (stream_chunk or stream_end)
      console.log("Waiting for AI response (container startup + inference)...");
      const firstContent = await waitForMessage(
        ws,
        (m) =>
          m.type === "stream_chunk" ||
          m.type === "stream_end" ||
          (m.type === "message" && typeof m.content === "string" && m.content.length > 0),
        RESPONSE_TIMEOUT_MS,
      );
      const tFirstResponse = firstContent.ts - t0;

      // Wait for stream_end if we got a chunk
      let tStreamEnd = tFirstResponse;
      let fullContent = String(firstContent.msg.content ?? "");

      if (firstContent.msg.type === "stream_chunk") {
        const endMsg = await waitForMessage(
          ws,
          (m) => m.type === "stream_end",
          120_000,
        );
        tStreamEnd = endMsg.ts - t0;
        fullContent = String(endMsg.msg.content ?? fullContent);
      }

      // Report results
      console.log("\n╔══════════════════════════════════════════════╗");
      console.log("║       Cold Start Measurement Results         ║");
      console.log("╠══════════════════════════════════════════════╣");
      console.log(`║  First response:  ${formatMs(tFirstResponse).padStart(10)} (${formatSec(tFirstResponse)})`);
      console.log(`║  Stream complete: ${formatMs(tStreamEnd).padStart(10)} (${formatSec(tStreamEnd)})`);
      console.log(`║  Messages total:  ${String(messages.length).padStart(10)}`);
      console.log("╠══════════════════════════════════════════════╣");
      console.log(`║  Response: ${(fullContent || "").slice(0, 35).padEnd(35)}║`);
      console.log("╚══════════════════════════════════════════════╝\n");

      // Timeline
      console.log("Timeline:");
      for (const { ts, msg } of messages) {
        const delta = ts - t0;
        const type = msg.type ?? msg.status ?? "unknown";
        const preview = msg.content ? String(msg.content).slice(0, 60) : "";
        console.log(`  +${formatMs(delta).padStart(8)}  ${String(type).padEnd(14)} ${preview}`);
      }

      expect(tFirstResponse).toBeGreaterThan(0);
      expect(fullContent.length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });
});

function formatMs(ms: number): string {
  return `${ms}ms`;
}

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
