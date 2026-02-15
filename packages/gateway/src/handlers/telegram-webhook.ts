import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";

import { getTaskState, putTaskState } from "../services/task-state.js";
import { routeMessage, savePendingMessage } from "../services/message.js";
import { startTask } from "../services/container.js";
import { sendTelegramMessage } from "../services/telegram.js";
import { resolveUserId, verifyOtpAndLink } from "../services/identity.js";
import { resolveSecrets } from "../services/secrets.js";

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
  const secrets = await resolveSecrets([
    process.env.SSM_BRIDGE_AUTH_TOKEN!,
    process.env.SSM_TELEGRAM_BOT_TOKEN!,
    process.env.SSM_TELEGRAM_SECRET_TOKEN!,
  ]);

  const secretToken = event.headers["x-telegram-bot-api-secret-token"];
  const expectedToken = secrets.get(process.env.SSM_TELEGRAM_SECRET_TOKEN!) ?? "";

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
  const telegramId = String(update.message.from?.id ?? chatId);
  const rawUserId = `telegram:${telegramId}`;
  const connectionId = `telegram:${chatId}`;
  const botToken = secrets.get(process.env.SSM_TELEGRAM_BOT_TOKEN!) ?? "";
  const text = update.message.text;

  // Handle /link command
  if (text.startsWith("/link ")) {
    const code = text.slice(6).trim();
    if (!/^\d{6}$/.test(code)) {
      if (botToken) {
        await sendTelegramMessage(
          fetch as never,
          botToken,
          connectionId,
          "사용법: /link {6자리 코드}",
        );
      }
      return { statusCode: 200, body: "OK" };
    }
    const result = await verifyOtpAndLink(dynamoSend, telegramId, code);
    if (botToken) {
      const msg = "error" in result
        ? `❌ ${result.error}`
        : "✅ 계정 연동 완료! 이제 웹과 Telegram이 같은 컨테이너를 공유합니다.";
      await sendTelegramMessage(fetch as never, botToken, connectionId, msg);
    }
    return { statusCode: 200, body: "OK" };
  }

  // Handle /unlink command
  if (text === "/unlink") {
    if (botToken) {
      await sendTelegramMessage(
        fetch as never,
        botToken,
        connectionId,
        "연동 해제는 웹 UI 설정에서만 가능합니다.",
      );
    }
    return { statusCode: 200, body: "OK" };
  }

  // Resolve telegram userId to linked cognito userId if available
  const userId = await resolveUserId(dynamoSend, rawUserId);

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

  // Build environment for RunTask — include TELEGRAM_CHAT_ID when using resolved userId
  const taskEnv = [
    { name: "USER_ID", value: userId },
    { name: "CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
  ];
  if (userId !== rawUserId) {
    // Linked user: container needs to know the telegram chat ID for notifications
    taskEnv.push({ name: "TELEGRAM_CHAT_ID", value: String(chatId) });
  }

  await routeMessage({
    userId,
    message: text,
    channel: "telegram",
    connectionId,
    callbackUrl: process.env.WEBSOCKET_CALLBACK_URL ?? "",
    bridgeAuthToken: secrets.get(process.env.SSM_BRIDGE_AUTH_TOKEN!) ?? "",
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
      environment: taskEnv,
    },
  });

  return { statusCode: 200, body: "OK" };
}
