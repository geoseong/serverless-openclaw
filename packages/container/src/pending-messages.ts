import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  TABLE_NAMES,
  KEY_PREFIX,
} from "@serverless-openclaw/shared";
import type { PendingMessageItem } from "@serverless-openclaw/shared";

interface ConsumeDeps {
  dynamoSend: (command: unknown) => Promise<unknown>;
  userId: string;
  processMessage: (msg: PendingMessageItem) => Promise<void>;
}

export async function consumePendingMessages(
  deps: ConsumeDeps,
): Promise<number> {
  const result = (await deps.dynamoSend(
    new QueryCommand({
      TableName: TABLE_NAMES.PENDING_MESSAGES,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `${KEY_PREFIX.USER}${deps.userId}`,
      },
    }),
  )) as { Items?: PendingMessageItem[] };

  const items = result.Items ?? [];

  for (const msg of items) {
    await deps.processMessage(msg);
    await deps.dynamoSend(
      new DeleteCommand({
        TableName: TABLE_NAMES.PENDING_MESSAGES,
        Key: { PK: msg.PK, SK: msg.SK },
      }),
    );
  }

  return items.length;
}
