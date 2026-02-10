import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";

import type { ClientMessage, ServerMessage } from "@serverless-openclaw/shared";
import { getConnection } from "../services/connections.js";
import { getTaskState, putTaskState } from "../services/task-state.js";
import { routeMessage, savePendingMessage } from "../services/message.js";
import { startTask } from "../services/container.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ecsSend = ecs.send.bind(ecs) as (cmd: any) => Promise<any>;

export async function handler(event: {
  requestContext: { connectionId?: string };
  body?: string;
}): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId!;

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };
  }

  let msg: ClientMessage;
  try {
    msg = JSON.parse(event.body) as ClientMessage;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const connection = await getConnection(dynamoSend, connectionId);
  if (!connection) {
    return { statusCode: 403, body: JSON.stringify({ error: "Connection not found" }) };
  }

  const userId = connection.userId;

  if (msg.action === "getStatus") {
    const state = await getTaskState(dynamoSend, userId);
    const response: ServerMessage = {
      type: "status",
      status: state?.status ?? "idle",
    };
    return { statusCode: 200, body: JSON.stringify(response) };
  }

  if (msg.action === "sendMessage") {
    await routeMessage({
      userId,
      message: msg.message ?? "",
      channel: "web",
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
          { name: "BRIDGE_AUTH_TOKEN", value: process.env.BRIDGE_AUTH_TOKEN ?? "" },
          { name: "WEBSOCKET_CALLBACK_URL", value: process.env.WEBSOCKET_CALLBACK_URL ?? "" },
        ],
      },
    });

    return { statusCode: 200, body: JSON.stringify({ status: "processing" }) };
  }

  if (msg.action === "getHistory") {
    return { statusCode: 200, body: JSON.stringify({ type: "error", error: "Use REST API for history" }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };
}
