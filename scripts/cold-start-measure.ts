#!/usr/bin/env npx tsx
/**
 * Cold Start Measurement Script
 *
 * Authenticates via Cognito, connects WebSocket, sends "Hello!",
 * and measures the time from message send to first AI response.
 *
 * Usage:
 *   npx tsx scripts/cold-start-measure.ts            # wait for idle if container is active
 *   npx tsx scripts/cold-start-measure.ts --no-wait  # skip idle wait (warm start measurement)
 *
 * Required .env vars:
 *   HTTP_API_URL, WEBSOCKET_URL, COGNITO_USER_POOL_ID,
 *   COGNITO_CLIENT_ID, TEST_USERNAME, TEST_PASSWORD
 */
import WebSocket from "ws";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

// ── Config ──────────────────────────────────────────────────────────

const HTTP_API_URL = env("HTTP_API_URL");
const WEBSOCKET_URL = env("WEBSOCKET_URL");
const COGNITO_USER_POOL_ID = env("COGNITO_USER_POOL_ID");
const COGNITO_CLIENT_ID = env("COGNITO_CLIENT_ID");
const TEST_USERNAME = env("TEST_USERNAME");
const TEST_PASSWORD = env("TEST_PASSWORD");

const SKIP_IDLE_WAIT = process.argv.includes("--no-wait");
const STATUS_POLL_INTERVAL_MS = 30_000;
const STATUS_POLL_MAX_MS = 35 * 60_000;
const RESPONSE_TIMEOUT_MS = 5 * 60_000;

// ── Helpers ─────────────────────────────────────────────────────────

function env(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing env var: ${key}. Add it to .env`);
    process.exit(1);
  }
  return val;
}

function formatMs(ms: number): string {
  return `${ms}ms`;
}

function formatSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function authenticate(): Promise<string> {
  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({
      UserPoolId: COGNITO_USER_POOL_ID,
      ClientId: COGNITO_CLIENT_ID,
    });
    const user = new CognitoUser({ Username: TEST_USERNAME, Pool: pool });
    const auth = new AuthenticationDetails({
      Username: TEST_USERNAME,
      Password: TEST_PASSWORD,
    });
    user.authenticateUser(auth, {
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

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Cold Start Measurement ===\n");

  // 1. Authenticate
  console.log("1. Authenticating with Cognito...");
  const idToken = await authenticate();
  console.log("   Authenticated successfully\n");

  // 2. Check container status
  console.log("2. Checking container status...");
  let status = await getStatus(idToken);
  console.log(`   Current status: ${status}`);

  if (!SKIP_IDLE_WAIT && (status === "Running" || status === "Starting")) {
    console.log(
      `   Waiting for idle (polling every ${STATUS_POLL_INTERVAL_MS / 1000}s, ` +
        `max ${STATUS_POLL_MAX_MS / 60_000}min)...`,
    );
    const deadline = Date.now() + STATUS_POLL_MAX_MS;

    while (status !== "idle" && status !== "Idle" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
      status = await getStatus(idToken);
      const elapsed = ((Date.now() + STATUS_POLL_MAX_MS - deadline) / 1000).toFixed(0);
      console.log(`   [${elapsed}s] Status: ${status}`);
    }

    if (status !== "idle" && status !== "Idle") {
      console.error(`Container did not become idle within ${STATUS_POLL_MAX_MS / 60_000}min`);
      process.exit(1);
    }
  }

  const startType = status === "idle" || status === "Idle" ? "COLD" : "WARM";
  console.log(`   Start type: ${startType}\n`);

  // 3. Connect WebSocket
  console.log("3. Connecting WebSocket...");
  const ws = await connectWs(idToken);
  const messages = collectMessages(ws);
  console.log("   Connected\n");

  try {
    // 4. Send message and measure
    const t0 = Date.now();
    console.log(`4. Sending "Hello!" at ${new Date(t0).toISOString()}`);
    ws.send(JSON.stringify({ action: "sendMessage", message: "Hello!" }));

    // Wait for "Starting" status
    const startingMsg = await waitForMessage(
      ws,
      (m) =>
        m.type === "status" &&
        (m.status === "Starting" || m.status === "starting"),
      30_000,
    ).catch(() => null);

    if (startingMsg) {
      console.log(`   "Starting" status: +${startingMsg.ts - t0}ms`);
    }

    // Wait for first AI response
    console.log("   Waiting for AI response...");
    const firstContent = await waitForMessage(
      ws,
      (m) =>
        m.type === "stream_chunk" ||
        m.type === "stream_end" ||
        (m.type === "message" &&
          typeof m.content === "string" &&
          m.content.length > 0),
      RESPONSE_TIMEOUT_MS,
    );
    const tFirstResponse = firstContent.ts - t0;

    // Wait for stream_end
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

    // 5. Results
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║         Cold Start Measurement Results           ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  Start type:      ${startType.padStart(10)}                     ║`);
    console.log(`║  First response:  ${formatMs(tFirstResponse).padStart(10)} (${formatSec(tFirstResponse).padStart(6)})            ║`);
    console.log(`║  Stream complete: ${formatMs(tStreamEnd).padStart(10)} (${formatSec(tStreamEnd).padStart(6)})            ║`);
    console.log(`║  Messages total:  ${String(messages.length).padStart(10)}                     ║`);
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  Response: ${(fullContent || "").slice(0, 37).padEnd(37)} ║`);
    console.log("╚══════════════════════════════════════════════════╝");

    // Timeline
    console.log("\nTimeline:");
    for (const { ts, msg } of messages) {
      const delta = ts - t0;
      const type = String(msg.type ?? msg.status ?? "unknown");
      const preview = msg.content ? String(msg.content).slice(0, 60) : "";
      console.log(
        `  +${formatMs(delta).padStart(8)}  ${type.padEnd(14)} ${preview}`,
      );
    }
    console.log("");
  } finally {
    ws.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
