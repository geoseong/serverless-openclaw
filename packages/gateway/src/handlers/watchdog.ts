import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ECSClient, StopTaskCommand } from "@aws-sdk/client-ecs";
import {
  TABLE_NAMES,
  INACTIVITY_TIMEOUT_MS,
  MIN_UPTIME_MINUTES,
} from "@serverless-openclaw/shared";
import type { TaskStateItem } from "@serverless-openclaw/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});

export async function handler(): Promise<void> {
  const cluster = process.env.ECS_CLUSTER_ARN ?? "";
  const now = Date.now();

  const result = (await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      FilterExpression: "#s = :running",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":running": "Running" },
    }),
  )) as { Items?: TaskStateItem[] };

  const items = result.Items ?? [];

  for (const item of items) {
    const startedAt = new Date(item.startedAt).getTime();
    const lastActivity = new Date(item.lastActivity).getTime();
    const uptimeMs = now - startedAt;

    // Don't stop tasks that haven't been running long enough
    if (uptimeMs < MIN_UPTIME_MINUTES * 60 * 1000) {
      continue;
    }

    // Stop tasks that have been inactive too long
    const inactiveMs = now - lastActivity;
    if (inactiveMs > INACTIVITY_TIMEOUT_MS) {
      await ecs.send(
        new StopTaskCommand({
          cluster,
          task: item.taskArn,
          reason: "Watchdog: inactivity timeout",
        }),
      );

      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAMES.TASK_STATE,
          Key: { PK: item.PK },
        }),
      );
    }
  }
}
