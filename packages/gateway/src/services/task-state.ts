import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { TABLE_NAMES, KEY_PREFIX } from "@serverless-openclaw/shared";
import type { TaskStateItem } from "@serverless-openclaw/shared";

type Send = (command: unknown) => Promise<unknown>;

export async function getTaskState(
  send: Send,
  userId: string,
): Promise<TaskStateItem | null> {
  const result = (await send(
    new GetCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      Key: { PK: `${KEY_PREFIX.USER}${userId}` },
    }),
  )) as { Item?: TaskStateItem };

  const item = result.Item;
  if (!item || item.status === "Idle") return null;
  return item;
}

export async function putTaskState(
  send: Send,
  item: TaskStateItem,
): Promise<void> {
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      Item: item,
    }),
  );
}

export async function deleteTaskState(
  send: Send,
  userId: string,
): Promise<void> {
  await send(
    new DeleteCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      Key: { PK: `${KEY_PREFIX.USER}${userId}` },
    }),
  );
}
