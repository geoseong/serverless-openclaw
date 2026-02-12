import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";

import { getTaskState, putTaskState } from "../services/task-state.js";
import { routeMessage, savePendingMessage } from "../services/message.js";
import { startTask } from "../services/container.js";
import { sendTelegramMessage } from "../services/telegram.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ecsSend = ecs.send.bind(ecs) as (cmd: any) => Promise<any>;

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
  };
}

export async function handler(event: {
  headers: Record<string, string | undefined>;
  body?: string;
}): Promise<APIGatewayProxyResultV2> {
  const secretToken = event.headers["x-telegram-bot-api-secret-token"];
  const expectedToken = process.env.TELEGRAM_SECRET_TOKEN;

  if (!secretToken || secretToken !== expectedToken) {
    return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
  }

  if (!event.body) {
    return { statusCode: 200, body: "OK" };
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(event.body) as TelegramUpdate;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!update.message?.text) {
    return { statusCode: 200, body: "OK" };
  }

  const chatId = update.message.chat.id;
  const userId = `telegram:${update.message.from?.id ?? chatId}`;
  const connectionId = `telegram:${chatId}`;
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

  // Check task state for cold start reply
  const taskState = await getTaskState(dynamoSend, userId);
  const needsColdStart = !taskState || taskState.status === "Starting";

  if (needsColdStart && botToken) {
    await sendTelegramMessage(
      fetch as never,
      botToken,
      connectionId,
      "🔄 에이전트를 깨우는 중... 잠시만 기다려주세요.",
    );
  }

  await routeMessage({
    userId,
    message: update.message.text,
    channel: "telegram",
    connectionId,
    callbackUrl: process.env.WEBSOCKET_CALLBACK_URL ?? "",
    bridgeAuthToken: process.env.BRIDGE_AUTH_TOKEN ?? "",
    fetchFn: fetch as never,
    getTaskState: (uid) => getTaskState(dynamoSend, uid),
    startTask: (params) => startTask(ecsSend, params),
    putTaskState: (item) => putTaskState(dynamoSend, item),
    savePendingMessage: (item) => savePendingMessage(dynamoSend, item),
    startTaskParams: {
      cluster: process.env.ECS_CLUSTER_ARN ?? "",
      taskDefinition: process.env.TASK_DEFINITION_ARN ?? "",
      subnets: (process.env.SUBNET_IDS ?? "").split(","),
      securityGroups: (process.env.SECURITY_GROUP_IDS ?? "").split(","),
      containerName: "openclaw",
      environment: [
        { name: "USER_ID", value: userId },
        { name: "CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
      ],
    },
  });

  return { statusCode: 200, body: "OK" };
}
