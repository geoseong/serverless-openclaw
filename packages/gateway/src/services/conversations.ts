import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAMES, KEY_PREFIX } from "@serverless-openclaw/shared";
import type { ConversationItem } from "@serverless-openclaw/shared";

type Send = (command: unknown) => Promise<unknown>;

export async function getConversations(
  send: Send,
  userId: string,
  limit = 50,
): Promise<ConversationItem[]> {
  const result = (await send(
    new QueryCommand({
      TableName: TABLE_NAMES.CONVERSATIONS,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `${KEY_PREFIX.USER}${userId}`,
        ":sk": `${KEY_PREFIX.CONV}`,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )) as { Items?: ConversationItem[] };

  return result.Items ?? [];
}

export async function saveConversation(
  send: Send,
  item: ConversationItem,
): Promise<void> {
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.CONVERSATIONS,
      Item: item,
    }),
  );
}
