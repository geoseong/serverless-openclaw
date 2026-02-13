import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAMES, KEY_PREFIX } from "@serverless-openclaw/shared";
import type { ConversationItem, Channel } from "@serverless-openclaw/shared";

type Send = (command: unknown) => Promise<unknown>;

const CONVERSATION_TTL_DAYS = 7;

export async function saveMessagePair(
  send: Send,
  userId: string,
  userMessage: string,
  assistantMessage: string,
  channel: Channel,
  conversationId = "default",
): Promise<void> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + CONVERSATION_TTL_DAYS * 86400;

  await send(
    new PutCommand({
      TableName: TABLE_NAMES.CONVERSATIONS,
      Item: {
        PK: `${KEY_PREFIX.USER}${userId}`,
        SK: `${KEY_PREFIX.CONV}${conversationId}#MSG#${now}`,
        role: "user",
        content: userMessage,
        channel,
        ttl,
      } satisfies ConversationItem,
    }),
  );

  await send(
    new PutCommand({
      TableName: TABLE_NAMES.CONVERSATIONS,
      Item: {
        PK: `${KEY_PREFIX.USER}${userId}`,
        SK: `${KEY_PREFIX.CONV}${conversationId}#MSG#${now + 1}`,
        role: "assistant",
        content: assistantMessage,
        channel,
        ttl,
      } satisfies ConversationItem,
    }),
  );
}

export async function loadRecentHistory(
  send: Send,
  userId: string,
  conversationId = "default",
  limit = 20,
): Promise<ConversationItem[]> {
  const result = (await send(
    new QueryCommand({
      TableName: TABLE_NAMES.CONVERSATIONS,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `${KEY_PREFIX.USER}${userId}`,
        ":sk": `${KEY_PREFIX.CONV}${conversationId}#MSG#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )) as { Items?: ConversationItem[] };

  return (result.Items ?? []).reverse();
}

export function formatHistoryContext(history: ConversationItem[]): string {
  if (history.length === 0) return "";

  const lines = history
    .map((item) => `<message role="${item.role}">${item.content}</message>`)
    .join("\n");

  return `<conversation_history>\n${lines}\n</conversation_history>\n\n`;
}
