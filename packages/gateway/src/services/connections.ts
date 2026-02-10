import { PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAMES, KEY_PREFIX, CONNECTION_TTL_SEC } from "@serverless-openclaw/shared";
import type { ConnectionItem } from "@serverless-openclaw/shared";

type Send = (command: unknown) => Promise<unknown>;

export async function saveConnection(
  send: Send,
  connectionId: string,
  userId: string,
): Promise<void> {
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.CONNECTIONS,
      Item: {
        PK: `${KEY_PREFIX.CONN}${connectionId}`,
        userId,
        connectedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SEC,
      },
    }),
  );
}

export async function getConnection(
  send: Send,
  connectionId: string,
): Promise<ConnectionItem | null> {
  const result = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.CONNECTIONS,
      Key: { PK: `${KEY_PREFIX.CONN}${connectionId}` },
    }),
  )) as { Item?: ConnectionItem };

  return result.Item ?? null;
}

export async function deleteConnection(
  send: Send,
  connectionId: string,
): Promise<void> {
  await send(
    new DeleteCommand({
      TableName: TABLE_NAMES.CONNECTIONS,
      Key: { PK: `${KEY_PREFIX.CONN}${connectionId}` },
    }),
  );
}
