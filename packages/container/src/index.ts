import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BRIDGE_PORT } from "@serverless-openclaw/shared";
import { createApp } from "./bridge.js";
import { CallbackSender } from "./callback-sender.js";
import { OpenClawClient } from "./openclaw-client.js";
import { LifecycleManager } from "./lifecycle.js";
import { consumePendingMessages } from "./pending-messages.js";
import type { PendingMessageItem } from "@serverless-openclaw/shared";

const REQUIRED_ENV = [
  "BRIDGE_AUTH_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "USER_ID",
  "TASK_ARN",
  "S3_BUCKET",
  "CALLBACK_URL",
] as const;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function main(): Promise<void> {
  // Validate required env vars
  const env = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, requireEnv(name)]),
  ) as Record<(typeof REQUIRED_ENV)[number], string>;

  const userId = env.USER_ID;
  const gatewayUrl = `ws://localhost:${18789}`;

  // Initialize AWS clients
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamoSend = dynamoClient.send.bind(dynamoClient) as (cmd: any) => Promise<any>;

  // Initialize components
  const callbackSender = new CallbackSender(env.CALLBACK_URL);
  const openclawClient = new OpenClawClient(gatewayUrl, env.OPENCLAW_GATEWAY_TOKEN);

  const lifecycle = new LifecycleManager({
    dynamoSend,
    userId,
    taskArn: env.TASK_ARN,
    s3Bucket: env.S3_BUCKET,
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
