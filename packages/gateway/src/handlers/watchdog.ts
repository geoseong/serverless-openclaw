import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ECSClient, StopTaskCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import {
  TABLE_NAMES,
  INACTIVITY_TIMEOUT_MS,
  MIN_UPTIME_MINUTES,
} from "@serverless-openclaw/shared";
import type { TaskStateItem } from "@serverless-openclaw/shared";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});

const STALE_STARTING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function handler(): Promise<void> {
  const cluster = process.env.ECS_CLUSTER_ARN ?? "";
  const now = Date.now();

  // Scan all active TaskState items (Running or Starting)
  const result = (await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAMES.TASK_STATE,
      FilterExpression: "#s IN (:running, :starting)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":running": "Running", ":starting": "Starting" },
    }),
  )) as { Items?: TaskStateItem[] };

  const items = result.Items ?? [];

  for (const item of items) {
    const startedAt = new Date(item.startedAt).getTime();
    const lastActivity = new Date(item.lastActivity).getTime();
    const uptimeMs = now - startedAt;

    if (item.status === "Starting") {
      // Clean up stale "Starting" entries — task may have failed to start
      if (uptimeMs > STALE_STARTING_TIMEOUT_MS) {
        // Verify the ECS task is actually stopped
        try {
          const desc = await ecs.send(
            new DescribeTasksCommand({ cluster, tasks: [item.taskArn] }),
          );
          const task = desc.tasks?.[0];
          if (!task || task.lastStatus === "STOPPED") {
            await ddb.send(
              new DeleteCommand({ TableName: TABLE_NAMES.TASK_STATE, Key: { PK: item.PK } }),
            );
          }
        } catch {
          // Task not found — clean up the stale entry
          await ddb.send(
            new DeleteCommand({ TableName: TABLE_NAMES.TASK_STATE, Key: { PK: item.PK } }),
          );
        }
      }
      continue;
    }

    // Running tasks: don't stop if uptime is too short
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
