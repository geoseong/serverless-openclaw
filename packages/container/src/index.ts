import * as net from "net";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BRIDGE_PORT } from "@serverless-openclaw/shared";
import { createApp } from "./bridge.js";
import { CallbackSender } from "./callback-sender.js";
import { OpenClawClient } from "./openclaw-client.js";
import { LifecycleManager } from "./lifecycle.js";
import { consumePendingMessages } from "./pending-messages.js";
import { restoreFromS3 } from "./s3-sync.js";
import type { PendingMessageItem } from "@serverless-openclaw/shared";

const REQUIRED_ENV = [
  "BRIDGE_AUTH_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "USER_ID",
  "DATA_BUCKET",
  "CALLBACK_URL",
] as const;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function getTaskArn(): Promise<string> {
  // Prefer env var if set, otherwise discover from ECS metadata
  if (process.env.TASK_ARN) return process.env.TASK_ARN;
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (metadataUri) {
    const resp = await fetch(`${metadataUri}/task`);
    const data = (await resp.json()) as { TaskARN?: string };
    if (data.TaskARN) return data.TaskARN;
  }
  throw new Error("Cannot determine TASK_ARN from env or ECS metadata");
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function tryConnect(): void {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    }
    tryConnect();
  });
}

async function notifyTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Non-fatal — startup notifications are best-effort
  }
}

function getTelegramChatId(userId: string): string | null {
  return userId.startsWith("telegram:") ? userId.slice(9) : null;
}

async function main(): Promise<void> {
  // Validate required env vars
  const env = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, requireEnv(name)]),
  ) as Record<(typeof REQUIRED_ENV)[number], string>;

  const taskArn = await getTaskArn();
  const userId = env.USER_ID;
  const gatewayUrl = `ws://localhost:${18789}`;

  // Initialize AWS clients
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamoSend = dynamoClient.send.bind(dynamoClient) as (cmd: any) => Promise<any>;

  const chatId = getTelegramChatId(userId);

  // Restore workspace from S3 (runs before gateway is ready)
  await restoreFromS3({
    bucket: env.DATA_BUCKET,
    prefix: `workspaces/${userId}`,
    localPath: "/data/workspace",
  });

  if (chatId) {
    await notifyTelegram(chatId, "⚡ 컨테이너 시작됨. AI 엔진 연결 중...");
  }

  // Wait for OpenClaw Gateway to be ready (up to 120s for cold start)
  await waitForPort(18789, 120000);

  // Initialize components
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const callbackSender = new CallbackSender(env.CALLBACK_URL, telegramBotToken);
  const openclawClient = new OpenClawClient(gatewayUrl, env.OPENCLAW_GATEWAY_TOKEN);
  await openclawClient.waitForReady();

  if (chatId) {
    await notifyTelegram(chatId, "✅ 준비 완료! 메시지를 처리합니다...");
  }

  const lifecycle = new LifecycleManager({
    dynamoSend,
    userId,
    taskArn,
    s3Bucket: env.DATA_BUCKET,
    s3Prefix: `workspaces/${userId}`,
    workspacePath: "/data/workspace",
  });

  // Update state to Starting
  await lifecycle.updateTaskState("Starting");

  // Create and start Bridge server
  const app = createApp({
    authToken: env.BRIDGE_AUTH_TOKEN,
    openclawClient,
    callbackSender,
    lifecycle,
  });

  const server = app.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.log(`Bridge server listening on port ${BRIDGE_PORT}`);
  });

  // Update state to Running
  await lifecycle.updateTaskState("Running");

  // Consume pending messages queued during cold start
  const consumed = await consumePendingMessages({
    dynamoSend,
    userId,
    processMessage: async (msg: PendingMessageItem) => {
      const generator = openclawClient.sendMessage(userId, msg.message);
      for await (const chunk of generator) {
        await callbackSender.send(msg.connectionId, {
          type: "stream_chunk",
          content: chunk,
        });
      }
      await callbackSender.send(msg.connectionId, {
        type: "stream_end",
      });
    },
  });

  if (consumed > 0) {
    console.log(`Processed ${consumed} pending message(s)`);
  }

  // Start periodic backup
  lifecycle.startPeriodicBackup();

  // SIGTERM handler
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    server.close(async () => {
      await lifecycle.gracefulShutdown();
      openclawClient.close();
      process.exit(0);
    });
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
