import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getConversations } from "../services/conversations.js";
import { getTaskState } from "../services/task-state.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;

export async function handler(event: {
  requestContext: {
    http: { method: string; path: string };
    authorizer?: { jwt?: { claims?: { sub?: string } } };
  };
  rawPath: string;
  body?: string;
}): Promise<APIGatewayProxyResultV2> {
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === "GET" && path === "/conversations") {
    const items = await getConversations(dynamoSend, userId);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    };
  }

  if (method === "GET" && path === "/status") {
    const state = await getTaskState(dynamoSend, userId);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state ?? { status: "idle" }),
    };
  }

  return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
}
